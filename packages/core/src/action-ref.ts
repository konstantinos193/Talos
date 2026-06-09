import { createHash } from 'crypto';
import type { PaymentEvent } from './types.js';

/**
 * Deterministic cross-rail join key ("action_ref").
 *
 * Both Talos and Mycelium compute the SAME hash for the SAME payment so the two systems
 * can join on it with a plain SHA-256 compare. That only works if the preimage is
 * *byte-identical* on both sides — a single differing byte makes the hashes never match
 * and the join fails *silently*.
 *
 * Preimage spec (confirmed by giskard09 / Mycelium):
 *   { agent_id, action_type, scope, timestamp }  →  SHA-256(JCS(preimage)), hex, NO 0x prefix
 *
 *   - action_type and scope are FIXED literals (a permission *type*, not value-specific) —
 *     the route and amount stay in the Talos audit record as metadata but are NOT hashed.
 *   - timestamp is RFC 3339 (Date.toISOString(), millisecond precision: "...:00.000Z").
 *   - agent_id is the address AS-IS (no casing normalization in the reference impl).
 *
 * Two items to cross-verify byte-identical on testnet before enabling on mainnet:
 *   (1) timestamp precision — milliseconds (".000Z") vs seconds (":00Z"); we use ms.
 *   (2) agent_id casing — checksummed vs lowercase; we pass it through unchanged.
 * The testnet cross-verify (compare our hash vs Mycelium's for the same tuple) is the gate.
 */
const ACTION_TYPE = 'transfer.execute'; // fixed permission type — NOT the route
const SCOPE = 'talos:transfer'; // fixed permission scope — NOT the amount

export interface ActionRefDetail {
  /** The four preimage fields, before canonicalization. */
  preimage: { agent_id: string; action_type: string; scope: string; timestamp: string };
  /** The exact canonical (JCS) bytes that get hashed — compare THIS byte-for-byte with Mycelium. */
  canonical: string;
  /** SHA-256(canonical), lowercase hex, no 0x prefix. */
  actionRef: string;
}

/**
 * Full derivation, exposing the preimage and canonical bytes — use this for the cross-verify
 * step: if two `actionRef`s disagree, diffing the `canonical` strings shows exactly where
 * (casing, ms precision, field order, …).
 */
export function describeActionRef(
  e: Pick<PaymentEvent, 'agentAddress' | 'timestampMs'>,
): ActionRefDetail {
  const preimage = {
    agent_id: e.agentAddress,
    action_type: ACTION_TYPE,
    scope: SCOPE,
    timestamp: new Date(e.timestampMs).toISOString(), // RFC 3339, ms precision
  };
  const canonical = canonicalize(preimage);
  const actionRef = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return { preimage, canonical, actionRef };
}

export function computeActionRef(
  e: Pick<PaymentEvent, 'agentAddress' | 'timestampMs'>,
): string {
  return describeActionRef(e).actionRef;
}

/**
 * Minimal RFC 8785 (JCS) canonicalization for a FLAT object whose values are all strings
 * — which is all `computeActionRef`'s preimage contains. For this restricted value set,
 * "sort keys lexicographically + JSON.stringify each member" is byte-identical to a full
 * JCS implementation (e.g. the `canonicalize` npm lib giskard09's reference uses): JCS
 * mandates exactly lexicographic key order and standard JSON string escaping, which
 * JSON.stringify already produces. Swapping in the lib is trivial if the preimage ever
 * gains nested/float values, but the testnet cross-verify is the definitive byte check.
 */
function canonicalize(obj: Record<string, string>): string {
  const members = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`);
  return `{${members.join(',')}}`;
}
