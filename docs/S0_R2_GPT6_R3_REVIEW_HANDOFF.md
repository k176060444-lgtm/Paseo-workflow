# S0-R2 follow-up remediation R3 — independent review handoff

**Status: source changes implemented and locally tested; independent review required. S0 remains NO-GO.**

## Fixed objects

- Previous fixed review target: `d4b9be759a26d4c50945d67194bda4b46c578819`
- Parent for this follow-up: `d4b9be759a26d4c50945d67194bda4b46c578819`
- Changed files: `src/store.mjs`, `src/p0_paseo.mjs`, `tests/s0_store_p0.test.mjs`, this handoff document.
- Review the exact new Commit and Tree after publication; do not use a moving branch head.

## R1 — five Store tests now assert production Store evidence

The five parameterized negative-report tests no longer inspect `x.seen.terminal`, which belongs only to the synthetic fixture Store. They inspect production `Store.dispatches()` rows and registered evidence:
- both original dispatch rows are present and TERMINAL;
- the invalid 5bao report is not accepted as a report and has a separately registered signed cancellation;
- the valid 9bao report remains registered as a result;
- the incomplete summary retains `quorum.established=false`.

No production rejection condition was weakened.

## R2 — mixed terminal outcomes are reconciled per dispatch

For a P0 cycle without a successful quorum summary, `Store.assertRecoverableDispatches()` now distinguishes:
- a valid independently signed result envelope, bound to the immutable original request and exact original Agent ID; or
- a valid independently signed cancellation proof, bound to the original request, Preflight, dispatch ID and Agent ID.

A normal completed result no longer has to fabricate a cancellation artifact. An invalid/missing result does **not** count as completion; that dispatch still needs a valid cancellation proof. If neither original is valid, recovery remains blocked. No quorum is synthesized and no dispatch is replayed.

## R3 — transient cancel-artifact fsync failure

`Store.artifact()` records the exact file created by the current invocation. It performs cleanup **only** when that file's own `fsync` throws, the SQLite registration transaction rolled back, the manifest has no row for that name, the path is still a regular non-symlink file, and the bytes still match the digest calculated before the write. It then removes only that exact unregistered file and annotates the original error with `REMOVED_AFTER_ROLLBACK`.

Any other failure (event append failure, post-fsync state/ledger race, partial or changed bytes, manifest uncertainty, or cleanup failure) keeps the orphan visible and fail-closed for manual reconciliation. Existing R2-002 and R4-003 tests assert that these other orphan cases remain rejected; they must continue to pass.

The Paseo cleanup path records `cancelEvidenceCleanupState` alongside the original cancellation stage/error and the verified termination proof in both the cancel-error and incomplete evidence. A successful transient rollback therefore allows the subsequent error/incomplete evidence to be durably registered without falsely marking the Dispatch TERMINAL. Persistent storage failure still blocks progress.

## Local verification performed

Environment: Linux container, Node `v22.16.0`, Python `3.13.5`. This differs from 21bao's Windows / Node 26 / Python 3.11 runtime and must be rechecked there.

- Store + R2 + R4 focused regression files (`s0_store_p0.test.mjs`, `r2_regression.test.mjs`, `r4_regression.test.mjs`): **39 PASS, 0 FAIL, 0 SKIP**.
- P0 adapter + S0-R2 targeted + Store focused files: **38 PASS, 0 FAIL, 1 SKIP**; the sole SKIP is the actual SDK DaemonClient constructor check because this isolated source snapshot has no installed `@getpaseo/client`.
- Full Node suite before the final fsync-only cleanup guard: **226 total, 225 PASS, 0 FAIL, 1 SKIP**, exit 0. After the final guard, the directly affected Store/R2/R4 tests passed; a repeated monolithic run in this container timed out before completing, so no final full-suite count is claimed.
- Python suite: **11 PASS, 0 FAIL**, exit 0.
- `node --check src/*.mjs`: all source modules parsed, exit 0.
- Text hygiene: no trailing whitespace or conflict markers in changed files.
- The full Node suite used `--test-timeout=120000`; at 30 seconds this container's parallel controller test exceeded its timeout. Do not interpret the earlier timeout as a product regression.

## Required independent verification on 21bao

Use the installed Node 26 / Python 3.11 environment and existing installed `@getpaseo/client@0.15.2`; do not install or upgrade dependencies. Re-run the complete Node suite with a 120-second per-test timeout, Python suite, all syntax checks, and `git diff --check`. Independently review the exact Commit/Tree and test the mixed result/cancel, transient fsync EIO, event-append orphan, and post-fsync state-mutation orphan cases.

## Explicit residual gates

- F8 remains PARTIAL: an unknown native Task ID cannot be claimed as independently matched merely because a signed Witness envelope contains one.
- Production Witness V2, original native Task provenance, actual Daemon 0.15.3 interaction, OS-enforced read-only isolation, cross-node P0, Compliance, Arbitrator and Gate 5.9 remain NOT_VERIFIED / NOT_RUN.
- No real P0, production model call, SSH/A2A dispatch, service change, deployment, merge or S0 acceptance is authorized by this patch.

**S0 remains NO-GO until the new fixed SHA receives independent review and all non-waivable operational gates have evidence.**
