import { randomUUID } from 'crypto';
import type { PaymentContext, PolicyDecision, PaymentEvent, PaymentEventType } from './types.js';
import type { BudgetStore } from './budget.js';
import type { Allowlist } from './allowlist.js';
import type { AuditLog } from './audit.js';

export class PolicyEngine {
  constructor(
    readonly budget: BudgetStore,
    readonly allowlist: Allowlist,
    readonly auditLog: AuditLog,
  ) {}

  async evaluate(ctx: PaymentContext): Promise<PolicyDecision> {
    const merchantAllowed = await this.allowlist.isAllowed(ctx.merchantAddress);
    if (!merchantAllowed) {
      await this.emit('payment:rejected', ctx, { reason: 'merchant-blocked' });
      return { allow: false, reason: 'merchant-blocked' };
    }

    const withinBudget = await this.budget.canSpend(ctx.agentAddress, ctx.amountAtomicUsdc);
    if (!withinBudget) {
      await this.emit('payment:rejected', ctx, { reason: 'budget-exceeded' });
      return { allow: false, reason: 'budget-exceeded' };
    }

    await this.emit('payment:approved', ctx);
    return { allow: true };
  }

  async recordRequested(ctx: PaymentContext): Promise<void> {
    await this.emit('payment:requested', ctx);
  }

  async recordSettled(ctx: PaymentContext, txHash: string): Promise<void> {
    await this.budget.record(ctx.agentAddress, ctx.amountAtomicUsdc);
    await this.emit('payment:settled', ctx, { txHash });
  }

  async recordFailed(ctx: PaymentContext, reason: string): Promise<void> {
    await this.emit('payment:failed', ctx, { reason });
  }

  async queryAudit(filter?: import('./audit.js').AuditFilter): Promise<import('./types.js').PaymentEvent[]> {
    return this.auditLog.query(filter);
  }

  async getSpent(agentAddress: string): Promise<bigint> {
    return this.budget.getSpent(agentAddress);
  }

  private async emit(
    type: PaymentEventType,
    ctx: PaymentContext,
    extras: Pick<PaymentEvent, 'reason' | 'txHash'> = {},
  ): Promise<void> {
    await this.auditLog.record({
      id: randomUUID(),
      type,
      agentAddress: ctx.agentAddress,
      merchantAddress: ctx.merchantAddress,
      amountAtomicUsdc: ctx.amountAtomicUsdc,
      asset: ctx.asset,
      network: ctx.network,
      route: ctx.route,
      correlationId: ctx.correlationId,
      timestampMs: Date.now(),
      ...extras,
    });
  }
}
