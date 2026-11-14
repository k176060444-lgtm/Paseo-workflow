# Soul provenance — source-only remediation 2026-11-14

> UNMERGED CANDIDATE; no production deployment; E2 original frozen task data untouched.

Nine canonical local Souls: `k176060444-lgtm/Hermes-Coding-Role-Souls@3ca4590146a3ac0f7fdafc5352362fb8dd2b2b05` (package 1.2.0), copied **byte-for-byte** to Workflow `souls/`. Canonical source has `roles.json`, `SHA256SUMS.txt`. 3 external P0 Souls are maintained in `k176060444-lgtm/Paseo-workflow/souls/blind_*.md`, pinned at the Workflow release commit if approved. Each new role's exact `version`, `sha256`, source repo and fixed local-source Commit is in [SOUL_MANIFEST.json](../souls/SOUL_MANIFEST.json).

**Three distinct layers:** (1) source file and immutable source Commit; (2) Controller-approved local copy referenced by role matrix; (3) task-frozen `task.frozen.souls[role].text/sha256` at `freezeConfig`, bound to execution evidence. Editing (1) or (2) does not rewrite (3). E2 `TASK_E2_PHASE1` remains on its original freeze, ledger and signing evidence; this repo-only patch cannot independently attest an external production Store.

P0 A/B: 5bao/9bao via native direct Paseo SDK. P0 C: optional rusty Hermes native A2A, not yet formally integrated/eligible; no SSH. Physical independence and signature evidence are not provided by Soul words.

**Known hard Controller conflicts:** (a) forced final Arbitrator despite no dispute, including Gate 5.9 replay checks; (b) current P0 Controller/config still use Paseo direct for rusty, not formally attached A2A. See [SOUL_CONTRACT_GAPS.md](SOUL_CONTRACT_GAPS.md). Neither is fixed or implicitly approved by this Soul patch.
