# IFCAST

**Conditional prediction markets with independently verified GenLayer AI consensus.**

> **Status: early testnet implementation (v0.1). NOT deployed, audited, or approved for mainnet.** Demo credits have zero monetary value. The contract neither accepts nor pays GEN/ETH/USDC as stakes; GenLayer network transactions can still incur native network fees. Do not use it with real funds.

IFCAST tackles a common prediction-market ambiguity: *what if the prerequisite never happens?* A market defines an **IF precondition** and a **THEN target**. Its policy, URLs, close time, and earliest resolution time are committed when the market is created. The outcome is resolved by GenLayer's independent validator mechanism, while participant accounting and payouts remain deterministic.

## Why not another YES/NO oracle?

The incentive consequence is not a webpage label. A finalized market outcome determines which participants receive non-transferable test credits, or whether everyone is refunded. **Missing evidence never means NO.** The settlement policy explicitly defines a VOID outcome if the prerequisite misses its deadline, and an inconclusive path that leaves the market unresolved.

### Fixed source policy in v0.1

This first release deliberately limits the attack surface to **one GitHub repository** and two fixed API endpoint shapes:

- IF: `https://api.github.com/repos/{owner}/{repo}/pulls/{number}`
- THEN: `https://api.github.com/repos/{owner}/{repo}/releases/latest`

The *exact URLs* are pinned and cannot be changed by a resolver. Query strings, ports, non-HTTPS schemes, alternative hosts, cross-repository evidence, and arbitrary web pages are rejected in the contract. Source material is clearly labeled as untrusted in the AI prompt. The leader and validator independently read the source URLs and derive separate structured verdicts; both **condition** and **target** decision fields must match before writing outcome state.

**Important evidence limitation:** A latest-release endpoint does not prove that no qualifying earlier release exists. The resolver is explicitly told to return UNKNOWN unless a negative outcome is affirmatively demonstrated. This can leave markets unresolved; it is preferable to a false NO. Production-grade absence proofs need an expanded archived-source policy and stronger machine-checkable rules. GitHub rate limits and changing API output are other unresolved risks.

## Resolution table

| AI condition | AI target | Stored settlement |
| --- | --- | --- |
| FALSE | any | VOID, all participants refunded |
| TRUE | TRUE | YES, winning pool shares loser credits |
| TRUE | FALSE | NO, winning pool shares loser credits |
| TRUE/UNKNOWN | UNKNOWN (or condition UNKNOWN) | OPEN, retry after 10-minute cooldown |
| TRUE | TRUE/FALSE, no positions on winning side | VOID refund (avoid trapped demo credits); actual outcome preserved |

Only `RESOLVED` or `VOID` can be claimed. Each wallet can hold only one side per market, but can increase that position before close. A wallet may claim the one-time faucet only once (1000 credits). Max stake per call is 1000 credits. Payout uses integer floor division; any rounding dust remains unallocated in the virtual pool and is **not** available to creators. The market creator has **no privileged resolution, payout, or cancellation function**. Appeals are managed by the underlying GenLayer transaction consensus lifecycle, not by arbitrary market-state mutation.

## Repository

```text
contracts/IFCast.py       GenLayer intelligent contract + custom independent validator
web/                      React / TypeScript / Vite GenLayer dApp
  src/genlayer.ts         Wallet, read, fee estimate, write, FINALIZED receipt checks
  src/main.tsx            Market explorer, form, positions, resolution, activity
  src/style.css           Responsive UI
  .env.example            Contract deployment address (public)
tests/                    Deterministic local logic regression suite
.github/workflows/ci.yml Basic Python and frontend build checks
REVIEWER.md               Steward reproduction and acceptance gates
SECURITY.md               Threat model and current limitations
```

## Local development

Requirements: Node.js 20+ and Python 3.12+. The frontend pins `genlayer-js@2.0.0-rc.1` because its fee-estimation and finalization APIs are not available in the stable v1 package; do not mix this preview SDK with an incompatible chain/node release. For a live deployment you also need the current GenLayer CLI / GenLayer Studio and a testnet wallet with enough network-fee tokens.

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q tests/
python -m py_compile contracts/IFCast.py

cd web
cp .env.example .env
npm install
npm run dev
npm run build
```

The app intentionally shows **"Deployment not configured"** and no manufactured on-chain markets until `VITE_IFCAST_CONTRACT_ADDRESS` points to a verified deployment.

### Deploy to Studionet

1. Install/configure the [GenLayer CLI](https://docs.genlayer.com/developers/intelligent-contracts/deploying) or open [GenLayer Studio](https://studio.genlayer.com/).
2. Deploy `contracts/IFCast.py` **with an empty constructor** to Studionet, using the runner pinned on line 1.
3. Confirm the deployed source code matches this repository commit and record its **contract address, deployment transaction hash, network chain ID, and finalized status** in your reviewer evidence.
4. Set `web/.env` to `VITE_IFCAST_CONTRACT_ADDRESS=0x...` and run the app. For Vercel, set **Root Directory: `web`**, build command `npm run build`, output `dist`, and the same environment variable for the target environment.
5. Test with two distinct wallets. Both must independently claim demo credits. Call `create_market`, `place_position` from opposite wallets, then **after both market timestamps have passed**, `resolve_market`, and `claim`. Wait for finalization after each transaction.

**There is deliberately no claimed deployed address, Vercel URL, or successful live consensus in this repository yet.** Do not submit to GenLayer Projects on the basis of local mock tests alone.

### Read methods

`get_market_count()`, `get_markets(offset, limit)`, `get_market(market_id)`, `get_position(market_id, wallet)`, and `get_balance(wallet)`, and `has_claimed_grant(wallet)`.

### Write methods

`claim_demo_credits()`, `create_market(title, condition, target, condition_url, target_url, close_at, resolve_after)`, `place_position(market_id, side, amount)`, `resolve_market(market_id)`, `claim(market_id)`.

All time arguments are **UTC Unix seconds**, with `close_at > transaction_time + 60`, `close_at < resolve_after`, and `resolve_after` at most one year into the future. `datetime.now(timezone.utc)` under GenVM is the **transaction's deterministic timestamp**, not validator wall-clock time.

## Verification / release blockers

- [x] Contract syntax compiles with local CPython.
- [x] 22 local deterministic regression tests (shimmed GenLayer environment).
- [x] Independent leader/validator evaluation in source code; verdict fields compared strictly.
- [x] Only demo credits; no payable write methods.
- [ ] Run `genvm-lint check contracts/IFCast.py` against a supported runner.
- [ ] Run real GenLayer direct-mode and Studio integration tests (mocks are insufficient).
- [ ] Validate browser SDK against an installed dependency set (`npm run build`).
- [ ] Deploy verified contract to Studionet and capture finalized transaction receipts.
- [ ] Verify real web/LLM consensus with valid, inconclusive, contradictory, and prompt-injection fixtures.
- [ ] Record a live two-wallet test and reviewer video.
- [ ] Security review and multi-user load testing.

## Documentation

- [GenLayer Equivalence Principle](https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle)
- [Transaction context](https://docs.genlayer.com/developers/intelligent-contracts/features/transaction-context)
- [GenLayerJS](https://docs.genlayer.com/api-references/genlayer-js)

MIT licensed. Built experimentally for GenLayer. Not financial advice.
