> **S0 three-node remediation candidate:** [scope, tests and remaining gates](docs/S0_THREE_NODE_P0_REMEDIATION.md). This is an offline code candidate, not S0 PASS. No real P0 or deployment was performed. The latest native-Paseo rulings supersede the older transport descriptions below.

> **R13.2 closeout (source-only):** [Atomic signed recovery & live integration readiness plan](docs/R13_2_CLOSEOUT_AND_LIVE_ACCEPTANCE_PREP_20261111.md). Official read-only CLI status now returns the verified human-signature checkpoint/state digest. Recovery evidence, nonce, task and event share one SQLite transaction; ordinary rejected evidence is conditionally cleaned. New independent fixed-SHA audit and separate permission are still required before any real cluster, model or deployment action.

> **R13.2 targeted hardening:** [Recovery proof and historical P0 freshness](docs/R13_2_RECOVERY_PROOF_HARDENING_20261111.md) binds human recovery approvals to the exact blocked checkpoint and task-state digest, rejects reused recovery nonces before writing, and keeps the bounded future-clock tolerance during historical P0 replay. Offline verification only; obtain a new independent review before any merge or live execution.\n\n> **R13.1 audit-driven follow-up:** [R13.1 signed-P0/State/Arbitrator remediation](docs/R13_R2_REVIEW_FOLLOWUP_20261111.md) fixes 30-minute P0 Gate 5.9 historical revalidation, uncertain generic error guard, original signed Arbitrator decision comparison and stale Reviewer recovery state. Offline synthetic SQLite tests do **not** change the R13 review's missing C and NON_COMPLIANT D results; live authorization remains BLOCKED.

> **R13 targeted source remediation:** [R13 fixed-SHA audit handoff](docs/R13_TARGETED_REMEDIATION.md) resolves the reported uncertain-state mismatch, forged P0 summary trust, safe two-seat Reviewer re-use and actual Arbitrator dispute output contract at offline code level. Historical R12 verdict FAIL and all live-integration blockers remain; **do not deploy/merge this branch**.

> **R12 source-only security gate:** Independent process signers are required for Gates 0.1/0.2/5.9 and safe incident closure. Signed OS/Paseo observer capability preflight is mandatory before the first paid model dispatch. See [R12 review and witness handoff](docs/R12_GATE_WITNESS_INCIDENT_REVIEW.md). CI simulation does not authorize live deployment.

> **V2.3 source-only continuation:** [R11 Coding mainline remediation](docs/R11_CODING_MAINLINE_REMEDIATION.md) adds original-dispatch read-only reconciliation, three mandatory Tester B layers with verified original logs, exact signed-terminal recovery checks and technical budget allocation after compliant PRE. **Not cleared for live execution or release.**

> **R10 source-only remediation:** See [R10 evidence/reliability status](docs/R10_EVIDENCE_RELIABILITY_REMEDIATION.md). Unique Pro-Audit PRE/POST evidence sessions, independent execution-witness V2 and P0 witness V2 are now required. A read-only `p0-reconcile` command is available. Real host witness/cancel/recovery and full workflow integration are **NOT VERIFIED**. Do not deploy from this branch.\n\n# Paseo-workflow — Coding Pipeline V2.2 mainline correction candidate

**Status (2026-11-10): source remediation + offline CI only; NOT approved for live Coding, paid Provider calls, deployment or production.** Existing historical R2–R8 documents are retained as evidence and do not supersede this README or current user decisions.

## User-approved purpose

Correctly implement the **user's real Coding goal**, not merely pass tests. User approves actual requirements, important strategy and the **model + Harness assignment matrix**; technical implementation and file-level choices remain with professional agents. Do not broaden scope or allow incidental issues to derail the Coding mainline.

Hermes → independent Workflow Controller → Paseo SDK → local Codex/OpenCode or remote candidates. All formal P0 candidates use `PaseoP0Adapter` and native Paseo; 5bao/9bao are primary, rusty is optional and independently gated. SSH and Hermes A2A are not production P0 transports.

## End-to-end Coding flow

1. **Gate 0.1**: explicitly approve user intent, strategy bounds and frozen model/Harness matrix.
2. **Planner alignment**: restate the user's objective, constraints, suggested method and decisions **in plain Chinese**, without inappropriate analogies or implementation minutiae. Form a high-level candidate TASK_SPEC only.
3. **Gate 0.2**: human explicitly approves the *actual candidate alignment/spec SHA*. Prior to approval **no detailed Coding task decomposition**.
4. **Planner Detail**: after approval, write and freeze `WORK_PLAN.md` and detailed TDD/atomic tasks without changing approved scope.
5. **Gate A (up to 10 rounds)**: Worker → independent parallel Spec Reviewer and Quality Reviewer on exact Commit → independent Tester A and frozen command evidence.
6. **P0 initial**: ≥2 physically independent verified Blind Review reports on exact Commit (5bao/9bao are the primary Paseo candidates; rusty is optional Paseo and currently P0_INELIGIBLE).
7. **Gate B (up to 10 rounds)**: when no confirmed remediation is required skip Worker Remediation; otherwise targeted remediation → changed Commit → two independent re-reviews; Tester B must verify Smoke/Canary/Regression. A modified final Commit requires renewed P0 evidence. Neither an unverified P0 result nor a technical disagreement becomes PASS by assumption.
8. **Arbitrator — mandatory final technical acceptance**: even without disagreement, verify actual code completeness, unimplemented requirements, alignment to the **original user intent**, and consistency with exact final Commit evidence. On substantive technical disputes, Arbitrator gives the final technical ruling; it cannot waive missing verifiable P0, tests or compliance.
9. **Final Compliance Gate**: confirm the complete *process* evidence, including authenticated Pro-Audit PRE/POST receipts and the final Arbitrator; no technical verdict.
10. **Gate 5.9**: human decision, without automatic push/merge/deploy/restart.

**At every individual role dispatch**, `pro_audit` executes PRE and POST checks and records independently signed original evidence, including both reviewers, the independent test execution, P0, and final Arbitrator. It checks **process only**: approved inputs, sequence, permissions, matrix, evidence, exact Commits and authorization; never code quality. The deterministic Store checks every transition too. Any material violation stops the line; manual approval and reconciliation are required before recovery. Do not retry uncertain provider/A2A calls automatically.

## Twelve roles

`planner`, `worker`, `spec_reviewer`, `quality_reviewer`, `tester_gate_a`, `worker_remediation`, `tester_gate_b`, `arbitrator`, `pro_audit`, and external `blind_a`, `blind_b`, `blind_c`. Frozen Soul sources and their changes are documented in `docs/SOUL_PROVENANCE.md`. Soul text is a **soft** behavioral contract; the Controller, operating system and independent witness must enforce actual boundaries.

## Verified cluster facts, 2026-11-10

| Node | Transport | Verified | NOT verified |
|---|---|---|---|
| 21bao | local Paseo daemon 0.15.3 at loopback `127.0.0.1:6767/ws` | SDK connection; Codex/OpenCode provider discovery | full production orchestration |
| 5bao | authenticated direct Paseo SDK `ws://192.168.5.6:6767/ws` | daemon `srv_X18iC2z6z-sS`, OpenCode detected | paid remote Agent lifecycle, physical identity, signed P0 |
| 9bao | authenticated direct Paseo SDK `ws://192.168.9.6:6767/ws` | daemon `srv_TjihQm2fgp_k`, OpenCode detected | same |
| rusty | native Paseo candidate `ws://100.100.88.100:6767/ws` | prior authentication acceptance; infrastructure CONDITIONAL | P0_INELIGIBLE: session/OS/permission/native-task/Witness acceptance pending |

The remote Paseo SDK connects **directly** with separately approved password environment variables `PASEO_5BAO_PASSWORD` and `PASEO_9BAO_PASSWORD`. No credentials are included in the repo, printed or uploaded. Direct daemon connections do **not** require local `hosts.list()` registration, which is currently empty on 21bao. `src/p0_paseo.mjs` supports both pinned direct SDK and historical native Connected Hosts routing without SSH fallback.

`ws://` is **not encrypted**: using authenticated private-LAN endpoints is only a preliminary connection capability, not a substitute for independently approved encrypted transport, network boundary, credential security and OS isolation for real workloads.

rusty uses the same native Paseo inventory and contract as the two primary candidates. Its example remains `P0_INELIGIBLE`; detecting `rustyhand` does not provide a permission/session adapter. `src/p0_a2a.mjs` is retained for historical offline evidence only. An optional seat without independently witnessed termination is skipped before paid dispatch. Archive is not termination. A valid two-node quorum survives an unavailable third seat; unresolved paid execution is recorded separately and still blocks workflow advancement.

## Source organization

- `src/controller.mjs` — gated Coding state machine, role PRE/POST, two-stage Planner, mandatory final Arbitrator.
- `src/policy.mjs` — code-fixed role permissions and 10+10 budget.
- `src/store.mjs` — immutable frozen context, SQLite ledger, signed execution and exact-Commit verification, final Pro-Audit coverage.
- `src/agents.mjs` — Paseo native local SDK, Soul injection and Agent lifecycle.
- `src/p0_paseo.mjs` — Paseo direct/Connected Hosts P0, authenticated per-node witness, 2 physical node quorum.
- `src/p0_a2a.mjs` — historical A2A evidence/fixture contract; excluded from formal P0.
- `src/attestor.mjs` — client of **external independent** execution/OS witness service (not bundled).
- `src/p0.mjs` and `remote/p0_runner.py` — quarantined legacy fixtures; `ssh()` always throws; not live transport.
- `souls/*.md`, `config/role-matrix.example.json` — behavior and unapproved sample assignments.

## Offline checks

```bash
npm run check
npm test
python3 -m unittest discover -s remote/tests -v
```

These tests use simulations and do not invoke paid models or validate a live cluster. The GitHub Actions workflow runs them on the isolated remediation branch.

## Manual commands (do not use with real tasks until independently approved)

```bash
node src/cli.mjs help
node src/cli.mjs init --id TASK1234 --matrix config/role-matrix.json --intent config/intent.md
node src/cli.mjs status --id TASK1234
node src/cli.mjs verify --id TASK1234
```

`init` creates local state files (not a paid model task). Signed human approval and `run` additionally require independent trust roots, signed gate receipts, real OS isolation, remote per-node witness and explicit authorization. `P1_LIVE_ALLOWED=YES` and `P1_HOST_ISOLATION_ATTESTED=YES` alone are **not** proof of readiness.

**Current blockers**: real 21bao/rusty task execution not attested, independent execution/witness service not provisioned, full remote physical node/OS ACL identity not verified, existing state DB migration unapproved, TEST_ONLY addition-of-test-files support not fully implemented. Never claim complete real integration from CI PASS.

For binding and safety details see `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and `docs/REMEDIATION_20261110.md`.
