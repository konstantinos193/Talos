# x402 v1 → v2 Migration Log

_Completed: 2026-06-01_

---

## Why we did this

Two compounding problems made the migration urgent:

1. **Live runtime error.** Every payment attempt was returning:
   ```
   {"isValid":false,"invalidReason":"unsupported_scheme","payer":""}
   ```
   Root cause: `ncu -u` (our last dep bump) did **not** migrate us to the v2 `@x402/*` scope — it only bumped patch/minor versions within the old `x402*` scope. v2 is a fully renamed npm scope (`x402-express@1.2` → `@x402/express@2.x`), so we were silently still on v1 wire format while the facilitator (`x402.org/facilitator`) expected v2.

2. **The wrapper was the wrong architecture.** Our `packages/x402-express/src/middleware.ts` was a ~150-line hand-rolled middleware that duplicated most of upstream `x402-express` v1 in order to inject governance at two seams:
   - **Seam 1 (pre-settle):** call `engine.evaluate()` to check allowlist + budget
   - **Seam 2 (post-settle):** call `engine.recordSettled()` to write spend + emit event

   v2 ships `onBeforeSettle` / `onAfterSettle` / `onSettleFailure` as first-class hooks on `x402ResourceServer`. Those hooks **are** Seam 1 and Seam 2, natively. So the architecture became: wire governance into hooks, delete the wrapper.

---

## What changed (file by file)

### `package.json` (root)
| Before | After |
|---|---|
| `x402-express@^1.2.0` | removed |
| `x402-fetch@^1.2.0` | removed |
| — | `@x402/core@^2.14.0` |
| — | `@x402/express@^2.14.0` |
| — | `@x402/evm@^2.14.0` |
| — | `@x402/fetch@^2.14.0` |

`typecheck` script now also covers `packages/x402-express`.

---

### `packages/x402-express/` → `@talos/x402`

**Package renamed** from `@talos/x402-express` → `@talos/x402`.

Rationale: hooks live on `x402ResourceServer` (from `@x402/core`), which is framework-agnostic. The same governance attacher works with `@x402/hono`, `@x402/next`, etc. Naming it `-express` would have been wrong the moment we added a second transport.

**`middleware.ts` — deleted (150 lines → 0)**

The entire file was a workaround for the absence of hooks in v1. Now that v2 has hooks, the workaround is the problem.

**`governance.ts` — new (70 lines)**

```typescript
export function attachGovernance(server: x402ResourceServer, engine: PolicyEngine): x402ResourceServer
```

Wires three hooks:

| Hook | What it does |
|---|---|
| `onBeforeSettle` | Emits `payment:requested` → checks allowlist → `budget.tryReserve()` → emits `payment:approved`; returns `{ abort: true, reason }` on any rejection |
| `onAfterSettle` | `budget.commit()` → emits `payment:settled` with `txHash` |
| `onSettleFailure` | `budget.release()` → emits `payment:failed`; does **not** return `{ recovered: true }` so the failure propagates |

**Payer address extraction** (the tricky part): the v2 `SettleContext.paymentPayload.payload` is `Record<string, unknown>`. For EVM exact scheme (EIP-3009), the payer lives at `payload.authorization.from`. For Permit2 variant, it's at `payload.permit2Authorization.from`. The extractor handles both shapes.

**`tsconfig.json`** — fixed stale `@mvp1/core` path alias → `@talos/core`; added `"types": ["node"]`.

---

### `packages/core/src/budget.ts`

**Problem (latent bug):** `evaluate()` called `budget.canSpend()` (read-only check), then — after one or more `await`s for `verify` and `settle` — called `budget.record()` (write). Under concurrent payments from the same agent, two payments could both pass `canSpend` before either called `record`, blowing the cap.

**Fix:** Added `tryReserve / commit / release` to `BudgetStore` interface and `MemoryBudgetStore`:

```typescript
// atomic on Node's event loop — no await between read and write
async tryReserve(agentAddress: string, amount: bigint): Promise<boolean> {
  const b = this.bucket(agentAddress);
  if (b.spent + amount > this.config.limitAtomicUsdc) return false;
  b.spent += amount;  // increment happens here, not later
  return true;
}

async commit(_agentAddress: string, _amount: bigint): Promise<void> {}  // no-op in memory

async release(agentAddress: string, amount: bigint): Promise<void> {
  const b = this.bucket(agentAddress);
  b.spent = b.spent > amount ? b.spent - amount : 0n;
}
```

`commit` is a no-op in `MemoryBudgetStore` because the reservation already counted. When a persistent store (Redis) is added, `commit` finalises a two-phase reserve → confirm without a double-increment.

`release` is called from `onSettleFailure` to give the reserved amount back. A failed settlement must not permanently consume budget.

---

### `packages/core/src/policy.ts`

`budget`, `allowlist`, `auditLog` changed from `private readonly` → `readonly` (public).

`attachGovernance` in the `@talos/x402` package accesses these directly to call `tryReserve`, `release`, `commit`, and `auditLog.record`. Making them public is cleaner than adding engine-level wrapper methods for every new combination — and keeps `@talos/core` free of any dependency on `@x402/*` types.

Existing methods (`evaluate`, `recordRequested`, `recordSettled`, `recordFailed`) are kept for backwards compat; they are no longer called by the new hook code.

---

### `src/server.ts`

Before:
```typescript
app.use(governedPaymentMiddleware(payTo, routes, engine, { url: facilitatorUrl }));
```

After:
```typescript
const facilitator = new HTTPFacilitatorClient({ url: env.facilitatorUrl });
const resourceServer = new x402ResourceServer(facilitator);
registerExactEvmScheme(resourceServer);   // registers eip155:* wildcard
attachGovernance(resourceServer, engine); // wires governance hooks

app.use(paymentMiddleware({ "GET /paid": { accepts: [...] } }, resourceServer));
```

Route config changed from:
```typescript
{ price: "$0.001", network: "base-sepolia", config: { description, mimeType } }
```
to:
```typescript
{ accepts: [{ scheme: "exact", price: "$0.001", network: "eip155:84532", payTo }], description, mimeType }
```

Key changes:
- Network is CAIP-2 format: `base-sepolia` → `eip155:84532`
- `payTo` moves into the `accepts` array (per-payment-option in v2)
- `env.network` removed from runtime config — hardcoded `eip155:84532` since Base Sepolia is the only MVP target

---

### `src/agent.ts`

| Before | After |
|---|---|
| `import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch"` | `import { wrapFetchWithPayment, decodePaymentResponseHeader, x402Client } from "@x402/fetch"` |
| `wrapFetchWithPayment(fetch, account, BigInt(1_000_000))` | `new x402Client().register("eip155:*", new ExactEvmScheme(account))` + `wrapFetchWithPayment(fetch, client)` |
| `res.headers.get("x-payment-response")` | `res.headers.get("payment-response")` |
| `decodeXPaymentResponse(settle)` | `decodePaymentResponseHeader(settle)` |

The v2 client API separates signing strategy from transport:
- `x402Client` manages scheme registration and payment creation
- `ExactEvmScheme(account)` provides EIP-3009 signing for EVM exact payments
- `"eip155:*"` wildcard covers all EVM chains — no chain-specific config needed client-side

---

### `src/config/env.ts` + `.env.example`

Removed `X402_NETWORK` / `env.network` — no longer needed (network is hardcoded in the route).

---

## Protocol diff (v1 → v2)

| Dimension | v1 | v2 |
|---|---|---|
| Package scope | `x402-express`, `x402-fetch`, `x402` | `@x402/express`, `@x402/fetch`, `@x402/core`, `@x402/evm` |
| Network ID | `"base-sepolia"` (free-form string) | `"eip155:84532"` (CAIP-2) |
| Payment request header | `X-PAYMENT` | `PAYMENT-SIGNATURE` |
| Payment response header | `X-PAYMENT-RESPONSE` | `PAYMENT-RESPONSE` |
| Version field | `x402Version: 1` | `x402Version: 2` |
| Governance injection | Fork/wrap middleware | Native `onBeforeSettle` hook |
| Route config shape | `{ price, network, config: { ... } }` | `{ accepts: [{ scheme, price, network, payTo }], description, mimeType }` |

---

## Architecture before vs. after

**Before — wrapper around middleware:**

```
HTTP request
  ↓
governedPaymentMiddleware (packages/x402-express/src/middleware.ts ~150 lines)
  ├── manually builds PaymentRequirements
  ├── decodes X-PAYMENT header
  ├── engine.recordRequested(ctx)      ← Seam 1a
  ├── engine.evaluate(ctx)             ← Seam 1b (allowlist + budget read, racy)
  ├── calls facilitator.verify()
  ├── buffers response manually
  ├── calls next() → route handler
  ├── waits for handler to call res.end()
  ├── calls facilitator.settle()
  ├── engine.recordSettled(ctx, tx)    ← Seam 2 (budget write, after settle)
  └── flushes buffered response
```

**After — hooks on resource server:**

```
HTTP request
  ↓
paymentMiddleware(@x402/express) — ~0 custom code
  ↓
x402ResourceServer lifecycle:
  → onBeforeSettle hook  ← attachGovernance wires here
      ├── audit: payment:requested
      ├── allowlist.isAllowed(agent)   → abort if blocked
      └── budget.tryReserve(amount)    → abort if over limit, else reserve (atomic)
            ↓ (if not aborted)
  → facilitator.settle()
            ↓
  → onAfterSettle hook   ← attachGovernance wires here
      ├── budget.commit(agent, amount) (no-op in memory)
      └── audit: payment:settled + txHash
            OR
  → onSettleFailure hook ← attachGovernance wires here
      ├── budget.release(agent, amount)
      └── audit: payment:failed
```

---

## What is still NOT done (next steps)

- **Live on-chain proof** — run two cycles on Base Sepolia, capture new tx hashes, update README proof section
- **Over-budget test** — set `limitAtomicUsdc: 1n`, confirm `onBeforeSettle` aborts with `budget_exceeded` and no on-chain tx
- **Persistent BudgetStore** — Redis adapter (for multi-process / multi-instance deployments)
- **Persistent AuditLog** — Postgres or append-only file (memory resets on restart)
- **Dashboard** — query `/audit` and `/audit/budget` in a UI
- **Multi-tenant** — per-tenant engine instances and budget scoping
