import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, decodePaymentResponseHeader, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { loadAgentEnv } from "./config/env.js";

const env = loadAgentEnv();
const account = privateKeyToAccount(env.privateKey);

const client = new x402Client().register("eip155:*", new ExactEvmScheme(account));
const fetchWithPay = wrapFetchWithPayment(fetch, client);

async function main() {
  console.log(`agent address: ${account.address}`);
  console.log(`calling:       ${env.targetUrl}\n`);

  const res = await fetchWithPay(env.targetUrl, { method: "GET" });
  console.log(`status: ${res.status}`);

  const body = await res.json();
  console.log("body:", body);

  const settle = res.headers.get("payment-response");
  if (!settle) {
    console.warn("\nno payment-response header — server may not have settled");
    return;
  }

  const decoded = decodePaymentResponseHeader(settle);
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
