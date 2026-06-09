export interface RouteLimit {
  limitAtomicUsdc: bigint;
  windowMs: number;
}

export interface BudgetConfig {
  default: RouteLimit;
  perRoute?: Record<string, RouteLimit>;  // keyed by "METHOD /path", e.g. "GET /scrape"
}

export interface BudgetStore {
  /** Atomic check-and-reserve: pushes an entry if within limit, returns false otherwise. */
  tryReserve(agent: string, route: string, amount: bigint): Promise<boolean>;
  /** Commit a prior reservation to permanent spend. No-op in memory store. */
  commit(agent: string, route: string, amount: bigint): Promise<void>;
  /** Return a failed reservation to the budget. */
  release(agent: string, route: string, amount: bigint): Promise<void>;
  /** Per-route spend within the current window. Keys are "METHOD /path". */
  getSpent(agent: string): Promise<Record<string, bigint>>;
}

interface Entry {
  amount: bigint;
  ts: number;
}

export class MemoryBudgetStore implements BudgetStore {
  private readonly buckets = new Map<string, Entry[]>();

  constructor(private readonly config: BudgetConfig) {}

  private limitFor(route: string): RouteLimit {
    return this.config.perRoute?.[route] ?? this.config.default;
  }

  private key(agent: string, route: string): string {
    return `${agent}:${route}`;
  }

  // Prunes expired entries in-place; returns live entries and their summed spend.
  // Payer addresses start with 0x (no colon); route is "METHOD /path" (no colon before the space),
  // so splitting on the first colon in getSpent unambiguously recovers the route.
  private live(key: string, windowMs: number): { entries: Entry[]; spent: bigint } {
    const cutoff = Date.now() - windowMs;
    const all = this.buckets.get(key) ?? [];
    const entries = all.filter(e => e.ts > cutoff);
    this.buckets.set(key, entries);
    let spent = 0n;
    for (const e of entries) spent += e.amount;
    return { entries, spent };
  }

  // Synchronous read+write — atomic on Node's single-threaded event loop.
  // No await between check and push, so concurrent payments can't both pass the same limit.
  async tryReserve(agent: string, route: string, amount: bigint): Promise<boolean> {
    const { limitAtomicUsdc, windowMs } = this.limitFor(route);
    const key = this.key(agent, route);
    const { entries, spent } = this.live(key, windowMs);
    if (spent + amount > limitAtomicUsdc) return false;
    entries.push({ amount, ts: Date.now() });
    this.buckets.set(key, entries);
    return true;
  }

  // No-op: reservation already counts and ages out of the window naturally.
  // A persistent (Redis) store finalises the two-phase reserve → commit here.
  async commit(_agent: string, _route: string, _amount: bigint): Promise<void> {}

  async release(agent: string, route: string, amount: bigint): Promise<void> {
    // LIFO amount-match is fine for this memory store where reserve→release is tightly paired
    // per request. Switch to reservation token + TTL when building the Redis adapter.
    const { windowMs } = this.limitFor(route);
    const key = this.key(agent, route);
    const { entries } = this.live(key, windowMs);
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]?.amount === amount) {
        entries.splice(i, 1);
        break;
      }
    }
    this.buckets.set(key, entries);
  }

  async getSpent(agent: string): Promise<Record<string, bigint>> {
    const out: Record<string, bigint> = {};
    const prefix = `${agent}:`;
    for (const key of this.buckets.keys()) {
      if (!key.startsWith(prefix)) continue;
      const route = key.slice(prefix.length);
      const { spent } = this.live(key, this.limitFor(route).windowMs);
      if (spent > 0n) out[route] = spent;
    }
    return out;
  }
}
