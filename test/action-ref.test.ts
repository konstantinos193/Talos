import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeActionRef } from '../packages/core/src/index.js';

// Only agent_id and timestamp feed the preimage (action_type/scope are fixed literals).
const BASE = {
  agentAddress: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const,
  timestampMs: 1_700_000_000_000, // → "2023-11-14T22:13:20.000Z"
};

test('deterministic — same input produces the same action_ref', () => {
  assert.equal(computeActionRef(BASE), computeActionRef(BASE));
});

test('shape — bare lowercase 64-hex SHA-256, NO 0x prefix', () => {
  assert.match(computeActionRef(BASE), /^[0-9a-f]{64}$/);
});

// Golden value pinned to the confirmed Mycelium preimage:
//   { agent_id, action_type:"transfer.execute", scope:"talos:transfer", timestamp:RFC3339 }
// A mismatch here means the preimage recipe drifted — re-confirm against Mycelium.
test('golden — known input maps to the confirmed hash', () => {
  assert.equal(
    computeActionRef(BASE),
    '7dfce0356ce57d83ff479c1db0f4667a338bfc5b47b3115171b21abcfec0101f',
  );
});

// CROSS-VERIFY ITEM: the reference impl passes agent_id through unchanged, so casing is
// significant. The two rails must agree on checksummed-vs-lowercase, or the join breaks.
test('casing-sensitive — checksummed address hashes differently from lowercase', () => {
  const checksummed = { ...BASE, agentAddress: '0xDEADBEEFdeadbeefDEADBEEFdeadbeefDEADBEEF' as const };
  assert.notEqual(computeActionRef(checksummed), computeActionRef(BASE));
});

// CROSS-VERIFY ITEM: timestamp is RFC 3339 at millisecond precision (toISOString → ".000Z").
// A sub-second difference changes the hash; seconds-only precision would too.
test('ms-precision — a sub-second timestamp difference changes the hash', () => {
  const plusMs = { ...BASE, timestampMs: BASE.timestampMs + 123 };
  assert.notEqual(computeActionRef(plusMs), computeActionRef(BASE));
});

test('agent-sensitive — a different agent address changes the hash', () => {
  const other = { ...BASE, agentAddress: '0x1111111111111111111111111111111111111111' as const };
  assert.notEqual(computeActionRef(other), computeActionRef(BASE));
});
