/**
 * Read-only verification of the Mycelium anchor on Arbitrum (Sepolia or One).
 * After markUsed(actionRef) lands, run this to confirm:
 *   1. used(actionRef) returns true
 *   2. The ActionRefUsed event is on the tx (look it up via the explorer link printed below)
 *
 * Network selection mirrors mycelium-anchor.ts: testnet by default, --mainnet for Arbitrum One.
 * RPC and chain come from the shared MYCELIUM_NETWORKS config (no second hardcoded endpoint).
 *
 * Usage:
 *   ACTION_REF=0x... npx tsx src/scripts/verify-mycelium-anchor.ts             # Arbitrum Sepolia
 *   ACTION_REF=0x... npx tsx src/scripts/verify-mycelium-anchor.ts --mainnet   # Arbitrum One
 */

import { createPublicClient, http } from "viem";
import { loadMyceliumAnchorEnv } from "../config/env.js";
import {
  MYCELIUM_ACTIONREF_CONTRACT,
  MYCELIUM_ABI,
  MYCELIUM_NETWORKS,
  toActionRefBytes32,
  type MyceliumNetwork,
} from "../lib/mycelium.js";

const argv = process.argv.slice(2);
const network: MyceliumNetwork = argv.includes("--mainnet") ? "arbitrum" : "arbitrum-sepolia";
const net = MYCELIUM_NETWORKS[network];
const env = loadMyceliumAnchorEnv(network);

// Normalize through the same helper the anchor uses: accepts 0x/no-0x, mixed case, validates 64 hex.
const actionRef = toActionRefBytes32(
  process.env.ACTION_REF ?? "0xb0fb25013a4ea19f63ba4ce47751f0c6dabc916325f5a85b841b1c81ab54b74b",
);

async function verify() {
  const client = createPublicClient({ chain: net.chain, transport: http(env.rpcUrl) });

  console.log(`Reading Mycelium ActionRef registry on ${net.chain.name} (chainId ${net.chain.id})...`);
  console.log(`Contract: ${MYCELIUM_ACTIONREF_CONTRACT}`);
  console.log(`action_ref: ${actionRef}\n`);

  try {
    const used = await client.readContract({
      address: MYCELIUM_ACTIONREF_CONTRACT,
      abi: MYCELIUM_ABI,
      functionName: "used",
      args: [actionRef],
    });

    console.log(`result of used(${actionRef}):`);
    console.log(`  ${used ? "✓ TRUE" : "✗ FALSE"}`);

    if (used) {
      console.log("\n✓ Action_ref has been anchored and marked used on-chain.");
      console.log("The Talos ↔ Mycelium join is live.");
      console.log(`Confirm the ActionRefUsed event on the anchoring tx: ${net.explorerTx}<txHash>`);
    } else {
      console.log("\n✗ Action_ref not yet marked used.");
      console.log("Either it hasn't been anchored yet, or there's a mismatch.");
    }
  } catch (e) {
    console.error("Error reading contract:", e);
    process.exit(1);
  }
}

verify();
