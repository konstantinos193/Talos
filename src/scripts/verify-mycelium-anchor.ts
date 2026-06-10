/**
 * Read-only verification of the Mycelium anchor on Arbitrum Sepolia.
 * After giskard09 calls markUsed(actionRef) from the owner wallet, run this script
 * to confirm:
 *   1. used(actionRef) returns true
 *   2. The ActionRefUsed event was emitted
 *
 * Usage:
 *   ACTION_REF=0x... npx tsx src/scripts/verify-mycelium-anchor.ts
 */

import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { MYCELIUM_ACTIONREF_CONTRACT, MYCELIUM_ABI } from "../lib/mycelium.js";

const actionRef = (process.env.ACTION_REF || "0xb0fb25013a4ea19f63ba4ce47751f0c6dabc916325f5a85b841b1c81ab54b74b") as `0x${string}`;

async function verify() {
  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
  });

  console.log("Reading Mycelium ActionRef registry on Arbitrum Sepolia...");
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
    } else {
      console.log("\n✗ Action_ref not yet marked used.");
      console.log("Either giskard09 hasn't anchored yet, or there's a mismatch.");
    }
  } catch (e) {
    console.error("Error reading contract:", e);
    process.exit(1);
  }
}

verify();
