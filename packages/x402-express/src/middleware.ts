import type { Request, Response, NextFunction } from 'express';
import { getAddress } from 'viem';
import { exact } from 'x402/schemes';
import {
  computeRoutePatterns,
  findMatchingPaymentRequirements,
  findMatchingRoute,
  processPriceToAtomicAmount,
  toJsonSafe,
} from 'x402/shared';
import {
  moneySchema,
  settleResponseHeader,
  SupportedEVMNetworks,
  SupportedSVMNetworks,
} from 'x402/types';
import { useFacilitator } from 'x402/verify';
import type { RoutesConfig, FacilitatorConfig } from 'x402/types';
import type { PolicyEngine, PaymentContext } from '@mvp1/core';

export function governedPaymentMiddleware(
  payTo: `0x${string}`,
  routes: RoutesConfig,
  engine: PolicyEngine,
  facilitator?: FacilitatorConfig,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const { verify, settle, supported } = useFacilitator(facilitator);
  const x402Version = 1;
  const routePatterns = computeRoutePatterns(routes);

  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const matchingRoute = findMatchingRoute(routePatterns, req.path, req.method.toUpperCase());
    if (!matchingRoute) {
      next();
      return;
    }

    const { price, network, config = {} } = matchingRoute.config;
    const { description, mimeType, maxTimeoutSeconds, inputSchema, outputSchema, resource, discoverable } = config;

    const atomicAmountForAsset = processPriceToAtomicAmount(price, network);
    if ('error' in atomicAmountForAsset) {
      throw new Error(atomicAmountForAsset.error);
    }
    const { maxAmountRequired, asset } = atomicAmountForAsset;
    const resourceUrl = resource || `${req.protocol}://${req.headers['host']}${req.path}`;

    // Build payment requirements — same logic as upstream
    const paymentRequirements: ReturnType<typeof findMatchingPaymentRequirements> extends { requirements: infer R } ? R : never[] = [];
    const reqList: Parameters<typeof findMatchingPaymentRequirements>[0] = [];

    if (SupportedEVMNetworks.includes(network as (typeof SupportedEVMNetworks)[number])) {
      reqList.push({
        scheme: 'exact',
        network: network as (typeof SupportedEVMNetworks)[number],
        maxAmountRequired,
        resource: resourceUrl,
        description: description ?? '',
        mimeType: mimeType ?? '',
        payTo: getAddress(payTo),
        maxTimeoutSeconds: maxTimeoutSeconds ?? 60,
        asset: getAddress(asset.address as `0x${string}`),
        outputSchema: {
          input: { type: 'http' as const, method: req.method.toUpperCase(), discoverable: discoverable ?? true, ...inputSchema },
          output: outputSchema,
        },
        extra: (asset as { address: `0x${string}`; decimals: number; eip712: { name: string; version: string } }).eip712,
      });
    } else if (SupportedSVMNetworks.includes(network as (typeof SupportedSVMNetworks)[number])) {
      const paymentKinds = await supported();
      let feePayer: string | undefined;
      for (const kind of paymentKinds.kinds) {
        if (kind.network === network && kind.scheme === 'exact') {
          feePayer = (kind as { extra?: { feePayer?: string } }).extra?.feePayer;
          break;
        }
      }
      if (!feePayer) throw new Error(`Facilitator did not provide fee payer for network: ${network}`);
      reqList.push({
        scheme: 'exact',
        network: network as (typeof SupportedSVMNetworks)[number],
        maxAmountRequired,
        resource: resourceUrl,
        description: description ?? '',
        mimeType: mimeType ?? '',
        payTo,
        maxTimeoutSeconds: maxTimeoutSeconds ?? 60,
        asset: asset.address as string,
        outputSchema: {
          input: { type: 'http' as const, method: req.method.toUpperCase(), discoverable: discoverable ?? true, ...inputSchema },
          output: outputSchema,
        },
        extra: { feePayer },
      });
    } else {
      throw new Error(`Unsupported network: ${network}`);
    }

    const payment = req.header('X-PAYMENT');
    if (!payment) {
      res.status(402).json({ x402Version, error: 'X-PAYMENT header is required', accepts: toJsonSafe(reqList) });
      return;
    }

    let decodedPayment: ReturnType<typeof exact.evm.decodePayment>;
    try {
      decodedPayment = exact.evm.decodePayment(payment);
      decodedPayment.x402Version = x402Version;
    } catch (error) {
      res.status(402).json({
        x402Version,
        error: error instanceof Error ? error.message : 'Invalid payment header',
        accepts: toJsonSafe(reqList),
      });
      return;
    }

    const selectedRequirements = findMatchingPaymentRequirements(reqList, decodedPayment);
    if (!selectedRequirements) {
      res.status(402).json({ x402Version, error: 'Unable to find matching payment requirements', accepts: toJsonSafe(reqList) });
      return;
    }

    // Build PaymentContext from decoded payment — payload is EVM (authorization) or SVM (transaction)
    const evmPayload = decodedPayment.payload as { authorization?: { from: string } };
    const agentAddress = (evmPayload.authorization?.from ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;

    const ctx: PaymentContext = {
      agentAddress,
      merchantAddress: selectedRequirements.payTo as `0x${string}`,
      amountAtomicUsdc: BigInt(selectedRequirements.maxAmountRequired),
      asset: selectedRequirements.asset,
      network: selectedRequirements.network,
      route: `${req.method.toUpperCase()} ${req.path}`,
    };

    await engine.recordRequested(ctx);

    // ── SEAM 1: policy gate ──────────────────────────────────────────────────
    const decision = await engine.evaluate(ctx);
    if (!decision.allow) {
      res.status(402).json({ x402Version, error: decision.reason ?? 'payment-blocked', accepts: toJsonSafe(reqList) });
      return;
    }
    // ────────────────────────────────────────────────────────────────────────

    try {
      const verifyResponse = await verify(decodedPayment, selectedRequirements);
      if (!verifyResponse.isValid) {
        res.status(402).json({ x402Version, error: verifyResponse.invalidReason, accepts: toJsonSafe(reqList), payer: verifyResponse.payer });
        return;
      }
    } catch (error) {
      res.status(402).json({
        x402Version,
        error: error instanceof Error ? error.message : 'Payment verification failed',
        accepts: toJsonSafe(reqList),
      });
      return;
    }

    // Buffer response until after settlement (same pattern as upstream)
    const originalWriteHead = res.writeHead.bind(res);
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const originalFlushHeaders = res.flushHeaders.bind(res);
    type BufferedCall = ['writeHead' | 'write' | 'end' | 'flushHeaders', unknown[]];
    let bufferedCalls: BufferedCall[] = [];
    let settled = false;
    let endCalled!: () => void;
    const endPromise = new Promise<void>(resolve => { endCalled = resolve; });

    res.writeHead = function (...args: Parameters<typeof res.writeHead>) {
      if (!settled) { bufferedCalls.push(['writeHead', args]); return res; }
      return originalWriteHead(...args);
    } as typeof res.writeHead;
    res.write = function (...args: Parameters<typeof res.write>) {
      if (!settled) { bufferedCalls.push(['write', args]); return true; }
      return originalWrite(...args);
    } as typeof res.write;
    res.end = function (...args: Parameters<typeof res.end>) {
      if (!settled) { bufferedCalls.push(['end', args]); endCalled(); return res; }
      return originalEnd(...args);
    } as typeof res.end;
    res.flushHeaders = function () {
      if (!settled) { bufferedCalls.push(['flushHeaders', []]); return; }
      return originalFlushHeaders();
    };

    next();
    await endPromise;

    const restore = () => {
      settled = true;
      res.writeHead = originalWriteHead;
      res.write = originalWrite;
      res.end = originalEnd;
      res.flushHeaders = originalFlushHeaders;
      for (const [method, args] of bufferedCalls) {
        if (method === 'writeHead') originalWriteHead(...(args as Parameters<typeof originalWriteHead>));
        else if (method === 'write') originalWrite(...(args as Parameters<typeof originalWrite>));
        else if (method === 'end') originalEnd(...(args as Parameters<typeof originalEnd>));
        else if (method === 'flushHeaders') originalFlushHeaders();
      }
      bufferedCalls = [];
    };

    // If handler returned 4xx/5xx, pass through without settling
    if (res.statusCode >= 400) {
      restore();
      return;
    }

    try {
      const settleResponse = await settle(decodedPayment, selectedRequirements);

      if (!settleResponse.success) {
        bufferedCalls = [];
        res.status(402).json({ x402Version, error: settleResponse.errorReason, accepts: toJsonSafe(reqList) });
        await engine.recordFailed(ctx, settleResponse.errorReason ?? 'settle-failed');
        return;
      }

      // ── SEAM 2: post-settle audit ────────────────────────────────────────
      await engine.recordSettled(ctx, settleResponse.transaction);
      // ────────────────────────────────────────────────────────────────────

      res.setHeader('X-PAYMENT-RESPONSE', settleResponseHeader(settleResponse));
    } catch (error) {
      bufferedCalls = [];
      const reason = error instanceof Error ? error.message : 'settlement-exception';
      res.status(402).json({ x402Version, error: reason, accepts: toJsonSafe(reqList) });
      await engine.recordFailed(ctx, reason);
      return;
    } finally {
      restore();
    }
  };
}
