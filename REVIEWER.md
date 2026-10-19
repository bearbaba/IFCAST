# IFCAST — steward review guide

## Submission status

**Not submission-ready yet.** A Studio screenshot dated 2026-10-19 shows a FINALIZED deployment transaction, but the complete contract address and on-chain source parity have not been independently verified. There is no finished end-to-end demo. The scope is limited to a GitHub PR / release conditional market with **non-transferable, non-redeemable demo credits**. No test should use real-money collateral.

## Contested consequence

The contract locks participant demo credits when they select YES/NO. An independent GenLayer consensus result governs **who is permitted to claim the virtual pool**, or whether it must be refunded. Neither the caller nor creator can select/overwrite the resolution after market creation; no `admin_finalize` or `challenge_anything` bypass exists.

## Evidence boundary

1. `create_market` requires two exact, public GitHub REST endpoint shapes in the **same repository**. The entire URL is permanently stored on-chain. Query parameters, ports, untrusted domains, and cross-project evidence are rejected.
2. At `resolve_market`, a leader loads both pinned URLs and analyzes the original immutable IF/THEN rules. A validator **independently reloads both sources** and performs the same analysis. Decision fields `condition` and `target` must match exactly; free-form reasoning is not used as consensus equality.
3. Unknown evidence results in **OPEN**, not NO. `FALSE` prerequisite yields VOID. `TRUE` prerequisite + `TRUE` target yields YES. `TRUE` + `FALSE` yields NO. Zero winning positions trigger refund instead of trapping credits.
4. All balances, timestamps, pool accounting and one-time claims are deterministic. There are no payable/financial methods. GenLayer's protocol lifecycle governs appeals of a consensus transaction.

## Reproduction checklist (after deployment)

1. Inspect the deployed source with the GitHub version `contracts/IFCast.py`; confirm chain and finalized deployment transaction.
2. Connect wallet A; claim 1000 demo credits. Connect wallet B; claim 1000 demo credits.
3. Create a market for a GitHub PR + `releases/latest` pair. Show immutable `close_at`, `resolve_after`, source URLs, condition text, and target text in `get_market(1)`.
4. Before close, stake e.g. 100 YES from A and 200 NO from B. Confirm balances fall, and that taking the other side of the same market fails.
5. Confirm early resolution fails. After `resolve_after`, trigger `resolve_market`. Show leader + validator execution trace and finalized receipt. Use authoritative source data sufficient for a definite result, or explicitly present **inconclusive** (never pretend to get YES/NO).
6. Claim payout/refund via connected wallets; check `claimed`, verify double-claim reverts and that the creator cannot overwrite finalized settlement.
7. Supply hash links, screenshot(s), and an unedited recorded session. Test an unavailable evidence URL, contradictory JSON, malicious release notes and a stale/latest-release case; preserve trace of any unresolved/rotated decision.

## Verified evidence

- On-chain contract address: `0xA0Ba214e2a4b848219A21515ff6b3A49162075C7` (user supplied exact Studio import URL; source match independently unverified)
- Network + chain ID: **Studio context suggests Studionet (target chain ID 61999); independently verify through RPC**
- Deployment transaction: [`0xf3095b5854582ee61da774992c29a8e07e84b1c34ff8e924aee3b86e8c37ce17`](https://explorer-studio.genlayer.com/tx/0xf3095b5854582ee61da774992c29a8e07e84b1c34ff8e924aee3b86e8c37ce17) — **FINALIZED according to Studio screenshot; independently verify explorer/RPC and deployed source**
- Resolution transaction: **NONE**
- Live web app: **NONE**
- Real integration tests: **PENDING**

Do not claim a successful AI consensus or point allocation without supplying those artifacts.

## Added live read evidence (2026-10-19)

From the deployer's Studio output: `get_balance(0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb)` returned `1000` with `Response (Accepted)`. This verifies an accepted read call as reported, **not** that faucet claiming, pool settlement, or wallet-to-web flows have been demonstrated. Next obtain a finalized `claim_demo_credits` transaction if not already recorded; create a market and complete the two-wallet claim sequence.
