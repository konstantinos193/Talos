# Talos

> Congrats, your agent just paid $40 in API fees while you slept. Built this so mine wouldn't.

**Talos** is the opinionated audit + budget layer for [x402](https://github.com/coinbase/x402) agent payments. x402 v2 gives you the enforcement hook (`onBeforeVerify`). Talos is the policy engine that drops into it — per-agent budget caps, allowlists, and a full audit trail — so every team isn't hand-rolling the same spend tracking differently.

![Talos demo — over-budget agent blocked, funded agent settles on-chain](demo.gif)

*Scene 1: over-budget agent → `onBeforeVerify` → HTTP 402, resource never served, no payment initiated. Scene 2: funded agent → status 200 → on-chain settlement with tx hash → full audit trail.*

---

## The problem

Your agent has a wallet. Right now it operates on trust and vibes.

It can hammer your paid endpoints all night. Each call settles on-chain. You'll find out in the morning when the wallet's dry — or when you get a very creative invoice. There's no log, no limit, no way to ask "wait, what did it *actually* spend and on what?".

Talos is the part where it stops.

---

## Proof it works

**The block** — over-budget agent, `GET /paid`, $0.00 limit:

```json
[
  { "type": "payment:requested", "agentAddress": "0x742d35...", "amountAtomicUsdc": "1000" },
  { "type": "payment:rejected",  "agentAddress": "0x742d35...", "amountAtomicUsdc": "1000", "reason": "budget_exceeded" }
]
```

HTTP 402 returned. Resource never served. No payment initiated. The block fires at `onBeforeVerify` — before x402 touches the facilitator.

**The allow** — funded agent, same endpoint, $10 USDC/hr limit:

```json
[
  {
    "type": "payment:requested",
    "agentAddress": "0xAFc6Bb7fC4A4cd3C500F15798F7aC82be5d5caeD",
    "route": "GET /paid",
    "amountAtomicUsdc": "1000",
    "network": "base-sepolia",
    "timestampMs": 1780143556663
  },
  {
    "type": "payment:approved",
    "agentAddress": "0xAFc6Bb7fC4A4cd3C500F15798F7aC82be5d5caeD",
    "route": "GET /paid",
    "amountAtomicUsdc": "1000",
    "network": "base-sepolia",
    "timestampMs": 1780143556663
  },
  {
    "type": "payment:settled",
    "agentAddress": "0xAFc6Bb7fC4A4cd3C500F15798F7aC82be5d5caeD",
    "route": "GET /paid",
    "amountAtomicUsdc": "1000",
    "network": "base-sepolia",
    "txHash": "0x913aa602e7626114a7eae31e13cd4886eb9f7370acea7783d5a2b47753a327d8",
    "timestampMs": 1780143558054
  }
]
```

Verified on-chain: [basescan ↗](https://sepolia.basescan.org/tx/0x913aa602e7626114a7eae31e13cd4886eb9f7370acea7783d5a2b47753a327d8)

And `/audit/budget?agent=0xAFc6...`:

```json
{
  "agent": "0xAFc6Bb7fC4A4cd3C500F15798F7aC82be5d5caeD",
  "spentAtomicUsdc": "2000",
  "spentUsdc": "0.002000"
}
```

`requested → approved → settled`. Every decision, logged. Every cent, accounted for.

The `requested` and `approved` timestamps match — the policy check (budget + allowlist) is synchronous in-memory, sub-millisecond. The gap is between approval and on-chain settlement (~1.4s above).

---

## Install

> **Not on npm yet** — clone and build locally. npm publish coming once the API stabilises.
> **API in flux** — migrating to x402 v2 lifecycle hooks. Code samples below reflect v1; updated examples in [`src/server.ts`](src/server.ts).

Adding Talos to an existing x402 v2 service? See **[INTEGRATION.md](INTEGRATION.md)** — step-by-step guide with before/after diffs, per-route budget config, and production caveats.

```bash
git clone https://github.com/konstantinos193/Talos.git
cd Talos && npm install
```

**Before** (stock x402-express):

```ts
import { paymentMiddleware } from "x402-express";

app.use(paymentMiddleware(payTo, routes, { url: facilitatorUrl }));
```

**After** (governed):

```ts
import { governedPaymentMiddleware } from "@talos/x402-express";
import { PolicyEngine, MemoryBudgetStore, MemoryAllowlist, MemoryAuditLog } from "@talos/core";

const engine = new PolicyEngine(
  new MemoryBudgetStore({ limitAtomicUsdc: 10_000_000n, windowMs: 60 * 60 * 1000 }), // 10 USDC/hr per agent
  new MemoryAllowlist({ mode: "open" }),
  new MemoryAuditLog(),
);

app.use(governedPaymentMiddleware(payTo, routes, engine, { url: facilitatorUrl }));
```

One extra argument. Everything else stays.

Then wire up the audit endpoints:

```ts
// GET /audit?agent=0x...&since=<ms>&limit=N
app.get("/audit", async (req, res) => {
  const { agent, since, limit } = req.query;
  const events = await engine.queryAudit({
    agentAddress: typeof agent === "string" ? agent : undefined,
    sinceMs: typeof since === "string" ? Number(since) : undefined,
    limit: typeof limit === "string" ? Number(limit) : 50,
  });
  res.json(events.map(e => ({ ...e, amountAtomicUsdc: e.amountAtomicUsdc.toString() })));
});

// GET /audit/budget?agent=0x...
app.get("/audit/budget", async (req, res) => {
  const { agent } = req.query;
  if (typeof agent !== "string") { res.status(400).json({ error: "agent required" }); return; }
  const spent = await engine.getSpent(agent);
  res.json({ agent, spentAtomicUsdc: spent.toString(), spentUsdc: (Number(spent) / 1_000_000).toFixed(6) });
});
```

Full working example: [`src/server.ts`](src/server.ts)

---

## What it does

| | |
|---|---|
| **Budget enforcement** | Per-agent USDC cap over a rolling time window. Agent hits the limit → payment rejected, 402 returned. |
| **Allowlist** | Open (any agent) or closed (explicit address list). |
| **Audit log** | Every payment request, every approval/rejection, every on-chain settlement — queryable by agent and time range. |
| **x402 drop-in** | Wraps `x402-express`. No protocol changes, no lock-in. |

---

## What it doesn't do (yet)

- **No persistent storage.** `MemoryBudgetStore` and `MemoryAuditLog` reset on restart. Bring your own DB adapter — the interfaces are small.
- **x402 only.** Not a general agent payments SDK.
- **Testnet only.** Base Sepolia. Don't put this in front of mainnet money before you know what you're doing.
- **No dashboard.** The audit endpoints return JSON. A UI is on the roadmap.

---

## Status

Early. The loop is closed — agent pays, governance enforces, audit logs it, on-chain settlement confirmed. Production-hardening in progress.

Issues and PRs welcome. If you're building x402 infra and want to compare notes, open an issue or find me on Twitter.

---

## License

MIT
