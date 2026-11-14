# Soul → Controller interface differences (handoff; no runtime code changes)

## GAP-ARB-01 — Conditional Arbitrator vs mandatory final execution
Desired: dispatch Arbitrator only when a *substantiated substantive technical dispute* satisfies the approved trigger, with final technical ruling power **when dispatched**. Must still independently verify exact-final-Commit code completeness and original user intent. Current `src/controller.mjs` always enters ARBITRATOR after B_TEST/P0_FINAL; `src/store.mjs` requires signed `finalArbitration` for Gate 5.9 and replay. Minimal candidate (separately approved Controller session only): add no-dispute evidence path, using existing independent reviewers on exact final SHA with explicit completeness/original-intent attestation; change state, signed final evidence and Store replay checks together. Never weaken final P0, Tester, compliance or human Gate.

## GAP-P0-C-01 — Optional rusty Hermes A2A
Desired: 5bao/9bao direct native Paseo, optional rusty via Hermes native A2A; at least two distinct physical signed reports; optional third extra <=600s. Current `src/p0_a2a.mjs` contains an A2A concept but `src/p0_paseo.mjs`/`src/cli.mjs` formal path and `config/role-matrix.example.json` use Paseo direct and mark rusty `P0_INELIGIBLE`. Separate Controller owner must verify approved bridge, independent original A2A Task/Agent IDs, OS read-only, pinned physical keys/signatures, replay, error/timeout/unknown reconciliation, without SSH or single-seat release.

## GAP-SOURCE-01 — Approved immutable Soul manifest
Current `freezeConfig` captures bytes/SHA for new tasks; current matrix contains Soul paths but does not independently enforce a user-approved source Commit/role hash manifest. Consider separate approval and check at new-task freeze; never retroactively re-freeze E2.

## GAP-E2-01 — External E2 historic proof
Workflow Git baseline `44273f09195d2e5687ce757b47adc86953ebcf94` remains fixed; no signed production Store was accessed. External `TASK_E2_PHASE1` frozen SHA/signatures require separate read-only attestation. This branch does not change historical artifacts.
