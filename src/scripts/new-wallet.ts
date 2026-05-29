import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

function newWallet(label: string) {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  console.log(`\n=== ${label} ===`);
  console.log(`Address:     ${account.address}`);
  console.log(`Private key: ${pk}`);
}

newWallet("AGENT    (pays USDC)");
newWallet("MERCHANT (receives USDC)");

console.log(`
Next steps:
1. Put AGENT private key into .env as AGENT_PRIVATE_KEY (testnet only — never reuse).
2. Put MERCHANT address into .env as PAY_TO_ADDRESS.
3. Fund the AGENT address with test USDC: https://faucet.circle.com → Base Sepolia.
4. Optional: a drop of Base Sepolia ETH from https://www.alchemy.com/faucets/base-sepolia
   (x402 uses EIP-3009 so the facilitator covers gas, but it's a cheap safety net).
`);
