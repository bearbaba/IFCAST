# IFCAST — live Studio acceptance runbook

Status: **Partially exercised on Studionet; final AI settlement has not yet been evidenced.** This document records the manual two-wallet acceptance test for the immutable contract already deployed on Studionet. It is not a request to redeploy or reset the contract.

## Verified inputs and scope

- Network: **GenLayer Studionet** (chain ID 61999).
- Contract: `0xA0Ba214e2a4b848219A21515ff6b3A49162075C7`.
- [Open the deployed contract in Studio](https://studio.genlayer.com/?import-contract=0xA0Ba214e2a4b848219A21515ff6b3A49162075C7).
- [Deployment transaction](https://explorer-studio.genlayer.com/tx/0xf3095b5854582ee61da774992c29a8e07e84b1c34ff8e924aee3b86e8c37ce17), displayed as FINALIZED in the deployer's screenshot.
- Market ID: **1**.
- `close_at=1792406700` (2026-10-19 10:45:00 UTC).
- `resolve_after=1792407600` (2026-10-19 11:00:00 UTC).
- Historical illustrative IF/THEN: GitHub [vitejs/vite PR #23806](https://github.com/vitejs/vite/pull/23806) vs [`releases/latest`](https://api.github.com/repos/vitejs/vite/releases/latest). This is **not a forward-looking, uninformed prediction**. The latest-release API is mutable and can cease to represent the relevant historical release.

## Evidence already supplied by the deployer

1. Studio `get_balance(0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb)` returned `1000`, ACCEPTED.
2. Studio `has_claimed_grant(0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb)` returned `true`, ACCEPTED.
3. Studio `get_market(1)` initially showed `status=OPEN`, `yes_pool=0`, `no_pool=0`; a subsequent read reported `yes_pool=100`, `no_pool=200`.
4. Studio `get_position` returned `{"amount":100,"claimed":false,"side":"YES"}` (wallet input not included in the submitted excerpt). Confirm the YES wallet separately.
5. Studio `get_position(1, 0xD6b8A3A5eB329410D9504784812b8569afA8C2aF)` returned `{"amount":200,"claimed":false,"side":"NO"}`, ACCEPTED.
6. An **early** `resolve_market(1)` transaction was ACCEPTED **with execution ERROR** and `Resolution window has not opened`. This was an expected time-gate rollback, **not** a successful resolution.

The following are still **missing**: finalized `resolve_market(1)` success receipt, validator evidence trace, settled `get_market(1)` state, payout claims, and a Vercel web demo.

## Acceptance test, in order

### Step A — read before write

In Studio, use **Read Methods → get_market** with `market_id=1` and record `status`, `attempts`, `last_attempt_at`, `outcome`, `reason`, `yes_pool`, and `no_pool`.

- If `RESOLVED` or `VOID`, **do not call resolve again**. Proceed to Step C.
- If `OPEN`, the earliest resolution deadline has elapsed. Check the cooldown: if `attempts>0`, wait until at least `last_attempt_at+600` UTC seconds. Then continue to Step B.
- An accepted read is not itself a write receipt.

### Step B — resolve only when eligible

Call **Write Methods → resolve_market** with `market_id=1`. Use Normal / Full Consensus mode. Record the **full transaction hash**, and inspect both **consensus status** and **execution result**. A transaction can be ACCEPTED while its execution result is ERROR (as in the early time-gate test).

Wait for FINALIZED before trusting balances. Re-read `get_market(1)` and capture the validator/evidence history if available.

- `RESOLVED` and `outcome=YES` or `NO`: proceed to Step C.
- `VOID`: both sides are eligible for an exact refund, proceed to Step C.
- `OPEN` with `attempts>=1`: inspect `reason` and source availability. It can legitimately be inconclusive; retry only after cooldown, and **do not invent a verdict**.
- Execution `ERROR`: collect full GenVM/validator error before considering any code changes or redeployment.

### Step C — claim using each original position wallet

First confirm `get_position(1, walletA)` and `get_position(1, walletB)`. Check balances before and after claim. Use the wallet that owns each position; the creator cannot claim on another account's behalf.

- If `RESOLVED / YES`: with YES=100 and NO=200, the YES side can claim **300 credits total** (provided that wallet actually owns the complete 100-credit YES pool). The 200-credit NO wallet can claim **0 credits**, marking that position claimed.
- If `RESOLVED / NO`: the NO wallet can claim **300 credits total**; the YES wallet can claim 0 credits.
- If `VOID`: YES can reclaim **100**; NO can reclaim **200**.
- Verify each `get_position(...).claimed` switches to `true` and that a repeated `claim(1)` reverts.
- Record claim transaction hashes separately from final read results. All values are **non-redeemable demo credits**, not GEN.

### Step D — frontend acceptance

When a Vercel web URL exists: read live market state via the configured Studionet contract; connect each wallet, check displayed positions, inspect activity and explorer links, verify the UI reflects refreshed state, and confirm the UI never reports success based solely on `ACCEPTED` when execution failed. Record screenshots and an unedited walkthrough.

## Results log (fill with real evidence only)

| Gate | Status | Evidence |
| --- | --- | --- |
| Deployment | Studio screenshot FINALIZED | Deployment tx linked above |
| Balance/grant | Accepted reads | User-provided Studio outputs |
| Market #1 created | Accepted market read | `get_market(1)` |
| YES and NO pools | Accepted market read | `yes_pool=100`, `no_pool=200` |
| NO position owner | Accepted view | Wallet B address above |
| Early resolution guard | Expected rollback | ACCEPTED / ERROR screenshot |
| Post-deadline resolution | **PENDING** | Add finalized tx hash |
| Market decision / evidence | **PENDING** | Add `get_market(1)` and validator trace |
| Claims and double-claim | **PENDING** | Add both wallet hashes |
| Deployed UI | **PENDING** | Add HTTPS URL |

## Security limitations

The first version uses **GitHub PR + the mutable latest-release API only**, not a general-purpose trusted oracle. Missing proof of a negative is **UNKNOWN**, not NO. An absent/changed release API response can prevent settlement; do not override or manually invent the result. No real-money custody, transferable credits, or mainnet financial support is implemented. See [SECURITY.md](SECURITY.md).

## Time-dependent source drift observed on 2026-10-21

A live GitHub API re-check on 2026-10-21 confirmed why the first market must not assume a YES or NO outcome:

- PR `vitejs/vite#23806`: `merged_at = 2026-10-18T06:48:24Z` (before the IF deadline).
- [Tagged release `create-vite@9.3.0`](https://github.com/vitejs/vite/releases/tag/create-vite%409.3.0): `published_at = 2026-10-19T08:05:45Z`; notes explicitly cite `#23806`. This is affirmative **historical** YES evidence, within the market's target deadline (09:00Z on 2026-10-19).
- However the market's immutable `target_url` points to **[releases/latest](https://api.github.com/repos/vitejs/vite/releases/latest)**, which on 2026-10-21 returned **`v8.3.5`**, published at `2026-10-21T06:35:46Z`, with **no** `#23806` mention.

**Important:** The deployed v0.1 contract cannot fetch the tagged release through an arbitrary replacement URL. Do not change the source off-chain or assert that consensus has seen the historical release. The correct response to insufficient data from the pinned endpoint may be `UNKNOWN`, leaving market 1 `OPEN`. This finding is a v0.2 source-policy blocker: pin exact release identities or use a bounded archival release list with deterministic filtering and a fixed observation window, then redeploy a separate contract after tests. Never retrofit an already open market's terms.
