# Coding-mainline remediation log — 2026-11-10

## Scope and change basis

Parent immutable R8 Commit: `10f48338aff81aa4374e6f74b6bac4057f8c0c56`. All changes are confined to `fix/coding-mainline-compliance-paseo-a2a-20261110` and do **not** alter the GitHub default `main` branch, 21bao/5bao/9bao actual configurations, passwords, providers, or deployed services.

User authority is the 2026-11-10 conversation: precise role responsibilities, genuine Coding goal as primary input, Gate 0.2 alignment followed by approval and only then task decomposition, mandatory PRE/POST process-only Compliance, final mandatory Arbitrator, native Paseo direct 5bao/9bao, native A2A rusty, never SSH, fail-closed uncertainty and 10+10 rounds.

## Implemented in repository

- `policy.mjs`: restored `pro_audit` READ_ONLY role, 12 roles total.
- `controller.mjs`: independently attested Pro-Audit PRE and POST for each role invocation (including parallel reviewers, test executor, P0 and Arbitrator); Gate 0.2 approval before `PLAN_DETAIL` and immutable `WORK_PLAN.md`; final Arbitrator stage mandatory even without conflict, with original user intent in prompt and exact SHA binding. Prevent missing review bypass.
- `store.mjs`: new gated transitions, immutable detailed plan and final Arbitrator result; Gate 5.9 checks ordered authenticated Pro-Audit receipts against every completed Coding execution and final Arbitrator.
- `p0_paseo.mjs`: native SDK direct private-LAN password-authenticated connections, pinned serverIds and real `workspaceDirectory` field; no local Host registration prerequisite; read-only reconciliation also supports direct; no SSH fallback.
- `agents.mjs`: supports SDK 0.15.3 `agents.list({includeBackground:true})` response `{entries,...}`.
- `cli.mjs`: passes independently pinned P0 roots; refuses optional rusty enabled when native Hermes bridge is not connected.
- `p0_a2a.mjs`: optional native Hermes A2A bridge contract; refuses missing Task/Agent ID, missing pinned remote signing key or invalid signed original result. It does not implement another JSON-RPC or Bearer client.
- `p0.mjs`: historical SSH `ssh()` permanently disabled, legacy signature verification retained for isolated fixture regression only.
- `souls/`: existing specialized Souls reused; Planner, Pro-Audit and Arbitrator corrected and versioned. No changes to the separate reference Soul repository.
- `tests/`: updated 12-role and mandatory-final-arbitration contract tests, added 5bao/9bao authenticated direct SDK tests and independent synthetic rusty A2A proofs.

## Current limits and independent acceptance

Passing offline CI does **not** show live remote Agent tasks were executed. Independent OS/Paseo witness service, node-specific trusted signing identities, OS isolation and actual native Hermes A2A Task ID/result bridge remain unverified or absent. The rusty branch remains disabled by default; no fake A2A acceptance is possible.

For reliable real acceptance:
1. Review and approve exact source Commit and frozen Soul/matrix hashes.
2. Install/integrate independent witness with protected per-host key custody, no cloud private-key upload.
3. In separately approved low-cost workspaces, verify two authenticated direct Paseo Agent full lifecycles and exact Git Commit with OS read-only evidence; record serverId/Agent ID/raw result and any unknown-state recovery.
4. In separately approved Hermes native A2A test, verify rusty Task ID, status/get, final result and independent node signature before enabling it.
5. Verify full roles/Gates/Compliance/Arbitrator workflow under controlled simulated then live workloads; never equate code tests to real business-goal satisfaction.

No deployment, merge, main branch rewrite or remote service change was authorized or performed during the source-code remediation.
