import { randomUUID } from 'crypto';
import type { x402ResourceServer, VerifyFailureContext, SettleResultContext, SettleFailureContext } from '@x402/core/server';
import type { PolicyEngine, Hex } from '@talos/core';

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
function extractRoute(ctx: WithPayload): string {
  const tc = (ctx as any).transportContext as
    { request: { method: string; path: string; routePattern?: string } } | undefined;
  const method = tc?.request?.method ?? 'GET';
  const raw = tc?.request?.routePattern ?? tc?.request?.path ?? '/';
  const path = raw.replace(/\/+$/, '') || '/';
  return `${method} ${path}`;
}

export function attachGovernance(server: x402ResourceServer, engine: PolicyEngine): x402ResourceServer {
  return server
    // Gate fires BEFORE verify — content is never served on reject.
    // Tradeoff: 'from' is claimed-but-unverified here. A forged 'from' is
    // blocked by the facilitator verify that follows, and the reservation is
    // released by onVerifyFailure. Acceptable grief risk for testnet.
    .onBeforeVerify(async (ctx) => {
      const agent  = extractPayer(ctx);
      const route  = extractRoute(ctx);
      const amount = BigInt(ctx.requirements.amount);
      const base = {
        agentAddress: agent,
        merchantAddress: ctx.requirements.payTo as Hex,
        amountAtomicUsdc: amount,
        asset: ctx.requirements.asset,
        network: ctx.requirements.network,
        route,
        timestampMs: Date.now(),
      };

      await engine.auditLog.record({ id: randomUUID(), type: 'payment:requested', ...base });

      if (!await engine.allowlist.isAllowed(agent)) {
        await engine.auditLog.record({ id: randomUUID(), type: 'payment:rejected', reason: 'not_allowlisted', ...base });
        return { abort: true as const, reason: 'not_allowlisted' };
      }
      if (!await engine.budget.tryReserve(agent, route, amount)) {
        await engine.auditLog.record({ id: randomUUID(), type: 'payment:rejected', reason: 'budget_exceeded', ...base });
        return { abort: true as const, reason: 'budget_exceeded' };
      }

      await engine.auditLog.record({ id: randomUUID(), type: 'payment:approved', ...base });
      // reservation is held; released by onVerifyFailure or onSettleFailure
    })
    // Facilitator rejected the payment after we had already reserved.
    // Release the hold so budget is not permanently consumed by a bad payload.
    .onVerifyFailure(async (ctx: VerifyFailureContext) => {
      const agent  = extractPayer(ctx);
      const route  = extractRoute(ctx);
      const amount = BigInt(ctx.requirements.amount);
      await engine.budget.release(agent, route, amount);
      await engine.auditLog.record({
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
    })
    .onAfterSettle(async (ctx: SettleResultContext) => {
      const agent  = (ctx.result.payer as Hex | undefined) ?? extractPayer(ctx);
      const route  = extractRoute(ctx);
      const amount = BigInt(ctx.result.amount ?? ctx.requirements.amount);
      await engine.budget.commit(agent, route, amount);
      await engine.auditLog.record({
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
    })
    .onSettleFailure(async (ctx: SettleFailureContext) => {
      const agent  = extractPayer(ctx);
      const route  = extractRoute(ctx);
      const amount = BigInt(ctx.requirements.amount);
      await engine.budget.release(agent, route, amount);
      await engine.auditLog.record({
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
}
