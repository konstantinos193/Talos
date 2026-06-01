export type Hex = `0x${string}`;

export type PaymentEventType =
  | 'payment:requested'
  | 'payment:approved'
  | 'payment:rejected'
  | 'payment:settled'
  | 'payment:failed';

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
