# Integrating Talos into an existing x402 v2 service

This guide is for operators who **already have a working x402 v2 resource server** and want to add Talos governance on top: per-route budget caps, allowlist enforcement, and a full audit trail. You are not starting from scratch.

---

## Prerequisites

- **x402 v2** resource server. Talos hooks into the v2 lifecycle (`onBeforeVerify`, `onAfterSettle`, etc.). x402 v1 is not supported.
- Node 18+, TypeScript, pnpm.
- Your facilitator and routes are already configured and working. Talos does not touch settlement — it adds a gate before verification and observes the outcome.

---

## 1. Install

Talos is not on npm yet. The two packages (`@talos/core` and `@talos/x402`) are an internal pnpm workspace — `@talos/x402` depends on `@talos/core` via `workspace:*`, so you **cannot** `pnpm add` the source folders directly (the `workspace:*` link won't resolve outside the workspace). The reliable way to consume them is to **pack each into a tarball** — packing rewrites the `workspace:*` link to a real version (`0.1.0`) — and install those. npm publish is roadmapped.

### a. Build the tarballs (in the Talos repo)

```bash
git clone https://github.com/konstantinos193/Talos.git
cd Talos
pnpm install
pnpm --filter @talos/core pack    # → packages/core/talos-core-0.1.0.tgz
pnpm --filter @talos/x402 pack    # → packages/x402-express/talos-x402-0.1.0.tgz
```

Re-run the two `pack` commands whenever you pull Talos updates.

### b. Install into your service

Install **both tarballs in one step** — `@talos/x402` requires `@talos/core@0.1.0`, and only the local core tarball provides it (it isn't on npm).

**npm / yarn** — works directly:
```bash
cd your-project
npm install ../Talos/packages/core/talos-core-0.1.0.tgz \
            ../Talos/packages/x402-express/talos-x402-0.1.0.tgz
```

**pnpm** needs an `overrides` entry so the transitive `@talos/core@0.1.0` resolves to the local tarball instead of the registry. Add this to your `pnpm-workspace.yaml` (create the file if you don't have one):
```yaml
overrides:
  "@talos/core": "file:../Talos/packages/core/talos-core-0.1.0.tgz"
```
then:
```bash
cd your-project
pnpm add ../Talos/packages/core/talos-core-0.1.0.tgz \
         ../Talos/packages/x402-express/talos-x402-0.1.0.tgz
```

### c. Requirement — your service must transpile TypeScript

> **Talos ships raw TypeScript** (`exports: "./src/index.ts"`, with `.js`-specifier imports that resolve to `.ts` files — there is no build step). Your service must run or build through **`tsx`** (e.g. `node --import tsx/esm`) **or a bundler configured to transpile `@talos/*`**. A plain `tsc` → `node dist` build will *not* pick these packages up, because `tsc` does not emit JS for dependencies inside `node_modules`.

(Shipping pre-built `dist/*.js` + `.d.ts`, so any consumer can install regardless of build setup, is roadmapped alongside npm publish.)

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
const { server, budgetReconciler } = attachGovernance(resourceServer, engine);  // + changed

app.use(budgetReconciler);                       // + add — MUST come before paymentMiddleware
app.use(paymentMiddleware(routes, server));      // + changed — pass the governed `server`
```

`attachGovernance` returns `{ server, budgetReconciler }`. It registers four hooks on the resource server — `onBeforeVerify` gates the payment before the facilitator is ever called; `onVerifyFailure` and `onSettleFailure` release the budget reservation; `onAfterSettle` commits it — and hands you a `budgetReconciler` Express middleware. (The returned `server` is the same `resourceServer` it mutated in place, so passing either to `paymentMiddleware` works; use `server` to match this wiring.)

**Mount `budgetReconciler` before `paymentMiddleware`.** It listens for response completion and, when a paid route's handler returns a status ≥ 400 — a failure x402 does *not* settle — releases the reservation and records a `payment:not_settled` event. Without it (or if mounted *after* `paymentMiddleware`), a handler that errors out after payment was approved would leave budget consumed for a request that never settled. Your route handlers are otherwise unchanged.

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

## 6. Cross-rail join (Mycelium) — `action_ref`

If you're joining Talos audit events with another rail (e.g. Mycelium anchors) on a deterministic key, the two systems compute the same SHA-256 `action_ref` from the same payment and join on it. **Recommended path: Talos exposes the raw fields, the other rail derives the hash** — one source of truth for the hash, no risk of a byte-level mismatch.

The confirmed preimage (Mycelium) is:

```jsonc
{
  "agent_id":    "<agentAddress>",     // the paying agent's address
  "action_type": "transfer.execute",   // FIXED literal — a permission type, not the route
  "scope":       "talos:transfer",     // FIXED literal — a permission scope, not the amount
  "timestamp":   "<RFC 3339>"          // e.g. "2023-11-14T22:13:20.000Z" — from timestampMs
}
// action_ref = SHA-256(JCS(preimage))  — lowercase hex, NO 0x prefix
```

Only `agent_id` and `timestamp` vary per event; `action_type` and `scope` are constants. **`route` and `amountAtomicUsdc` are NOT hashed** — they stay in the audit record as metadata. Read the two fields that feed the preimage straight off `GET /audit`:

| Audit field | Feeds | Form on the wire | Byte-identity note |
|-------------|-------|------------------|--------------------|
| `agentAddress` | `agent_id` | `0x`-prefixed EVM address | **⚠️ casing:** taken from the payment payload, may be EIP-55 checksummed (mixed-case). Talos passes it through **unchanged**; the two rails must agree (checksummed vs lowercase) or the hashes won't match. |
| `timestampMs` | `timestamp` | integer **milliseconds** epoch | Convert to RFC 3339 via `new Date(timestampMs).toISOString()` → millisecond precision (`...:20.000Z`). **⚠️ precision:** seconds-only (`...:20Z`) would change the hash. |

**Byte-identity is everything.** If the two preimages differ by a single byte the hashes never match and the join fails *silently* — the demo looks like it works but no rows join. Before relying on it, run the flow once on **testnet** (Arbitrum Sepolia) and confirm `Talos action_ref === Mycelium action_ref` for the same payment. Never debut this on mainnet.

### Optional: let Talos derive `action_ref` too

Talos can attach `action_ref` to every event itself, behind an opt-in flag that is **OFF by default**:

```ts
const { server, budgetReconciler } = attachGovernance(resourceServer, engine, { deriveActionRef: true });
```

It hashes the preimage above with the same `JCS → SHA-256 → hex` recipe. Keep it **off until a testnet cross-verify proves the hashes match** — the two open items are the timestamp precision (we emit milliseconds) and the address casing (we pass it through unchanged). The flag exists precisely so you can enable it for the testnet run, cross-verify, and only then consider it for mainnet.

---

## 7. Verify it works

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

**Check 4 — handler failure releases the reservation (the reconciler path):**

This is the check that proves `budgetReconciler` is wired in. Make a paid route fail *after* the payment is approved — temporarily have its handler return a status ≥ 400:

```ts
app.get("/scrape", (_req, res) => {
  res.status(502).json({ error: "upstream failed" });   // TEMPORARY — for this check only
});
```

Send a valid payment to `/scrape`, then read the audit log:

```bash
curl "http://localhost:YOUR_PORT/audit?agent=0xYOUR_AGENT&limit=10"
```

The handler returned ≥ 400, so x402 skips settlement and `budgetReconciler` releases the hold. You should see a `payment:not_settled` event — and **no** `payment:settled` for that call:

```json
{ "type": "payment:not_settled", "route": "GET /scrape", "reason": "service_failed", "amountAtomicUsdc": "10000" }
```

Confirm the reservation was actually returned — per-route spend drops back to where it was before this call:

```bash
curl "http://localhost:YOUR_PORT/audit/budget?agent=0xYOUR_AGENT"
```

Without `budgetReconciler` mounted (or mounted *after* `paymentMiddleware`), this hold would never be released and the agent would be charged budget for a request that never settled. Revert the temporary `502` when you're done.

---

## 8. Production notes

Read this before you deploy to mainnet.

### State is in-memory — counters reset on restart

`MemoryBudgetStore` and `MemoryAuditLog` live in the Node process heap. When the process restarts, redeploys, or scales to zero, all budget counters and audit history are lost.

On your $0.01/$0.05 routes the financial stakes of a counter reset are low — an agent that hit its cap is unblocked again after a restart, but you're talking cents. The bigger concern is the audit log: history is gone after a restart, so you lose the paper trail.

For a service where this matters, the fix is a persistent adapter. The `BudgetStore` and `AuditLog` interfaces are small (4 methods and 2 methods respectively). A Redis `BudgetStore` is the obvious first target — hash keys per agent+route, TTL-driven windows. This is roadmapped; the interfaces are designed to be swapped.

### Single-process assumption

The in-memory store's `tryReserve`/`release` cycle is safe on a single Node.js event loop (no data races). If you run multiple replicas or workers, budget state is not shared across instances — each process tracks independently, and an agent could spend `N × limit` where `N` is your replica count. Again: persistent store is the fix.

### Orphaned-process gotcha

If you restart your server in the background (`pnpm run server &`, `node server.js &`) and the new process fails to bind the port silently — because a stale process is still holding it — traffic keeps hitting the old process on the old config. Redirecting stdout (`pnpm run server > out.log &`) can swallow the bind error entirely, so the failure is invisible. This causes confusing behaviour where governance config changes don't appear to take effect.

Mitigate with a liveness check or a restart-on-failure policy (`pm2`, `systemd` with `Restart=always`, or a container restart policy). Before any deploy, verify the new process is actually the one handling requests.

---

## What's next

Once this is running:
- **Persistent storage** — swap `MemoryBudgetStore` for a Redis-backed adapter to survive restarts
- **Closed allowlist** — change `MemoryAllowlist({ mode: "open" })` to `"closed"` and populate with specific agent addresses
- **Dashboard** — the audit endpoints return JSON; a UI is on the roadmap

Questions or issues: [open an issue on GitHub](https://github.com/konstantinos193/Talos/issues).
