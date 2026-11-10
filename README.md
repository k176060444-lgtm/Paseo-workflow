# Paseo-workflow — Coding Pipeline V2.2 mainline correction candidate

**Status (2026-11-10): source remediation + offline CI only; NOT approved for live Coding, paid Provider calls, deployment or production.** Existing historical R2–R8 documents are retained as evidence and do not supersede this README or current user decisions.

## User-approved purpose

Correctly implement the **user's real Coding goal**, not merely pass tests. User approves actual requirements, important strategy and the **model + Harness assignment matrix**; technical implementation and file-level choices remain with professional agents. Do not broaden scope or allow incidental issues to derail the Coding mainline.

Hermes → independent Workflow Controller → Paseo SDK → local Codex/OpenCode or remote OpenCode. The rusty optional Reviewer seat uses the **native Hermes A2A tool bridge**, not Paseo and not SSH.

## End-to-end Coding flow

1. **Gate 0.1**: explicitly approve user intent, strategy bounds and frozen model/Harness matrix.
2. **Planner alignment**: restate the user's objective, constraints, suggested method and decisions **in plain Chinese**, without inappropriate analogies or implementation minutiae. Form a high-level candidate TASK_SPEC only.
3. **Gate 0.2**: human explicitly approves the *actual candidate alignment/spec SHA*. Prior to approval **no detailed Coding task decomposition**.
4. **Planner Detail**: after approval, write and freeze `WORK_PLAN.md` and detailed TDD/atomic tasks without changing approved scope.
5. **Gate A (up to 10 rounds)**: Worker → independent parallel Spec Reviewer and Quality Reviewer on exact Commit → independent Tester A and frozen command evidence.
6. **P0 initial**: ≥2 physically independent verified Blind Review reports on exact Commit (5bao/9bao are the primary Paseo candidates; rusty is optional A2A).
7. **Gate B (up to 10 rounds)**: when no confirmed remediation is required skip Worker Remediation; otherwise targeted remediation → changed Commit → two independent re-reviews; Tester B must verify Smoke/Canary/Regression. A modified final Commit requires renewed P0 evidence. Neither an unverified P0 result nor a technical disagreement becomes PASS by assumption.
8. **Arbitrator — mandatory final technical acceptance**: even without disagreement, verify actual code completeness, unimplemented requirements, alignment to the **original user intent**, and consistency with exact final Commit evidence. On substantive technical disputes, Arbitrator gives the final technical ruling; it cannot waive missing verifiable P0, tests or compliance.
9. **Final Compliance Gate**: confirm the complete *process* evidence, including authenticated Pro-Audit PRE/POST receipts and the final Arbitrator; no technical verdict.
10. **Gate 5.9**: human decision, without automatic push/merge/deploy/restart.

**At every individual role dispatch**, `pro_audit` executes PRE and POST checks and records independently signed original evidence, including both reviewers, the independent test execution, P0, and final Arbitrator. It checks **process only**: approved inputs, sequence, permissions, matrix, evidence, exact Commits and authorization; never code quality. The deterministic Store checks every transition too. Any material violation stops the line; manual approval and reconciliation are required before recovery. Do not retry uncertain provider/A2A calls automatically.

## Twelve roles

`planner`, `worker`, `spec_reviewer`, `quality_reviewer`, `tester_gate_a`, `worker_remediation`, `tester_gate_b`, `arbitrator`, `pro_audit`, and external `blind_a`, `blind_b`, `blind_c`. Frozen Soul sources and their changes are documented in `docs/SOUL_PROVENANCE.md`. Soul text is a **soft** behavioral contract; the Controller, operating system and independent witness must enforce actual boundaries.

## Verified cluster facts, 2026-11-10

| Node | Transport | Verified | NOT verified |
|---|---|---|---|
| 21bao | local Paseo daemon 0.15.3 at loopback `127.0.0.1:6767/ws` | SDK connection; Codex/OpenCode provider discovery | full production orchestration |
| 5bao | authenticated direct Paseo SDK `ws://192.168.5.6:6767/ws` | daemon `srv_X18iC2z6z-sS`, OpenCode detected | paid remote Agent lifecycle, physical identity, signed P0 |
| 9bao | authenticated direct Paseo SDK `ws://192.168.9.6:6767/ws` | daemon `srv_TjihQm2fgp_k`, OpenCode detected | same |
| rusty | native Hermes peer `rustyhand` using Bearer + A2A | authenticated Agent Card discovery | A2A Task ID/results, independent remote Reviewer, signed third seat |

The remote Paseo SDK connects **directly** with separately approved password environment variables `PASEO_5BAO_PASSWORD` and `PASEO_9BAO_PASSWORD`. No credentials are included in the repo, printed or uploaded. Direct daemon connections do **not** require local `hosts.list()` registration, which is currently empty on 21bao. `src/p0_paseo.mjs` supports both pinned direct SDK and historical native Connected Hosts routing without SSH fallback.

`ws://` is **not encrypted**: using authenticated private-LAN endpoints is only a preliminary connection capability, not a substitute for independently approved encrypted transport, network boundary, credential security and OS isolation for real workloads.

rusty: `src/p0_a2a.mjs` defines a strictly authenticated **native Hermes A2A tool bridge contract**, not an alternate protocol implementation. A2A task lifecycle and signed result are unverified; the standalone CLI refuses to enable rusty until a real native bridge, remote Task ID and independently pinned signing identity exist. No fabricated Task IDs or inferred model results.

## Source organization

- `src/controller.mjs` — gated Coding state machine, role PRE/POST, two-stage Planner, mandatory final Arbitrator.
- `src/policy.mjs` — code-fixed role permissions and 10+10 budget.
- `src/store.mjs` — immutable frozen context, SQLite ledger, signed execution and exact-Commit verification, final Pro-Audit coverage.
- `src/agents.mjs` — Paseo native local SDK, Soul injection and Agent lifecycle.
- `src/p0_paseo.mjs` — Paseo direct/Connected Hosts P0, authenticated per-node witness, 2 physical node quorum.
- `src/p0_a2a.mjs` — optional native Hermes A2A bridge contract (not yet live wired).
- `src/attestor.mjs` — client of **external independent** execution/OS witness service (not bundled).
- `src/p0.mjs` and `remote/p0_runner.py` — quarantined legacy fixtures; `ssh()` always throws; not live transport.
- `souls/*.md`, `config/role-matrix.example.json` — behavior and unapproved sample assignments.

## Offline checks

```bash
npm run check
npm test
python3 -m unittest discover -s remote/tests -v
```

These tests use simulations and do not invoke paid models or validate a live cluster. The GitHub Actions workflow runs them on the isolated remediation branch.

## Manual commands (do not use with real tasks until independently approved)

```bash
node src/cli.mjs help
node src/cli.mjs init --id TASK1234 --matrix config/role-matrix.json --intent config/intent.md
node src/cli.mjs status --id TASK1234
node src/cli.mjs verify --id TASK1234
```

`init` creates local state files (not a paid model task). Signed human approval and `run` additionally require independent trust roots, signed gate receipts, real OS isolation, remote per-node witness and explicit authorization. `P1_LIVE_ALLOWED=YES` and `P1_HOST_ISOLATION_ATTESTED=YES` alone are **not** proof of readiness.

**Current blockers**: real 21bao/rusty task execution not attested, independent execution/witness service not provisioned, full remote physical node/OS ACL identity not verified, standalone Hermes A2A bridge not attached, existing state DB migration unapproved, TEST_ONLY addition-of-test-files support not fully implemented. Never claim complete real integration from CI PASS.

For binding and safety details see `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and `docs/REMEDIATION_20261110.md`.
