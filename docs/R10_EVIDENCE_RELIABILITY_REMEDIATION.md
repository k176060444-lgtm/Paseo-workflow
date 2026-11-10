# R10 — Process evidence and P0 reliability, source remediation candidate

Based on the independent R9 review and the previous R9 source remediation. **No real model/provider work was run.** This document does not certify production.

## Implemented in source

- **Compliance sessions:** unique UUID for each PRE/POST pair, persisted with every completed target role, including independent Reviewer seats, Tester executor and P0. POST points to the precise registered target original evidence SHA, dispatch and Agent identity when present. Gate 5.9 now rejects mismatched/duplicated sessions and phase-only legacy reuse. Untrusted target findings are *not* spliced as direct instructions into the Pro-Audit prompt.
- **Independent local execution witness V2:** report and independently pinned Ed25519 statement must attest the observed model, Harness and frozen Soul digest. This includes the Pro-Audit Agent itself. V1 reports with no observed identity must not satisfy a real frozen role. The external witness service itself is NOT bundled or verified.
- **Independent remote P0 witness V2:** cryptographically bind Blind role, frozen Soul, exact requested prompt, approved original intent/TASK_SPEC hashes, workspace ID and cwd in the signed result. Store reloads the originally registered request, checks the frozen task and verifies V2 signature before accepting P0. The actual remote witness service has not been deployed.
- **Read-only P0 reconciliation:** `node src/cli.mjs p0-reconcile --id TASK1234 --cycle initial-A1 --state /secure/state`. It reads only recorded deterministic Job IDs and enumerates remote background Agents through existing authenticated Paseo SDK. It NEVER creates, retries, archives, cancels, marks terminal or changes task state. It returns original Agent ID/status (if present) for manual reconciliation. Distinct daemon server IDs are required.
- **Artifact idempotence:** if the same already-registered name and same bytes are submitted again, return the existing digest without a second event; divergent same-name contents are refused. Unregistered crash-orphan files still require explicit forensic reconciliation; never trust or overwrite them automatically.
- **Paseo cleanup:** direct connection failures and reconciliation failures release the SDK client; Agent-list responses must be recognized or the result is unknown (not incorrectly empty).
- **Gate 0.2 scope:** Planner produces separate plain-language `USER_ALIGNMENT.md` and high-level `TASK_SPEC.md`; human signed Gate 0.2 approval now binds the combined deterministic digest of both file hashes. After approval and before `WORK_PLAN.md` is frozen, an independently signed, process-audited Spec Reviewer must PASS the candidate detail plan's consistency with both approved documents. Synthetic negative tests prove an old spec-only SHA fails and unapproved scope drift blocks Worker.
- **P0 unfinished third seat:** removed the unsound assumption that Paseo `archive()` cancels a running provider task. If an extra third seat is still running after the review budget, processing now fails closed with the original Agent/Job IDs preserved for reconciliation. The desired optional-third nonblocking behavior requires a separately verified provider cancellation/termination contract; this safety gate is still **NOT IMPLEMENTED**. Normal two-Seat Paseo runs remain supported.
- Negative tests cover report-context tampering, post-attestation model drift, unique PRE/POST pairing, remote reconciliation with exact labels and client cleanup, immutable evidence replays.

## Safety and scope boundaries

The established live source code still **must not run** until verified deployment and independent signers are provided. SDK client 0.15.3 compatibility for live Agent creation/cancellation, provider model validation, physical OS isolation, actual witness V2 service, rusty Task/Agent lifecycle and real blind-review workloads remain NOT_VERIFIED.

### Remaining mainline blockers

1. Provider remote Agent unknown-create ACK and partial multi-node dispatch need independently verified cancellation or continuing read-only reconciliation, not `archive()` falsely described as guaranteed cancellation. A successful read-only lookup does not itself authorize resuming or creating another task.
2. External independent V2 witness must actually verify observed Provider settings, unmodified Soul, real original P0 request, read-only OS boundary and authentic physical node, not merely sign model claims.
3. Incident authorization and supersession semantics need to explicitly link failed Compliance audits to signed human resume approval. Gate 0.1, 0.2 and 5.9 need independent procedural evidence if the all-step policy is interpreted strictly.
4. Gate 0.2 dual-artifact hash binding and independently signed workplan scope review are implemented at source level; genuine semantic judgment remains unverified in live model execution. Tester B Smoke/Canary/Regression matrix, true TEST_ONLY isolation, crash-orphan evidence and stale lock recovery remain incomplete.
5. The optional rusty native Hermes A2A bridge is not attached and does not have independently verifiable Task IDs/status/results.
6. Round-budget accounting and Tester/Worker post-commit compliance granularity still require reconciliation with the approved business workflow.
7. Dependency reproducibility and exact SDK lockfile remain to be resolved prior to live release.

The offline suite does not establish LIVE_END_TO_END or CODE_VERDICT PASS. Keep historical review FAIL until new independent fixed-SHA review clears remaining blockers. The target branch is not merged to `main` and no SSH is permitted for Coding orchestration.
