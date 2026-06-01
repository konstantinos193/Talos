# Pre-Settlement Gate Fix — Code Review Findings

_Completed: 2026-06-01 (follow-up to x402 v2 migration)_

---

## Critical: timing regression (finding #1)

### The bug

`onBeforeSettle` fires **after content has been served**. The v2 default flow is:

```
verify → serve resource → onBeforeSettle → settle
```

The budget/allowlist gate was wired in `onBeforeSettle`. This means:

- An over-budget agent still received the resource body.
- The `abort: true` return blocked the on-chain settlement — but the agent already got the data.
- This was "serve then block the payment", not "block before serving".

This was a regression from v1. The old `middleware.ts` had an explicit response-buffer that held back `res.end()` until settlement completed. The v2 rewrite removed that buffer (correctly — the library handles it) but moved the gate to the wrong hook.

### The v1 buffer (for reference)

The deleted `middleware.ts` did this:
```typescript
// intercept res.end() — don't flush until after settle
res.end = function (...args) {
  bufferedCalls.push(['end', args]);
  endCalled();
  return res;
};
next();
await endPromise;           // wait for handler to call res.end()
await settle(...);          // THEN settle
restore();                  // THEN flush the buffered response
```

This was necessary in v1 because there was no hook to abort before serving. In v2, `onBeforeVerify` is that hook.

### The fix

Moved the gate to **`onBeforeVerify`** — the earliest point in the v2 lifecycle, before the facilitator is even called:

```
onBeforeVerify → (verify with facilitator) → serve resource → settle
```

If `onBeforeVerify` returns `{ abort: true }`, the response is a `402` with the rejection reason. Nothing is served, nothing settles.

New hook mapping:

| Hook | Action |
|---|---|
| `onBeforeVerify` | emit `requested` → check allowlist → `tryReserve` → emit `approved`; return `{ abort }` on any rejection |
| `onVerifyFailure` | `release` reservation + emit `payment:failed` — facilitator rejected a previously-approved payment |
| `onAfterSettle` | `commit` + emit `payment:settled` with `txHash` |
| `onSettleFailure` | `release` + emit `payment:failed` |

### The tradeoff

In `onBeforeVerify`, the payer address (`authorization.from`) is **claimed-but-unverified**. A forged `from` is still caught by the facilitator verify that follows — in which case `onVerifyFailure` fires and the reservation is released. The grief vector is:

> Flood of invalid payloads that claim a legitimate payer's `from` address → each causes a transient budget reservation → released as soon as verify fails.

This is acceptable for testnet/MVP. Rate-limiting at the HTTP layer is the future mitigation.

### Over-budget test correction

The existing test plan checked: _"no on-chain transaction when over-budget."_ This test would have **passed** with the buggy `onBeforeSettle` gate — there was no tx, but the agent still got the resource body.

Correct test:
1. Set `limitAtomicUsdc: 1n` (effectively 0 budget).
2. Run agent.
3. Assert: HTTP response is `402` (not `200`) **and** response body contains `budget_exceeded`.
4. Assert: no on-chain tx.
5. Assert: `/audit` shows `payment:requested` → `payment:rejected` (reason: `budget_exceeded`). No `payment:approved` or `payment:settled` events.

---

## windowMs is fine — clarification (#2)

The `MemoryBudgetStore.bucket()` method:

```typescript
private bucket(agentAddress: string): Bucket {
  const now = Date.now();
  const existing = this.buckets.get(agentAddress);
  if (!existing || now - existing.windowStart >= this.config.windowMs) {
    // window expired — create fresh bucket, old spend is forgotten
    const fresh = { spent: 0n, windowStart: now };
    this.buckets.set(agentAddress, fresh);
    return fresh;
  }
  return existing;
}
```

Old spend IS evicted when the window expires (the bucket object is replaced). `tryReserve` mutates the bucket in-place (`b.spent += amount`), and since `b` is the same object reference stored in `this.buckets`, the mutation persists until the next window rollover. The rolling window is working correctly.

The edge case to be aware of: a reservation made near the end of a window may span a rollover. If `onSettleFailure` fires after the window resets, the `release` call will decrement from the new window's `spent = 0n` (resulting in clamp to `0n`). The `console.warn` added to `release` covers this case — it explains the difference between a logic bug and a window-boundary event.

---

## Amount source (#3)

Budget reservation uses `ctx.requirements.amount` — the server's declared route price — not `authorization.value` (what the agent signed). For the `exact` scheme, the facilitator enforces that these are equal, so the source doesn't matter for correctness. Using `requirements.amount` is the right choice because:

- It's always the canonical price the server intends to charge.
- It doesn't depend on the (unverified) client payload in `onBeforeVerify`.
- It's consistent across `onBeforeVerify`, `onVerifyFailure`, and `onSettleFailure`.

`onAfterSettle` uses `ctx.result.amount ?? ctx.requirements.amount`. The `result.amount` is the actual settled amount (present in `upto` scheme; typically absent in `exact`). Keying budget commit off the settled amount is the correct behavior — charge what was actually transferred.

---

## `release` underflow warning (#4)

Added `console.warn` in `MemoryBudgetStore.release` when `b.spent < amount`:

```typescript
if (b.spent < amount) {
  console.warn(`budget.release: releasing ${amount} but bucket.spent=${b.spent} for ${agentAddress} — possible logic bug or window rollover`);
}
```

Two root causes produce this warning:
1. **Logic bug**: more is being released than was reserved (double-release, wrong agent address, etc.).
2. **Window rollover**: the reservation was made in window N, the window expired before `onSettleFailure` or `onVerifyFailure` fired, so the new window starts at `0n`.

Both are worth knowing about. The warn is non-fatal — the clamp to `0n` is the correct behavior in either case.

---

## Dead code deleted (#5)

The following methods were removed from `PolicyEngine` (nothing called them after the v2 migration):

- `evaluate(ctx: PaymentContext): Promise<PolicyDecision>` — was Seam 1 in v1 middleware
- `recordRequested(ctx)` — was called before verify in v1 middleware
- `recordSettled(ctx, txHash)` — was called after settle in v1 middleware
- `recordFailed(ctx, reason)` — was called on settle failure in v1 middleware
- `private emit(type, ctx, extras)` — internal helper for all of the above

Also removed from `@talos/core` public API (pre-npm, no external consumers):
- `PaymentContext` type — was the parameter type for all deleted methods
- `PolicyDecision` type — was the return type of `evaluate()`

`PolicyEngine` now exposes only what's actually used: `budget`, `allowlist`, `auditLog` (readonly public), `queryAudit()`, `getSpent()`.

---

## Redis TTL note (future work, flagged)

When a Redis-backed `BudgetStore` is added: **reservations need a TTL**. If the server crashes between `tryReserve` and `onAfterSettle`/`onSettleFailure`, the held amount is permanently stuck reducing the agent's budget until the window rolls over naturally.

Mitigation: store reservations as a separate key with `TTL = windowMs` (or `maxTimeoutSeconds` + a small buffer). On TTL expiry the hold auto-releases. This is the Redis Lua analogue of the current window-rollover behavior in `MemoryBudgetStore`.
