# Integrating Talos into an existing x402 v2 service

This guide is for operators who **already have a working x402 v2 resource server** and want to add Talos governance on top: per-route budget caps, allowlist enforcement, and a full audit trail. You are not starting from scratch.

---

## Prerequisites

- **x402 v2** resource server. Talos hooks into the v2 lifecycle (`onBeforeVerify`, `onAfterSettle`, etc.). x402 v1 is not supported.
- Node 18+, TypeScript, pnpm.
- Your facilitator and routes are already configured and working. Talos does not touch settlement — it adds a gate before verification and observes the outcome.

---

## 1. Install

Talos is not on npm yet. Clone the repo and install the packages locally via file: references. This is the only setup step that will feel manual; npm publish is roadmapped.

```bash
# 1. Clone Talos alongside your project
git clone https://github.com/konstantinos193/Talos.git

# 2. From your project root, add the two packages
cd your-project
pnpm add file:../Talos/packages/core file:../Talos/packages/x402
```

Your `package.json` will gain:
```json
{
  "dependencies": {
    "@talos/core": "file:../Talos/packages/core",
    "@talos/x402": "file:../Talos/packages/x402"
  }
}
```

Talos packages export TypeScript source directly and rely on `tsx` or your existing TS pipeline — no separate build step required.

---

## 2. Wire in governance — the minimal diff

Your existing server likely looks something like this:

```ts
// BEFORE — plain x402 v2 resource server
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

const facilitator = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator);
registerExactEvmScheme(resourceServer);  // required for eip155:* / Base

app.use(paymentMiddleware(routes, resourceServer));
```

Add Talos in three steps — no rewrites, no removed lines:

```ts
// AFTER — governed x402 v2 resource server
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { attachGovernance } from "@talos/x402";                                     // + add
import { PolicyEngine, MemoryBudgetStore, MemoryAllowlist, MemoryAuditLog } from "@talos/core"; // + add

// + add: build the policy engine
const engine = new PolicyEngine(
  new MemoryBudgetStore({
    default:  { limitAtomicUsdc: 10_000_000n, windowMs: 3_600_000 },  // $10/hr fallback
    perRoute: {
      "GET /scrape":  { limitAtomicUsdc:  10_000n, windowMs: 3_600_000 },  // $0.01/hr
      "GET /extract": { limitAtomicUsdc:  50_000n, windowMs: 3_600_000 },  // $0.05/hr
    },
  }),
  new MemoryAllowlist({ mode: "open" }),  // open = any agent; or "closed" with an address list
  new MemoryAuditLog(),
);

const facilitator = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator);
registerExactEvmScheme(resourceServer);
attachGovernance(resourceServer, engine);  // + add — hooks into the x402 lifecycle

app.use(paymentMiddleware(routes, resourceServer));
```

`attachGovernance` mutates `resourceServer` in-place (and returns it for chaining). It registers four hooks: `onBeforeVerify` gates the payment before the facilitator is ever called; `onVerifyFailure` and `onSettleFailure` release the budget reservation; `onAfterSettle` commits it. Your route handlers are unchanged.

---

## 3. Per-route budget config

The `MemoryBudgetStore` constructor takes a `BudgetConfig`:

```ts
interface BudgetConfig {
  default: RouteLimit;                      // fallback for any route not in perRoute
  perRoute?: Record<string, RouteLimit>;    // keyed by "METHOD /path"
}

interface RouteLimit {
  limitAtomicUsdc: bigint;  // spend cap in atomic USDC
  windowMs: number;         // rolling window in milliseconds
}
```

**USDC atomic convention.** USDC has 6 decimal places. One cent = `10_000n`; one dollar = `1_000_000n`. Use bigint literals (`n` suffix):

| Human value | `limitAtomicUsdc` |
|-------------|-------------------|
| $0.01       | `10_000n`         |
| $0.05       | `50_000n`         |
| $1.00       | `1_000_000n`      |
| $10.00      | `10_000_000n`     |

**The `default` limit** applies to every route not explicitly listed in `perRoute`. Set it high enough to never accidentally block a route you forgot to configure, and low enough that it still provides a safety net.

---

## 4. Route key format — important gotcha

The keys in `perRoute` must **exactly match** the route key Talos derives internally. The format is:

```
"METHOD /path"
```

Rules:
- HTTP method is **uppercase** (`GET`, `POST`, `DELETE`, …)
- A single space between method and path
- Trailing slashes are stripped — `GET /scrape/` becomes `GET /scrape`
- Root is `GET /` (not `GET`)

Talos derives the key from the Express `routePattern` if available, falling back to `req.path`. In practice, for routes like `app.get("/scrape", ...)` registered with Express, the key will be `"GET /scrape"` — exactly what you put in the routes config you already pass to `paymentMiddleware`.

**If a key doesn't match, the route silently falls through to the `default` limit.** There is no error. If you see a route spending up to the `default` cap instead of a per-route cap, check the key spelling in your config.

---

## 5. Audit endpoints

These are optional but without them you have no visibility into what's happening. Add them after your other routes:

```ts
// GET /audit?agent=0x...&since=<epochMs>&limit=N
app.get("/audit", async (req, res) => {
  const { agent, since, limit } = req.query;
  const events = await engine.queryAudit({
    agentAddress: typeof agent === "string" ? agent : undefined,
    sinceMs:      typeof since === "string" ? Number(since) : undefined,
    limit:        typeof limit === "string" ? Number(limit) : 50,
  });
  // bigint fields must be serialised to string for JSON
  res.json(events.map(e => ({ ...e, amountAtomicUsdc: e.amountAtomicUsdc.toString() })));
});

// GET /audit/budget?agent=0x...  — per-route spend breakdown
app.get("/audit/budget", async (req, res) => {
  const { agent } = req.query;
  if (typeof agent !== "string") {
    res.status(400).json({ error: "agent query param required" });
    return;
  }
  const breakdown = await engine.getSpent(agent);
  res.json({
    agent,
    perRoute: Object.fromEntries(
      Object.entries(breakdown).map(([k, v]) => [k, v.toString()]),
    ),
  });
});
```

`queryAudit` accepts an optional filter; omit `agentAddress` to see all agents. `getSpent` returns `Record<string, bigint>` — a per-route map of total spend within the current window.

---

## 6. Verify it works

Start your server, then run through these checks. Replace `0xYOUR_AGENT` with the wallet address your agent is actually paying from.

**Check 1 — payment under cap is allowed and settles:**

```bash
# send a payment for GET /scrape (you'll need a valid x402 payment header — use your existing agent or x402 test client)
curl -i -H "X-PAYMENT: <payment>" http://localhost:YOUR_PORT/scrape
# expect: HTTP 200
```

Then check the audit log:

```bash
curl "http://localhost:YOUR_PORT/audit?agent=0xYOUR_AGENT&limit=10"
```

You should see three events in order:

```json
[
  { "type": "payment:requested", "route": "GET /scrape", "agentAddress": "0xYOUR_AGENT", "amountAtomicUsdc": "10000" },
  { "type": "payment:approved",  "route": "GET /scrape", "agentAddress": "0xYOUR_AGENT", "amountAtomicUsdc": "10000" },
  { "type": "payment:settled",   "route": "GET /scrape", "agentAddress": "0xYOUR_AGENT", "amountAtomicUsdc": "10000", "txHash": "0x..." }
]
```

**Check 2 — payment over cap is blocked (no settlement):**

Set a route limit to `0n` temporarily, or send enough payments to exhaust the `$0.01` cap for `/scrape`, then send one more.

```bash
curl -i -H "X-PAYMENT: <payment>" http://localhost:YOUR_PORT/scrape
# expect: HTTP 402 with reason budget_exceeded
```

Audit log for that agent should now include:

```json
{ "type": "payment:rejected", "route": "GET /scrape", "reason": "budget_exceeded", "amountAtomicUsdc": "10000" }
```

No `payment:settled` event. The facilitator was never called. No on-chain transaction.

**Check 3 — per-route spend breakdown:**

```bash
curl "http://localhost:YOUR_PORT/audit/budget?agent=0xYOUR_AGENT"
```

Expected response:

```json
{
  "agent": "0xYOUR_AGENT",
  "perRoute": {
    "GET /scrape": "10000"
  }
}
```

Values are atomic USDC as strings (divide by `1_000_000` for dollar amount).

---

## 7. Production notes

Read this before you deploy to mainnet.

### State is in-memory — counters reset on restart

`MemoryBudgetStore` and `MemoryAuditLog` live in the Node process heap. When the process restarts, redeploys, or scales to zero, all budget counters and audit history are lost.

On your $0.01/$0.05 routes the financial stakes of a counter reset are low — an agent that hit its cap is unblocked again after a restart, but you're talking cents. The bigger concern is the audit log: history is gone after a restart, so you lose the paper trail.

For a service where this matters, the fix is a persistent adapter. The `BudgetStore` and `AuditLog` interfaces are small (4 methods and 2 methods respectively). A Redis `BudgetStore` is the obvious first target — hash keys per agent+route, TTL-driven windows. This is roadmapped; the interfaces are designed to be swapped.

### Single-process assumption

The in-memory store's `tryReserve`/`release` cycle is safe on a single Node.js event loop (no data races). If you run multiple replicas or workers, budget state is not shared across instances — each process tracks independently, and an agent could spend `N × limit` where `N` is your replica count. Again: persistent store is the fix.

### Orphaned-process gotcha

If you restart your server in the background (`node server.js &`) and the new process fails to bind the port silently (because the old one is still holding it), traffic continues hitting the old process on the old config. This can cause confusing behaviour where governance config changes don't appear to take effect.

Mitigate with a liveness check or a restart-on-failure policy (`pm2`, `systemd` with `Restart=always`, or a container restart policy). Before any deploy, verify the new process is actually the one handling requests.

---

## What's next

Once this is running:
- **Persistent storage** — swap `MemoryBudgetStore` for a Redis-backed adapter to survive restarts
- **Closed allowlist** — change `MemoryAllowlist({ mode: "open" })` to `"closed"` and populate with specific agent addresses
- **Dashboard** — the audit endpoints return JSON; a UI is on the roadmap

Questions or issues: [open an issue on GitHub](https://github.com/konstantinos193/Talos/issues).
