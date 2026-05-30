export type AllowlistMode = 'open' | 'allowlist-only';

export interface Allowlist {
  isAllowed(merchantAddress: string): Promise<boolean>;
  allow(merchantAddress: string): Promise<void>;
  block(merchantAddress: string): Promise<void>;
}

export interface AllowlistInit {
  mode?: AllowlistMode;
  allowed?: string[];
  blocked?: string[];
}

export class MemoryAllowlist implements Allowlist {
  private readonly mode: AllowlistMode;
  private readonly allowed = new Set<string>();
  private readonly blocked = new Set<string>();

  constructor(init: AllowlistInit = {}) {
    this.mode = init.mode ?? 'open';
    init.allowed?.forEach(a => this.allowed.add(a.toLowerCase()));
    init.blocked?.forEach(a => this.blocked.add(a.toLowerCase()));
  }

  async isAllowed(merchantAddress: string): Promise<boolean> {
    const addr = merchantAddress.toLowerCase();
    if (this.blocked.has(addr)) return false;
    if (this.mode === 'allowlist-only') return this.allowed.has(addr);
    return true;
  }

  async allow(merchantAddress: string): Promise<void> {
    const addr = merchantAddress.toLowerCase();
    this.allowed.add(addr);
    this.blocked.delete(addr);
  }

  async block(merchantAddress: string): Promise<void> {
    const addr = merchantAddress.toLowerCase();
    this.blocked.add(addr);
    this.allowed.delete(addr);
  }
}
