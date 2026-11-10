# Coding Pipeline architecture — mainline V2.2 candidate (2026-11-10)

This file supersedes the pre-R8 SSH-centric architecture prose. Actual live performance remains NOT_VERIFIED.

## Controller state flow

```text
Gate 0.1: approve user intent + model/Harness matrix
    Planner: plain-language need/method/strategy alignment
Gate 0.2: approve candidate TASK_SPEC SHA
    Planner Detail: implementation-specific work plan/TDD tasks
    PREPARE: independent working copy and frozen base commit
Gate A: max 10 rounds
    Worker -> Spec & Quality independent concurrent review -> Tester A
    failures -> next available Gate A round
P0 initial: at least 2 distinct physical verified Blind Review seats
Gate B: max 10 rounds
    no confirmed defects -> skip Worker Remediation
    defects -> targeted Worker Remediation -> new commit -> Spec & Quality
    Tester B + original tests + target regression
    modified final commit -> renewed P0 on exact final SHA
    disputes -> Arbitrator technical ruling (cannot bypass quorum)
Final Arbitrator: MANDATORY even if no disputes
    original user requirements + code completeness + final engineering evidence
    rejection -> remediation if budget remains, otherwise STOP
Final Compliance Gate: evidence, authorization, exact commits, ordered audits
Gate 5.9: human approval; NEVER auto-release
```

### Process compliance is a first-class invariant

`pro_audit` is a frozen independent role. Every individual role dispatch has a prior PRE and subsequent POST audit: Planner (both passes), Worker, Spec/Quality separately, Tester A/B, independent test-command executor, P0, remediation and Arbitrator. PRE must succeed before the target is dispatched; POST must succeed before downstream processing. Auditor and deterministic Store both check procedural evidence only, not technical correctness. The auditor is not recursively dispatched to review itself.

`Store` independently checks transition legality at every stage. Final Gate 5.9 verifies ordered, authenticated PRE/POST evidence for each actual role completion; arbitrary role self-assertions do not count as execution evidence. The 10+10 budget is independent of Pro-Audit calls; violations require line-stop and human-controlled recovery.

### Human Gate 0.2

Planner's first output is an intelligible alignment/strategy proposal; it **must not** create formal atomic Coding tasks. Gate 0.2 approves the exact candidate digest. Only after approval is `PLAN_DETAIL` allowed to produce a frozen `WORK_PLAN.md`; that implementation plan cannot redefine the user-approved task.

### Final Arbitrator

Arbitrator participates when substantive technical disputes arise and **always** before final technical acceptance. The final verdict must check the original user intent, partial/unimplemented features, delivered behavior, and exact final Commit supported by independent tests and P0. Its technical PASS never substitutes for process compliance, independent P0 receipts, user approval or missing executed tests.

## Transport and execution

Local 21bao Paseo SDK uses its authenticated loopback daemon. Both 5bao and 9bao were actually discovered on 2026-11-10 by separate password-authenticated SDK connections to known private-LAN WebSocket URLs and pinned `serverId` identities. `src/p0_paseo.mjs` supports this **direct** path and validates a remote Workspace's actual `workspaceDirectory` before P0 dispatch. Previous `hosts.list()` registration is not required; optional Connected Hosts API compatibility remains.

There is NO SSH path in normal Coding orchestration; historical `SshP0Adapter.ssh()` deliberately throws. Users have not authorized SSH as an orchestration transport. Physical identity is not established by a serverId alone. Witness keys, read-only OS isolation and exact Commit checkouts remain necessary.

rusty uses Hermes' own authenticated A2A peer `rustyhand` as an **optional** third Reviewer. Agent Card authentication succeeded, but Task ID, request lifecycle, signed original result and review workspaces are unverified. `src/p0_a2a.mjs` is a strict interface to the **native Hermes A2A tool bridge** and does not independently build a JSON-RPC client. The standalone Controller rejects enabling rusty until the native bridge is actually connected and separately approved. Invalid or uncertain requests never get automatically resent.

## Persistence and release

Signed independent execution receipts, remote physical review evidence and human approvals bind exact artifacts/Commits. SQLite hashes are tamper-evident only within the host, not an external immutable anchor. An uncertain Agent submit, missing ACK, unknown cancellation or missing witness stops the pipeline pending reconciliation. Gate 5.9 closes the workflow without merge, push or deployment.

## Still unverified

- Dedicated independent OS/Paseo witness service and physical-signing custody.
- Live remote Agent/Provider lifecycle over new direct SDK transport.
- Actual Hermes A2A task/Reviewer and third-seat signature integration.
- Provider/model options/permissions in real cross-host workloads.
- Windows/Linux process isolation, workload-boundary and storage ACL proof.
- Full TEST_ONLY file-addition semantics and production state migration.

These are technical blockers for live certification, not a reason to redesign the user's Coding mainline.
