# V2.2 independent rereview: remediation register (2026-11-10)

This candidate is **NOT production-ready**. It is based on audited immutable commit `8e28acca359116518edceadc3e5b8edb76ee90b3` and is isolated in `fix/v22-rereview-mainline-20261110`. The independent rereview concluded CODE_VERDICT=FAIL and WORKFLOW_VERDICT=FAIL; this document records a **partial source remediation** without rewriting that historical verdict. No actual model/SSH/A2A/remote coding run has been authorized or performed.

## Implemented with offline regression coverage

- **B-01**: Paseo `providers.listAvailable()` now requires the real SDK `{providers:[{provider,available}]}` shape, not a mock-only provider-keyed map. Negative and positive synthetic SDK-layout tests.
- **B-02**: normalize legacy Blind, Arbitrator and Tester verdicts only at parser trust boundaries; preserve independently signed original report and compare its normalized verdict to parsed original raw text. Do not infer a PASS from unknown verdict text.
- **B-05 (active transports)**: `PaseoP0Adapter` and `HermesA2AP0Seat` require `blind_a/b/c`, not arbitrary Worker or write-enabled roles.
- **A-02 (restricted)**: the final Arbitrator can independently dismiss an actual signed P0 technical disagreement only as a specific, reference-backed FALSE_POSITIVE ruling bound to the exact original P0 report set. It cannot waive missing physical quorum, invalid signatures, UNKNOWN, missing tests or compliance. Positive/negative synthetic full-workflow tests were added.
- **A-03 (source dossier)**: the mandatory final Arbitrator prompt now includes authenticated registered original evidence for Spec/Quality, Tester, process auditors and P0 node signatures (with SHA-256 index). Overlarge dossiers fail closed; real model evaluation is unverified.
- **A-01 (partial)**: signed human recovery now accepts `WAIT_HUMAN/WAITING_HUMAN` and `BLOCKED/WAITING_HUMAN` to a recorded safe checkpoint, only after all recorded dispatches are terminal. An uncertain `NEEDS_RECONCILIATION` or in-flight/unknown remote task is **not** auto-recovered or resent.
- **B-07**: `Store` prevents ordinary transitions from changing pinned trust-root digest or silently clearing `aFindings`, `bFindings`, `p0Dispute`.
- **B-06 (partial)**: Worker/Remediation commits cannot weaken existing tests or test scripts/configs; can add new cases. TEST_ONLY executes in disposable test checkout, is allowed to add **new tests only**, and inherited Tester A cases are copied and verified for Tester B. Tool providers receive an exact-approved-command allowlist, but external OS-level boundaries and complete three-layer Tester B coverage remain unverified.
- **B-10 (partial)**: Paseo live preflight requires pinned trust roots, independent witness client, two independent P0 trust keys and a validated P0 inventory **before first paid role dispatch**. Signed host isolation remains unverified.

## Major blockers STILL OPEN — do not permit live operation

1. **A-04/B-09**: Pro-Audit reports are not cryptographically tied to a unique target dispatch, observed real model/Harness/Soul and complete source receipts; final Gate retains phase-based matching. Prompt injection hardening and explicit Gate process checks remain incomplete.
2. **B-03/A-01 remainder**: P0 task creation still lacks supported idempotency/cancellation and an authorized original-result reconciliation CLI; remote lost ACK/in-flight unknown requires separate read-only reconciliation, not human bypass.
3. **B-04**: independently signed P0 result must also bind role, Soul, prompt, approved TASK_SPEC/intent, Workspace and approved execution identity; external witness service is not deployed.
4. **A-05 remainder**: Tester B still needs explicit smoke/canary/full regression matrix and proof that OS-level TEST_ONLY controls constrain operations, not just post-hoc Git checks.
5. **A-06/A-07**: independent, hash-bound USER_ALIGNMENT.md delivery at Gate 0.2 and an enforceable WorkPlan-versus-approved-intent consistency check.
6. **B-08**: fixed-name evidence idempotence, orphan evidence and stale lock recoverability.
7. **B-11 and physical integration**: exact SDK dependency lockfile, real 5bao/9bao remote Agent lifecycle, independently attested physical host/OS isolation and actual rusty native A2A signed Task ID/status/result bridge.
8. **A-08**: budget accounting currently counts some PRE-failure/empty Gate B rounds; clarify/adjust in a separately tested transition change.

Current unit/CI success is offline mock evidence only. The exact final source SHA is the branch head at review time; do not audit a moving ref and do not merge this branch without completing its open gates and conducting an independent fixed-SHA review. `main` and the historical R8 audit target remain unchanged.
