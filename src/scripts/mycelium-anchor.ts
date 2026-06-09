import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describeActionRef } from "@talos/core";
import type { ActionRefDetail, Hex } from "@talos/core";
import { loadMyceliumAnchorEnv } from "../config/env.js";
import {
  MYCELIUM_ABI,
  MYCELIUM_ACTIONREF_CONTRACT,
  MYCELIUM_NETWORKS,
  toActionRefBytes32,
  type MyceliumNetwork,
} from "../lib/mycelium.js";

// Anchor a Talos-derived action_ref on Mycelium's registry (markUsed) — the on-chain proof
// that a Talos-approved payment composes with Mycelium's live system.
//
// Default path proves the full story end-to-end: pull the latest `payment:approved` event from
// a running governed server, re-derive its action_ref with the SAME computeActionRef both sides
// verified byte-identical, and anchor THAT. The payment loop stays on Base Sepolia; markUsed is
// an independent, chain-agnostic call (the action_ref is just a hash).
//
// Usage:
//   npm run mycelium-anchor                              # latest approved-payment event → anchor
//   npm run mycelium-anchor -- --audit-url <url>         # point at a different governed server
//   npm run mycelium-anchor -- --agent 0x.. --ts <ms>    # derive from an explicit tuple
//   npm run mycelium-anchor -- --ref <0x|64hex>          # anchor a precomputed action_ref
//   npm run mycelium-anchor -- --dry-run                 # derive + validate, send NO tx
//   npm run mycelium-anchor -- --mainnet --confirm       # step 2: same address, real funds
//
// SECURITY: the signing key lives in AGENT_PRIVATE_KEY (env / local signer) — never paste it
// into any chat or commit it. Use a throwaway wallet, funded on the selected chain.

const argv = process.argv.slice(2);
const has = (name: string): boolean => argv.includes(name);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

interface AuditEvent {
  id: string;
  type: string;
  agentAddress: string;
  timestampMs: number;
  action_ref?: string;
}

interface Resolved {
  /** 64 lowercase hex, no 0x — the JCS/string-compare form Mycelium stores. */
  actionRefHex: string;
  source: string;
  /** Present when we derived it (tuple/audit), absent for an explicit --ref. */
  detail?: ActionRefDetail;
  /** action_ref the server already recorded (server run with TALOS_DERIVE_ACTION_REF=1). */
  recorded?: string;
}

async function fetchLatestApproved(auditUrl: string): Promise<AuditEvent> {
  const res = await fetch(auditUrl);
  if (!res.ok) {
    throw new Error(`audit fetch ${auditUrl} → ${res.status} ${res.statusText}`);
  }
  const events = (await res.json()) as AuditEvent[];
  const approved = events.filter((e) => e.type === "payment:approved");
  const latest = approved.at(-1);
  if (!latest) {
    throw new Error(
      `no payment:approved events at ${auditUrl} — start the governed server and make one ` +
        `approved payment first (or pass --agent/--ts or --ref).`,
    );
  }
  return latest;
}

async function resolveActionRef(auditUrl: string): Promise<Resolved> {
  const refArg = opt("--ref");
  if (refArg !== undefined) {
    return { actionRefHex: toActionRefBytes32(refArg).slice(2), source: "explicit --ref" };
  }

  const agentArg = opt("--agent");
  const tsArg = opt("--ts");
  if (agentArg !== undefined && tsArg !== undefined) {
    const timestampMs = Number(tsArg);
    if (!Number.isInteger(timestampMs)) {
      throw new Error(`--ts must be an integer epoch in milliseconds; got "${tsArg}"`);
    }
    const detail = describeActionRef({ agentAddress: agentArg as Hex, timestampMs });
    return { actionRefHex: detail.actionRef, source: `tuple (agent ${agentArg}, ts ${timestampMs})`, detail };
  }

  const ev = await fetchLatestApproved(auditUrl);
  const detail = describeActionRef({ agentAddress: ev.agentAddress as Hex, timestampMs: ev.timestampMs });
  return {
    actionRefHex: detail.actionRef,
    source: `Talos audit event ${ev.id} (payment:approved, agent ${ev.agentAddress})`,
    detail,
    recorded: ev.action_ref,
  };
}

async function main(): Promise<void> {
  const network: MyceliumNetwork = has("--mainnet") ? "arbitrum" : "arbitrum-sepolia";
  const net = MYCELIUM_NETWORKS[network];
  const env = loadMyceliumAnchorEnv(network);
  const auditUrl = opt("--audit-url") ?? env.auditUrl;

  if (!net.isTestnet && !has("--confirm")) {
    console.error("Refusing a mainnet anchor without --confirm (real funds, irreversible).");
    console.error("Re-run: npm run mycelium-anchor -- --mainnet --confirm");
    process.exit(1);
  }

  const { actionRefHex, source, detail, recorded } = await resolveActionRef(auditUrl);
  const actionRefBytes32 = toActionRefBytes32(actionRefHex);

  console.log("Talos → Mycelium anchor");
  console.log("  network      :", network, `(chainId ${net.chain.id})`);
  console.log("  contract     :", MYCELIUM_ACTIONREF_CONTRACT);
  console.log("  source       :", source);
  if (detail) {
    console.log("  preimage     :", JSON.stringify(detail.preimage));
    console.log("  canonical    :", detail.canonical);
  }
  console.log("  action_ref   :", actionRefHex, "(no 0x — JCS string-compare form)");
  console.log("  bytes32      :", actionRefBytes32, "(0x form passed to markUsed)");

  // Recompute-before-send (gotcha #4): if the server already recorded an action_ref, our local
  // re-derivation MUST match it, else we'd anchor bytes that disagree with the audit log.
  if (recorded !== undefined) {
    if (recorded.toLowerCase() === actionRefHex) {
      console.log("  cross-check  : ✓ recompute matches the action_ref the server recorded");
    } else {
      console.error(`  cross-check  : ✗ MISMATCH — server recorded ${recorded}, recompute is ${actionRefHex}`);
      console.error("Aborting: anchoring a value the audit log disagrees with would fail giskard09's verify.");
      process.exit(1);
    }
  } else if (detail) {
    console.log("  cross-check  : recomputed locally (server's action_ref derivation is OFF — set TALOS_DERIVE_ACTION_REF=1 to double-check)");
  }

  if (has("--dry-run")) {
    console.log("\n--dry-run: derived + validated only, no tx sent.");
    return;
  }

  const account = privateKeyToAccount(env.privateKey());
  const transport = http(env.rpcUrl);
  const walletClient = createWalletClient({ account, chain: net.chain, transport });
  const publicClient = createPublicClient({ chain: net.chain, transport });

  console.log("\n  signer       :", account.address, "(becomes msg.sender / caller in ActionRefUsed)");

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    console.error(`\nSigner has 0 gas on ${network}. Fund ${account.address}${net.faucet ? ` via ${net.faucet}` : ""}.`);
    process.exit(1);
  }
  if (!net.isTestnet) {
    console.log("\n⚠ MAINNET — this spends real funds and is irreversible.");
  }

  // simulate first: a clean revert (e.g. action_ref already used) surfaces here instead of
  // burning gas on a failed tx.
  const { request } = await publicClient.simulateContract({
    account,
    address: MYCELIUM_ACTIONREF_CONTRACT,
    abi: MYCELIUM_ABI,
    functionName: "markUsed",
    args: [actionRefBytes32],
  });
  const hash = await walletClient.writeContract(request);
  console.log("\ntx hash:", hash, "| action_ref:", actionRefBytes32);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    console.error(`tx reverted (status=${receipt.status}). Explorer: ${net.explorerTx}${hash}`);
    process.exit(1);
  }
  console.log("confirmed in block", receipt.blockNumber, "| explorer:", `${net.explorerTx}${hash}`);

  // Paste-ready note for giskard09 — tx hash + anchored action_ref (0x) + caller to verify against.
  const stage = net.isTestnet ? "testnet" : "mainnet";
  console.log("\n── Send to giskard09 ───────────────────────────────");
  console.log(`${stage} anchor's live. tx: ${hash} on ${net.chain.name}, action_ref ${actionRefBytes32}`);
  console.log(`(derived from a Talos payment:approved audit event), caller ${account.address}.`);
  console.log("can you confirm the ActionRefUsed event matches?");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
