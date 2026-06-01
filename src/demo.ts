import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import { PolicyEngine, MemoryBudgetStore, MemoryAllowlist, MemoryAuditLog } from '@talos/core';

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const R = '\x1b[0m';
const bold   = (s: string) => `\x1b[1m${s}${R}`;
const dim    = (s: string) => `\x1b[2m${s}${R}`;
const red    = (s: string) => `\x1b[31m${s}${R}`;
const green  = (s: string) => `\x1b[32m${s}${R}`;
const yellow = (s: string) => `\x1b[33m${s}${R}`;
const cyan   = (s: string) => `\x1b[36m${s}${R}`;
const white  = (s: string) => `\x1b[97m${s}${R}`;

function box(text: string, color: (s: string) => string = cyan) {
  const inner = `  ${text}  `;
  const line  = '─'.repeat(inner.length);
  console.log(color(`┌${line}┐`));
  console.log(color(`│${inner}│`));
  console.log(color(`└${line}┘`));
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Scene 1: governance blocks over-budget request (in-process) ───────────────
async function scene1() {
  const AGENT = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' as `0x${string}`;
  const AMOUNT = 1_000n; // $0.001 USDC (atomic)

  box('SCENE 1 — Over-budget agent → blocked before payment', s => bold(red(s)));
  console.log();
  console.log(`  ${dim('agent:')}    ${AGENT.slice(0, 20)}...`);
  console.log(`  ${dim('budget:')}   $0.00 USDC limit`);
  console.log(`  ${dim('request:')}  GET /paid  ($0.001 USDC)`);
  console.log();
  await sleep(1200);

  const auditLog = new MemoryAuditLog();
  const engine = new PolicyEngine(
    new MemoryBudgetStore({ limitAtomicUsdc: 0n, windowMs: 60_000 }),
    new MemoryAllowlist({ mode: 'open' }),
    auditLog,
  );

  const base = {
    agentAddress:     AGENT,
    merchantAddress:  '0xMerchant1' as `0x${string}`,
    amountAtomicUsdc: AMOUNT,
    asset: 'USDC', network: 'eip155:84532',
    timestampMs: Date.now(),
  };

  await engine.auditLog.record({ id: randomUUID(), type: 'payment:requested', ...base });
  console.log(`  ${yellow('→')} ${dim('x402: payment requested')}`);
  await sleep(400);

  console.log(`  ${yellow('→')} ${dim('governance: onBeforeVerify fires...')}`);
  await sleep(700);

  const ok = await engine.budget.tryReserve(AGENT, AMOUNT);
  if (!ok) {
    await engine.auditLog.record({ id: randomUUID(), type: 'payment:rejected', reason: 'budget_exceeded', ...base });
    console.log(`  ${bold(red('✗  HTTP 402'))}  ${red('budget_exceeded')}`);
    console.log(`  ${dim('   resource NOT served. no payment initiated.')}`);
  }
  await sleep(1000);

  const events = await engine.auditLog.query({ limit: 10 });
  console.log();
  console.log(dim('  ── audit trail ───────────────────────────────────────'));
  for (const e of events) {
    const tag  = e.type === 'payment:rejected' ? red(e.type) : dim(e.type);
    const note = e.reason ? `  ${dim('reason:')} ${red(e.reason)}` : '';
    console.log(`  ${tag}${note}`);
  }
  console.log(dim('  ──────────────────────────────────────────────────────'));
  await sleep(2500);
}

// ── Scene 2: funded agent → live Sepolia tx ────────────────────────────────────
async function scene2() {
  box('SCENE 2 — Funded agent → payment → on-chain proof', s => bold(green(s)));
  console.log();
  console.log(`  ${dim('budget:')}   $10.00 USDC / hr`);
  console.log(`  ${dim('request:')}  GET /paid  ($0.001 USDC)`);
  console.log(`  ${dim('network:')}  Base Sepolia (eip155:84532)`);
  console.log();
  await sleep(1200);

  // start server
  console.log(`  ${yellow('→')} starting governance server...`);
  const server = spawn(process.execPath, ['--import', 'tsx/esm', 'src/server.ts'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server start timeout')), 15_000);
    server.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('listening')) { clearTimeout(t); resolve(); }
    });
    server.stderr!.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) process.stderr.write(dim(`  [server] ${msg}\n`));
    });
  });
  console.log(`  ${green('✓')} server ready  ${dim('http://localhost:4021')}`);
  await sleep(600);

  // run agent
  console.log(`  ${yellow('→')} agent initiating payment...`);
  console.log();
  await new Promise<void>((resolve, reject) => {
    const agent = spawn(process.execPath, ['--import', 'tsx/esm', 'src/agent.ts'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    agent.stdout!.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n')) {
        if (!line.trim()) continue;
        if      (line.includes('status: 200')) console.log(`  ${bold(green('✓'))}  ${bold(white(line.trim()))}`);
        else if (line.includes('tx:'))         console.log(`  ${green('    ' + line.trim())}`);
        else if (line.includes('basescan:'))   console.log(`  ${cyan('    ' + line.trim())}`);
        else if (line.includes('body:'))       console.log(`  ${green('    ' + line.trim())}`);
        else                                   console.log(`  ${dim('    ' + line.trim())}`);
      }
    });
    agent.stderr!.on('data', (d: Buffer) => process.stderr.write(dim(`  [agent] ${d.toString().trim()}\n`)));
    agent.on('close', code => code === 0 ? resolve() : reject(new Error(`agent exited ${code}`)));
  });

  await sleep(1200);

  // fetch audit log
  const res   = await fetch('http://localhost:4021/audit?limit=5');
  const events = await res.json() as Array<{ type: string; amountAtomicUsdc: string; txHash?: string; reason?: string }>;
  console.log();
  console.log(dim('  ── audit trail ───────────────────────────────────────'));
  for (const e of events) {
    const amt  = `$${(Number(e.amountAtomicUsdc) / 1_000_000).toFixed(4)} USDC`;
    const tx   = e.txHash ? `  ${dim('tx:')} ${cyan(e.txHash.slice(0, 14) + '...')}` : '';
    const tag  = e.type === 'payment:settled' ? bold(green(e.type)) : green(e.type);
    console.log(`  ${tag.padEnd(35)} ${dim(amt)}${tx}`);
  }
  console.log(dim('  ──────────────────────────────────────────────────────'));
  await sleep(2500);

  server.kill();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.clear();
  console.log('\n');
  box('  TALOS  Governance Layer — Live Demo  ', s => bold(cyan(s)));
  console.log(`  ${dim('block over-budget agents · audit every payment · on-chain proof')}\n`);
  await sleep(2000);

  await scene1();
  console.log();
  await sleep(500);
  await scene2();
  console.log();
  box('DONE — governance enforced · audit complete · on-chain proof', s => bold(green(s)));
  console.log();
  await sleep(2000);
}

const SENTINEL = 'e:\\programming\\mvp1\\.demo-done';
try { rmSync(SENTINEL); } catch {}

main()
  .then(() => { writeFileSync(SENTINEL, ''); })
  .catch(e => { console.error(red('demo failed:'), e.message); process.exit(1); });
