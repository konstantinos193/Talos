import "dotenv/config";
import { MYCELIUM_NETWORKS, type MyceliumNetwork } from "../lib/mycelium.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("0xYour") || v.startsWith("0xReplace")) {
    console.error(`Missing or placeholder env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function loadServerEnv() {
  return {
    payTo: required("PAY_TO_ADDRESS") as `0x${string}`,
    port: Number(optional("PORT", "4021")),
    facilitatorUrl: optional("X402_FACILITATOR_URL", "https://x402.org/facilitator"),
  } as const;
}

export function loadAgentEnv() {
  return {
    privateKey: required("AGENT_PRIVATE_KEY") as `0x${string}`,
    targetUrl: optional("AGENT_TARGET_URL", "http://localhost:4021/paid"),
    rpcUrl: optional("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org"),
  } as const;
}

// Env for the Mycelium action_ref anchor (markUsed on Arbitrum). The signer reuses
// AGENT_PRIVATE_KEY — testnet throwaway, funded on the SELECTED chain (not Base). RPC is
// per-network so the same key can anchor on testnet then mainnet without env churn.
export function loadMyceliumAnchorEnv(network: MyceliumNetwork) {
  const net = MYCELIUM_NETWORKS[network];
  return {
    rpcUrl: optional(net.rpcEnv, net.rpcDefault),
    auditUrl: optional("TALOS_AUDIT_URL", "http://localhost:4021/audit"),
    // Lazy: only resolve (and require) the signing key at send time, so --dry-run needs no key.
    privateKey: () => required("AGENT_PRIVATE_KEY") as `0x${string}`,
  } as const;
}
