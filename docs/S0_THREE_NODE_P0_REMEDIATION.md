# S0 three-node P0 remediation candidate

Implementer handoff only. This document does not certify independent technical review, process compliance, S0 PASS, P0 readiness, or production acceptance.

## Scope and provenance

- Repository: `k176060444-lgtm/Paseo-workflow`.
- Required parent: `b4bcfe93fde5a2538d87659c084881b6b25cf5b0`.
- Repair branch: `fix/s0-three-node-p0-20261112t021428z`.
- Original dirty checkout was frozen before the independent worktree was created. Its two files and `+39/-3` diff remain separate provenance, not baseline functionality. See `audit_evidence/s0-three-node/ORIGINAL_FREEZE.json` and `original-worktree.diff`.
- The current user task authorizes source, configuration examples, and offline tests. It supersedes the older rusty A2A requirement and the skill's older three-seat/A2A/5-round descriptions. The retained workflow has its existing Gate 0.1/0.2, PRE/POST, Gate A/B, 10+10 budgets, fresh P0 after code changes, final Arbitrator, and human Gate 5.9.
- No production role matrix, signer key, trust root, approval authority, Daemon, or service was changed. No dependency installation, real remote task, new model call, SSH, A2A dispatch, deployment, merge, or S1–S6 execution was performed for this remediation.

## R1–R7 implementation and regression map

| Requirement | Implementation | Offline evidence |
|---|---|---|
| R1 unified native entry | `PaseoP0Adapter` owns one inventory and direct/registered-native contract. CLI requires native Paseo and has no mandatory rusty A2A bridge. Primary seats precede the optional seat. | `s0_three_node`: qualified 5bao+9bao with unavailable/ineligible/misconfigured rusty; qualified 9bao+simulated rusty; one eligible node cannot dispatch. |
| R2 optional seat | Quorum uses verified reports from distinct physical hosts. The third-seat cutoff starts when the second valid report arrives and is capped at 600000ms. Cancellation requires readback plus an independently signed native terminal witness. | Exact 600000ms simulated clock; no termination capability means NOT_DISPATCHED; cancel ACK loss with successful signed readback; cancellation/readback/witness failure leaves UNKNOWN. |
| R3 deadlines and ACK | `deadline.mjs` bounds SDK, preflight, witness, polling, cancellation, and cleanup calls. Immutable request and Job ID/Intent precede create. Existing Job IDs cannot be recreated after an unknown or late ACK. | `s0_three_node` and `s0_deadline_routes`: hanging connection/directory/client/workspace/status/finish/witness/create/poll/cancel/readback/cleanup, late create ACK, immutable Intent and no retry. |
| R4 node identities | Physical/server identity remains independent; cwd and daemon-local Workspace IDs may coincide across hosts. Unusable optional identity cannot invalidate qualified primary identities. All Tailscale endpoints, including wss, require exact approved endpoint, encrypted transport declaration and application-password declaration; SDK receives the approved password alias. | Shared cwd/Workspace on different hosts; wrong signed server/Workspace/Commit rejected; missing or duplicate optional identity skipped; Tailscale missing approval/encryption/auth or endpoint mismatch rejected. |
| R5 RustyHand boundary | Unsupported harness remains ineligible. `providerOptions` does not accept `rustyhand` and has no empty-options escape. The example records P0_INELIGIBLE and the future native acceptance entry. | Unsupported provider and missing OS/session/native-task witness do not dispatch or count. A qualified simulated rusty uses an already supported harness, not an invented RustyHand adapter. |
| R6 Store/signature chain | `commitRecovery` checks dispatch reconciliation inside its transaction before artifact/nonce/state changes. Native P0 completion verifies signed preflight, entire original report, immutable request, role/Soul/Prompt/Intent/TaskSpec/Commit/Workspace/Agent and completed dispatches. Rejected witness responses are preserved. | Q1 three negative tests fail before the fix and pass after it. `s0_store_p0`: real SQLite/public completion rejects forged summary/count/identity, invalid original signature and outstanding dispatch. Historical replay still validates the same original signatures 31 minutes later. |
| R7 separated decisions | Report count/quorum, technical verdict, dispute and paid execution closeout are separate. No majority vote converts FAIL/QUESTION/NEEDS_SPECIALIST into PASS. Native technical questions reach the existing Tester B and Arbitrator path; unknown execution blocks advancement while preserving quorum evidence. | Two-seat conflict and valid third FAIL/QUESTION/NEEDS_SPECIALIST retain originals and require Arbitrator. Controller refuses P0_COMPLETE on UNKNOWN. Existing end-to-end gates, final Arbitrator, process witnesses and human Gate 5.9 still run in offline fixtures. |

`QUESTION` and `NEEDS_SPECIALIST` remain unresolved technical results. They must be clarified and reviewed; this remediation does not grant an Arbitrator new approval authority or let it waive procedural evidence.

## Tests and exact bindings

All new SDK/Witness fixtures are hand-written mocks using ephemeral synthetic keys. The suite exercises real production Adapter, Controller and Store logic, including real temporary SQLite and disposable local Git repositories. It creates no real Paseo Agent and calls no model.

Final complete Node run: **211 tests, 210 PASS, 0 FAIL, 1 SKIP, exit 0**. Final Python offline runner: **11 PASS, 0 FAIL, 0 SKIP, exit 0**.

The skipped test is `R4-007 inherited symlink index is rejected even without staged symlink diff`: Windows symlink permission is unavailable. It is not counted as PASS and no privilege change was attempted.

Each raw run records argv, cwd, parent HEAD/tree, start/end, source-file hashes, runtime version, TAP or unittest output, and its actual exit code. These are modified-worktree results; they are not a claim that the clean parent commit contains these fixes. The delivery identity file binds the tested code/config/test hashes to the final candidate tree. Later documentation and evidence additions do not alter the tested runtime inputs.

Relevant raw evidence under `audit_evidence/s0-three-node/`:

- `01-q1-negative-before-fix.txt`: original public recovery bypass, three failing negative assertions.
- `02-q1-negative-after-fix.txt`: same three assertions passing after the fix.
- `08-complete-node-regression-r1.txt`: retained earlier run, 203 PASS / 1 FAIL / 1 SKIP. The historical fixture lacked the new protocol evidence.
- `10-historical-native-fixture.txt`: historical fixture now uses the real Adapter with mock SDK/Witness; its original time shift, no-reissue requirement, Store and Gate 5.9 assertions pass.
- `11-three-node-supplemental.txt`: retained earlier test-harness timeout. The mock used a 600000ms polling delay with a never-resolving sleep; a 10000ms test timeout does not cancel the underlying SDK timer. The corrected regression uses a 1ms poll interval to exercise the same bounded production path without waiting ten real minutes. Production polling limits were not relaxed.
- `13-final-complete-node.txt` and `14-final-existing-python.txt`: final complete runs.

Earlier baseline timeout and intermediate fixture failures remain in the evidence corpus. They are superseded as final code-test results, not erased. The evidence directory has a scoped `.gitattributes` disabling newline conversion and whitespace lint for raw artifacts, so native CRLF and diagnostic spacing remain byte-exact. Source/test whitespace checks are unchanged.

Reproduce without installing dependencies:

```text
node --test --test-timeout=30000 --test-reporter=tap tests/*.test.mjs
python -m unittest discover -s remote/tests -v
git diff --check
```

Use a disposable scratch TMP/TEMP. The suite uses Node's built-in test runner/SQLite and Python stdlib. The historical runner tests are isolated offline fixtures, not permission to use SSH for formal P0.

## Static and simulated 5bao+9bao acceptance

The production CLI selects the native adapter, passes the frozen inventory and approved timing, and retains the original live-execution/process gates. With independently signed mock V2 preflight/results on 5bao and 9bao, the Adapter and real Store accept two distinct physical reports and completed dispatches while rusty remains ineligible. A third incomplete paid execution cannot erase that quorum or advance the workflow.

This establishes source wiring and simulated behavior only. Actual 5bao/9bao sessions, model execution, physical isolation and witnesses have not been exercised in this round.

## Remaining gates and residual risks

1. Rusty authentication acceptance remains the previously accepted specialist result; infrastructure remains CONDITIONAL. `rustyhand` still lacks accepted independent session/permission adaptation, OS isolation, native task identity and independently bound Witness evidence. It is not production-eligible.
2. Preflight V2 and signed native termination are new required contracts. Real witness services must independently support and prove them before a paid P0. This round does not deploy or modify those services. This also leaves the real primary-node V2 integration unverified.
3. A native cancel request, idle/closed Agent state, or archive flag alone cannot prove provider termination. Optional paid dispatch requires a signed verified-termination capability; failed confirmation remains NEEDS_RECONCILIATION. No automatic retry or fabricated terminal proof is provided.
4. Deadline expiration cannot undo a remote mutation when an SDK ignores AbortSignal. Late/unknown create results retain the original Intent and require explicit reconciliation. Cleanup calls are individually bounded but may extend beyond the third-report collection window; that time is execution closeout, not extra review waiting.
5. The installed client declarations inspected for reuse are version 0.15.2. Runtime interoperability with the previously observed Daemon 0.15.3 was not exercised here. Internal `DaemonClient.cancelAgent` is a native request capability, not a native-task termination proof.
6. Windows symlink coverage remains skipped. No real OS read-only isolation or physical-node qualification is inferred from unchanged hashes or synthetic keys.
7. No independent fixed-SHA review, Arbitrator acceptance or Pro-Audit COMPLIANT was issued by the implementer. The next review must target the delivered fixed identity and inspect original signatures, artifacts, PRE/POST, OS isolation and every unresolved issue. Gate 5.9 remains a separate human approval.

Stop after delivering the repair candidate and evidence. Do not declare S0 PASS, deploy, merge, run live P0, or enter S1–S6.
