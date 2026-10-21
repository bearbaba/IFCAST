# IFCAST Unified v0.3 — Crypto Predictions + AI-Verified Events

> **DEVELOPMENT PROTOTYPE — NOT DEPLOYED, NOT MAINNET SAFE.** This branch is an unmerged Draft PR. All stakes use non-transferable, non-redeemable **demo credits**. The deployed v0.1 GitHub demonstration and the older v0.2 price prototype remain separate; never reuse their addresses with the v0.3 frontend.

## Why GenLayer matters

Price-only prediction markets can resolve with ordinary deterministic arithmetic plus an external price oracle. Using GenLayer for **these** calculations is not, by itself, a defensible claim of novel LLM adjudication.

IFCAST v0.3 intentionally distinguishes three market types in **one GenLayer contract and one frontend**:

| User question | Engine | Decisive evidence |
| --- | --- | --- |
| Will ETH/USDT touch 2,500 during a specified 24h window? | Price Target (`TOUCH_ABOVE` / `TOUCH_BELOW`) | Every completed Binance Spot USDT 1h candle in the frozen window; threshold comparison in exact integer units |
| Will SOL outperform ETH over the same 24h window? | Coin Battle (`OUTPERFORM`) | Exact open and close prices at the same UTC boundaries, with integer cross-multiplication; ties are VOID |
| Will Coinbase officially list a specified token for spot trading? | AI Event (`COINBASE_SPOT_LISTING`) | Official dated Coinbase blog article submitted after cutoff, independently read and semantically assessed by leader and validators |
| Will the SEC approve a specified issuer/asset **spot** ETF before deadline? | AI Event (`SEC_SPOT_ETF_DECISION`) | Official dated SEC press release or permitted HTML document; SEC filing/deferral/futures ETF is not approval |

The *specific* official decision is the useful GenLayer component. The contract uses `gl.nondet.web.get` **and** `gl.nondet.exec_prompt(..., response_format='json')` inside `gl.vm.run_nondet_unsafe`. Validators independently fetch the official URLs and re-run the AI interpretation. For AI events, equivalence compares **outcome + exact supporting URL + UTC event timestamp**; free-form explanations can differ, but cannot substitute for agreement on what happened.

The AI event category is *not* a general free-form “AI decides any news” market. Allowed categories, source hosts, subject identification, market deadline and settlement rules are all restricted in the contract. Market creator cannot directly set the verdict.

## Files

- `contracts/IFCast.py`: legacy deployed v0.1 — unchanged.
- `contracts/IFCastCryptoV02.py`: legacy undeployed price/battle prototype — unchanged.
- `contracts/IFCastUnifiedV03.py`: new isolated contract, unifying price/battle/AI event markets.
- `tests/test_unified_v03.py`: deterministic shim-based checks of adversarial URL input, timing, validator disagreement, decision gating and payouts.
- `web/`: one English-language market explorer and builder. `VITE_IFCAST_UNIFIED_V03_ADDRESS` must be set only after a new v0.3 deployment is independently verified.

## Event rules (important)

1. User creates a category-specific market with a precisely named subject (issuer + asset/token) and two immutable UTC times: `close_at` (predictions stop) and `deadline_at` (event must occur by then). The deadline must be at least one hour after close, and at most 60 days from creation.
2. After betting closes, **anyone** may submit up to four unique official evidence URLs. Strict domain and path allowlists prohibit lookalike domains, credentials, query strings and fragments. SEC **binary PDF** and untrusted sources are deliberately not supported in this text-reading prototype.
3. Full Consensus may run no earlier than five minutes after the event deadline. Each validator independently re-reads the submitted official pages and evaluates the same locked question.
4. **YES** requires an explicit dated official approval/listing of the exact issuer/asset, with a UTC timestamp inside the locked event window.
5. **NO** requires an explicit dated *official rejection/cancellation* of that exact application/listing. Rumors, roadmaps, unrelated assets, a pending application or the **absence of an announcement** never prove NO.
6. Missing, conflicting, inaccessible or ambiguous evidence yields `UNKNOWN`, which leaves the market `OPEN` for further proof/retry after a ten-minute cooldown. The contract records attempts, reason, supporting URL, event timestamp and a fingerprint of the agreed **decision identity**, not a hash of the website's contents.
7. After **14 days past earliest resolution**, evidence submissions close. If all submitted evidence has had a successful consensus review but the result remains unresolved, anyone may call `void_expired_event` to VOID the market and refund both sides. This is a disclosed timeout rule; it is **not a NO payout**. No submitted documents = no review needed before refund. If new evidence arrives, the review count becomes stale and another successful review is required before refund.
8. A finalized `RESOLVED` or `VOID` market cannot be changed by subsequent evidence/resolution calls. One-time `claim` payouts are deterministic virtual accounting, like v0.2.

**User comprehension requirement:** “Will Coinbase list token X before Y?” looks binary, but a NO payout only occurs after explicit authoritative cancellation. If simply not listed by Y with no verified rejection, the market may VOID/refund after grace. **Do not describe that as a standard Polymarket-style binary settlement rule.** A production NO-by-absence product would need a trusted complete historical event index to prove the negative.

## Source limitations and trust boundary

- Whitelisting the original URL does **not** verify the final redirect destination, authenticity of the page body, publisher archival integrity, or historical permanence; these are blockers to production.
- Coinbase and SEC may present JavaScript-rendered content, PDFs or inaccessible pages; GenVM source access is **UNVERIFIED**. `get` retrieves raw content and truncates to the first 22k chars, so critical evidence may be missing even when the page exists. Inconclusive is safe; do not force a decision.
- The LLM can hallucinate a publication time or mistake similar asset names; validators independently assess but may agree on a false assertion. The supporting timestamp is syntax/interval-checked, **not cryptographically authenticated**. A decision fingerprint does not prove that an official record is authentic.
- A single ambiguous document may lead to a refunded test-credit market instead of a NO result. Censorship, latency, spam to fill four evidence slots and premature/late release updates need adversarial live testing.
- The Binance Price Engine uses one exchange and is not suitable for real-value custody. A multi-source archived price oracle, dispute policy, sybil resistance, code audits and legal review are mandatory before any economic launch.
- SEC/Coinbase evidence source URLs and timestamp reliability must be demonstrated **on Studionet with validator traces**. Local test mocks cannot establish any of these properties.

## Dev checks

```bash
python -m py_compile contracts/IFCast.py contracts/IFCastCryptoV02.py contracts/IFCastUnifiedV03.py
python -m pytest -q tests/
cd web && npm install && npm run build
```

## Strict reviewer gates before marking Ready or submitting Projects

1. Run `genvm-lint check` against v0.3 and fix all GenVM incompatibilities. Local CPython compilation is insufficient.
2. Deploy a **new** `IFCastUnifiedV03` instance on GenLayer Studionet, Normal / Full Consensus, with final transaction hash and source parity confirmed.
3. Verify two wallets, demo credit grants, one complete **price target** and one **coin battle** including correct payout/refund, double-claim rejection and UI.
4. Verify one actual **SEC or Coinbase AI event**: create while future, submit real date-stamped official evidence after close, wait until deadline, execute `resolve_market`, capture full leader/validator traces and `get_market` outcome. Test one deliberately ambiguous or unavailable official source to get `UNKNOWN` rather than NO.
5. Verify the 14-day timeout rule using safe accelerated test-chain setup, not a fabricated real-time Studionet claim.
6. Publish one HTTPS frontend (Vercel project root `web`, Vite `dist`, `VITE_IFCAST_UNIFIED_V03_ADDRESS` set to **the new verified v0.3 address**). Confirm two-wallet behavior, source links and finalized receipt checks.
7. Record unedited demo, exact explorer URLs, complete `README.md` and `SECURITY.md` disclosure. Do not overstate true AI consensus until this is finished.

## Submission positioning

IFCAST is a *crypto-first prediction market with independent AI adjudication of official crypto events*, not a webpage classifier or a simple LLM wrapper. Consequence: winning/losing positions and refunds **change on-chain, per-wallet balances of demo credits** following a GenLayer consensus result. The Price Engine attracts users; the AI Event Engine is why the product uses GenLayer. This must be proven with **real consensus transactions**, not only mock test logs.
