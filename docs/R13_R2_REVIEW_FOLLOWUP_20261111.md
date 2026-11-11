# R13.1 — Follow-up to 21bao fixed-SHA R13 re-review (2026-11-11)

**Audit base:** `30475aa993eed21e969910e3bcc3b60639ce4803`. Remediation only in `fix/r13-r2-audit-findings-20261111`. Record the **final exact Commit SHA** at handoff, not moving branch HEAD.

## Scope and evidence status

The user-provided 21bao review reports:
- independent Spec A and Quality B both genuinely completed and returned `REQUEST_CHANGES`;
- configured Arbitrator C `antigravity/gemini-4-argon` was **not served** by Magpie (404) and produced no report;
- independent Pro-Audit D marked PRE and POST `NON_COMPLIANT`;
- isolated Windows tests: `npm run check` passed; `npm test`: 134 total, 133 pass / 1 skipped; Python 11 pass, no live cluster work.

These are review-process observations. **This source patch does not retroactively make PRE/POST compliant, create a missing Arbitrator output or authorize model substitution.** A genuine independent technical verdict is still NOT_COMPLETED.

## Targeted source fixes

1. **P0 receipt freshness vs historical verification**: original `verifyPaseoP0Envelope` first receipt retains the strict 30-minute freshness limit. Subsequent Gate 5.9 / post-incident checks validate the Ed25519 signature, exact original signed report, approved node identity, task/commit/workspace/intent binding, remote dispatch and registered original summary, and require both an original completed P0 event and a later strict-accepted transition. Historical rechecks must not reject because the user approved the final Gate 31 minutes after original P0.
2. **`UNEXPECTED_STAGE_ERROR` transition**: Store now enforces old status, original source checkpoint, exact original role/phase for unknown in-flight execution, null new in-flight marker, blockedStage and event payload consistency; definite errors may start only in READY stage, not human Gate or in-flight.
3. **Final Arbitrator original evidence**: Store now checks the actual independently signed original Arbitrator result against `t.finalArbitration.disputeResolution`, agent ID, exact phase and final Commit, both at `ARBITRATION_FINALIZED` and Gate 5.9. Changing a rationale after signing cannot be authenticated by a Controller-only assertion.
4. **Post-recovery state**: successful signed human recovery clears `blockedStage` and, solely for fully completed two-seat Reviewer recovery, creates a one-use `reviewerReuse` token bound to exact SHA, checkpoint and human nonce. Source-aware replay reads the original independently witnessed reports; the token is cleared when leaving the review checkpoint. Missing or mismatched original PRE/POST blocks.
5. **Regression**: timestamp 31-minute and future witness cases, signed-report tampering, unexpected checkpoint/phase forgery, signed Arbitrator ruling change, Reviewer POST absence, successful zero-redispatch reviewer recovery and token cleanup.
6. **Integrated delayed Gate test**: a test-only two-seat native Paseo P0 signer registers original Ed25519 envelopes, task/workspace/prompt bindings and terminal dispatches in the real SQLite Store. The normal Controller/Store stages advance to READY_FINAL; the test advances the clock 31 minutes and exercises WAITING_HUMAN_GATE_5_9, a freshly signed human approval and the Gate 5.9 Store validation to CLOSED. Real network/model preflight alone is stubbed in the isolated test; no remote task was created.

## Known remaining blockers (not changed)

- Real independent OS/Paseo process and observer witnesses remain unimplemented/unverified; no physical-node isolation attestation.
- Native P0 third-seat provider termination and optional A2A Rusty task bridge remain unverified. No live P0 model was dispatched by this patch.
- General write-once artifact and test directory recovery, Tester A exact commands, detailed-plan source SHA binding and real external Gate/Coding model integration remain outside this narrow fix.
- **C seat still not served.** For a later independent review, the user must approve a working C model/harness assignment or re-enable the originally approved model in Magpie. Do not silently switch to another model or re-run a timed-out paid call.
- D's PRE/POST `NON_COMPLIANT` findings require actual independent read-only enforcement and preflight evidence, not a fabricated or backdated PASS. Avoid conflating locally installed two Agents with the mandatory distinct physical P0 quorum.
- No upgrade to CODE_VERDICT PASS, WORKFLOW_VERDICT PASS, PROCESS_COMPLIANCE PASS, PASEO_INTEGRATION VERIFIED, RUSTY A2A VERIFIED or LIVE END-TO-END VERIFIED is authorized by source-only CI.

## Next controlled review

Freeze SHA, confirm source and CI, then **only after genuine Pro-Audit PRE and user-approved C model availability** re-run a single independent scope-limited Spec/Quality/Arbitrator/Pro-Audit review. Inspect and independently reproduce the newly added 31-minute SQLite Store/Gate integration regression as well as unwanted UNKNOWN-stage transitions, signed Arbitrator decision tampering and Reviewer missing POST. Store full original logs, call IDs and usage; do not use a master fallback as independent report.

**No repository main mutation, deployment, SSH, remote model execution, paid calls or key upload occurred in this remediation.**
