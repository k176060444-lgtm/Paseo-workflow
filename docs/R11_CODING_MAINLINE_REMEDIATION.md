# V2.3 Coding mainline — recovery, budget and Tester B remediation (2026-11-10)

## Review scope and immutable parent

Parent R10 source candidate: `2ca099fa19eb242cdb5ca39337192cac7fcd4b63`.
All edits in `fix/v23-dispatch-recovery-testerb-20261110`. This is a **source-only remediation**, NOT an approved live deployment or complete verification of paid/remote Agent execution. Obtain the exact final HEAD SHA at review time.

## Changed behavior

### 1. Read-only original-task reconciliation

- Native local Paseo Agent creation now labels the original `p1-dispatch`, exact `p1-phase`, task ID, role, source SHA and frozen Soul digest. The separately exposed `agent-reconcile` CLI enumerates existing background Agents and matches **persisted original dispatch IDs**, not task titles or fuzzy phase similarity. Duplicate/mismatched identities block. An empty search means **UNKNOWN**, never safely cancelled or retriable.
- `p0-reconcile` locates the original registered `p0-<cycle>-<node>-request.json` and uses its signed-bound **original Commit and Job ID**; it does not use the task's later currentSHA after remediation. Absent request is reported without inventing a dispatch. Invalid/mismatched original requests fail closed.
- Neither reconciliation CLI writes task state, dispatches, cancels a paid task, archives remote state, or authorizes restarting a workflow.
- Signed human recovery now additionally requires **every TERMINAL dispatch** to have one independently verified original Agent result in the immutable artifact ledger; P0 terminal rows require the independently signed entire seat report set. A crash after Terminal ACK but before saving result does not permit blind re-execution.

### 2. Independent test layers and original logs

- Human-frozen `tests.gateB` **must** contain separate non-empty approved argv command arrays for `smoke`, `canary` and `regression`.
- Tester B executes all three layers in order, failing closed after the first failure. Actual commands, exit status and all stdout/stderr receipts are registered in the artifact manifest.
- The deterministic Store checks exact approved commands, layer completeness, and requires each final Tester A/B receipt to match the **original registered log file name, digest, argv, exit code and timeout/truncation status**; a copied or forged log digest from another layer fails.
- Examples in `config/role-matrix.example.json` are illustrative only and NOT approved for an actual target repository. Actual command coverage and OS-level role permission enforcement still require independent live verification.

### 3. 10+10 technical budget

- Gate A increments its technical Worker iteration **only after** an independent PRE Pro-Audit succeeds, immediately before first Worker dispatch.
- Gate B increments remediation iterations **only after** corresponding Worker Remediation PRE passes, before dispatch. Zero-defect Gate B still runs all three Tester B layers, but consumes **zero remediation rounds**.
- Final Gate permits `bRound=0` only if no B code changes and the original P0 reviewed the exact final Commit. B remediation remains capped at 10 actual Worker rounds.
- User-initiated questions, independent process compliance failures and skips do not silently consume technical Worker budget. Once a Worker may have been dispatched, uncertainty blocks replays; never reclaim spent rounds based on missing ACK alone.

## Real verification still needed (do not merge or deploy)

1. The V2 local execution and P0 signed witness protocols have not been implemented/observed in real independent OS-bound witness services. Actual provider runtime may differ from a mock.
2. A read-only reconciliation observation is **not** a signed termination/last-message proof; lost ACK and unknown in-flight state remain blocked. No verified native Provider job-scoped cancellation/termination yet; optional third P0 seat cannot be safely detached.
3. Explicit process Compliance for human Gate 0.1/0.2/5.9, post-commit Worker proof, signed authorized supersession of failed audits, and full incident-reconciliation transitions remain incomplete. Deterministic Store Gate checks are not themselves independent Pro-Audit.
4. Native Hermes A2A rusty Task ID/status/independent Reviewer integration remains unverified and disconnected from the standalone CLI by design.
5. Stale lock, crashed/orphaned artifact recovery, reproducible dependency lockfile, Windows/Linux OS permission isolation and genuine model assignment all require real acceptance before release.

## Independent audit of this branch

Review the **exact final Commit**, not branch name. Validate both positive and negative offline scenarios: original Job identity, no task resend, duplicate/missing Agent, phased Reviewer evidence, A/B PRE refusal without budget burn, B0 no-remediation test execution, all three approved Tester B layers, original test log file hash substitution and terminal-without-attested-output recovery rejection. Separate CODE/WORKFLOW/PROCESS-COMPLIANCE from PASEO/A2A/LIVE verdicts.

**No SSH** is permitted in any Coding dispatch; no live Agent tasks were launched by this source edit.
