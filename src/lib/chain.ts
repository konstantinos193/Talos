import { baseSepolia } from "viem/chains";

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_SEPOLIA_CAIP2 = "eip155:84532" as const;

// Circle USDC on Base Sepolia (FiatTokenProxy, 6 decimals, EIP-3009).
// Verified: https://developers.circle.com/stablecoins/usdc-contract-addresses
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const USDC_DECIMALS = 6;

// Free public testnet facilitator — Base Sepolia + Solana Devnet only.
// For mainnet swap to https://api.cdp.coinbase.com/platform/v2/x402 with CDP API keys.
export const PUBLIC_TESTNET_FACILITATOR = "https://x402.org/facilitator" as const;

// Faucets (operator-facing — used in script logs)
export const FAUCETS = {
  usdc: "https://faucet.circle.com",
  eth: "https://www.alchemy.com/faucets/base-sepolia",
} as const;

export { baseSepolia };
