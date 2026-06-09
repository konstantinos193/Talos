export type Hex = `0x${string}`;

export type PaymentEventType =
  | 'payment:requested'
  | 'payment:approved'
  | 'payment:rejected'
  | 'payment:settled'
  | 'payment:failed'
  | 'payment:not_settled';

export interface PaymentEvent {
  id: string;
  type: PaymentEventType;
  agentAddress: Hex;
  merchantAddress: Hex;
  amountAtomicUsdc: bigint;
  asset: string;
  network: string;
  // Optional on the type so audit *queries*/filters can omit it, but every event
  // EMITTED by attachGovernance always carries a route (see extractRoute). Cross-rail
  // consumers may rely on route being present on emitted events.
  route?: string;
  correlationId?: string;
  reason?: string;
  txHash?: string;
  timestampMs: number;
  // Derived cross-rail join key (SHA-256 of a canonical preimage). Populated only when
  // attachGovernance is given { deriveActionRef: true } — OFF by default. snake_case is
  // intentional: it's an external contract name (Mycelium), not a local convention.
  action_ref?: string;
}
