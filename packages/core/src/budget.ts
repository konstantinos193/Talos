export interface BudgetConfig {
  limitAtomicUsdc: bigint;
  windowMs: number;
}

export interface BudgetStore {
  canSpend(agentAddress: string, amount: bigint): Promise<boolean>;
  record(agentAddress: string, amount: bigint): Promise<void>;
  getSpent(agentAddress: string): Promise<bigint>;
  reset(agentAddress: string): Promise<void>;
}

interface Bucket {
  spent: bigint;
  windowStart: number;
}

export class MemoryBudgetStore implements BudgetStore {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: BudgetConfig) {}

  private bucket(agentAddress: string): Bucket {
    const now = Date.now();
    const existing = this.buckets.get(agentAddress);
    if (!existing || now - existing.windowStart >= this.config.windowMs) {
      const fresh: Bucket = { spent: 0n, windowStart: now };
      this.buckets.set(agentAddress, fresh);
      return fresh;
    }
    return existing;
  }

  async canSpend(agentAddress: string, amount: bigint): Promise<boolean> {
    const b = this.bucket(agentAddress);
    return b.spent + amount <= this.config.limitAtomicUsdc;
  }

  async record(agentAddress: string, amount: bigint): Promise<void> {
    this.bucket(agentAddress).spent += amount;
  }

  async getSpent(agentAddress: string): Promise<bigint> {
    return this.bucket(agentAddress).spent;
  }

  async reset(agentAddress: string): Promise<void> {
    this.buckets.delete(agentAddress);
  }
}
