# R13.2 — Recovery Proof and Historical P0 Freshness Hardening

## Fixed scope

- Repository: `k176060444-lgtm/Paseo-workflow`
- Baseline: `fc0c467a3d9bf6536798b15eb8a951654c233083` (R13.1 independently reviewed)
- Branch: `fix/r13.2-recovery-proof-hardening-20261111`
- Scope: the two non-blocking C follow-up findings and their four requested negative-test categories.
- No changes to `main`, role matrix, Souls, workflow stages, 10+10 budget, Paseo transport, A2A transport, deployment configuration, or live cluster.

## Changes

### 1. Historical P0 verification retains a future-clock bound

First receipt remains constrained to the original freshness window: at most 30 minutes old and no more than 2 minutes in the future. Historical verification may replay an already registered and cryptographically bound receipt regardless of its age, but it retains the same 2-minute future-skew ceiling. A timestamp farther in the future is rejected even when `allowHistorical: true`.

### 2. Human recovery approval signs the exact checkpoint and state

A `recovery` human approval now includes both:

- `blockedStage`: the exact interrupted checkpoint (or explicit `null` for the narrowly permitted legacy PLANNER fallback).
- `stateSha256`: SHA-256 of the exact persisted task snapshot before recovery.

The Controller verifies these fields before writing a recovery artifact. The Store independently recomputes the original state hash and checkpoint from the pre-transition database row, compares them with the signed statement, the immutable recovery artifact, and the ledger event payload, then consumes the nonce. Recovery also rejects an already consumed nonce before writing a new artifact.

### 3. Regression coverage

- Historical P0 proof beyond the 30-minute window is accepted only when previously registered and bound; a timestamp beyond the 2-minute future tolerance is rejected in historical mode; bounded clock skew remains accepted.
- A recovery proof signed against a different task status or blocked checkpoint is rejected.
- A previously consumed recovery nonce cannot authorize a later stop; rejection occurs before writing another recovery artifact.
- Reviewer recovery rejects duplicate Agent IDs rather than treating one Agent as two independent seats.
- Recovery rejects both a caller-supplied wrong Commit SHA and a signature whose digest refers to a different Commit.

Shared synthetic recovery signers in the existing R2/R4/R6 regression suites were updated to sign the exact recovery snapshot; production trust roots and signing boundaries are unchanged.

## Evidence boundary

These are offline code-level tests using synthetic Ed25519 keys, temporary Git repositories and SQLite state. They do not prove real 5bao/9bao P0 execution, physical-host independence, OS-level isolation, independent deployed Witness services, rusty A2A, or Live E2E. Those remain `NOT_VERIFIED`.

## Review requirements

The R13.2 fixed Commit must receive a new, scope-controlled independent review. Reviewers should inspect the exact commit/tree and specifically attack:

1. `allowHistorical` with future timestamps, malformed dates, stale registered receipts, and unregistered/tampered report bindings.
2. Recovery statements with altered `blockedStage`, altered task state/status, mismatched artifact/event fields, wrong digest, stale/reused nonce, and replay after recovery.
3. Reviewer pair recovery with duplicate/missing Agent identities, missing PRE/POST, wrong Commit, and zero-redispatch guarantees.

No merge, deployment, remote task dispatch, or release is authorized by this remediation document.
