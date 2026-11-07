# Soul v1.1.0 → P1 V2.1 迁移差异（未经正式批准）

本仓库保留了用户历史 Soul 的原始字节与来源 SHA，不应静默覆盖。下面是必须在正式模型调用前由用户审核的新行为契约：

| 角色/文件 | 旧版历史条款 | V2.1 应采用的结论 |
| --- | --- | --- |
| `souls/spec_reviewer.md`, `souls/quality_reviewer.md` | `APPROVE`/`REQUEST_CHANGES` 等判决 | SDK 接收旧别名并在可信输入边界规范化为 PASS/FAIL；推荐新版统一 PASS/FAIL/QUESTION/NEEDS_SPECIALIST/APPROVE_WITH_COMMENTS，所有发现都明确严重度 |
| `souls/worker_remediation.md` | 暗示不能绕过每轮 Arbitrator | 只有真实技术意见冲突或争议才派发 Arbitrator；无争议时必须记录 `NOT_TRIGGERED` |
| `souls/arbitrator.md`, `souls/quality_reviewer.md` | 对 Pro-Audit 的文字引用 | Pro-Audit AI 角色已退役；程序化 Compliance Gate 负责过程门禁，不作技术裁决 |
| `souls/blind_a/b/c.md` | 远端 A2A 交互文字 | 5bao/9bao 可使用 SSH + 原生 OpenCode Runner；rusty 原生 Harness 可选，不要求远端 Paseo |
| `souls/tester_gate_a/b.md` | 允许独立追加测试用例和合法增量提交 | 当前 Controller 仅实现只读 Tester + 冻结命令执行，不支持完整 TEST_ONLY 用例添加与并入最终 Commit。**正式链路 BLOCKED**，必须先实现并获得 OS 级验收 |

此外，正式输出应包含：task_id、role、phase、被审 Commit、TASK_SPEC SHA、Soul SHA、法定 Markdown 交付物、发现与严重度、原始测试命令/退出码/日志及可定位证据。现有 JSON 仅有 verdict/summary/findings/taskSpec，不满足完整报告映射。

**迁移决策：保留原文，只提供差异清单。** 用户审核批准新的 Soul 内容和 HASH 后，再在单独提交中更新并与 Controller 的输出契约做双向校验。不接受“Controller 会忽略旧文字”作为无需对齐的理由。
