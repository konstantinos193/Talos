import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine, MemoryBudgetStore, MemoryAllowlist, MemoryAuditLog } from '../packages/core/src/index.js';
import { attachGovernance } from '../packages/x402-express/src/governance.js';
import type { x402ResourceServer } from '@x402/core/server';

// Captures the hooks that attachGovernance registers, without a real x402 server.
function makeStubServer() {
  const hooks: Record<string, (ctx: unknown) => Promise<unknown>> = {};
  const server = {
    onBeforeVerify(fn: (ctx: unknown) => Promise<unknown>) { hooks['beforeVerify'] = fn; return server; },
    onVerifyFailure(fn: (ctx: unknown) => Promise<unknown>) { hooks['verifyFailure'] = fn; return server; },
    onAfterSettle(fn: (ctx: unknown) => Promise<unknown>) { hooks['afterSettle'] = fn; return server; },
    onSettleFailure(fn: (ctx: unknown) => Promise<unknown>) { hooks['settleFailure'] = fn; return server; },
    hooks,
  };
  return server;
}

const AGENT = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;
const MERCHANT = '0x1111111111111111111111111111111111111111' as const;

function makeCtx(amount = '1000000') {
  return {
    paymentPayload: { payload: { authorization: { from: AGENT } } },
    requirements: { payTo: MERCHANT, amount, asset: 'USDC', network: 'eip155:84532' },
  };
}

// x402 middleware converts { abort: true } from onBeforeVerify to HTTP 402.
// These tests assert the abort signal directly; HTTP 402 is the guaranteed outcome.

test('over-budget → abort:true (→ HTTP 402)', async () => {
  const engine = new PolicyEngine(
    new MemoryBudgetStore({ limitAtomicUsdc: 0n, windowMs: 60_000 }),
    new MemoryAllowlist({ mode: 'open' }),
    new MemoryAuditLog(),
  );
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine);

  const result = await server.hooks['beforeVerify']!(makeCtx('1000000'));

  assert.deepEqual(result, { abort: true, reason: 'budget_exceeded' });
});

test('within budget → undefined (payment proceeds to facilitator)', async () => {
  const engine = new PolicyEngine(
    new MemoryBudgetStore({ limitAtomicUsdc: 10_000_000n, windowMs: 60_000 }),
    new MemoryAllowlist({ mode: 'open' }),
    new MemoryAuditLog(),
  );
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine);

  const result = await server.hooks['beforeVerify']!(makeCtx('1000000'));

  assert.equal(result, undefined);
});

test('not allowlisted → abort:true (→ HTTP 402)', async () => {
  const engine = new PolicyEngine(
    new MemoryBudgetStore({ limitAtomicUsdc: 10_000_000n, windowMs: 60_000 }),
    new MemoryAllowlist({ mode: 'allowlist-only' }),
    new MemoryAuditLog(),
  );
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine);

  const result = await server.hooks['beforeVerify']!(makeCtx());

  assert.deepEqual(result, { abort: true, reason: 'not_allowlisted' });
});

test('verify failure → budget released (no phantom spend)', async () => {
  const budget = new MemoryBudgetStore({ limitAtomicUsdc: 1_000_000n, windowMs: 60_000 });
  const engine = new PolicyEngine(budget, new MemoryAllowlist({ mode: 'open' }), new MemoryAuditLog());
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine);

  // reserve 1 USDC
  await server.hooks['beforeVerify']!(makeCtx('1000000'));
  assert.equal(await budget.getSpent(AGENT), 1_000_000n);

  // facilitator rejects — budget must be restored
  await server.hooks['verifyFailure']!({
    paymentPayload: { payload: { authorization: { from: AGENT } } },
    requirements: { payTo: MERCHANT, amount: '1000000', asset: 'USDC', network: 'eip155:84532' },
    error: new Error('facilitator unavailable'),
  });

  assert.equal(await budget.getSpent(AGENT), 0n);
});
