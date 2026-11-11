# R13 — Targeted independent-review remediation (2026-11-11)

Fixed original R12 audit base: `0666586173375d7055a7c61647b13bef6c608dea`.
Candidate branch: `fix/r13-uncertain-state-p0-verdict-20261111`.
Record the **final immutable Commit SHA** at the end of the batch, never review a moving HEAD.

## Scope: R12 native reproduced blockers D-01 and D-02, directly related D-03 and D-11

**No live Agent, no paid provider calls, no SSH/A2A, no infrastructure mutation and no deployment were authorized or performed.** All tests described below are source-level/offline.

### D-01: truly uncertain role/Pro-Audit/reviewer-pair/P0 execution

The Controller now saves stage `NEEDS_RECONCILIATION`, status `NEEDS_RECONCILIATION`, `blockedStage` equal to the exact interrupted original checkpoint, and `inflight=null`. The original in-flight role and phase are preserved as a separate audited event with the checkpoint, never guessed from the next request.

The Store's state transition verifier demands a prior INFLIGHT state, the original stage, and original role/phase agreement, for `EXECUTION_UNCERTAIN`, `REVIEW_PAIR_UNCERTAIN`, and `P0_UNCERTAIN`. Unexpected exception fallback also saves a consistent blocked/uncertain checkpoint with no orphaned in-flight marker.

The formal `incident-close` gate can now recognize interrupted `A_REVIEW/B_REVIEW` checkpoints, **but only** after proving all original dispatches terminal with independently verified original reports. If original output is absent, it will continue to block; there is no automatic retry.

### D-02: signed P0 verdicts cannot be hidden by forged summary flags

`deriveP0Verdict(reports)` computes `passed`, `dispute`, and aggregate findings exclusively from per-seat original verdicts and findings. `assertP0Summary` requires the supplied Adapter summary to match this computation exactly.

The Controller checks this **before registering a P0 summary** and rechecks before accepting final arbitration. The Store rechecks at P0 transition, signed original node verification and final Gate 5.9. `acceptedP0Dispute` also enforces the derived facts even when called independently. A fabricated `passed:true` mixed with signed FAIL cannot circumvent the Arbitrator or final Gate.

A valid technical disagreement is not automatically rejected: one genuine PASS and one genuine FAIL must be explicitly adjudicated by the mandatory final Arbitrator with evidence for every negative seat, while original signed P0 reports remain immutable. Unanimous FAIL, missing witness, QUESTION/unknown and invalid signatures cannot be waived.

### D-03: source-aware reviewer-pair recovery without duplicate paid tasks

`readCompletedReviewerPair` reads two separate independently signed original Spec/Quality receipts for the exact frozen Commit, verifies Agent IDs, one terminal dispatch per seat, and independent PRE+POST process receipts. After a separately authorized signed recovery, the Controller reuses these original reports and performs **zero** replacement model calls.

If any seat or process receipt is missing, the task remains blocked pending independently witnessed remediation. Incomplete, unknown, or forged reviewer outputs cannot be reconstructed or treated as PASS. A real OS witness service is still NOT_VERIFIED.

### D-11: viable real-model P0 dispute output

The Arbitrator technical docket now includes `reportSha256` for each original P0 report alongside the full signed envelope and report-set digest. The standard model output JSON Schema now explicitly supports a structured `disputeResolution` on the Arbitrator role only, preserving it in the signed original Agent execution report and passing it through the Controller and Store. No artificial/model-generated hash calculation is required. Every negative seat's SHA, cited code refs, rationale and decision must be precise.

## Source-only regression checklist

- A synthetic lost-ACK role execution preserves `blockedStage` and never redispatches.
- Independent Pro-Audit, local reviewer-pair and remote P0 failure each persist the original interrupted checkpoint.
- `passed:true` with a genuine signed FAIL seat is rejected before Arbitrator/Gate.
- Exact per-report P0 SHA appears in the final Arbitrator docket.
- Valid fully evidenced reviewer pair can resume from its original reports without new Agent creation; missing a seat remains BLOCKED.
- Model schema/parser accepts only final Arbitrator structured evidence-bound rulings, and the policy rejects tampered hashes or summaries.

## Unresolved, separately scoped follow-ups — NOT production-ready

- **D-04**: crashed/orphan artifact handling, versioned final compliance and retry-safe Tester worktree names are not yet solved for every failure/recovery scenario. Existing fixed names are immutable and can still block retries.
- **D-05/D-06**: authentic independently deployed OS, process and runtime observers and recovery-time independent process proof are not live-verified or fully closed.
- **D-07/D-08**: native remote cancellation and optional third-seat handling; physical host attestation; real native Rusty Hermes A2A task/spec/result bridge are not yet complete.
- **D-09/D-10**: Tester A exact frozen command and actual independent test-case execution; WorkPlan review bound to the exact WorkPlan digest remain outstanding.
- Real 5bao/9bao native Paseo Agent lifecycle, independent witness service, OS ACLs and model selection require separate explicit authorization.

Do not merge into main, publish code, waive a Gate, fabricate independent evidence or claim P0/LIVE End-to-End VERIFIED based on offline tests.

After this fixed Commit passes CI, arrange a **single independent local source review**, with genuinely separate Spec and Quality model reports, final Arbitrator and process PRE/POST or explicitly report inability to comply. Any live remote checks require user-approved scope and model fees.
