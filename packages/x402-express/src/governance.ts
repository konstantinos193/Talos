import { randomUUID } from 'crypto';
import type { x402ResourceServer, SettleContext, SettleResultContext, SettleFailureContext } from '@x402/core/server';
import type { PolicyEngine } from '@talos/core';
import type { Hex } from '@talos/core';

function extractPayer(ctx: SettleContext): Hex {
  const payload = ctx.paymentPayload.payload as Record<string, unknown>;
  const eip3009 = payload.authorization as { from?: string } | undefined;
  if (eip3009?.from) return eip3009.from as Hex;
  const permit2 = payload.permit2Authorization as { from?: string } | undefined;
  if (permit2?.from) return permit2.from as Hex;
  return '0x0000000000000000000000000000000000000000';
}

function extractAmount(ctx: SettleContext | SettleResultContext): bigint {
  const override = (ctx as SettleResultContext).result?.amount;
  return BigInt(override ?? ctx.requirements.amount);
}

export function attachGovernance(server: x402ResourceServer, engine: PolicyEngine): x402ResourceServer {
  return server
    .onBeforeSettle(async (ctx) => {
      const agent = extractPayer(ctx);
      const amount = extractAmount(ctx);
      const merchantAddress = ctx.requirements.payTo as Hex;
      const base = {
        agentAddress: agent,
        merchantAddress,
        amountAtomicUsdc: amount,
        asset: ctx.requirements.asset,
        network: ctx.requirements.network,
        timestampMs: Date.now(),
      };

      await engine.auditLog.record({ id: randomUUID(), type: 'payment:requested', ...base });

      if (!await engine.allowlist.isAllowed(agent)) {
        await engine.auditLog.record({ id: randomUUID(), type: 'payment:rejected', reason: 'not_allowlisted', ...base });
        return { abort: true as const, reason: 'not_allowlisted' };
      }
      if (!await engine.budget.tryReserve(agent, amount)) {
        await engine.auditLog.record({ id: randomUUID(), type: 'payment:rejected', reason: 'budget_exceeded', ...base });
        return { abort: true as const, reason: 'budget_exceeded' };
      }

      await engine.auditLog.record({ id: randomUUID(), type: 'payment:approved', ...base });
    })
    .onAfterSettle(async (ctx) => {
      const agent = (ctx.result.payer ?? extractPayer(ctx)) as Hex;
      const amount = extractAmount(ctx);
      const txHash = ctx.result.transaction;
      await engine.budget.commit(agent, amount);
      await engine.auditLog.record({
        id: randomUUID(),
        type: 'payment:settled',
        agentAddress: agent,
        merchantAddress: ctx.requirements.payTo as Hex,
        amountAtomicUsdc: amount,
        asset: ctx.requirements.asset,
        network: ctx.requirements.network,
        txHash,
        timestampMs: Date.now(),
      });
    })
    .onSettleFailure(async (ctx) => {
      const agent = extractPayer(ctx);
      const amount = BigInt(ctx.requirements.amount);
      await engine.budget.release(agent, amount);
      await engine.auditLog.record({
        id: randomUUID(),
        type: 'payment:failed',
        agentAddress: agent,
        merchantAddress: ctx.requirements.payTo as Hex,
        amountAtomicUsdc: amount,
        asset: ctx.requirements.asset,
        network: ctx.requirements.network,
        reason: (ctx as SettleFailureContext).error?.message,
        timestampMs: Date.now(),
      });
      // do NOT return { recovered: true } — let the failure propagate
    });
}
