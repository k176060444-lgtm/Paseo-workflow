# S0-R2 GPT-6 corrective follow-up — review handoff

**Status: SOURCE PATCH, NOT YET INDEPENDENTLY TESTED OR ACCEPTED.**

Original S0-R2 audit target: `683d4fe9caba03c668fa0f23492b711f9b14bf13`.
Current follow-up branch: `fix/s0-r2-gpt6-remediation-20261112`.
Always pin a new full commit SHA and Tree before independent review; never review a moving HEAD.

## Changes to verify

- **F4:** Connected Host source.key is a registrar key (often UUID), not a transport enum. The adapter verifies the host's `p1Transport=direct` metadata and parseable native ws(s) targetDescription before `hosts.client()`; no SSH fallback. Direct `paseoUrl` remains the preferred production P0 path. A real 0.15.3 HostSummary/targetDescription sample is still REQUIRED; tests are not live acceptance.
- **F6:** Missing ACK, even with an empty remote lookup, always reports `consistent:false` and explicit unknown outcome; CLI stays read-only.
- **F3:** Cleanup now records stage, cancel ACK state, error and attempted evidence name; failed durable cancel-proof registration leaves dispatch unresolved. Verified original cancellation can be included in the incomplete artifact. Existing tests must assert canceled terminal rows without treating invalid reports as quorum.
- **F8 partial:** Where an original task ID is observed from create ACK/verified report, result and termination proofs must agree. If the SDK does not expose a stable nativeTaskId, the independent Witness contract remains an acceptance blocker; no synthetic task ID may be invented.
- **F9:** Explicit `crash-quarantine --id ... --actor ... --receipt ...` accepts only an original regular lock aged at least 60 seconds whose PID is proven absent (ESRCH). It preserves lock bytes, original checkpoint and dispatch evidence, and transitions only to `NEEDS_RECONCILIATION`. It never replays a task. Signed incident-close and separate signed recovery still apply. A failed lock archive or unverified PID must be handled manually.
- **F12:** Optional `PASEO_LOCAL_PASSWORD` alias, wall-clock deadline for local connect/create and bounded close. A timed-out create is UNKNOWN, not permission to re-create.
- **Recovery hardening:** A P0 cancelled Agent can be recognized without an invented successful quorum only through registered original request, signed preflight and independently signed termination, all matched to the original dispatch/Agent.

## Limits, without an invented PASS

- The original reviewer reported Node 217 total / 211 PASS / 6 FAIL; this follow-up has changed those assertions but **has not independently rerun the full suite**.
- SDK constructor 0.15.2 was independently tested in the prior audit; real daemon 0.15.3 and native cancellation, per-node Witness V2, OS isolation and real P0 remain NOT_VERIFIED.
- F8 independent native task provenance is PARTIAL. F11 Souls retain historical A2A wording and require separate owner-approved Soul edits. No deployment or signers were modified.
- F10 threat model: Store's event chain is a self-hash integrity chain, **not a cryptographic defense against a privileged local DB writer**. Its assumed boundary is that processes with write access to the state directory are trusted; external independently pinned signing keys and separate Witness attestations provide stronger evidence. If local DB writers are adversarial, an external append-only anchor/signing design is required.
- A failed cancellation evidence write can also prevent the incomplete artifact from being registered (e.g. filesystem I/O failure). Treat this as NEEDS_RECONCILIATION; preserve dispatch IDs, snapshots and in-memory logs. No write failure is permission to mark TERMINAL.
- No real P0, production provider, SSH/A2A dispatch, service modification, merge or human Gate 5.9 action is authorized by this source patch.

## Independent test checklist

Run on a dedicated isolated 21bao test workspace, with the fixed commit and the existing installed SDK (no install/upgrade):

```text
node --test --test-timeout=30000 --test-reporter=tap tests/*.test.mjs
python -m unittest discover -s remote/tests -v
node --check src/p0_paseo.mjs
node --check src/agents.mjs
node --check src/store.mjs
node --check src/cli.mjs
git diff --check
```

Additionally use independent probes for real HostSummary source UUID, fake-daemon direct CLI no-ACK/no-remote, cancellation artifact failure, nativeTaskId mismatch, crash-lock live/dead PID, and recovery of signed cancellation without a quorum. Keep original raw logs and report exact PASS/FAIL/SKIP/exit status. Do not claim a real daemon or production Witness was exercised by a mock.

R2 remains **NO-GO** until independent review of the new fixed SHA and operational Witness/integration gates.
