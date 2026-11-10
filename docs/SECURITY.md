# Coding Pipeline security and verification boundaries — 2026-11-10

This replaces superseded SSH-era instructions in this document. **Current branch passes offline tests only and must not be executed against real Coding tasks or paid models without separate authorization and host-specific integration verification.**

## Binding process policy

- User's real requirements and approved strategy are authoritative. A model may not broaden the task, choose a new matrix or approve its own work.
- Gate 0.1, Gate 0.2 and Gate 5.9 use independently signed human approval receipts. The detailed task plan starts only after Gate 0.2 approval.
- Every role dispatch, including both Reviewers, Testers, test-command execution, P0 and final Arbitrator, is surrounded by separately attested process-only Pro-Audit PRE/POST checks. Missing/uncertain/failed compliance blocks downstream work; no technical judgment is delegated to Compliance.
- Every Store state transition has deterministic guards and an append-only ledger. Final Gate 5.9 also verifies the **ordering**, positive verdict and independently signed original evidence for every required PRE/POST and mandatory final Arbitrator.
- Gate A and B have 10 rounds each. A compliance violation does not automatically trigger a new technical remediation round. Any material violation stops the pipeline; only explicit human-controlled recovery after reconciliation is permitted.
- Uncertain delivery/ACK/results must not be blindly resubmitted. Requests are persisted before external effects.

## Transport — no SSH

- 21bao SDK connects to local daemon using its loopback listener.
- 5bao/9bao are reached by separate **native Paseo SDK** connections using pinned private-LAN endpoints, independently approved password environment variable names, and exact serverIds. Current SDK direct read-only calls succeeded on 2026-11-10; remote model execution is NOT_VERIFIED.
- No SSH or SSH tunnel is permitted in any Coding P0 execution. The old SSH code is retained only for offline legacy verification tests; its transport method unconditionally throws.
- `ws://` does **not** encrypt credentials or traffic. LAN-only validation in source is a guard against inadvertent public cleartext transport, not an assertion that the private LAN is trusted. Before paid/source-sensitive P0 operations, independently approve authenticated encrypted transport and network isolation; do not silently rewrite URLs or create SSH tunnels.
- Pinning serverId and node-specific public key does **not** prove physical-machine independence by itself. Each candidate needs independent physical identity, OS process isolation, read-only workspace checkout and per-node witness.
- rusty is an optional third independent P0 via **native Hermes A2A**. Only authenticated Agent Card discovery has been observed. No remote Task ID, status retrieval, actual review or signed report has been observed. `src/p0_a2a.mjs` refuses absent native bridge, Task ID or independent signed report; standalone CLI refuses enabled rusty until bridge integration is completed. Never substitute `context` as a Task ID.

## Key custody

- Never commit or print Paseo passwords, Bearer tokens, provider API keys, SSH keys, raw credential headers, remote node private signing keys or sensitive task content in public GitHub.
- Role matrix contains **environment variable names**, not values. Controller should only receive credential access explicitly approved for its runtime.
- Human, execution and remote P0 signer trust domains use independently pinned Ed25519 public keys; no private signing key is generated or kept in the Controller.
- The independent OS/Paseo witness service is NOT bundled and currently NOT_VERIFIED. `src/attestor.mjs` only requests attestation over local IPC; it cannot manufacture trusted evidence.
- SQLite hash chains are tamper-evident against accidental or unsophisticated edits, not independently immutable evidence in the face of privileged host compromise.
- Role Soul and provider sandbox restrictions are not OS-level isolation. TEST_ONLY test-file additions and OS ACL/termination still need physical-host validation.

## Never claim these from an offline test

A passing Node/Python simulation does not prove: real model/provider selection, credential-safe daemon routing, physical node identity, remote Agent lifecycle, independently signed provenance, Windows/Linux process boundaries, persistent A2A Task state, honest Blind Review, or user goal completion.

## Recovery

After any uncertain remote or local call, preserve Job/Agent/Task IDs and raw receipts; reconcile with Paseo `agents.list({includeBackground:true})` and `agents.ref(id).refresh()` or a native Hermes A2A task-status API when *actually available*. No automatic repeat dispatch. Unknown cancellation remains BLOCKED. Gate 5.9 only records human closure and never auto-deploys.
