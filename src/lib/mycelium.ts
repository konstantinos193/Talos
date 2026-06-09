import { parseAbi } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import type { Hex } from "@talos/core";

// Mycelium ActionRef registry — the cross-rail anchor for a Talos-derived action_ref.
//
// giskard09 deployed it deterministically, so the SAME address holds on testnet and mainnet;
// only the chain (and the funded signer) changes. `markUsed` is the only call we make;
// `ActionRefUsed` is the event giskard09 verifies on-chain against the action_ref we send.
export const MYCELIUM_ACTIONREF_CONTRACT =
  "0xD467CD1e34515d58F98f8Eb66C0892643ec86AD3" as const;

export const MYCELIUM_ABI = parseAbi([
  "function markUsed(bytes32 actionRef)",
  "event ActionRefUsed(bytes32 indexed actionRef, address indexed caller)",
]);

// One tool, two steps: testnet first (committed step), mainnet repeat once giskard09 confirms.
// Default is ALWAYS testnet; mainnet is opt-in (--mainnet --confirm) so a typo can't spend real funds.
export const MYCELIUM_NETWORKS = {
  "arbitrum-sepolia": {
    chain: arbitrumSepolia, // chainId 421614
    rpcEnv: "ARB_SEPOLIA_RPC_URL",
    rpcDefault: "https://sepolia-rollup.arbitrum.io/rpc",
    explorerTx: "https://sepolia.arbiscan.io/tx/",
    faucet: "https://www.alchemy.com/faucets/arbitrum-sepolia",
    isTestnet: true,
  },
  arbitrum: {
    chain: arbitrum, // chainId 42161 — real funds
    rpcEnv: "ARB_MAINNET_RPC_URL",
    rpcDefault: "https://arb1.arbitrum.io/rpc",
    explorerTx: "https://arbiscan.io/tx/",
    faucet: null,
    isTestnet: false,
  },
} as const;

export type MyceliumNetwork = keyof typeof MYCELIUM_NETWORKS;

/**
 * The audit-event action_ref is stored as 64 lowercase hex chars, NO 0x prefix — that exact
 * form is what matches Mycelium's JCS string compare. `markUsed(bytes32)` needs the 0x form.
 *
 * This ONLY prepends 0x (normalizing case): a SHA-256 digest is exactly 32 bytes = 64 hex,
 * so it drops into bytes32 with no padding. Never re-hash, pad, or truncate — gotcha #1, the
 * single most common way to anchor the wrong bytes and silently fail giskard09's verify.
 */
export function toActionRefBytes32(actionRef: string): Hex {
  const hex = (actionRef.startsWith("0x") ? actionRef.slice(2) : actionRef).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(
      `action_ref must be 64 hex chars (32 bytes); got "${actionRef}". ` +
        `A SHA-256 action_ref is exactly 64 hex — do not re-hash, pad, or truncate.`,
    );
  }
  return `0x${hex}`;
}
