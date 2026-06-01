import "dotenv/config";

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
