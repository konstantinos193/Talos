# Competitive landscape — Agent-payment governance / control layer

**Date:** 2026-05-30 · **For:** MVP1 (OSS-core + paid-hosted control/audit layer between AI agents and wallets — budgets, allowlists, human approval, audit log; x402-native, Node/TypeScript).
**Method:** 7-agent research workflow + targeted follow-up; all stats verified via GitHub API / npm / live HTTP on 2026-05-30 unless marked. paybot + AgentPay marked _⏳_ — a follow-up agent is re-verifying them (the workflow's paybot cluster failed schema validation).

---

## TL;DR — the honest verdict (revised after hard data)

1. **The pain is overwhelmingly validated.** 16+ players, including AWS, Coinbase, Stripe, Visa, MoonPay all shipping pieces. Two community RFCs on Stripe's own repo ([#356](https://github.com/stripe/ai/issues/356), [#320](https://github.com/stripe/ai/issues/320)) spell out the exact gap MVP1 targets.

2. **The indie crowd is NOT the threat — they're thin.** Every solo competitor enforces **agent-side** (bypassable) and has negligible adoption: **paybot 0★** (~400 downloads, all from a launch-day spike; live API but broken landing, non-public core, single chain, solo dev in Finland), APS **19★** (100 npm versions in 3mo = self-publish churn), Shape **4★** (no PyPI), Mycelium **2★** (verify endpoints **dead/404 today**, on-chain claim publicly retracted), NOVAI **6★** (pre-launch L1), QBitFlow **~1★/repo**. The "ecosystem" in stripe/ai#356 is **three accounts cross-promoting each other** (giskard09 is literally a contributor to aeoess's repo). **paybot — the most complete — has zero organic stars and no human-in-the-loop.** Polish ≠ adoption.

3. **The real threat is the platforms — and one is roadmapping MVP1's exact product.** **Stripe** previewed "**agent guardrails**" at Sessions 2026 (agent identities + scope rules + approval flows) and publicly states it's "**planning to expand these controls to let people set spending limits, and choose when agents can act without additional approval**." That is MVP1's core, on Stripe's roadmap. **Coinbase** already ships the enforcement primitives (TEE-enforced Wallet Policies: allowlists/caps/network filters; on-chain Spend Permissions; Agentic Wallets with session caps + activity log). **AWS** shipped a [reference "Spend Governor"](https://github.com/aws-samples/sample-secure-agentic-payments-on-aws-x402) that is _conceptually MVP1 exactly_ — budget + allowlist + rate-limit + audit + rollback before signing.

4. **But the platforms leave one structural gap none of them will fill: cross-rail, vendor-neutral governance.** Each platform governs **only its own rail** (Stripe controls Stripe; Coinbase controls CDP wallets; Visa controls Visa cards; AWS controls Bedrock agents on AWS). A team running agents across x402 + Stripe + a second processor has **no single budget/allowlist/approval/audit plane**. That neutrality — plus **server-side/unbypassable enforcement at the 402 boundary**, an **OSS core** (no processor lock-in), and a **compliance-grade unified audit log** — is the only defensible wedge. The AWS sample proves demand and shape; nobody sells the managed, multi-rail version.

5. **The sharpest strategic warning:** "betting against Stripe shipping single-processor agent governance is a losing bet; betting on neutral, multi-rail governance is the survivable one." If MVP1 builds another single-rail agent-side SDK, it dies between paybot/APS (free) and Stripe/Coinbase (native). If it builds the neutral control plane *above* the rails, it has air.

---

## The map: where is policy enforced?

The single most useful lens (from the Vidanov↔NOVAI debate, now backed by data):

```
AGENT-SIDE                       SERVER-SIDE / UNBYPASSABLE            PROTOCOL-SIDE
(in agent runtime/SDK)           (gate before signing/settlement)     (chain-level)
bypassable by the agent          agent CANNOT bypass                  needs new chain / on-chain
        │                                  │                                  │
  Shape (runtime, 4★)            ◀ MVP1 TARGET ▶                      NOVAI (own L1, 6★)
  paybot-sdk ⏳                    AWS Spend Governor (sample, 2★)      QBitFlow (on-chain cap, live)
  APS (toolkit-wrap, 19★)         Coinbase Wallet Policies (TEE!)      Mycelium (audit-only, dead)
  AgentPay (card) ⏳              Stripe Issuing controls (network)    TRON 8004 (identity)
  TrapLedger (hackathon)         Visa network controls
        │                                  │                                  │
        └──────────── PLATFORM (vendor owns its own rail end-to-end) ─────────┘
              AWS AgentCore · Coinbase CDP · Stripe · MoonPay · Visa
                                       │
                    ▼ THE GAP NONE OF THEM FILL ▼
            CROSS-RAIL, VENDOR-NEUTRAL governance + unified audit
            (one plane spanning x402 + Stripe + others) ← MVP1's only moat
```

---

## Comparison matrix

| Player | Tier | Enforcement | Stars / adoption | License | Hosted product | MVP1 overlap | Threat |
|---|---|---|---|---|---|---|---|
| **paybot** (@RBKunnela) | indie | server-side (facilitator) | **0★**, ~400 dl (launch spike) | MIT/Apache/BSL? | api **LIVE**, site **DOWN (522)** | **HIGH** | low (zero traction) |
| **APS** (@aeoess) | indie | agent-side | 19★, 2.3k npm/mo (churn) | Apache-2.0 | none | **HIGH** | low (no adoption) |
| **AgentPay** (agentpay.la) | indie | network-side (card) | beta/waitlist, no public repo | closed | agentpay.la LIVE (beta) | **MED** | low-med (watch x402 roadmap) |
| **asqav** (@jagmarques) | indie | mixed | **152★**, 2.6k npm/mo | MIT + SaaS | asqav.com **LIVE** | **MED** (not payment-native) | low-med |
| **Shape** (@vidanov) | indie | agent-side | 4★, no PyPI | MIT | none (library) | HIGH-concept / LOW-commercial | low (ally) |
| **QBitFlow** | indie | on-chain/server | ~1★/repo, site **LIVE** | MPL-2.0 | qbitflow.app | **MED** (no agent product yet) | low |
| **Mycelium Trails** (@giskard09) | indie | protocol (audit-only) | 2★, endpoints **DEAD** | Apache-2.0 | retracted | LOW | none |
| **NOVAInetwork** (@0x-devc) | indie | protocol (own L1) | 6★, private testnet | Apache-2.0 | no | LOW | none |
| **TrapLedger** | hackathon | agent-side | no public repo | — | no | HIGH-concept | none |
| **AWS Spend Governor** | sample | server-side | 2★ "not for prod" | MIT-0 | no | **HIGH-concept** | validation+gap |
| **AWS AgentCore Payments** | platform | platform | preview | proprietary | AWS | MED (rail+ceiling) | med |
| **Coinbase x402+CDP** | platform | mixed (TEE+on-chain) | x402 **6.1k★**, ~97M txs | Apache-2.0 + proprietary | api.cdp.coinbase.com | MED | med-high |
| **Stripe** (guardrails) | platform | server-side | stripe/ai 1.6k★ | MIT + proprietary | Stripe | **HIGH** | **HIGHEST** |
| **MoonPay** | platform | mixed | $3.4B, $645M raised | mixed | MoonPay | MED | med |
| **TRON B.AI (8004)** | platform | protocol-side | top-tier L1 | mixed | — | LOW | low |
| **Visa Intelligent Commerce** | platform | server-side | 4.8B credentials | proprietary | Visa | MED (card-native) | med (different ICP) |

---

# Tier 1 — Indie / solo competitors

### paybot — @RBKunnela ⭐ the closest competitor — and it's beatable

**Tier:** direct-solo | **Enforcement:** server-side (facilitator is the policy chokepoint) + agent-side SDK | **Overlap with MVP1: HIGH** | **Moat: near-zero**

"USDC payments for bots via x402." Three-package stack: `paybot-sdk` (MIT, one dep — viem), `paybot-mcp` (Apache-2.0, MCP tools `paybot_pay/balance/history/register`), `paybot-core` (the facilitator). Trust levels L0–L5 (operator-set spend caps, e.g. L1 = $1/tx, $10/day), 5-gate validation, EIP-3009 (agent signs, never holds gas), x402 auto-handler. Origin: proposed as an OpenClaw core plugin ([#48140](https://github.com/openclaw/openclaw/issues/48140)) — **closed `not_planned`**.

**Live-product check (verified 2026-05-30) — API live, everything around it broken:**
- ✅ `api.paybotcore.com` → **HTTP 200**, v0.2.0, real `/verify /settle /authorize /supported /balance /history /bots` + a working `/demo`. Hosted on **Railway hobby tier** behind Cloudflare; uptime ~4.3 days at probe (normal redeploy cadence, not long-lived prod).
- ❌ `/supported` advertises **only Base mainnet + Base Sepolia** — NOT the Ethereum/Arbitrum/Optimism/Polygon set the marketing claims.
- ❌ Human site `paybotcore.com` → **HTTP 522 (origin unreachable)**, consistently. The npm `homepage` + SDK docs point here → docs/landing **dead**.
- ❌ `github.com/RBKunnela/paybot-core` → **404**. The "BSL 1.1 / Docker self-host in 5 min" facilitator is **claimed but source non-public/nonexistent**. Only the SDK's plain **MIT** LICENSE is confirmed.

**Maturity — weak (the damning part):**
- **GitHub: `paybot-sdk` = 0 stars, 0 watchers, 4 (network/dependabot) forks; `paybot-mcp` = 0 stars.** A "complete" competitor with **zero organic stars.**
- Commits look active (87 sdk / 36 mcp) but **66 of 87 are the author**, the rest dependabot/aliases/self-written CI-review bots — security/CI theatre, not user-driven features.
- **npm downloads: ~400 lifetime each, dominated by a single launch-day spike** (sdk 160, mcp 229 on 2026-02-27). Organic pulls = low single digits/day (bot/CI-shaped). Only 3 versions published.
- **Author:** Renata Baldissara-Kunnela (Finland), "Ai Agents ChatBot," **2 GitHub followers**. No company, no funding, no press. **Solo-ware.**

**Take:** the closest thing to MVP1's thesis (OSS-core + hosted, x402/EIP-3009, trust tiers ≈ budgets, velocity, audit log) — but **HIGH conceptual overlap, near-zero competitive moat.** No human-in-the-loop gate (autonomous-within-limits only), thin audit, hobby-tier single-chain hosting, non-public core, rejected from OpenClaw, zero users. **MVP1 wins exactly where paybot is weakest: real human-approval workflows + a credible multi-tenant hosted control/audit dashboard.**

**Links:** [paybot-sdk](https://github.com/RBKunnela/paybot-sdk) (live) · [paybot-mcp](https://github.com/RBKunnela/paybot-mcp) (live) · [paybot-core](https://github.com/RBKunnela/paybot-core) (**404**) · [npm paybot-sdk](https://www.npmjs.com/package/paybot-sdk) · [live API](https://api.paybotcore.com/) · [demo](https://api.paybotcore.com/demo) · paybotcore.com (**522 down**) · [openclaw#48140](https://github.com/openclaw/openclaw/issues/48140)

### AgentPay (agentpay.la, attrib. @luigiugge18) — "the card is the policy" — orthogonal bet

**Tier:** direct-solo | **Enforcement:** network-side (Stripe Issuing / Celtic Bank card rails) + human gate | **Overlap with MVP1: MEDIUM**

Per-agent programmable **virtual Visa cards** via **Stripe Issuing** (cards issued by **Celtic Bank, FDIC-insured**): agent requests a card for an exact amount → human approves via Telegram/dashboard → card auto-closes after use → full audit log (5-yr retention). Remote **MCP server** (`api.agentpay.la/mcp`), CLI, REST. "The card *is* the policy — no config to drift." **Fiat today; x402/USDC is roadmap, not live.**

**Verified (2026-05-30):**
- ✅ `agentpay.la`, `docs.agentpay.la`, `status.agentpay.la` all **200**; `api.agentpay.la/mcp` → **405 to GET** (live MCP endpoint expecting POST). Published pricing (Free / Pro $7/mo / Enterprise) — a real-product signal.
- ❌ Explicitly **beta / waitlist** (US cards only; retail/food/travel "Coming Soon"; Q2/Q3-2026 roadmap).
- ❌ **No public repo** — the site's linked `github.com/sagebhardt/agentpay` **404s**; nothing to audit/self-host, no stars/downloads to cite.
- ⚠️ **Identity probable, not proven:** content matches @luigiugge18's #48140 pitch verbatim, but **dev.to/luigiugge18 404s**, luigiugge18's GitHub has **no AgentPay repo**, and the site repo is under a different handle. Footer claims "**Menlo & Oak**" funding — **uncorroborated, likely decorative.**

**Take:** strongest enforcement model in the field (a card *physically* can't overspend — bank/network-enforced) and enterprise-legible (FDIC, KYC). **But orthogonal to MVP1:** custodial fiat cards via Stripe/Celtic vs. MVP1's non-custodial x402/USDC wallet-control layer. Same problem (limits/allowlists/approval/audit) + same MCP surface, different infrastructure decision. **Could even be complementary.** The one thing to watch: their stated x402/USDC roadmap — if they ship it, overlap jumps to HIGH.

**Links:** [agentpay.la](https://www.agentpay.la/) · [docs](https://docs.agentpay.la/) · [status](https://status.agentpay.la/) · [MCP endpoint](https://api.agentpay.la/mcp) · sagebhardt/agentpay (**404**) · [openclaw#48140](https://github.com/openclaw/openclaw/issues/48140)

### Agent Passport System (APS) — @aeoess (Tymofii Pidlisnyi)

**Tier:** direct-solo | **Enforcement:** agent-side (in-process SDK; bypassable) | **Overlap with MVP1: HIGH**

Closest conceptual twin to MVP1. Solo-built, Apache-2.0 TS+Python protocol: Ed25519 agent identity, monotonic scope-narrowing delegation with cascading revocation, a policy engine, signed accountability receipts. Payment commerce-preflight (passport → scope → **spend limit → merchant allowlist** → idempotency) + **human-approval thresholds**; wraps Stripe Agent Toolkit, targets x402/ACP/AP2/MPP. 3-signature chain (agent signs intent → policy engine signs evaluation → agent signs receipt). Backed by a self-published Zenodo preprint.

- **Verified (2026-05-30):** npm `agent-passport-system` v2.2.0, **100 versions** since 2026-02-23, ~2,322 dl/30d; **GitHub 19★, 9 forks, 0 watchers**, 7 contributors (incl. giskard09 = Mycelium author).
- **Skeptic's read:** adoption thin and self-generated (100 versions/3mo = CI churn); **test counts contradict across surfaces** (2,884 vs 2,306 vs 1,634); stripe/ai#356 opened by the author, **0 maintainer replies, 0 reactions**; cross-promotion ring; Zenodo "paper" = non-peer-reviewed preprint (152 views); implicated in the retracted on-chain-anchor episode.
- **Takeaway:** strongest articulation of MVP1's exact problem, best reference to study/differentiate against — but one-person OSS protocol, negligible independent adoption, no paid hosted layer. MVP1's wedge (server-side enforcement + hosted dashboard) intact.
- **Links:** [GitHub](https://github.com/aeoess/agent-passport-system) · [npm](https://www.npmjs.com/package/agent-passport-system) · [PyPI](https://pypi.org/project/agent-passport-system/) · [Zenodo](https://doi.org/10.5281/zenodo.19260073) · [stripe/ai#356](https://github.com/stripe/ai/issues/356) · [aeoess.com](https://aeoess.com)

### asqav — @jagmarques (João André Gomes Marques)

**Tier:** direct-solo | **Enforcement:** mixed (agent-side gate + cryptographic evidence) | **Overlap with MVP1: MEDIUM**

The "evidence layer for AI agents": MIT Python/TS SDKs + MCP server that sign **every agent action/tool call** with post-quantum **ML-DSA-65 (FIPS 204)**, hash-chain + timestamp them (RFC 3161 + OpenTimestamps on paid tiers) for **EU AI Act Art.12/26 + DORA** compliance. Bilateral request+response "compliance receipts" under a `protectmcp:` namespace. **Ships the same OSS-core + paid-hosted-dashboard shape as MVP1** (live asqav.com + /dashboard).

- **Verified:** GitHub `asqav-sdk` **152★** (8× APS), MIT, created 2026-01-14; npm `@asqav/sdk` v0.5.4, ~2,591 dl/30d; PyPI live; SaaS live. **Strongest traction of the indie cohort.**
- **Skeptic's read:** **NOT payment-native** — no wallet/budget/spend-cap/x402 primitive; governs tool calls generically, so it does NOT close MVP1's payment loop. The "IETF draft" is an **individual** Internet-Draft ("no formal standing", not WG-adopted). LiteLLM "integration" = self-filed unmerged issue. Same cross-promotion ring.
- **Takeaway:** most commercially-credible of the three, closest analog to MVP1's *business model*, differentiated compliance/PQ-crypto story on the AUDIT axis — but not a payments product. Track as possible audit-layer competitor or interop target, not head-on rival.
- **Links:** [asqav-sdk](https://github.com/jagmarques/asqav-sdk) · [npm](https://www.npmjs.com/package/@asqav/sdk) · [asqav.com](https://asqav.com) · [IETF draft -02](https://datatracker.ietf.org/doc/html/draft-marques-asqav-compliance-receipts-02)

### Shape — @vidanov (Alexey Vidanov, AWS Community Builder)

**Tier:** direct-solo | **Enforcement:** agent-side (runtime) | **Overlap: HIGH-concept / LOW-commercial** | **Best treated as ally**

Single-file, zero-dep Python lib wrapping any tool-calling agent with: **phases** (EXPLORE→DECIDE→COMMIT), **effect classes** (READ/REVERSIBLE/IRREVERSIBLE), **transactions-with-compensation**, **graduated budget gates** (reduce at 50%, block at 75%), a readable `BLOCK/REQUIRE/FLAG` **rule DSL**, and **proof traces**. The clearest articulation of the category (his dev.to article is its manifesto).

- **Verified:** **4★**, 0 forks, 39 commits, created 2026-04-25; **no PyPI** (the existing `shape` is unrelated). Pre-adoption reference implementation.
- **Take:** names the *exact* four gaps MVP1 targets and expresses them beautifully, but lives inside the agent (bypassable), no hosted plane, no x402. **Vidanov is the leading voice — engage as ally/design reference, not competitor.**
- **Links:** [GitHub](https://github.com/vidanov/shape) · [the article](https://dev.to/aws-builders/agents-that-pay-why-agent-payments-without-governance-is-the-next-incident-2gc1)

### QBitFlow

**Tier:** indie (small/solo) | **Enforcement:** on-chain authorization (server-side, unbypassable) | **Overlap: MEDIUM**

A **live, non-custodial crypto payment gateway** (qbitflow.app) whose core primitive is an **on-chain, revocable spending-cap authorization** — nothing above the cap is ever reachable, terms hashed on-chain ("mathematically impossible" to exceed). Solidity ^0.8.28, EIP-2612 + EIP-712, deployed to Ethereum mainnet (`0x843D…1E0C`) + Base + others. The founder pitched (in Shape's comments) that "the same primitive maps cleanly to agent payments (x402-style PAYG)."

- **Verified:** site LIVE w/ free test mode; GitHub repos **~1★ each**, EVM repo ~8 commits, **no published audit**. The agent/x402 framing exists **only as a dev.to comment** — no shipped agent product.
- **Take:** ships the *right primitive* in production (revocable cap > Shape's wrapper, > NOVAI's vapor) but it's a merchant checkout product, not an agent control plane. **Build-vs-partner question for MVP1's cap layer.**
- **Links:** [qbitflow.app](https://qbitflow.app/) · [EVM contracts](https://github.com/QBitFlow/qbitflow-evm-contracts) · ["Why Spending Caps Beat Escrow"](https://dev.to/qbitflow/why-spending-caps-beat-escrow-a-security-analysis-of-crypto-payment-models-4ko3)

### Mycelium Trails / Argentum — @giskard09 ⚠️ lowest credibility

**Tier:** direct-solo | **Enforcement:** protocol-side (on-chain record only, enforces nothing) | **Overlap: LOW**

A pixel-art "karma economy for agents" + a "post-execution accountability" layer claiming to anchor signed trail records on Arbitrum + Base. **The cautionary data point of this cohort:** in stripe/ai#356 the on-chain anchoring was claimed "in production," then **publicly retracted as "aspirational rather than active"** (`block: null, tx_hash: null`), then re-asserted. **Verify endpoints are DEAD today** (404/500 — could not reproduce the advertised proof). 2★, 1 contributor, no npm/PyPI. coinbase/agentkit PR [#1170](https://github.com/coinbase/agentkit/pull/1170) open/unmerged.
- **Take:** not a threat. Useful only as evidence of how much over-claiming exists in this space.
- **Links:** [argentum-core](https://github.com/giskard09/argentum-core) · [agentkit#1170](https://github.com/coinbase/agentkit/pull/1170)

### NOVAInetwork — @0x-devc

**Tier:** direct-solo (mislabeled "platform" by research — it's a one-dev L1) | **Enforcement:** protocol-side | **Overlap: LOW**

An AI-native Rust L1 (HotStuff BFT) making AI "entities" first-class with capability bitfields + approval-gated autonomy. Genuinely impressive solo engineering (360 commits, private testnet claims 16M+ blocks) — but the README's own "not live" list concedes **no staking/slashing, no delegation, ZK verifier inactive, AI autonomous execution not live**. 6★, no public testnet/mainnet, severe cold-start risk.
- **Take:** strongest *theoretical* enforcement, zero realism — asks agents to migrate to a new chain. Not a threat; the cautionary opposite extreme to MVP1's "meet agents where they pay."
- **Links:** [NOVAI-node](https://github.com/0x-devc/NOVAI-node)

### TrapLedger — Coinbase/lablab.ai hackathon

**Tier:** hackathon project | **Enforcement:** agent-side (in-line middleware) | **Overlap: HIGH-concept**

A pre-signing x402 enforcement gateway (deterministic policy set, destination allowlist, max spend, blocklist, prompt-injection detection; "the LLM explains, never decides"; every attempt → Audit Event). **Simulated signing, no public repo, hackathon-only.** Validates MVP1's exact thesis built in a weekend — and sits alongside near-identical siblings (AgentPayOps, DisburseGuard), underscoring it's an idea-stage pattern, not a moat.
- **Links:** [lablab x402](https://lablab.ai/tech/coinbase/x402)

### AWS Spend Governor — `aws-samples` reference architecture ⭐ most important indie-tier signal

**Tier:** AWS sample (not a product) | **Enforcement:** server-side | **Overlap: HIGH (conceptually = MVP1 exactly)**

Official AWS-samples repo bolting the governance layer AgentCore lacks onto x402: agent **proposes**, a Lambda **Spend Governor** enforces *before signing* — **budget caps** (DynamoDB atomic counters), **URL allowlist** (framed as prompt-injection defense), agent-ARN auth, **rate limits**, just-in-time KMS key retrieval, **immutable audit trail**, **atomic rollback**. Pluggable Payment Adapter (crypto/Stripe/Adyen).
- **Verified:** **2★, 1 fork, 1 contributor, 7 open issues**, MIT-0, README says **"not intended for production."**
- **Take:** This is MVP1's exact feature set, blessed by the AWS brand, shipped as an unsupported sample. **The strongest possible validation that the shape is right AND that nobody sells the managed, multi-stack, hosted version.** This is the opening, stated by AWS itself.
- **Links:** [GitHub](https://github.com/aws-samples/sample-secure-agentic-payments-on-aws-x402)

---

# Tier 2 — Platforms (the real competitive gravity)

### Stripe — Agent Toolkit / MPP / Agentic Commerce / Issuing / Projects / "agent guardrails" ⚠️ HIGHEST THREAT

**Enforcement:** server-side (API + card-authorization network level) | **Overlap: HIGH (bifurcated by maturity)**

Stripe ships strong controls **today** (server-side, unbypassable):
- **Issuing `spending_controls`** — merchant-category allowlist + per-authorization/monthly limits enforced at card authorization (real-time webhooks, 2s timeout).
- **Stripe Projects** — global/per-provider spend limits (hard caps, API-level rejection).
- **Link agent wallet** — **per-request human approval** with transaction context.
- **Shared Payment Tokens** — business/time/amount-scoped, revocable, Radar-integrated.

**The decisive facts:**
- **Restricted API Keys do NOT enforce spend** — only which resources + read/write scope. The community RFCs ([#356](https://github.com/stripe/ai/issues/356) open, [#320](https://github.com/stripe/ai/issues/320) closed/assigned-to-Stripe-eng) hammer this.
- Stripe's dedicated answer — "**agent guardrails**" (agent identities + scope rules + approval flows) — was **previewed at Sessions 2026 (Apr 29)** and is **planning to expand to "set spending limits, and choose when agents can act without additional approval."** **That is MVP1's core product, on Stripe's public roadmap.**
- **Verdict:** the most direct threat. Defensible wedge = what Stripe structurally won't do: **cross-rail, vendor-neutral governance** (one plane over Stripe *and* x402/CDP *and* others), unified compliance-grade audit, OSS-core for teams refusing single-processor lock-in. **Don't bet against Stripe on its own rail; bet on neutrality.**
- **Links:** [stripe/ai](https://github.com/stripe/ai) · [#356](https://github.com/stripe/ai/issues/356) · [#320](https://github.com/stripe/ai/issues/320) · [Issuing for agents](https://docs.stripe.com/issuing/agents) · [Sessions 2026](https://stripe.com/blog/everything-we-announced-at-sessions-2026) · [Giving agents the ability to pay](https://stripe.com/blog/giving-agents-the-ability-to-pay)

### Coinbase — x402 + CDP (facilitator, Wallet Policies, Spend Permissions, AgentKit)

**Enforcement:** mixed (TEE-enforced signing-layer policies + on-chain Spend Permissions + facilitator) | **Overlap: MEDIUM**

Owns the rail MVP1 sits on. x402 ([Foundation repo](https://github.com/x402-foundation/x402), Apache-2.0, **~6.1k★**, ~97M txs on Base) is *purely a payment protocol — no governance in it*. CDP facilitator = verify/settle + bundled **KYT compliance screening** (first 1,000 settled/mo free, then $0.001). First-party governance lives at the **wallet** layer as composable primitives:
- **CDP Wallet Policies** — allowlists/denylists/value caps/network filters, **enforced inside a TEE before any tx leaves the wallet** (unbypassable).
- **Spend Permissions** — on-chain token allowance + rolling time period, marketed for agentic payments.
- **Agentic Wallets** — per-token allowances, session caps ("$5/hour"), timestamped activity log.
- AgentKit ships **zero native governance** — delegates to the wallet's policies.
- **Verdict for MVP1:** Coinbase supplies the **enforcement substrate**, not a cross-agent control plane (no packaged approval queue, no portfolio budget abstraction, no compliance-grade multi-tenant audit; governance fragmented across 3 surfaces). **MVP1's natural posture: sit ON TOP of CDP** — consume facilitator + policy engine + KYT as enforcement, add orchestration, approval UX, allowlist management, unified audit.
- **Links:** [x402](https://github.com/x402-foundation/x402) · [AgentKit](https://github.com/coinbase/agentkit) · [CDP facilitator](https://docs.cdp.coinbase.com/x402/core-concepts/facilitator) · [Spend Permissions](https://docs.cdp.coinbase.com/server-wallets/v2/evm-features/spend-permissions)

### Amazon Bedrock AgentCore Payments (preview)

**Enforcement:** platform (unbypassable at AWS infra layer) | **Overlap: MEDIUM**

AWS's managed x402 rail (preview, May 7 2026; built with Coinbase + Stripe). Coinbase CDP or Stripe Privy wallet; keys vaulted in Secrets Manager; ships the Coinbase x402 Bazaar (10k+ endpoints) + CloudWatch/X-Ray. **Governance = `PaymentSession` only** (time-bounded, user-scoped `maxSpendAmount` + expiry, atomic reserve/commit/rollback). **Explicitly lacks:** URL allowlist, rate limits, human-approval gate, graduated budgets, phase enforcement, cross-step compensation, structured proof-trace audit, and **anything for agents off AWS**. (Vidanov's article + AWS's own community builders call this out.)
- **Verdict:** the rail + ceiling MVP1 sits on, not a competing policy layer. Regions: N. Virginia, Oregon, Frankfurt, Sydney.
- **Links:** [AWS announcement](https://aws.amazon.com/blogs/machine-learning/agents-that-transact-introducing-amazon-bedrock-agentcore-payments-built-with-coinbase-and-stripe/) · [docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html)

### MoonPay — Agents / MoonAgents Card / Open Wallet Standard

**Enforcement:** mixed (rail + card network, user-set permissions) | **Overlap: MEDIUM**

Crypto on/off-ramp giant (~$3.4B valuation, $645M raised, reportedly raising at ~$5B). Three 2026 agent products: **MoonPay Agents** (non-custodial agent wallets + fiat funding, Feb 24), **MoonAgents Card** (virtual Mastercard spending USDC on Solana, May 1), **Open Wallet Standard** (open-source agent-wallet spec w/ PayPal, ETH/SOL foundations, Ripple, Base — supports x402 + MPP). **Governance is thin** — permissions "the human sets one time," no budget engine/allowlist/approval/audit. Owns wallet/rail/card; the governance+audit layer is unfilled (and its Open Wallet Standard could be a *substrate MVP1 governs*).
- **Links:** [MoonPay Agents](https://crypto.news/moonpay-launches-ai-agents-non-custodial-wallets-2026/) · [Open Wallet Standard](https://decrypt.co/362162/moonpay-launches-open-source-wallet-standard-for-ai-agents)

### Visa — Intelligent Commerce / Connect

**Enforcement:** server-side (network-level) | **Overlap: MEDIUM (different ICP)**

Exposes Visa's network (~4.8B credentials, ~150M merchants) to verified agents. **Intelligent Commerce Connect** bundles payment initiation + tokenization + **spend controls + approval rules + agent-authority verification** at the agent layer (Visa + non-Visa cards). Genuine governance primitive — but **card-rail-native**, so it breaks exactly where agent spend is heaviest (Keyrock: 76% of agent payments are below the $0.30 card-fee floor), and controls live inside Visa's walled network, not as a portable/stablecoin-native plane.
- **Links:** [Visa Intelligent Commerce](https://corporate.visa.com/en/products/intelligent-commerce.html)

### TRON — B.AI (Bank of AI): x402 + protocol 8004

**Enforcement:** protocol-side (settlement + on-chain identity) | **Overlap: LOW**

Positions TRON as settlement+identity layer: x402 micropayments + an ERC-8004 "Trustless Agents" identity/reputation port (Identity/Reputation/Validation/Incident registries). **No spend-governance product** — rails + identity primitives, much delegated to ecosystem project AINFT. A chain MVP1 could settle on, not a competitor. Reputational baggage may deter the enterprise buyers who most need governance.
- **Links:** [TRON B.AI](https://www.criptolog.com/coin/tron-boosts-ai-agent-infrastructure-with-the-launch-of-b-ai/) · [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)

---

# Tier 3 — Protocols / standards

### x402 (Linux Foundation) + AP2 (Google) — strategic substrate, not competitors

- **x402** is now vendor-neutral under the Linux Foundation x402 Foundation (Apr 2 2026, 20+ backers incl. Google, Microsoft, Visa, Mastercard, AWS, Stripe, Cloudflare, Circle). It is **purely a payment protocol — no governance baked in.** That's *good* for MVP1: the standard won't commoditize the control layer; it leaves it open.
- **AP2 (Google's Agent Payments Protocol)** is the most governance-native standard — it defines authorization **mandates** + delegated authority. Reportedly **complementary** to x402 (AP2 = authorization mandates, x402 = settlement).
- **⭐ Strategic implication:** MVP1 is likely **better off implementing AP2 mandates than inventing its own policy model.** A control plane that *speaks AP2 + enforces it server-side over x402* = standards-aligned moat instead of standards-churn risk (master-plan §9). **This is worth confirming as a Phase-2 design decision.**

---

## MVP1 positioning verdict

**Where MVP1 can win (defensible, ranked):**
1. **Cross-rail, vendor-neutral governance** — the one thing no platform will build (they each lock to their own rail). One budget/allowlist/approval/audit plane over x402 + Stripe + others. _This is the moat._
2. **Server-side / unbypassable enforcement at the 402 boundary** — stronger than every indie's agent-side SDK; Phase 0 already built the seam.
3. **Compliance-grade unified audit** — the EU/MiCA/DORA angle (user's payments background); asqav proves the compliance narrative sells, but isn't payment-native.
4. **OSS-core + real hosted dashboard** — the indies ship libraries/CLIs; the managed control plane non-devs can use is the genuine product + revenue gap (AWS's sample proves demand).
5. **Standards-aligned (implement AP2 mandates)** — survive churn instead of fighting it.

**Where MVP1 loses (avoid):**
1. **Another agent-side SDK with budgets/allowlists** — paybot/APS already free there; Stripe/Coinbase absorbing it natively.
2. **Single-rail governance** — Stripe/Coinbase/Visa each win their own rail. Neutrality or nothing.
3. **Rails / facilitator / a new chain** — Coinbase/TRON/MoonPay own rails; NOVAI shows the new-chain trap.

**The two questions to resolve before writing `@mvp1/core`:**
1. **Payer or payee, and which rail-spanning scope?** Budgets/allowlists protect the *payer*; server-side spend-governance + audit protects the *payee/resource-owner* (Phase 0's side, less crowded). The neutral cross-rail plane implies serving the *operator running a fleet of agents across rails* — confirm the ICP. **(Still open — the real decision.)**
2. **Is paybot real?** ✅ **RESOLVED: no.** API is genuinely live (Base only, Railway hobby tier) but it's solo-ware — **0 stars, ~400 launch-spike downloads, broken landing page (522), non-public core, no human-in-the-loop, rejected from OpenClaw**. The most complete indie has near-zero moat. Go/no-go is **not** blocked by an entrenched indie; it's gated only by whether MVP1 can hold the **neutral cross-rail + hosted-dashboard** position against the *platforms* (question 1 + the Stripe/Coinbase reality).

**One-line strategy:** _Don't build a governance SDK. Build the neutral control plane the platforms can't — server-side, cross-rail, OSS-core, compliance-grade — and sit on top of Coinbase/Stripe rather than beside the indies._

---

## All verified links

**Indie/solo:** [paybot-sdk](https://github.com/RBKunnela/paybot-sdk) · [paybot-mcp](https://github.com/RBKunnela/paybot-mcp) · [api.paybotcore.com](https://api.paybotcore.com) · [APS](https://github.com/aeoess/agent-passport-system) · [APS npm](https://www.npmjs.com/package/agent-passport-system) · [APS paper](https://doi.org/10.5281/zenodo.19260073) · [asqav-sdk](https://github.com/jagmarques/asqav-sdk) · [asqav.com](https://asqav.com) · [asqav IETF draft](https://datatracker.ietf.org/doc/html/draft-marques-asqav-compliance-receipts-02) · [Shape](https://github.com/vidanov/shape) · [QBitFlow](https://qbitflow.app/) · [QBitFlow contracts](https://github.com/QBitFlow/qbitflow-evm-contracts) · [argentum-core](https://github.com/giskard09/argentum-core) · [NOVAI](https://github.com/0x-devc/NOVAI-node)

**Threads / RFCs:** [stripe/ai#356](https://github.com/stripe/ai/issues/356) · [stripe/ai#320](https://github.com/stripe/ai/issues/320) · [openclaw#48140](https://github.com/openclaw/openclaw/issues/48140) · [Shape article](https://dev.to/aws-builders/agents-that-pay-why-agent-payments-without-governance-is-the-next-incident-2gc1) · [agentkit#1170](https://github.com/coinbase/agentkit/pull/1170)

**Platforms:** [AWS AgentCore Payments](https://aws.amazon.com/blogs/machine-learning/agents-that-transact-introducing-amazon-bedrock-agentcore-payments-built-with-coinbase-and-stripe/) · [AWS docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html) · [AWS Spend Governor](https://github.com/aws-samples/sample-secure-agentic-payments-on-aws-x402) · [x402 Foundation](https://github.com/x402-foundation/x402) · [Coinbase AgentKit](https://github.com/coinbase/agentkit) · [CDP facilitator](https://docs.cdp.coinbase.com/x402/core-concepts/facilitator) · [CDP Spend Permissions](https://docs.cdp.coinbase.com/server-wallets/v2/evm-features/spend-permissions) · [Stripe Agent Toolkit](https://github.com/stripe/ai) · [Stripe Sessions 2026](https://stripe.com/blog/everything-we-announced-at-sessions-2026) · [Stripe Issuing for agents](https://docs.stripe.com/issuing/agents) · [MoonPay Agents](https://crypto.news/moonpay-launches-ai-agents-non-custodial-wallets-2026/) · [MoonPay Open Wallet Standard](https://decrypt.co/362162/moonpay-launches-open-source-wallet-standard-for-ai-agents) · [Visa Intelligent Commerce](https://corporate.visa.com/en/products/intelligent-commerce.html) · [TRON B.AI](https://www.criptolog.com/coin/tron-boosts-ai-agent-infrastructure-with-the-launch-of-b-ai/) · [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)

**Protocols:** [x402 Foundation (Linux Foundation)](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol) · [Keyrock/CoinDesk report](https://www.coindesk.com/business/2026/05/21/crypto-rails-are-becoming-the-default-payment-layer-for-ai-agents-report-says)

---

_All sections complete (paybot + AgentPay filled 2026-05-30 from follow-up agent with live HTTP verification). NOVAI/QBitFlow tier corrected from the workflow's "platform-big" to indie (both solo/small). Every stat verified via GitHub API / npm / live HTTP on 2026-05-30._
