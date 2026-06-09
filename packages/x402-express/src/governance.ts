import { randomUUID } from 'crypto';
import type { RequestHandler } from 'express';
import type { x402ResourceServer, VerifyFailureContext, SettleResultContext, SettleFailureContext } from '@x402/core/server';
import type { PolicyEngine, Hex, PaymentEvent } from '@talos/core';
import { computeActionRef } from '@talos/core';

// Minimal structural type — works for VerifyContext, SettleContext, and their sub-types.
type WithPayload = {
  paymentPayload: { payload: unknown };
  requirements: { payTo: string; amount: string; asset: string; network: string };
};

function extractPayer(ctx: WithPayload): Hex {
  const payload = ctx.paymentPayload.payload as Record<string, unknown>;
  const eip3009 = payload.authorization as { from?: string } | undefined;
  if (eip3009?.from) return eip3009.from as Hex;
  const p2 = payload.permit2Authorization as { from?: string } | undefined;
  if (p2?.from) return p2.from as Hex;
  return '0x0000000000000000000000000000000000000000';
}

// transportContext is typed as unknown in the hook ctx but is populated by x402-express
// with { request: { method, path, routePattern? } } from the real Express req.
// NEVER returns undefined — falls back to 'GET /' — so every emitted event carries a
// route as cross-rail audit metadata (the route is NOT part of the action_ref preimage).
function extractRoute(ctx: WithPayload): string {
  const tc = (ctx as any).transportContext as
    { request: { method: string; path: string; routePattern?: string } } | undefined;
  const method = tc?.request?.method ?? 'GET';
  const raw = tc?.request?.routePattern ?? tc?.request?.path ?? '/';
  const path = raw.replace(/\/+$/, '') || '/';
  return `${method} ${path}`;
}

// Raw payment header string from hook ctx — same value as req.headers['x-payment'].
// Returns undefined if not accessible (e.g. in tests without the full x402 transport).
function paymentKey(ctx: unknown): string | undefined {
  return (ctx as any).transportContext?.request?.paymentHeader as string | undefined;
}

interface Reconciliation {
  agent: Hex;
  route: string;
  amount: bigint;
  merchantAddress: Hex;
  asset: string;
  network: string;
}

export interface GovernanceOptions {
  // When true, attach a derived cross-rail `action_ref` to every recorded event.
  // OFF by default — the preimage is PROVISIONAL (see computeActionRef) and must be
  // confirmed byte-identical with Mycelium on testnet before enabling.
  deriveActionRef?: boolean;
}

export function attachGovernance(
  server: x402ResourceServer,
  engine: PolicyEngine,
  opts: GovernanceOptions = {},
): { server: x402ResourceServer; budgetReconciler: RequestHandler } {
  // Single record boundary: optionally enriches every event with action_ref so the
  // 8 call-sites below stay free of derivation logic (DRY — no duplicated hashing).
  const record = (e: Omit<PaymentEvent, 'action_ref'>) =>
    engine.auditLog.record(
      opts.deriveActionRef ? { ...e, action_ref: computeActionRef(e) } : e,
    );
  // Keyed by the raw x402 payment header. Tracks reservations that have been approved
  // by onBeforeVerify but not yet settled or released by a hook. The reconciler middleware
  // uses this to release reservations when the handler returns ≥400 and x402 skips settle.
  const pending = new Map<string, Reconciliation>();

  // Gate fires BEFORE verify — content is never served on reject.
  // Tradeoff: 'from' is claimed-but-unverified here. A forged 'from' is
  // blocked by the facilitator verify that follows, and the reservation is
  // released by onVerifyFailure. Acceptable grief risk for testnet.
  server.onBeforeVerify(async (ctx) => {
    const agent  = extractPayer(ctx as WithPayload);
    const route  = extractRoute(ctx as WithPayload);
    const amount = BigInt((ctx as WithPayload).requirements.amount);
    const base = {
      agentAddress: agent,
      merchantAddress: (ctx as WithPayload).requirements.payTo as Hex,
      amountAtomicUsdc: amount,
      asset: (ctx as WithPayload).requirements.asset,
      network: (ctx as WithPayload).requirements.network,
      route,
      timestampMs: Date.now(),
    };

    await record({ id: randomUUID(), type: 'payment:requested', ...base });

    if (!await engine.allowlist.isAllowed(agent)) {
      await record({ id: randomUUID(), type: 'payment:rejected', reason: 'not_allowlisted', ...base });
      return { abort: true as const, reason: 'not_allowlisted' };
    }
    if (!await engine.budget.tryReserve(agent, route, amount)) {
      await record({ id: randomUUID(), type: 'payment:rejected', reason: 'budget_exceeded', ...base });
      return { abort: true as const, reason: 'budget_exceeded' };
    }

    await record({ id: randomUUID(), type: 'payment:approved', ...base });

    const key = paymentKey(ctx);
    if (key) {
      pending.set(key, {
        agent, route, amount,
        merchantAddress: base.merchantAddress,
        asset: base.asset,
        network: base.network,
      });
    }
  });

  // Facilitator rejected the payment after we had already reserved.
  // Release the hold so budget is not permanently consumed by a bad payload.
  server.onVerifyFailure(async (ctx: VerifyFailureContext) => {
    const agent  = extractPayer(ctx);
    const route  = extractRoute(ctx);
    const amount = BigInt(ctx.requirements.amount);
    const key = paymentKey(ctx);
    if (key) pending.delete(key);   // reconciler won't see this — verify failed before handler ran
    await engine.budget.release(agent, route, amount);
    await record({
      id: randomUUID(),
      type: 'payment:failed',
      agentAddress: agent,
      merchantAddress: ctx.requirements.payTo as Hex,
      amountAtomicUsdc: amount,
      asset: ctx.requirements.asset,
      network: ctx.requirements.network,
      route,
      reason: ctx.error.message,
      timestampMs: Date.now(),
    });
  });

  server.onAfterSettle(async (ctx: SettleResultContext) => {
    const agent  = (ctx.result.payer as Hex | undefined) ?? extractPayer(ctx);
    const route  = extractRoute(ctx);
    const amount = BigInt(ctx.result.amount ?? ctx.requirements.amount);
    const key = paymentKey(ctx);
    if (key) pending.delete(key);   // committed; reconciler must not release a settled payment
    await engine.budget.commit(agent, route, amount);
    await record({
      id: randomUUID(),
      type: 'payment:settled',
      agentAddress: agent,
      merchantAddress: ctx.requirements.payTo as Hex,
      amountAtomicUsdc: amount,
      asset: ctx.requirements.asset,
      network: ctx.requirements.network,
      route,
      txHash: ctx.result.transaction,
      timestampMs: Date.now(),
    });
  });

  server.onSettleFailure(async (ctx: SettleFailureContext) => {
    const agent  = extractPayer(ctx);
    const route  = extractRoute(ctx);
    const amount = BigInt(ctx.requirements.amount);
    const key = paymentKey(ctx);
    // Exactly-once: only release if the reconciler hasn't already done so.
    // If key is absent (no correlation), fall back to unconditional release.
    if (!key || pending.has(key)) {
      if (key) pending.delete(key);
      await engine.budget.release(agent, route, amount);
    }
    await record({
      id: randomUUID(),
      type: 'payment:failed',
      agentAddress: agent,
      merchantAddress: ctx.requirements.payTo as Hex,
      amountAtomicUsdc: amount,
      asset: ctx.requirements.asset,
      network: ctx.requirements.network,
      route,
      reason: ctx.error.message,
      timestampMs: Date.now(),
    });
    // do NOT return { recovered: true } — let the failure propagate
  });

  // Reconciler middleware — mount BEFORE paymentMiddleware.
  // Fires on every response finish. If a payment was approved (pending entry exists)
  // but the handler returned ≥400 (x402 skipped settlement), releases the reservation
  // and logs payment:not_settled. The pending.delete() before any await ensures
  // exactly-once release even if onSettleFailure races on the same key.
  const budgetReconciler: RequestHandler = (req, res, next) => {
    res.on('finish', async () => {
      const key = req.headers['x-payment'] as string | undefined;
      if (!key) return;
      const entry = pending.get(key);
      if (!entry) return;
      pending.delete(key);      // claim before any await
      if (res.statusCode >= 400) {
        await engine.budget.release(entry.agent, entry.route, entry.amount);
        await record({
          id: randomUUID(),
          type: 'payment:not_settled',
          agentAddress: entry.agent,
          merchantAddress: entry.merchantAddress,
          amountAtomicUsdc: entry.amount,
          asset: entry.asset,
          network: entry.network,
          route: entry.route,
          reason: 'service_failed',
          timestampMs: Date.now(),
        });
      }
    });
    next();
  };

  return { server, budgetReconciler };
}
