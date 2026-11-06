# Soul provenance and V2.1 migration review

This repository copies the user's pre-existing Soul contents **byte-for-byte** at the source commits below, excluding the retired `pro_audit` Agent. Soul versions are NOT evidence that the new V2.1 semantics have already been approved; local audit must reconcile legacy text and formally approve replacements.

The V2.1 Controller's mandatory 10+10+Compliance Gate policy, conditional Arbitrator, and final-commit P0 re-review override older workflow descriptions. The SDK injects exactly each frozen Soul (role/Model binding is external). The repository has no cloud custody of credentials.

| New path | Source repository | Source commit | Source blob SHA |
|---|---|---|---|
| `souls/planner.md` | [k176060444-lgtm/Hermes-Coding-Role-Souls](https://github.com/k176060444-lgtm/Hermes-Coding-Role-Souls) | `f0ecc4895c8947af164ff40ce1f2b29f52947b07` | `2c82183fecb8fe0ab179bb9952e80c70397d3f3d` |
| `souls/worker.md` | [k176060444-lgtm/Hermes-Coding-Role-Souls](https://github.com/k176060444-lgtm/Hermes-Coding-Role-Souls) | `f0ecc4895c8947af164ff40ce1f2b29f52947b07` | `9d262f7ee45ced9df89356b36d76fe33ee89deb0` |
| `souls/spec_reviewer.md` | [k176060444-lgtm/Hermes-Coding-Role-Souls](https://github.com/k176060444-lgtm/Hermes-Coding-Role-Souls) | `f0ecc4895c8947af164ff40ce1f2b29f52947b07` | `fb816718f3330f3a5f9452182e22fe219ae61a92` |
| `souls/quality_reviewer.md` | [k176060444-lgtm/Hermes-Coding-Role-Souls](https://github.com/k176060444-lgtm/Hermes-Coding-Role-Souls) | `f0ecc4895c8947af164ff40ce1f2b29f52947b07` | `5a0063523673be878e404199626bf830d7221927` |
| `souls/tester_gate_a.md` | [k176060444-lgtm/Hermes-Coding-Role-Souls](https://github.com/k176060444-lgtm/Hermes-Coding-Role-Souls) | `f0ecc4895c8947af164ff40ce1f2b29f52947b07` | `26bdf9a6a31d423a48977169e62f8b1c234b807b` |
| `souls/worker_remediation.md` | [k176060444-lgtm/Hermes-Coding-Role-Souls](https://github.com/k176060444-lgtm/Hermes-Coding-Role-Souls) | `f0ecc4895c8947af164ff40ce1f2b29f52947b07` | `2fe39ef54fe670097e3d30b6ba7474fdffdc1132` |
| `souls/tester_gate_b.md` | [k176060444-lgtm/Hermes-Coding-Role-Souls](https://github.com/k176060444-lgtm/Hermes-Coding-Role-Souls) | `f0ecc4895c8947af164ff40ce1f2b29f52947b07` | `328043dc65347d6990c1ebe44fad7b4de97c67c4` |
| `souls/arbitrator.md` | [k176060444-lgtm/Hermes-Coding-Role-Souls](https://github.com/k176060444-lgtm/Hermes-Coding-Role-Souls) | `f0ecc4895c8947af164ff40ce1f2b29f52947b07` | `7018266562f43faea6713c7a8381dd2d846f4a07` |
| `souls/blind_a.md` | [k176060444-lgtm/hermes-agent](https://github.com/k176060444-lgtm/hermes-agent) | `38c76de3f7e8b47951b01d430806fffe10fe1cdc` | `80e357ee866d9d35a237b43b9a2784f6adf2df9d` |
| `souls/blind_b.md` | [k176060444-lgtm/hermes-agent](https://github.com/k176060444-lgtm/hermes-agent) | `38c76de3f7e8b47951b01d430806fffe10fe1cdc` | `0a4db0b5539e9021441a635881bc759b7e0c9744` |
| `souls/blind_c.md` | [k176060444-lgtm/hermes-agent](https://github.com/k176060444-lgtm/hermes-agent) | `38c76de3f7e8b47951b01d430806fffe10fe1cdc` | `c6f507ae0b57f67eb81573bf4af4c72fd449d693` |

**Pending migration review:** Some legacy Souls mention mandatory Pro-Audit or always-on arbitration. Neither legacy language nor a self-declared Agent PASS can override the new deterministic Controller. Before live operation the local agent must audit all 11 files, verify bytes/SHA, update and re-approve any contradictory or incomplete Soul contracts, and verify actual provider-side instruction injection. The blind-role Souls come from the original P1 feature branch and are different from the newer 9-role package.
