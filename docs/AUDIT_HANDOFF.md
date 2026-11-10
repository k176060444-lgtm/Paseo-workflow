# Remediation candidate audit handoff — 2026-11-10

**Supersedes old S0/S1 SSH-era deployment instructions.** No live-model execution is authorized by this file.

## Fixed review target

Branch `fix/coding-mainline-compliance-paseo-a2a-20261110` is based on R8 `10f48338aff81aa4374e6f74b6bac4057f8c0c56`. The independently reviewed **exact head Commit** must be obtained at audit time; a moving branch name is not an audit baseline.

## Mandatory independent audit focus

1. **Original user intent**: Gate 0.2 plain-language strategy and approval must precede detailed TDD task planning. Confirm TaskSpec/WorkPlan SHA immutability.
2. **Every role PRE/POST compliance**: independent Pro-Audit, separately attested dispatch, input/output evidence, no technical quality verdict; each role (including both concurrent reviewers, tester execution, P0, Arbitrator) must be covered and final Gate 5.9 must detect omissions/order reversals.
3. **Mandatory Arbitrator**: final review not skipped on a clean P0, original user requirement mapping, completeness including placeholders/partial features. Separate dispute adjudication from routine final review.
4. **Paseo direct remote**: 5bao/9bao use pinned authenticated SDK URL + serverId + approved Workspace and provider; no local Host registry prerequisite, never SSH fallback. Verify remote `workspaceDirectory` actual shape and SDK 0.15.3 compatibility.
5. **rusty A2A**: authentic Hermes peer, real Task ID/reconciliation, independently signed original report, no A2A reimplementation or impersonation of Paseo Host. The standalone CLI MUST block enabling rusty until native bridge is attached.
6. **Security**: permission boundaries, witness independent private-key custody, exact Commit, physical host identity, lost ACK/no duplicate dispatch, incident stop and human-controlled recovery.
7. **Tests**: run `npm run check`, `npm test`, and `python3 -m unittest discover -s remote/tests -v`; record actual counts, failures and fixed Commit.
8. **Real integration**: mark NOT_VERIFIED until separately authorized and observed. No live P0, model consumption, deployment or SSH for this handoff.

Please classify CODE_VERDICT, PROCESS_COMPLIANCE, REMOTE_LIVE_INTEGRATION and A2A_INTEGRATION separately. No fake pass from offline mocks.

Old evidence is retained at `docs/R2_*` through `docs/R8_*`, and prior README assumptions are historical only.
