import { describeActionRef } from "@talos/core";

// Cross-verify tool for the Talos ↔ Mycelium action_ref join.
//
// Usage:
//   npm run action-ref                          # fixed sample (reproducible)
//   npm run action-ref -- 0x<agent> <timestampMs>
//
// Agree a tuple with Mycelium, run this on both sides, and compare. The `canonical`
// line is the exact bytes that get hashed — diff THAT (not just the hash) to pinpoint
// a mismatch (address casing, ms-vs-seconds precision, field order).

const [agentArg, tsArg] = process.argv.slice(2);

const agentAddress = (agentArg ?? "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef") as `0x${string}`;
const timestampMs = tsArg !== undefined ? Number(tsArg) : 1_700_000_000_000;

if (Number.isNaN(timestampMs)) {
  console.error(`Invalid timestampMs: "${tsArg}" (must be an integer epoch in milliseconds)`);
  process.exit(1);
}

const { preimage, canonical, actionRef } = describeActionRef({ agentAddress, timestampMs });

if (agentArg === undefined) {
  console.log("(no args → using fixed sample tuple; pass `-- 0x<agent> <timestampMs>` for a real event)\n");
}

console.log("Talos action_ref — cross-verify probe");
console.log("  agentAddress :", agentAddress);
console.log("  timestampMs  :", timestampMs, "→", preimage.timestamp);
console.log("  preimage     :", JSON.stringify(preimage));
console.log("  canonical    :", canonical);
console.log("  action_ref   :", actionRef);
console.log("\nSend `canonical` + `action_ref` to Mycelium — both must match byte-for-byte.");
