# R12 — Human Gate process witness, OS readiness and incident reconciliation

Date: 2026-11-11. Parent source-only V2.3 Commit:
`284316f0492cb12f6c5af618e46535e824e44bce`.

Candidate branch: `fix/v24-gate-witness-reconciliation-20261111`.
**Do not use a moving branch name as an audit baseline**: record the full final Commit SHA after CI.

**Important status: code-only protocol and offline simulated tests. NOT approved for live jobs, deployment, merge, paid models, Rusty A2A or SSH.** User's approved 10+10+Compliance workflow, mandatory final Arbitrator, Gate 0.2 and independent physical P0 quorum remain unchanged.

## Implemented source changes

### 1. Independent procedural receipts at human Gates

`approve 0.1|0.2|5.9` requires two independently signed pieces of evidence:

- `P1_PROCESS_GATE_V1`: process-only independent Ed25519 signer (trust manifest section `procedure`) attests the exact task ID, Gate, frozen digest, actor/receipt SHA, persisted waiting state SHA, *pre-approval evidence root*, outcome COMPLIANT, specific process checklist, nonce and time.
- `P1_HUMAN_GATE_V1`: separate human Ed25519 key signs the approved digest, user receipt and the **SHA-256 of the original signed process proof**; Gate 5.9 also binds its original final-compliance digest/evidence root.

Both original signatures are stored together in the immutable nonce-scoped approval artifact and consumed under distinct nonce/key identities. Pinned public-key fingerprints cannot overlap human, independent execution, remote P0 or process signers. No signed human approval without a valid process witness can pass. This is an independent procedural gate, not a technical code verdict.

CLI: `approve --id ... --gate ... --digest ... --actor ... --receipt ... --process-proof SIGNED_JSON --approval-proof SIGNED_JSON`.

**Actual process observer service and private-key custody remain NOT_DEPLOYED/NOT_VERIFIED.** The Controller verifies the signed outputs but does not implement or fabricate an external independent signer. Human and procedure keys must remain off the coding workspace and must never be uploaded to a cloud model or committed.

### 2. Challenge-bound independent runtime readiness

On the **live Paseo** path, before any Pro-Audit or Coding model call, the Controller asks the existing protected IPC witness for `P1_OBSERVER_READY_V1`. The response is checked using an independently pinned execution witness public key and a per-run cryptographically unpredictable challenge. It must explicitly observe/affirm:

- original Paseo Agent output
- actual model/Harness
- frozen Soul SHA
- OS read-only isolation
- original test logs

The response must match task/config/state, challenge, freshness and signature. Environment flags `P1_LIVE_ALLOWED` and `P1_HOST_ISOLATION_ATTESTED` do **not** substitute for this witness. Without a real deployed compatible IPC witness, live execution fails closed. This is not proof the host currently has such a witness: test stubs are offline only.

### 3. Narrow human-authorized incident closure

`incident-close` is distinct from `recover`. A task with stage/status `NEEDS_RECONCILIATION` can be certified into `BLOCKED/BLOCKED` **only** when all original dispatch IDs are recorded as TERMINAL and each has exactly one independently attested original result, including signed full remote P0 evidence where relevant.

It requires both a separate process-only `P1_PROCESS_GATE_V1` signature and a human `P1_HUMAN_GATE_V1` signature with Gate `incident`. They bind the original dispatch/evidence snapshot, approved SHA, actor and incident receipt. The resulting immutable incident evidence is retained.

This step performs **no remote calls** and **does not mark an Agent terminal**, redispatch, cancel/terminate providers, approve code, waive missing process evidence or resume the workflow. Afterwards, a **separate, signed `recover`** at the original safe checkpoint is still required. Missing original proof, lost ACK, active/unknown provider, duplicated identity, unknown termination, or unaccounted P0 remains BLOCKED.

CLI: `incident-close --id ... --actor ... --receipt ... --process-proof SIGNED_JSON --approval-proof SIGNED_JSON --sha EXACT_COMMIT` (or `--basis APPROVED_DIGEST` before a Git commit exists).

## Required fixed-SHA independent local Agent review

**Recommended immediately after the source candidate becomes stable and CI is green**, before any real cluster validation or merge:

1. One read-only **Spec Reviewer** using an approved *local* harness/model, tracing the original user requirements against Gate 0.1→5.9, the exact Git Commit, recovery, Pro-Audit and mandatory Arbitrator.
2. A **different local read-only Quality/Security Reviewer** (preferably the other already installed harness), independently tracing error paths, signed receipts, trust roots, paid-job side effects and regressions. Both reports must be generated separately, without sharing preliminary conclusions.
3. An independent **process-only Pro-Audit** validates reviewer identity, immutability, model assignment, role permissions, order and original evidence; never assesses technical correctness.

These are local source-level reviewers; **one physical 21bao machine does not satisfy the P0 multi-physical-node Blind Review requirement**. For formal P0, 5bao/9bao native Paseo connections and optionally Rusty native Hermes A2A must still be independently validated. No paid model task, Agent creation or deployment is authorized by this documentation; the user must approve exact role/model and the limited review budget first.

Suggested review verdicts: CODE_VERDICT, WORKFLOW_VERDICT, PROCESS_COMPLIANCE_IMPLEMENTATION, WITNESS_PROTOCOL, INCIDENT_RECOVERY, LIVE_END_TO_END (the last **NOT_VERIFIED** until actual observed integration). Every meaningful finding needs path/line, trigger, original receipt and fix priority. Avoid endless review rounds.

## Still blocking production

- Real independent OS/Paseo watcher and independent procedural Gate signer with protected private keys, verified actual OS/Provider observation and physical node identity have **not** been built/deployed/observed. Signed test fixtures are not authoritative evidence.
- The native paid job-scoped cancellation/termination contract is NOT_VERIFIED. Optional running third P0 reviewer cannot simply be archived or abandoned.
- Unknown-ACK remote Agent lifecycles with missing original terminal report remain fail-closed, not automatically repairable or safe to rerun. Human-authorized closure only handles already authenticated terminal outcomes.
- Rusty Hermes A2A native Task ID/status/result signature remains not connected to standalone CLI; no real Rusty model review was attempted.
- TEST_ONLY real OS isolation, process audit at code commit post-effects, crashed/orphan artifact repair, stale locking, trusted dependency lock and existing task database migrations require separately approved integration.
- New Gate witness requirement changes approval protocol. Do not silently reclassify older single-signature approvals as compliant, re-sign on behalf of a user, or auto-migrate archived tasks.

Keep user intent and Coding mainline primary; do not expand low-value cosmetic findings into new design/review cycles.
