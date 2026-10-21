# IFCAST Crypto v0.2 — Price Targets & Coin Battles

> **Implementation branch — not deployed.** Contract syntax and shimmed deterministic tests are not proof of GenVM compatibility or verified oracle availability. Existing v0.1 contract and market positions remain untouched.

**Product goal:** A crypto-first YES/NO prediction experience. Users should not need to understand GenLayer consensus to pick a side. Initially uses **non-transferable test credits**, not collateral, payouts in money, or financial instruments.

## User-facing markets

- **Touch above:** “Will ETH reach or exceed 2,500 USDT during the 24-hour window?” YES iff at least one completed 1-hour ETH/USDT spot candle has **high >= 2500 USDT**.
- **Touch below:** “Will BTC touch or fall below 60,000 USDT?” YES iff at least one completed 1-hour candle has **low <= threshold**.
- **Coin battle:** “Will SOL outperform ETH over the next 24 hours?” YES iff **SOL's percentage return > ETH's return**, computed using the exact opening price of each first hourly candle and the closing price of each last hourly candle. Ties are VOID.

The phrase *reach* is intentionally scoped to observed **hourly high/low** values on **Binance spot /USDT**, not Binance Futures, USD spot, arbitrary minute-by-minute market prices, or predictions about an exchange's listing or volume. “By date” means the **end of the explicitly selected UTC observation window**, not any unspecified timezone. An unqualified `$2500` claim should **not** be described as exact USD; USDT can deviate from USD.

## Locked on-chain policy

`contracts/IFCastCryptoV02.py` defines a new contract with these public write methods:

```text
claim_demo_credits()
create_market(kind, token_a, token_b, target_e8, start_at, duration_hours)
place_position(market_id, side, amount)
resolve_market(market_id)
claim(market_id)
```

Read methods: `get_market_count`, `get_market`, `get_markets(offset,limit)`, `get_balance`, `has_claimed_grant`, and `get_position`.

- `kind`: `TOUCH_ABOVE`, `TOUCH_BELOW`, `OUTPERFORM`.
- `token_a`, `token_b`: allowlisted spot tokens: BTC, ETH, SOL, BNB, DOGE, AVAX, LINK, XRP. Empty `token_b` for price target; different assets required for battles.
- `target_e8`: integer threshold at **100,000,000 price units / USDT**. For 2,500 USDT use `250000000000`; battles must use `0`.
- `start_at`: exact future UTC full-hour Unix timestamp, at least 15 minutes ahead and at most 7 days ahead at market creation. **Prediction cutoff equals start_at**.
- `duration_hours`: 1, 4, 24 or 168; end_at=start_at+duration_hours*3600; earliest resolution is end_at+300 seconds.
- **Fixed source:** `https://api.binance.com/api/v3/klines?symbol={TOKEN}USDT&interval=1h&startTime={start_at_ms}&endTime={end_at_ms-1}&limit=1000` with only on-chain-allowlisted tokens and parameters. Creator **cannot set a source URL or resolution answer**.
- Every required candle must exist, have the expected open/close millisecond timestamps, have valid positive prices and internally coherent OHLC. Missing bars never imply NO.
- GenLayer leader and validators independently request the source(s), normalize exact fixed-point OHLC records, and compare both `outcome` **and SHA256 evidence digest** through `gl.vm.run_nondet_unsafe`.
- Responses are **YES / NO / VOID / UNKNOWN**. UNKNOWN leaves the market OPEN for retry after 10 minutes; VOID and empty winning-side markets refund the complete virtual stakes. Claims are on-chain and one-time. Credits cannot be withdrawn or transferred.

## Why this is different from the v0.1 GitHub market

Price outcomes are **deterministic**, not subjective: an LLM should not decide whether one price is greater than another. GenLayer validators protect agreement over independently observed data. The existing GitHub `IFCast.py` remains a separate **AI event-resolution experiment** to keep the actual LLM-related work distinct. A future product version can add trustworthy AI Event Markets after explicit source policies and evidence tests, without falsely claiming all price predictions need an LLM.

## Security / production blockers

1. The Binance public API must be tested on **real GenLayer Studionet GenVM**. It may rate-limit, block regions, change availability, or not provide historical candles, and independent validator reads may disagree. A runtime network failure should keep OPEN or fail safely; never automatically decide NO.
2. A single exchange is not a neutral or cryptographically authenticated oracle. Complete historical data from Binance can still be revised or manipulated. Before real money: add multi-source verification, finalized observation proofs, source-versioning, economic security, conflict/dispute policy, data retention and rigorous audit.
3. 1h high/low answers “did Binance's 1h candle report this threshold,” not “was that threshold touched on all crypto exchanges?”
4. A candle high may be a fleeting print. Future markets should offer clear `TOUCH` vs `CLOSE` semantics and better anti-outlier controls; no stealth oracle substitutions are permitted.
5. Credits are nonredeemable and not backed. This is not a licensed prediction-market product. Avoid financial collateral or production/mainnet deployment before legal, technical, security and market-integrity assessment.
6. The VM may reject parts of the current standard-library approach; compilation with CPython or mock tests does not guarantee deployability on GenLayer.
7. Repeated inconclusive resolutions can leave credits locked indefinitely. A formally specified timeout/refund escape hatch or bounded appeal design is necessary before financial usage.

## Local checks

```bash
python -m py_compile contracts/IFCastCryptoV02.py
python -m pytest -q tests/
cd web
npm install
npm run build
```

**Never point the v0.2 UI to `0xA0Ba214e2a4b848219A21515ff6b3A49162075C7`.** That is the old GitHub-only contract, and it holds the existing Market #1 test credits. The v0.2 frontend intentionally has no address fallback.

After a separate v0.2 contract is deployed and verified in Studio, configure `web/.env` (or Vercel env) as:

```env
VITE_IFCAST_CRYPTO_V02_ADDRESS=0xYOUR_NEW_VERIFIED_CONTRACT_ADDRESS
```

For Vercel, Root Directory = `web`, Framework = Vite, Build = `npm run build`, Output = `dist`. Do not claim a live contract/URL or finished price-consensus test until receipts are captured.

## Live acceptance gates (not yet completed)

1. Run GenVM lint and current supported GenLayer local/direct integration checks against the v0.2 source.
2. Deploy the *new* contract in Full Consensus mode on Studionet, recording the finalized tx hash and complete address.
3. Claim demo credits with two distinct wallets; open an upcoming hourly-window ETH threshold market; take opposite sides before start; verify balances, no cross-side manipulation, no post-start stakes.
4. After all hourly bars finish and resolution delay passes, execute a resolution with full validator trace. Verify actual source, candle count, evidence digest and outcome in on-chain reads. Test threshold crossing, no crossing, tie, sparse candles, HTTP 429/5xx, contradictory/revised source and delayed data.
5. Claim using each wallet, verify payout/refund balances and prevent duplicate claims.
6. Connect Vercel web to deployed address, test two wallets and mobile layout, capture reviewer video.

## Versioning

- v0.1 (unchanged): `contracts/IFCast.py`, deployed on Studionet, GitHub PR/release evidence.
- v0.2 (this branch): `contracts/IFCastCryptoV02.py`, **new, un-deployed** crypto price-and-battle prototype; separate state, balances and addresses.
