import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { PolicyEngine, MemoryBudgetStore, MemoryAllowlist, MemoryAuditLog, computeActionRef } from '../packages/core/src/index.js';
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

const AGENT    = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;
const MERCHANT = '0x1111111111111111111111111111111111111111' as const;

function makeCtx(amount = '1000000', path = '/paid', paymentHeader?: string) {
  return {
    paymentPayload: { payload: { authorization: { from: AGENT } } },
    requirements: { payTo: MERCHANT, amount, asset: 'USDC', network: 'eip155:84532' },
    transportContext: { request: { method: 'GET', path, routePattern: path, paymentHeader } },
  };
}

function makeVerifyFailureCtx(amount = '1000000', path = '/paid') {
  return { ...makeCtx(amount, path), error: new Error('facilitator unavailable') };
}

function makeSettleCtx(amount = '1000000', path = '/paid', paymentHeader?: string) {
  return {
    ...makeCtx(amount, path, paymentHeader),
    result: { payer: AGENT, amount, transaction: '0xdeadbeef' },
    error: undefined,
  };
}

// Minimal fake Express req/res for reconciler tests.
function makeFakeReqRes(paymentHeader: string, statusCode: number) {
  const req = { headers: { 'x-payment': paymentHeader } } as any;
  const res = Object.assign(new EventEmitter(), { statusCode }) as any;
  return { req, res };
}

// x402 middleware converts { abort: true } from onBeforeVerify to HTTP 402.
// These tests assert the abort signal directly; HTTP 402 is the guaranteed outcome.

test('over-budget → abort:true (→ HTTP 402)', async () => {
  const engine = new PolicyEngine(
    new MemoryBudgetStore({ default: { limitAtomicUsdc: 0n, windowMs: 60_000 } }),
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
    new MemoryBudgetStore({ default: { limitAtomicUsdc: 10_000_000n, windowMs: 60_000 } }),
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
    new MemoryBudgetStore({ default: { limitAtomicUsdc: 10_000_000n, windowMs: 60_000 } }),
    new MemoryAllowlist({ mode: 'allowlist-only' }),
    new MemoryAuditLog(),
  );
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine);

  const result = await server.hooks['beforeVerify']!(makeCtx());

  assert.deepEqual(result, { abort: true, reason: 'not_allowlisted' });
});

test('verify failure → budget released (no phantom spend)', async () => {
  const budget = new MemoryBudgetStore({ default: { limitAtomicUsdc: 1_000_000n, windowMs: 60_000 } });
  const engine = new PolicyEngine(budget, new MemoryAllowlist({ mode: 'open' }), new MemoryAuditLog());
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine);

  // reserve 1 USDC on GET /paid
  await server.hooks['beforeVerify']!(makeCtx('1000000'));
  assert.equal((await budget.getSpent(AGENT))['GET /paid'], 1_000_000n);

  // facilitator rejects — budget must be restored
  await server.hooks['verifyFailure']!(makeVerifyFailureCtx('1000000'));

  assert.deepEqual(await budget.getSpent(AGENT), {});
});

test('per-route isolation — /scrape exhausted does not block /extract', async () => {
  const budget = new MemoryBudgetStore({
    default:  { limitAtomicUsdc: 100_000_000n, windowMs: 60_000 },
    perRoute: {
      'GET /scrape':  { limitAtomicUsdc: 10_000n, windowMs: 60_000 },  // $0.01
      'GET /extract': { limitAtomicUsdc: 50_000n, windowMs: 60_000 },  // $0.05
    },
  });
  const engine = new PolicyEngine(budget, new MemoryAllowlist({ mode: 'open' }), new MemoryAuditLog());
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine);

  // first /scrape at $0.01 — fills the $0.01 cap exactly
  assert.equal(await server.hooks['beforeVerify']!(makeCtx('10000', '/scrape')), undefined);

  // second /scrape is over budget (10_000 + 10_000 > 10_000 cap)
  const blocked = await server.hooks['beforeVerify']!(makeCtx('10000', '/scrape'));
  assert.deepEqual(blocked, { abort: true, reason: 'budget_exceeded' });

  // /extract is in a separate bucket — must still pass
  const extractResult = await server.hooks['beforeVerify']!(makeCtx('50000', '/extract'));
  assert.equal(extractResult, undefined);
});

test('composite key release — verifyFailure releases correct per-route bucket', async () => {
  const budget = new MemoryBudgetStore({
    default:  { limitAtomicUsdc: 100_000_000n, windowMs: 60_000 },
    perRoute: {
      'GET /scrape': { limitAtomicUsdc: 10_000n, windowMs: 60_000 },
    },
  });
  const engine = new PolicyEngine(budget, new MemoryAllowlist({ mode: 'open' }), new MemoryAuditLog());
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine);

  // reserve on /scrape
  await server.hooks['beforeVerify']!(makeCtx('10000', '/scrape'));
  assert.equal((await budget.getSpent(AGENT))['GET /scrape'], 10_000n);

  // verify fails → release
  await server.hooks['verifyFailure']!(makeVerifyFailureCtx('10000', '/scrape'));
  assert.deepEqual(await budget.getSpent(AGENT), {});

  // a subsequent /scrape call at the full cap should now be allowed again
  const result = await server.hooks['beforeVerify']!(makeCtx('10000', '/scrape'));
  assert.equal(result, undefined);
});

test('window rolling — reserved amount ages out after windowMs', async () => {
  const WINDOW = 80;  // 80ms for fast test
  const budget = new MemoryBudgetStore({
    default: { limitAtomicUsdc: 10_000n, windowMs: WINDOW },
  });
  const engine = new PolicyEngine(budget, new MemoryAllowlist({ mode: 'open' }), new MemoryAuditLog());
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine);

  // fill the cap
  await server.hooks['beforeVerify']!(makeCtx('10000'));
  const blocked = await server.hooks['beforeVerify']!(makeCtx('10000'));
  assert.deepEqual(blocked, { abort: true, reason: 'budget_exceeded' });

  // wait for window to expire
  await sleep(WINDOW + 10);

  // should be allowed again
  const result = await server.hooks['beforeVerify']!(makeCtx('10000'));
  assert.equal(result, undefined);
});

test('service failure (status ≥400) → reservation released + payment:not_settled logged', async () => {
  const budget = new MemoryBudgetStore({ default: { limitAtomicUsdc: 1_000_000n, windowMs: 60_000 } });
  const auditLog = new MemoryAuditLog();
  const engine = new PolicyEngine(budget, new MemoryAllowlist({ mode: 'open' }), auditLog);
  const server = makeStubServer();
  const { budgetReconciler } = attachGovernance(server as unknown as x402ResourceServer, engine);

  const PAYMENT_HEADER = 'x402-test-header-aabbcc';

  // reserve via onBeforeVerify
  await server.hooks['beforeVerify']!(makeCtx('1000000', '/paid', PAYMENT_HEADER));
  assert.equal((await budget.getSpent(AGENT))['GET /paid'], 1_000_000n);

  // simulate failed response (status 500) — x402 would skip settlement here
  const { req, res } = makeFakeReqRes(PAYMENT_HEADER, 500);
  await new Promise<void>(resolve => budgetReconciler(req, res, resolve));
  res.emit('finish');
  await new Promise<void>(resolve => setImmediate(resolve));

  // budget must be freed
  assert.deepEqual(await budget.getSpent(AGENT), {});

  // audit must include payment:not_settled
  const events = await auditLog.query({ agentAddress: AGENT });
  assert.ok(events.some(e => e.type === 'payment:not_settled'), 'expected payment:not_settled event');
});

test('successful response → reconciler skips release (no false-positive)', async () => {
  const budget = new MemoryBudgetStore({ default: { limitAtomicUsdc: 1_000_000n, windowMs: 60_000 } });
  const auditLog = new MemoryAuditLog();
  const engine = new PolicyEngine(budget, new MemoryAllowlist({ mode: 'open' }), auditLog);
  const server = makeStubServer();
  const { budgetReconciler } = attachGovernance(server as unknown as x402ResourceServer, engine);

  const PAYMENT_HEADER = 'x402-test-header-ddeeff';

  // reserve
  await server.hooks['beforeVerify']!(makeCtx('1000000', '/paid', PAYMENT_HEADER));

  // onAfterSettle fires (x402 settled because handler returned 200) — removes from pending
  await server.hooks['afterSettle']!(makeSettleCtx('1000000', '/paid', PAYMENT_HEADER));

  // reconciler mounts and finish fires — pending entry is already gone
  const { req, res } = makeFakeReqRes(PAYMENT_HEADER, 200);
  await new Promise<void>(resolve => budgetReconciler(req, res, resolve));
  res.emit('finish');
  await new Promise<void>(resolve => setImmediate(resolve));

  // budget still debited (committed reservation)
  assert.equal((await budget.getSpent(AGENT))['GET /paid'], 1_000_000n);

  // no payment:not_settled emitted
  const events = await auditLog.query({ agentAddress: AGENT });
  assert.ok(!events.some(e => e.type === 'payment:not_settled'), 'unexpected payment:not_settled event');
});

test('getSpent returns per-route breakdown map', async () => {
  const budget = new MemoryBudgetStore({
    default:  { limitAtomicUsdc: 100_000_000n, windowMs: 60_000 },
    perRoute: {
      'GET /scrape':  { limitAtomicUsdc: 50_000n, windowMs: 60_000 },
      'GET /extract': { limitAtomicUsdc: 50_000n, windowMs: 60_000 },
    },
  });
  const engine = new PolicyEngine(budget, new MemoryAllowlist({ mode: 'open' }), new MemoryAuditLog());
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine);

  await server.hooks['beforeVerify']!(makeCtx('10000', '/scrape'));
  await server.hooks['beforeVerify']!(makeCtx('50000', '/extract'));

  const spent = await engine.getSpent(AGENT);
  assert.equal(spent['GET /scrape'], 10_000n);
  assert.equal(spent['GET /extract'], 50_000n);
  assert.equal(typeof spent, 'object');
});

test('deriveActionRef:true → every recorded event carries action_ref === computeActionRef(event)', async () => {
  const auditLog = new MemoryAuditLog();
  const engine = new PolicyEngine(
    new MemoryBudgetStore({ default: { limitAtomicUsdc: 10_000_000n, windowMs: 60_000 } }),
    new MemoryAllowlist({ mode: 'open' }),
    auditLog,
  );
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine, { deriveActionRef: true });

  await server.hooks['beforeVerify']!(makeCtx('1000000'));  // logs requested + approved

  const events = await auditLog.query({ agentAddress: AGENT });
  assert.ok(events.length > 0, 'expected recorded events');
  for (const e of events) {
    assert.equal(e.action_ref, computeActionRef(e));
  }
});

test('deriveActionRef off (default) → events have no action_ref', async () => {
  const auditLog = new MemoryAuditLog();
  const engine = new PolicyEngine(
    new MemoryBudgetStore({ default: { limitAtomicUsdc: 10_000_000n, windowMs: 60_000 } }),
    new MemoryAllowlist({ mode: 'open' }),
    auditLog,
  );
  const server = makeStubServer();
  attachGovernance(server as unknown as x402ResourceServer, engine);

  await server.hooks['beforeVerify']!(makeCtx('1000000'));

  const events = await auditLog.query({ agentAddress: AGENT });
  assert.ok(events.length > 0, 'expected recorded events');
  for (const e of events) {
    assert.equal(e.action_ref, undefined);
  }
});
