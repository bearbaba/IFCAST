# Security policy — IFCAST experimental release

IFCAST is **not audited**. This is not a real-money market. Demo-credit balances are non-transferable and cannot be redeemed. GenLayer transactions may still require native gas/consensus fees.

## Threats considered

- **Evidence prompt injection:** external release notes and PR text are untrusted, wrapped as data, not execution instructions; independent validator re-fetches the evidence. This mitigates but does not eliminate model manipulation.
- **SSRF / source substitution:** only HTTPS `api.github.com/repos/<owner>/<repo>/pulls/<number>` and matching repository `releases/latest` are accepted; all policy URLs are frozen on chain.
- **Resolver griefing:** any caller may resolve only after the eligible timestamp. Inconclusive results require a ten-minute retry cooldown. Finalized state cannot be rewritten by a new resolution call.
- **Deadline bypass:** contract time is pinned to the transaction context. Positions close exactly at `close_at`; resolution requires `resolve_after`.
- **Double claims / hedge manipulation:** claims are one-time; position cannot switch sides on the same market.
- **Insufficient evidence:** never treat unknown as NO; latest-release is insufficient to disprove an earlier release. Inconclusive remains unresolved, possibly indefinitely.
- **Conservation:** integer pro-rata payouts do not mint bonus credits, only reassign stakes. If there are no winners, all participants are refunded; fractional dust is not credited to anyone.

## Open issues / risk acceptance

- Nondeterministic model can still misread external evidence or agree on false facts; exact field agreement is not objective truth.
- `releases/latest` reflects only the most recent release. Time-window absence proofs are intentionally not supported. Expand sources and test before financial use.
- Public GitHub API rate limiting, temporary 404/5xx, mutable release bodies, and changing source contents can affect consensus.
- Storing markets as JSON in TreeMap is intentionally simple for v0.1, not optimal for high-scale state reads.
- There is no built-in custom appeal flow, dispute bond, formal economic audit, anti-Sybil policy, token economics, or private-market access control.
- One-time faucet can be gamed across many addresses. This does not affect real value because credits have none.
- Virtual accounting tests are local shims and **not proof of GenVM semantics**. Real testnet verification is a release gate.

Please report security issues privately via GitHub security reporting if enabled, rather than posting exploitable secrets in a public issue. No secret keys should be committed.
