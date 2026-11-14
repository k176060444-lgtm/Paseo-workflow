# Role Souls remediation — independent acceptance report, 2026-11-14

**Scope:** Workflow baseline `44273f09195d2e5687ce757b47adc86953ebcf94`; local authoritative source `k176060444-lgtm/Hermes-Coding-Role-Souls@3ca4590146a3ac0f7fdafc5352362fb8dd2b2b05`. Source-only branch, no model calls, real P0 jobs, production writes or Controller changes.

## SOUL_INVENTORY / ROLE_BOUNDARY_AUDIT

All 12 roles exist. Status is an audit of the **prior baseline**; SHA is the candidate's new exact Soul UTF-8 content.

| Role | Baseline | Gap / correction | Version | New SHA-256 |
|---|---|---|---|---|
| `planner` | OUTDATED | source differed; Gate 0.2 detail must wait | 2.3.0 | `bd9aaf338253f38dd0b541c9283045ce480c61aeade9d5fdda9a581c68657138` |
| `worker` | ALIGNED | role aligned, explicit JSON footer added | 1.2.0 | `ea8564160c24db365b49f6474214192d2158572fed94e23aa5757f424a825960` |
| `spec_reviewer` | OUTDATED | legacy prose verdict vs final JSON; final original-intent check | 1.2.0 | `81f3d7410ea707d23bc57a79560760616b3eba3454ebee83c5b8389be330d6fe` |
| `quality_reviewer` | OUTDATED | legacy prose verdict vs final JSON | 1.2.0 | `0229356c781a91568ebf90cfab566815494c427bfe6cbdcc0b770017f9182d6e` |
| `tester_gate_a` | OUTDATED | GATE_A_PASS legacy prose vs final JSON | 1.2.0 | `3296b87ef7fdcb172a558ee3ca4247b830f479ba75a96e3932674139bd686fe2` |
| `worker_remediation` | CONFLICT | erroneous implied mandatory Arbitrator | 1.2.0 | `a418a8f46a2a10399b494c0e6f47696905db77233b09998a5371717e50f9871a` |
| `tester_gate_b` | OUTDATED | GATE_B_PASS legacy prose vs final JSON | 1.2.0 | `35231b0ee4db45b409e7d0e063498292d3f653d426e3c3f17939d932d2334f5d` |
| `arbitrator` | CONFLICT | no-dispute forced-final and legacy verdict terms | 2.3.0 | `511595f29215207507f971dd454420eba7a7200ac8458f70d49f86a6a8d11ec8` |
| `pro_audit` | CONFLICT | mandatory Arbitrator reference and old separate-source version | 2.3.0 | `6cb5462b40cde16a48a0027dd15e78df3dd7e5267c7ee2e6d488190105996423` |
| `blind_a` | OUTDATED | generic A2A vs native Paseo 5bao | 2.0.0 | `c4bdc108e3c7b5101416890f1b860120b7b00e18ad30fe181585a4b1ab5c80b8` |
| `blind_b` | OUTDATED | generic A2A vs native Paseo 9bao | 2.0.0 | `fe877f95ceafb294fd6cf9026c34499ef01c2b8f37cd2817e3354f75d1d36379` |
| `blind_c` | CONFLICT | generic Debian A2A vs optional rusty eligibility | 2.0.0 | `4066ffd22a4419ac5ea3ec204f4f98a36e083a84802c48e407d6975a5b513287` |

## P0_TRANSPORT_ALIGNMENT
A: 5bao native Paseo; B: 9bao native Paseo; C: optional rusty Hermes A2A (formal integration currently unverified). No SSH; 2 distinct verified physical signed seats minimum; optional third extra 600s; final Commit P0 review. Source intent aligned; runtime C still **CONTRACT_CONFLICT**.

## ARBITRATOR_TRIGGER_ALIGNMENT
New Soul conditional on substantiated substantive technical dispute, final technical ruling only when invoked. Must explicitly retain original user intent and final code-completeness verification via other authorized independent roles otherwise. Controller presently mandates Arbitrator final acceptance: **CONTRACT_CONFLICT / GAP-ARB-01**.

## PRO_AUDIT_ALIGNMENT
Process-only PRE/POST for every actual role dispatch, never self-audit. No technical rulings; original evidence and approval must be checked. Model cost, tokens and dollars **OPTIONAL TELEMETRY**, never blocking when absent. Runtime must be handled in Controller-owner session.

## MACHINE_CONTRACT_COMPATIBILITY
12 Souls specify a single final standalone JSON object with `verdict,summary,findings`, valid Controller verdict vocabulary, severity labels and non-fabrication rule. Planner additionally requires `taskSpec` and `userAlignment` during candidate planning. Signed P0 and Agent execution proof are separate from text JSON. **Text-contract alignment** is distinct from **runtime final Gate compatibility**, which remains blocked on the two gaps.

## SOUL_SOURCE_OF_TRUTH / VERSION_AND_SHA_MAPPING
9 original roles: canonical independent repo fixed `3ca4590146a3ac0f7fdafc5352362fb8dd2b2b05`, `roles.json` and `SHA256SUMS.txt`; Workflow copies byte-identical. P0 canonical Workflow `blind_*.md`, pinned to approved immutable Workflow release commit. Exact per-role hashes and source paths in `souls/SOUL_MANIFEST.json`; runtime new-task Soul freeze in `src/policy.mjs`.

## OFFLINE_TEST_RESULTS
Added `tests/soul_contract_static.test.mjs` for all 12 text/HASH paths, Matrix, P0 boundaries, output text, new task freeze persistence and explicit hard gap assertions. No model/pipeline work. Review results against actual CI status; no claims of runtime P0 pass.

## E2_FROZEN_EVIDENCE_UNCHANGED
Original E2 baseline commit remains accessible; only Soul/docs/test files changed on isolated branch. E2 Store, actual task-frozen Soul texts, signed witness and ledger **NOT_VERIFIED** externally; cannot infer them from Git.

## SOUL_REMEDIATION_VERDICT
**SOUL_SOURCE_CANDIDATE_READY / CONTROLLER_INTEGRATION_BLOCKED** until separate Controller contract adjudication and explicit PR approval. Do not deploy or merge automatically.
