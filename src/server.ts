import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { attachGovernance } from "@talos/x402";
import { PolicyEngine, MemoryBudgetStore, MemoryAllowlist, MemoryAuditLog } from "@talos/core";
import { loadServerEnv } from "./config/env.js";

const env = loadServerEnv();
const app = express();
app.use(express.json());

const engine = new PolicyEngine(
  new MemoryBudgetStore({
    default:  { limitAtomicUsdc: 10_000_000n, windowMs: 3_600_000 },  // $10/hr fallback
    perRoute: {
      "GET /scrape":  { limitAtomicUsdc:  10_000n, windowMs: 3_600_000 },  // $0.01/hr
      "GET /extract": { limitAtomicUsdc:  50_000n, windowMs: 3_600_000 },  // $0.05/hr
    },
  }),
  new MemoryAllowlist({ mode: "open" }),
  new MemoryAuditLog(),
);

const facilitator = new HTTPFacilitatorClient({ url: env.facilitatorUrl });
const resourceServer = new x402ResourceServer(facilitator);
registerExactEvmScheme(resourceServer); // registers eip155:* wildcard
attachGovernance(resourceServer, engine);

app.get("/health", (_req, res) => {
  res.json({ ok: true, payTo: env.payTo });
});

app.use(
  paymentMiddleware(
    {
      "GET /paid": {
        accepts: [{ scheme: "exact", price: "$0.001", network: "eip155:84532", payTo: env.payTo }],
        description: "Phase 0 paid resource — proves the x402 loop works",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/paid", (_req, res) => {
  res.json({
    ok: true,
    message: "machine paid machine — governance layer active",
    timestamp: new Date().toISOString(),
  });
});

// Audit log — GET /audit?agent=0x...&since=<ms>&limit=N
app.get("/audit", async (req, res) => {
  const { agent, since, limit } = req.query;
  const events = await engine.queryAudit({
    agentAddress: typeof agent === "string" ? agent : undefined,
    sinceMs: typeof since === "string" ? Number(since) : undefined,
    limit: typeof limit === "string" ? Number(limit) : 50,
  });
  // bigint → string for JSON
  res.json(events.map(e => ({ ...e, amountAtomicUsdc: e.amountAtomicUsdc.toString() })));
});

// Budget query — GET /audit/budget?agent=0x...
app.get("/audit/budget", async (req, res) => {
  const { agent } = req.query;
  if (typeof agent !== "string") {
    res.status(400).json({ error: "agent query param required" });
    return;
  }
  const breakdown = await engine.getSpent(agent);
  res.json({
    agent,
    perRoute: Object.fromEntries(
      Object.entries(breakdown).map(([k, v]) => [k, v.toString()]),
    ),
  });
});

app.listen(env.port, () => {
  console.log(`x402 server listening on http://localhost:${env.port}`);
  console.log(`  payTo:       ${env.payTo}`);
  console.log(`  network:     eip155:84532`);
  console.log(`  facilitator: ${env.facilitatorUrl}`);
});
