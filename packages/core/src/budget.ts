export interface BudgetConfig {
  limitAtomicUsdc: bigint;
  windowMs: number;
}

export interface BudgetStore {
  canSpend(agentAddress: string, amount: bigint): Promise<boolean>;
  record(agentAddress: string, amount: bigint): Promise<void>;
  getSpent(agentAddress: string): Promise<bigint>;
  reset(agentAddress: string): Promise<void>;
  /** Atomic check-and-reserve: increments bucket if within limit, returns false otherwise. */
  tryReserve(agentAddress: string, amount: bigint): Promise<boolean>;
  /** Commit a prior reservation to permanent spend. No-op in memory store. */
  commit(agentAddress: string, amount: bigint): Promise<void>;
  /** Return a failed reservation to the budget. Subtracts from current-window spend. */
  release(agentAddress: string, amount: bigint): Promise<void>;
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

  // Synchronous read+write — atomic on Node's single-threaded event loop.
  // No await between check and increment, so concurrent payments can't both
  // pass the same under-budget check.
  async tryReserve(agentAddress: string, amount: bigint): Promise<boolean> {
    const b = this.bucket(agentAddress);
    if (b.spent + amount > this.config.limitAtomicUsdc) return false;
    b.spent += amount;
    return true;
  }

  // No-op: reservation is already counted in the bucket. Exists so persistent
  // stores (Redis) can finalize a two-phase reserve → commit.
  async commit(_agentAddress: string, _amount: bigint): Promise<void> {}

  async release(agentAddress: string, amount: bigint): Promise<void> {
    const b = this.bucket(agentAddress);
    b.spent = b.spent > amount ? b.spent - amount : 0n;
  }
}
