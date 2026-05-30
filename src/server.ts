import express from "express";
import { governedPaymentMiddleware, type Network } from "@talos/x402-express";
import { PolicyEngine, MemoryBudgetStore, MemoryAllowlist, MemoryAuditLog } from "@talos/core";
import { loadServerEnv } from "./config/env";

const env = loadServerEnv();
const app = express();
app.use(express.json());

// 10 USDC per hour per agent, open merchant allowlist
const engine = new PolicyEngine(
  new MemoryBudgetStore({ limitAtomicUsdc: 10_000_000n, windowMs: 60 * 60 * 1000 }),
  new MemoryAllowlist({ mode: "open" }),
  new MemoryAuditLog(),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, payTo: env.payTo, network: env.network });
});

app.use(
  governedPaymentMiddleware(
    env.payTo,
    {
      "GET /paid": {
        price: "$0.001",
        network: env.network as Network,
        config: {
          description: "Phase 0 paid resource — proves the x402 loop works",
          mimeType: "application/json",
          maxTimeoutSeconds: 60,
        },
      },
    },
    engine,
    { url: env.facilitatorUrl as `${string}://${string}` },
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
  const spent = await engine.getSpent(agent);
  res.json({ agent, spentAtomicUsdc: spent.toString(), spentUsdc: (Number(spent) / 1_000_000).toFixed(6) });
});

app.listen(env.port, () => {
  console.log(`x402 server listening on http://localhost:${env.port}`);
  console.log(`  payTo:       ${env.payTo}`);
  console.log(`  network:     ${env.network}`);
  console.log(`  facilitator: ${env.facilitatorUrl}`);
});
