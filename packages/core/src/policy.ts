import type { PaymentEvent } from './types.js';
import type { BudgetStore } from './budget.js';
import type { Allowlist } from './allowlist.js';
import type { AuditLog, AuditFilter } from './audit.js';

export class PolicyEngine {
  constructor(
    readonly budget: BudgetStore,
    readonly allowlist: Allowlist,
    readonly auditLog: AuditLog,
  ) {}

  async queryAudit(filter?: AuditFilter): Promise<PaymentEvent[]> {
    return this.auditLog.query(filter);
  }

  async getSpent(agentAddress: string): Promise<Record<string, bigint>> {
    return this.budget.getSpent(agentAddress);
  }
}
