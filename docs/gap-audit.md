# Gap audit — x402 SDKs vs governance vision

**Date:** 2026-05-30 · **Status:** partial (x402-express + x402-fetch done, AP2 + MCP pending)

## Scope

Map what the existing x402 npm SDKs already expose for governance / control / observability against the MVP1 product vision:

- Per-agent budgets (per period)
- Merchant / contract allowlists + blocklists
- Human-in-the-loop approval above a threshold
- Full audit log + observability per payment
- Anomaly detection / flags
- Kill switch
- Caller-aware structured logging
- Programmatic pre-payment rejection (beyond static price)

Anything **ABSENT** below = a feature MVP1 owns. Anything **PRESENT / PARTIAL** = either reusable or a starting point for a thin wrapper.

---

## x402-express (v1.2.0)

Audited file: `node_modules/x402-express/dist/esm/index.mjs` (~290 LOC) + types in `node_modules/x402/dist/esm/middleware-DJ1ItBJV.d.mts`. Single exported function: `paymentMiddleware(payTo, routes, facilitator, paywall?)`.

### Extension points that DO exist

| Surface | Where | What it gives you |
|---|---|---|
| Per-route config | `PaymentMiddlewareConfig` keys `description`, `mimeType`, `maxTimeoutSeconds`, `inputSchema`, `outputSchema`, `customPaywallHtml`, `resource`, `discoverable` | Only "what this endpoint costs and what it returns". Not behavioural. |
| Facilitator `createAuthHeaders` | `facilitator: { url, createAuthHeaders }` — invoked at `x402/verify/index.mjs:15-18, 41-44, 67-69` | Per-call async hook to mint a fresh auth token. **Cannot reject a payment.** |
| Paywall config | `paywall: { cdpClientKey, appName, appLogo, sessionTokenEndpoint }` (`index.mjs:131-134`) | Cosmetic only — for browser HTML 402 responses. |
| Re-usable helpers exported from `x402/shared` + `x402/verify` | `useFacilitator`, `verify`, `settle`, `supported`, `list`, `findMatchingRoute`, `findMatchingPaymentRequirements`, `processPriceToAtomicAmount`, `toJsonSafe`, `settleResponseHeader` | **Can rebuild the middleware around these without forking.** This is the cleanest extension path. |

### Hard-coded behaviour that should be configurable

- 402 JSON error body strings hard-coded at `index.mjs:141, 154, 166, 176, 186, 255, 266`.
- `errorMessages` map IS declared in `PaymentMiddlewareConfig` (`middleware-DJ1ItBJV.d.mts:53-59`) but **never read** by the Express adapter. ← **Upstream PR opportunity.**
- `console.error` is the only logger (`index.mjs:151, 183, 262`) — no `logger` injection.
- Web-vs-API detection: hard-coded Mozilla UA + `text/html` sniff at `index.mjs:110-112`.
- `x402Version = 1` hard-coded at `index.mjs:21`.
- `scheme = "exact"` hard-coded at `index.mjs:49, 83` even though the type union allows growth.
- `maxTimeoutSeconds` defaults to 60 (`index.mjs:56, 90`); `discoverable` defaults to true (`index.mjs:63, 97`).
- EVM-only decode: `exact.evm.decodePayment(payment)` at `index.mjs:148` — no SVM branch.
- `DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator"` hard-coded at `x402/verify/index.mjs:10` (a non-prod default for a money-moving service).

### ABSENT — these are the moat features

| Feature | Status | Evidence |
|---|---|---|
| Per-agent / per-payer budgets | **ABSENT** | No counter, store, or window logic anywhere. Payer address IS available inside the closure (`decodedPayment.payload.authorization.from` and `response.payer` at `index.mjs:178`) but **nothing aggregates it**. |
| Merchant / contract allowlists or blocklists | **ABSENT** | Route matcher is path-pattern only (`index.mjs:25`). Only "must equal" check is `getAddress(payTo)` itself (`index.mjs:55`). |
| HITL approval above threshold | **ABSENT** | Single async function, no pause/resume, no queue, no out-of-band signal. After `verify` succeeds (`index.mjs:172`), straight through to `next()` at `index.mjs:230` then `settle` at `index.mjs:249`. |
| Audit log / event emission per payment | **ABSENT** | No `EventEmitter`, no `onPaymentVerified` / `onPaymentSettled` / `onPaymentFailed` callbacks. The rich `SettleResponse` (`x402Specs-D2zW4X9v.d.mts:827-846` — `transaction`, `network`, `payer`, `success`, `errorReason`) is consumed only to build the `X-PAYMENT-RESPONSE` base64 header at `index.mjs:250, 260` then discarded. |
| Anomaly detection / flags | **ABSENT** | No rate, velocity, or pattern tracking. Stateless per request. |
| Kill switch | **ABSENT** | No global flag, no env check, no disable predicate. To kill the flow you must un-mount the middleware. |
| Caller-aware structured logging | **ABSENT** | `console.error(error)` at `index.mjs:151, 183, 262` logs only the raw Error — no payer, no route, no correlation id, no structured fields. |
| Programmatic pre-payment rejection (beyond static price) | **ABSENT** | Once `verify` returns `isValid: true` (`index.mjs:172-173`), middleware unconditionally calls `next()` then `settle`. No `canSettle(payer, requirements, req)` predicate, no per-caller hook, no `req`-aware policy interceptor. |

PARTIAL — **per-payer identity awareness** only: the address is reachable inside the middleware closure but it is never surfaced upward.

---

## x402-fetch (v1.2.0)

Audited file: `node_modules/x402-fetch/dist/esm/index.mjs` (60 LOC) + types in `index.d.mts`. Single exported runtime function: `wrapFetchWithPayment(fetch, walletClient, maxValue?, paymentRequirementsSelector?, config?)`. Also re-exports `createSigner`, `decodeXPaymentResponse`, and the `Signer` / `MultiNetworkSigner` / `X402Config` / `PaymentRequirementsSelector` types.

### Extension points that DO exist

| Surface | Where | What it gives you |
|---|---|---|
| `maxValue: bigint` | `index.mjs:15, 30` | Single per-call cap. Default `BigInt(0.1 * 10**6)` = 100_000 base units = 0.1 USDC. Hard-fail on exceed (`"Payment amount exceeds maximum allowed"`). |
| `paymentRequirementsSelector` | `index.mjs:15, 25-29`, type from `x402/client` | **The only real programmable hook.** Signature: `(requirements: PaymentRequirements[], network, scheme) → PaymentRequirements`. Default `selectPaymentRequirements`. Throwing aborts. |
| `config: X402Config` | `index.mjs:15, 37`, passed to `createPaymentHeader` | Connectivity only (e.g. custom SVM RPC). Not a policy surface. |
| Re-exported primitives | `createSigner`, `decodeXPaymentResponse`, plus `createPaymentHeader` + `selectPaymentRequirements` from `x402/client` + `PaymentRequirementsSchema` from `x402/types` | **Can rebuild the wrapper without forking.** Same strategy as server. |

### Hard-coded behaviour

- **Selector is called synchronously** at `index.mjs:25-29` (`const selectedPaymentRequirements = paymentRequirementsSelector(...)`, no `await`). An async selector returning a `Promise` breaks at line 30 (`selected.maxAmountRequired` undefined). **This is the single biggest constraint — blocks HITL approval at this seam without re-writing the wrapper.**
- `"exact"` scheme hard-coded at `index.mjs:28`.
- `__is402Retry` flag set on the second `init` (`index.mjs:39-41, 49`) — brittle private contract; passing `init.__is402Retry: true` from outside silently skips payment.
- `Access-Control-Expose-Headers: X-PAYMENT-RESPONSE` attached as a *request* header at line 47 — odd-but-harmless CORS workaround.
- Network inference from `walletClient.chain?.id` (`index.mjs:24`) → `ChainIdToNetwork` lookup. If the wallet has no bound chain (plain `LocalAccount`), `network` is `undefined` and the selector picks without network filtering. Phase 0 verified this still works for a single-network 402.
- Errors are bare `throw new Error("...")` (`index.mjs:31, 40`) — no error code, no structured failure object.

### ABSENT — moat features on the client side

| Feature | Status | Evidence |
|---|---|---|
| Per-agent budget (per period) | **ABSENT** | `maxValue` is per-call only. No counter, no window, no state. |
| Merchant allowlist | **PARTIAL** | Achievable inside `paymentRequirementsSelector` by checking `req.payTo` and throwing. Possible but idiomatically the selector is "which of N", not "is this allowed". |
| Asset / network allowlist | **PARTIAL** | Same — selector sees `req.asset` and the `network` arg. |
| HITL approval | **ABSENT** | Selector is sync (`index.mjs:25`). No await, no callback, no queue. Requires re-writing the wrapper. |
| Audit log on agent side | **ABSENT** | No event emission. `decodeXPaymentResponse` exists as a helper but the wrapper never calls it — caller must log manually. |
| Pre-commit review of the signed payment | **ABSENT** | At `index.mjs:33-38`, `createPaymentHeader` builds + signs in one opaque step. The wrapper does NOT expose the unsigned authorization for inspection before signing. |
| Kill switch | **ABSENT** | No global predicate; only "don't call the wrapper". |
| Caller-aware structured logging | **ABSENT** | Wrapper logs nothing at all. |
| Failure observability | **ABSENT** | Two thrown strings only. No retry policy, no backoff, no failure classification. |

### Client-side injection seam

**1. The `paymentRequirementsSelector` parameter** — cleanest non-fork seam. Its sync nature limits it to fast deterministic checks: allowlist enforcement on `payTo` / `asset` / `network`, and synchronous spend-cap checks against an injected store. **Cannot await human approval.**

**2. Re-implement the wrapper.** All primitives (`createPaymentHeader`, `selectPaymentRequirements`, `decodeXPaymentResponse`, `PaymentRequirementsSchema`) are importable from `x402/client` / `x402/shared` / `x402/types`. A `@mvp1/x402-fetch-governed` wrapper can:

- Run an **async** `prePay({decodedRequirements, payer, runningSpend, req}) → Promise<{ allow, reason }>` hook (supports HITL).
- Decode the response and emit `agent:payment:requested`, `agent:payment:signed`, `agent:payment:settled`, `agent:payment:failed` events.
- Track per-period spend in a `BudgetStore` injected at construction time.
- Auto-decode `X-PAYMENT-RESPONSE` and emit the audit record without burdening the caller.

This mirrors the server strategy: re-use upstream primitives, replace the wrapping logic.

### Fork required for

- Inspecting the **unsigned** authorization before signing (`createPaymentHeader` is opaque — it signs internally; to expose a pre-sign hook the wrapper would need to re-implement EIP-712 typed-data construction).

Not on the MVP1 critical path.

---

## Server injection seams (ranked by leverage)

### 1. Pre-payment gate — between `findMatchingPaymentRequirements` and `verify`

**Location:** `node_modules/x402-express/dist/esm/index.mjs:159-181`

State at this point:
- `decodedPayment` is decoded → payer address known via `decodedPayment.payload.authorization.from`
- `selectedPaymentRequirements` is matched → asset + `maxAmountRequired` + recipient known
- `req` is in scope → route + headers + correlation id available

A hook of shape `preVerify(decodedPayment, selectedPaymentRequirements, req) → { allow, reason }` unlocks in **one place**:
- Budgets (per-period spend lookup keyed by `payer`)
- Allowlists / blocklists (by payer, by asset, by route)
- Kill switch (global predicate)
- Anomaly flag (rate/velocity check)
- HITL queueing (return `{ allow: false, reason: 'pending-approval' }` and push to a queue)

Today nothing is here. To inject **without fork**: wrap `paymentMiddleware` with an Express middleware that decodes the `X-PAYMENT` header, runs the policy, and either short-circuits with 402 or delegates downstream.

### 2. Post-payment audit hook — around `settle`

**Location:** `node_modules/x402-express/dist/esm/index.mjs:248-260`

After settlement succeeds, `settleResponse` (`{ success, transaction, network, payer, errorReason }`) is **the** audit record — but it dies as soon as `X-PAYMENT-RESPONSE` is set.

A hook of shape `postSettle(settleResponse, decodedPayment, selectedPaymentRequirements, req)` (or an `EventEmitter.emit("payment:settled", …)`) here is the natural place for:
- Audit log write
- Observability emit (Prometheus / OTel)
- Budget decrement (close the loop with #1)

`payment:failed` emission belongs in the `else` branch at `index.mjs:251-258` and the `catch` at `index.mjs:261-269`.

### 3. Cleanest non-fork pattern — wrap `useFacilitator`

**Location:** `node_modules/x402/dist/esm/verify/index.mjs:11-105` (the `useFacilitator(facilitator)` factory) and the destructured `{ verify, settle, supported }` at `x402-express/dist/esm/index.mjs:20`

Since the middleware destructures these once at line 20 and uses them as the only choke point for both facilitator round-trips, intercepting `verify` and `settle` gives **nearly all governance signals** without re-implementing the response-buffering logic at `index.mjs:191-284`.

Pattern:
```
const baseFacilitator = useFacilitator(facilitatorConfig)
const instrumented = {
  ...baseFacilitator,
  verify: async (...args) => { /* pre-policy check, then call baseFacilitator.verify, then emit */ },
  settle: async (...args) => { const r = await baseFacilitator.settle(...args); /* emit audit */; return r },
}
// pass `instrumented` as the facilitator arg — but: paymentMiddleware accepts { url, createAuthHeaders }, NOT a verify/settle pair. So this requires either:
//   (a) PR to upstream to accept a full facilitator client object, OR
//   (b) re-build the middleware ourselves using the exported helpers (verify, settle, findMatchingRoute, findMatchingPaymentRequirements, processPriceToAtomicAmount, toJsonSafe, settleResponseHeader — all importable).
```

Path (b) is the realistic MVP1 strategy: ship our own `@mvp1/x402-express-governed` package that re-uses x402's exported primitives and adds the policy + audit layer around them.

### Fork would be required for…

- Cancelling a payment based on **response body** inspection (the response is buffered at `index.mjs:201-229` but never exposed).
- Rejecting between `verify` and the protected handler running — no seam today.

Neither is on the MVP1 critical path.

---

## Pending audits

- **AP2 spec** (Google's Agent Payments Protocol — referenced in the master plan as Phase 1 reading material). Compare its governance surface vs x402.
- **MCP payments integration** (`@x402/mcp`) — if MCP becomes the agent transport, governance has to live at that layer too.

---

## Implications for Phase 2 MVP scope

The three injection seams + the seven ABSENT features map directly to a minimum shippable governance product:

1. **`@mvp1/core`** — pure library, no framework: `Policy`, `BudgetStore`, `Allowlist`, `AuditLog` interfaces + an in-memory default implementation. Zero x402 dependency, so it's reusable for AP2/MCP later.
2. **`@mvp1/x402-express`** — replaces the upstream `x402-express` middleware. Same constructor surface; wires `core` into seams #1 and #2.
3. **Dashboard (later, Phase 4)** — reads from `AuditLog`, writes to `Policy`, signs `Allowlist` updates.

The Phase 2 MVP slice (from `project_mvp1.md`): **budgets + allowlist + audit log** — all three sit cleanly in seams #1 (budgets, allowlist) and #2 (audit log). No fork, no upstream blocker.
