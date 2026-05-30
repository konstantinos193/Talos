# Outreach — Phase 1 pain validation

**Date:** 2026-05-30 · **Goal:** 5–10 conversations with people who've publicly voiced the *exact* governance pain MVP1 addresses. **Ask one question per person. No pitch. Listen.**

## The one question

> "How do you control what your agent is allowed to spend — budgets, allowlists, kill switch? What's the part that broke or that you wish existed?"

(Greek variant for Greek-speaking devs, if any surface: *"Πώς ελέγχεις τι μπορεί να ξοδέψει το agent — budgets, allowlists, kill switch; Τι έσπασε ή τι θα ήθελες να υπάρχει;"*)

Goal: confirm or kill the thesis that "budgets + allowlists + audit + kill switch" is the unmet pain. **3 confirmations from strangers = green light for Phase 2.** Zero or contradictions = re-scope.

---

## Tier 1 — directly stated the exact pain

### 1. @aeoess (Tymofii Pidlisnyi)  (GitHub) — ⚠️ COMPETITOR, not a peer-with-the-pain

- **What they did:** Opened [stripe/ai#356](https://github.com/stripe/ai/issues/356) on **2026-04-06**. NOT just stating a gap — they **already shipped the product**: **Agent Passport System (APS)**, Apache 2.0, on npm (`agent-passport-system` v1.34.0), 2,306 tests, [paper on Zenodo](https://doi.org/10.5281/zenodo.19260073). Covers per-delegation spend caps, merchant allowlists, Ed25519 agent identity, **human approval gates**, signed audit receipts. A 4-gate preflight (passport / scope / budget / merchant) that wraps the Stripe Agent Toolkit, and the same delegation envelope claims to work across ACP, x402, AP2, MPP. **This is ~90% of the MVP1 vision, already built.**
- **Reality check on the thread:** Reads like LLM-heavy self-promo. Three accounts (aeoess, jagmarques/asqav, giskard09/Mycelium Trails) cross-promoting and "composing" their layers in giant jargon comments. Notable tell: giskard09 claimed Base-mainnet anchoring → aeoess corrected it to `block: null, tx_hash: null` (NOT on-chain) → then suddenly "dual-chain anchored" with block numbers. Demo-stage theater, not evidence of real users.
- **What this means:** The pain is validated (people are building layers for it) BUT the space is crowded and noisy, and MVP1 is **not first**. The open question flips from "does the pain exist?" to **"is anyone actually USING these, or is it all demo-stage?"** That's the real wedge to probe.
- **Channel:** GitHub comment on #356. Low odds of a substantive human reply given the thread's character — treat as info-gathering, not relationship-building.

**Draft (EN, casual/human — asks about ADOPTION, not the already-solved gap):**

> saw APS while digging into x402 control tooling — solid work.
>
> i've been poking at the same thing from the SDK side: x402-express has no hook between verify and settle, so there's nowhere clean to drop budget/allowlist checks without forking the middleware.
>
> genuinely curious whether anyone's wired APS into a live x402 flow yet, or if it's mostly the Stripe Toolkit / MPP path so far? trying to gauge if the x402-specific side is worth building out. (reachable at konstantinosblavakis@gmail.com if easier)

**Bigger takeaway for strategy:** before writing a line of `@mvp1/core`, install `agent-passport-system` and read it. If it's genuinely good and adopted, the MVP1 thesis needs a sharper differentiator (x402-native? OSS-first? a real hosted dashboard they don't have?). If it's vaporware/demo-only despite the polish, that's the opening. **Decide this before Phase 2.**

---

### 2. @RBKunnela (paybot)  (GitHub) — ⚠️ COMPETITOR with a HOSTED product · issue is LOCKED

- **What they did:** Opened [openclaw#48140](https://github.com/openclaw/openclaw/issues/48140) on **2026-03-16**. Not a wishlist — a shipped stack: `paybot-sdk` (MIT), `paybot-mcp` (Apache 2.0), and `paybot-core` facilitator **hosted at api.paybotcore.com**. Trust levels 0–5, 5-gate validation, hash-chained audit log, EIP-3009, x402 auto-handler. **This is the most complete competitor found — it already has the paid hosted control plane MVP1 only plans for Phase 4.**
- **Issue is LOCKED** (steipete closed it not-planned 2026-04-25, bot locked to collaborators 04-27). **Cannot comment there.**
- **Also in that thread:** @luigiugge18 → "AgentPay" (per-agent virtual cards, spend limits, merchant whitelists, HITL; Stripe cards now, x402 next). A third competitor.
- **Backup channel if you still want contact:** open a discussion/issue on github.com/RBKunnela/paybot-sdk or /paybot-mcp, or check their GH profile for socials. But treat as competitive diligence, NOT "fellow sufferer" outreach.

**Do NOT send the old "what's blocking you from shipping" draft — they already shipped. If you engage, ask as a peer doing diligence (e.g. about real usage / what they'd do differently). Better: just read the source first.**

---

### 3. Alexey Vidanov  ([@vidanov on dev.to](https://dev.to/aicryptosystems))

- **What they did:** Published ["Agents that pay: why agent payments without governance is the next incident"](https://dev.to/aws-builders/agents-that-pay-why-agent-payments-without-governance-is-the-next-incident-2gc1) on **2026-05-08**. Identifies 4 gaps (phase enforcement, compensation, graduated budgets, audit/proof traces) and released **Shape** — MIT-licensed Python framework wrapping tool-calling agents with governance.
- **Who they are:** AWS Cloud Consultant, AWS Community Builder, Hamburg.
- **Why them:** Already wrote the manifesto AND a reference implementation. Knows the AWS/Bedrock side. If outside HotelPoint non-compete, possible collaborator on a Node port + Coinbase-specific work.
- **Channel:** dev.to comment + LinkedIn (Hamburg AWS people are reachable on LinkedIn).

- **VERIFIED real & responsive:** Replies to his own comments 3× in the thread. Shape is a single-file Python lib (MIT, zero deps) at github.com/vidanov/shape. He is the best human contact of the three — NOT head-to-head (he's Python/AWS-runtime-side; MVP1 is Node/x402-server-side). Potential ally / source, not competitor.
- **The thread handed us the strategic key:** his back-and-forth with @NOVAInetwork is exactly the enforcement-boundary question (runtime/beside-the-agent vs protocol/below-the-agent). MVP1's answer = resource-server-side, a third position neither argued. The draft below uses this — it proves you read the comments, not just the post.

**Draft (EN, human/casual — engages the live enforcement-boundary debate he's already having):**

> Alexey — clearest writeup on this I've seen. been hitting the same four gaps from the x402 server side.
>
> the enforcement-boundary point in your back-and-forth with NOVAI is the one I keep circling. Shape runs in the agent runtime, so a buggy/compromised agent can route around it — that's NOVAI's critique and it's fair. but you don't need a whole new chain to fix it: if the policy gate sits on the *resource server* (the x402 middleware that returns the 402), the agent physically can't bypass it, because the merchant won't settle without it. below the agent, no new chain.
>
> did you consider that placement, or is the tool-calling-loop framing intentional for Shape? curious where you'd draw the line. reachable at konstantinosblavakis@gmail.com

---

### 4. AWS Spend Governor team  (org)

- **What they did:** Published [aws-samples/sample-secure-agentic-payments-on-aws-x402](https://github.com/aws-samples/sample-secure-agentic-payments-on-aws-x402) — "Spend Governor" with budget caps, URL allowlist, rate limits, AWS Secrets Manager + KMS key management. Reference architecture for governed x402.
- **Why them:** They built the AWS-native version of what you're building. Useful as competitive context AND a possible partner channel (AWS Marketplace, if their reference becomes a real product).
- **Risk:** large-org outreach is slow. Lower priority than 1–3.
- **Channel:** GitHub issue on the repo titled "Question on Spend Governor design / x402 control gap" — open dialog publicly. Or DM the listed maintainers (need to dig — contributors graph wouldn't load).

**Draft (EN, GitHub issue):**

> Hi — really useful reference architecture. Working on a control-plane layer on the x402 client/server SDK side (`x402-express` + `x402-fetch`) and seeing the same gaps you address with Spend Governor: no hook between verify/settle, no audit event emission. Two questions:
>
> 1. Did you consider proposing the policy interfaces upstream to the x402 spec, or is the AWS-side coupling intentional?
> 2. Are you tracking real-world use of this sample beyond demo / hackathon traffic?
>
> Not pitching anything — building in the same space and trying to avoid duplicate work.

---

## Tier 2 — adjacent / opportunistic

### 5. Merit-Systems / awesome-x402 maintainer

- **What:** Curates [Merit-Systems/awesome-x402](https://github.com/Merit-Systems/awesome-x402). Whoever runs this list sees every new x402 project and probably has strong views on what's missing.
- **Approach:** PR a "Governance / Control Plane" section to the README with placeholders → opens dialogue, also potentially places MVP1 in the canonical list later.

### 6. TrapLedger team  (Coinbase / lablab.ai)

- **What:** Hackathon project applying "deterministic Policy Set, destination allowlist, max spend, blocklist, prompt-injection detection" before x402 Payment Proofs. Coinbase-aligned.
- **Approach:** Find team handles on the [lablab.ai project page](https://lablab.ai/tech/coinbase/x402) → cold message via lablab profile or X.

---

## General one-liner (use opportunistically in DMs / X replies / Discord)

> "Closed the x402→USDC loop locally last week and the control gap (budgets, allowlists, audit emit) is more naked than I expected — `x402-express` has zero hook between verify and settle, `x402-fetch`'s only hook is a sync selector. Anyone running x402 in something resembling production: how are you handling this today?"

(Greek opportunistic variant for any Greek dev surfaces:
*"Έκλεισα τοπικά το x402→USDC loop και το gap στα controls είναι πιο γυμνό απ' όσο περίμενα. Όποιος τρέχει x402 σε κάτι σαν production: πώς το χειρίζεσαι;"*)

---

## Tracker (use as-is, sticky notes / Notion / whatever)

| # | Target | Channel | Sent? | Reply? | Notes |
|---|---|---|---|---|---|
| 1 | @aeoess | GitHub #356 |   |   |   |
| 2 | @RBKunnela | GitHub #48140 |   |   |   |
| 3 | Alexey Vidanov | dev.to + LinkedIn |   |   |   |
| 4 | AWS Spend Governor | GitHub repo issue |   |   |   |
| 5 | awesome-x402 maintainer | GitHub PR |   |   |   |
| 6 | TrapLedger | lablab/X |   |   |   |

---

## Decision rule (don't lose it)

- **3 strangers confirm the same top-2 pain points** → Phase 2 starts on `@mvp1/core` interfaces + `@mvp1/x402-express-governed`.
- **0–2 confirmations, or wildly different pains surface** → re-scope. Don't build the wrong thing.
- **Conversations reveal a feature you missed** → add to [gap-audit.md](gap-audit.md), re-scope Phase 2 accordingly.

---

## Sources

- [Stripe AI #356 — Governance layer for Stripe agent payments](https://github.com/stripe/ai/issues/356)
- [OpenClaw #48140 — Payment primitive plugin (x402/USDC)](https://github.com/openclaw/openclaw/issues/48140)
- [Vidanov — Agents that pay: why agent payments without governance is the next incident](https://dev.to/aws-builders/agents-that-pay-why-agent-payments-without-governance-is-the-next-incident-2gc1)
- [AWS x402 Spend Governor sample](https://github.com/aws-samples/sample-secure-agentic-payments-on-aws-x402)
- [Merit-Systems awesome-x402](https://github.com/Merit-Systems/awesome-x402)
- [TrapLedger on lablab.ai](https://lablab.ai/tech/coinbase/x402)
