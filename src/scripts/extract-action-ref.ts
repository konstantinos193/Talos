import { describeActionRef } from "@talos/core";

// Extract action_ref from the audit event and verify it's correct
const event = {
  agentAddress: "0x0682d8a38B30F343B8DEd1a13b3b464252D8E624" as const,
  timestampMs: 1781086011914,
};

const detail = describeActionRef(event);
const recordedActionRef = "481e94e5b908be3495e08d28fb9b74dc73a46831a9ab9a86eea43aabc8011e7c";

console.log("═══════════════════════════════════════════════════════════════");
console.log("TALOS ACTION_REF EXTRACTION & VERIFICATION");
console.log("═══════════════════════════════════════════════════════════════\n");

console.log("COMPUTED PREIMAGE & ACTION_REF:");
console.log("────────────────────────────");
console.log(`agent_id:     ${detail.preimage.agent_id}`);
console.log(`action_type:  ${detail.preimage.action_type}`);
console.log(`scope:        ${detail.preimage.scope}`);
console.log(`timestamp:    ${detail.preimage.timestamp}`);
console.log(`\ncanonical (JCS):  ${detail.canonical}`);
console.log(`action_ref:       ${detail.actionRef}`);

console.log("\n\nVERIFICATION:");
console.log("────────────");
if (detail.actionRef.toLowerCase() === recordedActionRef.toLowerCase()) {
  console.log("✓ PASS: recomputed action_ref matches the server's recorded value");
} else {
  console.error("✗ FAIL: mismatch!");
  console.error(`  recorded: ${recordedActionRef}`);
  console.error(`  computed: ${detail.actionRef}`);
  process.exit(1);
}

console.log("\n\nHANDOVER BLOCK (copy-paste to giskard09):");
console.log("─────────────────────────────────────────");
console.log("\naction_ref (bytes32):  0x" + detail.actionRef);
console.log("tuple:");
console.log(`  agent_id:     ${event.agentAddress.toLowerCase()}`);
console.log(`  timestampMs:  ${event.timestampMs}`);
console.log(`  timestamp:    ${detail.preimage.timestamp}`);
console.log("\ncanonical (JCS):  " + detail.canonical);

console.log("\n\nREAD-ONLY VERIFY SCRIPT (run after giskard anchors on Arbitrum Sepolia):");
console.log("─────────────────────────────────────────────────────────────────────");
console.log(`cast call 0xD467CD1e34515d58F98f8Eb66C0892643ec86AD3 "used(bytes32)(bool)" 0x${detail.actionRef} --rpc-url https://sepolia-rollup.arbitrum.io/rpc`);
console.log("(should return: true)");

console.log("\n");
