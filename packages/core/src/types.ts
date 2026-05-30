export type Hex = `0x${string}`;

export type PaymentEventType =
  | 'payment:requested'
  | 'payment:approved'
  | 'payment:rejected'
  | 'payment:settled'
  | 'payment:failed';

export interface PaymentContext {
  agentAddress: Hex;
  merchantAddress: Hex;
  amountAtomicUsdc: bigint;
  asset: string;
  network: string;
  route?: string;
  correlationId?: string;
}

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

export interface PaymentEvent {
  id: string;
  type: PaymentEventType;
  agentAddress: Hex;
  merchantAddress: Hex;
  amountAtomicUsdc: bigint;
  asset: string;
  network: string;
  route?: string;
  correlationId?: string;
  reason?: string;
  txHash?: string;
  timestampMs: number;
}
