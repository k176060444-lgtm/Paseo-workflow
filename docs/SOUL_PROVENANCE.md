# Soul provenance and approved-mainline comparison (2026-11-10)

Original local role reference: [Hermes-Coding-Role-Souls](https://github.com/k176060444-lgtm/Hermes-Coding-Role-Souls) at immutable Commit `f0ecc4895c8947af164ff40ce1f2b29f52947b07`.

The new workflow retains **12 independent roles** (9 original local Souls including restored Pro-Audit, plus 3 external Blind Reviewer Souls). The role's prose is a soft instruction, never a real OS permission or cryptographic identity. `freezeConfig` snapshots every enabled role Soul content into each task with SHA-256.

| Local role Soul | Source treatment | User-mainline correction |
|---|---|---|
| planner | Adapted from reference version 1.1.0 to 2.2.0 | Plain-language Gate 0.2 alignment first; detailed work plan only after approval |
| worker | Original 1.1.0 retained | TDD, only approved work scope |
| spec_reviewer | Original 1.1.0 retained | Independent specification review on frozen SHA |
| quality_reviewer | Original 1.1.0 retained | Independent technical-quality review on same SHA |
| tester_gate_a | Original 1.1.0 retained | Independent admission testing, evidence |
| worker_remediation | Original 1.1.0 retained | Only on confirmed defects, otherwise skip |
| tester_gate_b | Original 1.1.0 retained | Smoke, Canary and full Regression |
| arbitrator | Adapted from reference version 1.1.0 to 2.2.0 | Final technical reviewer **always**, plus final dispute resolution when needed; original intent and code completeness |
| pro_audit | Restored and adapted from reference version 1.1.1 to 2.2.0 | Every individual role execution PRE/POST, **process-only**, mandatory fail-closed, 10+10 |

The three `blind_a/b/c` Souls remain from the earlier P1 source commit `38c76de3f7e8b47951b01d430806fffe10fe1cdc`. Their old “A2A” descriptions are **historical transport wording**, not a mandate: 5bao/9bao use native direct Paseo SDK; optional rusty uses Hermes A2A. Their technical review duties and independent physical-seat evidence remain in force.

Explicit contradictions superseded by user's 2026-11-10 ruling:
- Old Pro-Audit 5+5+2 budget → **10+10+Compliance Gate**, no automatic compliance rewind.
- Old “Arbitrator final only when conflict” → final technical acceptance **mandatory**; technical disputes also adjudicated.
- Old “Planner TDD tasks before 0.2” → implementation task decomposition **after** the user's signed Gate 0.2 approval.
- Old P0 blanket A2A/SSH wording → direct Paseo for 5bao/9bao; native Hermes A2A for rusty; **SSH prohibited**.
- Pro-Audit verdict vocabulary in prose → machine JSON PASS/FAIL/QUESTION maps strictly to process COMPLIANT/NON_COMPLIANT/UNVERIFIED, not technical review.

No changes have been written back to the separately owned original Soul repository. Before any live deployment, independently inspect the exact frozen Soul SHAs and real provider-side instruction injection; do not infer that a Git commit has already installed these Souls on 21bao.
