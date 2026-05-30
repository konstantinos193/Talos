import type { PaymentEvent } from './types.js';

export interface AuditFilter {
  agentAddress?: string;
  sinceMs?: number;
  limit?: number;
}

export interface AuditLog {
  record(event: PaymentEvent): Promise<void>;
  query(filter?: AuditFilter): Promise<PaymentEvent[]>;
}

export class MemoryAuditLog implements AuditLog {
  private readonly events: PaymentEvent[] = [];

  async record(event: PaymentEvent): Promise<void> {
    this.events.push(event);
  }

  async query(f?: AuditFilter): Promise<PaymentEvent[]> {
    let result = this.events as PaymentEvent[];
    if (f?.agentAddress) {
      const addr = f.agentAddress.toLowerCase();
      result = result.filter(e => e.agentAddress.toLowerCase() === addr);
    }
    if (f?.sinceMs !== undefined) {
      const since = f.sinceMs;
      result = result.filter(e => e.timestampMs >= since);
    }
    if (f?.limit !== undefined) {
      result = result.slice(-f.limit);
    }
    return [...result];
  }
}
