# R13.2 closeout patch and real-cluster integration acceptance preparation

**Date:** 2026-11-11  
**Repository:** `k176060444-lgtm/Paseo-workflow`  
**Source baseline:** `a30e902bd2b1eb91027f5389286048851571ee33` (R13.2, independent scope review: CONDITIONAL)  
**Patch branch:** `fix/r13-2-recovery-atomic-and-integration-prep-20261111`

**Safety:** Source-only patch and offline synthetic tests. No `main` merge, deployment, remote machine changes, remote model calls, SSH/A2A jobs or paid work. This document is an **acceptance preparation plan**, not a live test report.

## A. R13.2 code-review findings closed by this patch

### A1. Official read-only recovery signature context

`node src/cli.mjs status --id TASK_ID --state STATE_ROOT` and `verify` use `WorkflowController.inspect` with a verified consistent read-only SQLite snapshot and return:

- `stage`, `status`, `blockedStage` (explicitly null when absent);
- `stateSha256 = sha256(persisted task)`;
- a `recovery` object only when state is `WAIT_HUMAN/WAITING_HUMAN` or `BLOCKED/BLOCKED|WAITING_HUMAN`;
- `recovery.taskId`, `gate:'recovery'`, `digest` (signature basis), `blockedStage`, `stateSha256`, `expectedSha` or `expectedBasis`.

This is the exact **human signing input**, not an approval or a statement that the outstanding original provider/dispatch evidence is complete. The signer must re-fetch the snapshot immediately before signing and verify that the current task hasn't changed. Never provide private keys to an Agent or commit them.

**Read-only example (does not dispatch Agents):**
```powershell
node src/cli.mjs status --id TASK1234 --state D:\P1-State
```

### A2. Transactional human recovery evidence and task mutation

`authorizeRecovery` no longer commits an evidence `ARTIFACT_REGISTERED` event before finding out whether Store will accept the recovery transition.

`Store.commitRecovery` uses one SQLite `BEGIN IMMEDIATE` transaction to:

1. verify the original task and original event/evidence ledger;
2. write and register exactly the original signed human-recovery artifact;
3. independently verify the signed checkpoint, original `stateSha256`, Git basis, agent identity and terminal original dispatches using existing Store guards;
4. consume the human approval nonce;
5. update task state and write `HUMAN_CONTROLLED_RECOVERY` event;
6. commit once, or roll back all SQLite effects.

On an **ordinary caught failure**, only a file created with exclusive `wx` by this specific recovery attempt, not registered and still containing the exact original digest, is removed. Other files or modified/incomplete evidence are never silently deleted. Power failure or forced termination between disk write and SQLite commit cannot provide cross-filesystem atomicity: the existing orphan-evidence reconciliation remains required; no automatic reattempt or fabricated execution result is permitted.

### A3. Tests

Test the real read-only CLI `status`, a signed `recover` CLI invocation, resulting ledger, unchanged state after a rejected recovery, absence of new unregistered recovery evidence after ordinary rollback, nonce unconsumed on rejection and consumed on successful retry. Tests must use an isolated temporary Git repository/SQLite state and synthetic Ed25519 keys.

## B. Integration acceptance gates — stop at first missing prerequisite

| Gate | Scope / evidence required | Current status | Allowed now? |
|---|---|---|---|
| S0 — Source & signers | Fixed Git Commit/Tree, clean isolated clone, independent review; pinned trusted public keys and actual role/model/Soul SHA inventory | Patch CI can establish only offline source quality; real signer custody not observed | Only offline/read-only |
| S1 — 21bao local no-model | Windows actual Node/Python, SDK/daemon versions, test runner permissions, real OS read-only enforcement, Magpie model mapping; no Agent creation | Not independently observed for this patch | Read-only inventory with separate user go-ahead |
| S2 — Independent Witness | Deployed independent process/OS/Provider observer, challenge-bound signed readiness and original execution receipts, separately protected private keys; fail-closed on missing capability | NOT_VERIFIED / source wrappers exist | No paid task |
| S3 — 5bao + 9bao P0 | Read-only native authenticated Paseo SDK connections, pinned `serverId`, actual `providers.listAvailable` payload, immutable read-only workspaces, OS+physical provenance, encrypted protected network, original remote receipts | NOT_VERIFIED for full original remote Agent lifecycle | No P0 model task |
| S4 — Full lifecycle & timeout | Fresh remote Agent create/list/status/terminal evidence, failure/partial-dispatch/ACK reconciliation and real provider-level termination; optional third seat never invalidates valid two-node result or leaves running paid tasks | NOT_VERIFIED | No paid P0 |
| S5 — Synthetic limited live canary | New explicit user-approved task, model cost cap and limits; independent PRE/POST, A/B role behavior, Tester actual command/log binding, P0 physical two-seat signed originals, mandatory final Arbitrator | NOT_VERIFIED | Requires new specific authorization |
| S6 — Full E2E and human Gate | Full 10+10+Compliance workflow when actually needed; fresh P0 for final changed SHA, all original reports, final process evidence and human Gate 5.9; separate permission for release | NOT_VERIFIED | No deployment or merge |

`rusty` via native Hermes A2A is **optional third P0 seat** and remains disabled until a real native bridge proves Task ID, status polling, results and independently signed binding; no SSH substitute and no fake third physical machine.

### Physical topology to confirm, not assume

- **21bao:** Windows 10 orchestrator with local Paseo daemon; local endpoint configured as `ws://127.0.0.1:6767/ws`.
- **5bao:** native Paseo endpoint example `ws://192.168.5.6:6767/ws`, pinned `serverId = srv_X18iC2z6z-sS`, password supplied only by local environment `PASEO_5BAO_PASSWORD`.
- **9bao:** `ws://192.168.9.6:6767/ws`, pinned `serverId = srv_TjihQm2fgp_k`, local environment `PASEO_9BAO_PASSWORD`.
- **rusty:** disabled native Hermes A2A optional review (`rustyhand`). No actual Task ID/status/result proof.

These are approved **configuration candidates**, not current connectivity or physical provenance attestations. `ws://` transmits credentials in cleartext; do not expose across untrusted networks or send secrets into hosted/cloud models. Use an independently approved encrypted authenticated link **without SSH** before sensitive/paid work.

### Proposed read-only local inventory (operator executes on 21bao)

```powershell
git rev-parse HEAD
git status --porcelain
node --version
python --version
npm run check
npm test
python -B -m unittest discover -s remote/tests -v
Test-NetConnection -ComputerName 192.168.5.6 -Port 6767
Test-NetConnection -ComputerName 192.168.9.6 -Port 6767
```

The two TCP tests prove only **port reachability**, not Paseo authentication, identity, TLS, model availability, workspace isolation or live remote review.

### Non-negotiable evidence matrix for eventual live tests

- Task: user-approved requirement, actual model/Harness/Soul SHA matrix, dated human approvals and exact frozen Git Commit.
- Local: preflight OS isolation proof, independent Witness challenge and signed original receipts, role/model identity, command argv/exit/stdout/stderr hashes, independent Reviewer A/B and process PRE/POST on each actual dispatch.
- Remote: two distinct independently attested physical hosts, exact serverIds, node-specific signed original evidence, taskSpec/intent/role/Soul/prompt/workspace/commit bindings; original Job ID, terminal status, no orphaned paid executions.
- Arbitrator: every time at final technical checkpoint even without dispute; original A/B/P0/Tester dossier and signed outcome; separate process-only audit.
- Recovery: human signed original `blockedStage` and `stateSha256`, all original Dispatches confirmed independently terminal, no duplicate paid task, atomic ledger update.
- Final: Gate 5.9 compliance original + exact signed approval, **no automatic merge or release**.

## C. Freeze and handoff policy

Before any real S1-S6 activity, record this patch's final immutable Commit SHA, Tree, CI run ID, test counts and any local skip. Have a separate fixed-SHA reviewer test the new atomic recovery failure paths, snapshot output, signature replay and crash-orphan behavior. Review outcome `PASS` for this patch is **not** a live E2E approval. Any failed prerequisite stops the live plan; no automatic credential upload, model swap, SSH tunneling or paid task retry.
