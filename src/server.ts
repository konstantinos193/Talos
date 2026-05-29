import express from "express";
import { paymentMiddleware, type Network } from "x402-express";
import { loadServerEnv } from "./config/env";

const env = loadServerEnv();
const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true, payTo: env.payTo, network: env.network });
});

app.use(
  paymentMiddleware(
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
    { url: env.facilitatorUrl as `${string}://${string}` },
  ),
);

app.get("/paid", (_req, res) => {
  res.json({
    ok: true,
    message: "machine paid machine — Phase 0 loop closed",
    timestamp: new Date().toISOString(),
  });
});

app.listen(env.port, () => {
  console.log(`x402 server listening on http://localhost:${env.port}`);
  console.log(`  payTo:       ${env.payTo}`);
  console.log(`  network:     ${env.network}`);
  console.log(`  facilitator: ${env.facilitatorUrl}`);
});
