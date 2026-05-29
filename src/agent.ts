import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { loadAgentEnv } from "./config/env";

const env = loadAgentEnv();
const account = privateKeyToAccount(env.privateKey);

// The wrapper accepts a viem LocalAccount directly. The chainId for the EIP-712
// domain is taken from the server's 402 payment requirements, not from the signer,
// so we don't need a chain-bound wallet client here.
// Default cap is 0.1 USDC; bump to 1 USDC per request for Phase 0 headroom.
const fetchWithPay = wrapFetchWithPayment(fetch, account, BigInt(1_000_000));

async function main() {
  console.log(`agent address: ${account.address}`);
  console.log(`calling:       ${env.targetUrl}\n`);

  const res = await fetchWithPay(env.targetUrl, { method: "GET" });
  console.log(`status: ${res.status}`);

  const body = await res.json();
  console.log("body:", body);

  const settle = res.headers.get("x-payment-response");
  if (!settle) {
    console.warn("\nno x-payment-response header — server may not have settled");
    return;
  }

  const decoded = decodeXPaymentResponse(settle);
  console.log("\nsettlement:");
  console.log(`  tx:       ${decoded.transaction}`);
  console.log(`  network:  ${decoded.network}`);
  console.log(`  payer:    ${decoded.payer}`);
  console.log(`  basescan: https://sepolia.basescan.org/tx/${decoded.transaction}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
