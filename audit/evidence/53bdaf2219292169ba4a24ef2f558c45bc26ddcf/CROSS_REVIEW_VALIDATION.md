# 双 CLI 原始意见与主审交叉复核（S0-R2 第三轮）

本文件保留独立 CLI 的原始输出与主审复核结论，**不改写模型原文**，也不把模型自报当作验收。主审结论不采用多数票。

## 1. 调用记录与有效性

| 席位 | 调用 | 结果 | 原始文件 |
|---|---|---|---|
| Codex | `codex exec -s read-only --skip-git-repo-check --ephemeral -C <offline-copy> -o CODEX_REPORT.md -`（stdin = `PROMPT.md`） | **NOT_AVAILABLE**，exit 1，账户配额限制 | `cli_reports/codex.stderr.log` |
| OpenCode（第 1 次） | `opencode run --dir <offline-copy> --agent p1-audit --model magpie/group/deepseek-v4-pro --format default` + 完整 `PROMPT.md`（42 文件范围） | **TIMEOUT**，exit 124（600s），仅 289 字节中间叙述，无最终报告 | `cli_reports/OPENCODE_REPORT.md`、`opencode.stderr.log` |
| OpenCode（第 2 次，聚焦） | 同 agent/model，`PROMPT_FOCUSED.md`（只读 5 个核心文件、4 个定点问题），22:53:02–22:55:40 | **VALID**，exit 0，3594 bytes 报告 | `cli_reports/OPENCODE_FOCUSED_REPORT.md`、`opencode2.stderr.log` |

- Codex 失败原文（节选）：`You've hit your usage limit. Upgrade to Pro ... try again at Nov 10th, 2026 3:58 PM.` 这是外部账户配额，不是源码/配置问题，也不是审计结论。
- 两次 OpenCode 调用均未收到主审发现、未收到 Codex 意见，**两席互不喂意见**。
- OpenCode 只读 agent `p1-audit` 的权限为 `*: deny, read/glob/grep/list: allow`（bash deny）。工作区文件清单在调用前后一致，未修改被审源码。
- 主审在独立完成静态审查、160 项测试与对抗探针之后才读取 OpenCode 报告；OpenCode 报告不影响主审判定。

## 2. OpenCode 原始意见 → 主审复核

| OpenCode 意见 | 主审复核 | 依据 |
|---|---|---|
| **Q1 CONFIRMED**：`src/store.mjs:70-79` 的 `event()` 是公开写路径，内部不调用 `verify()`；可对篡改后的 `tasks` 快照写入匹配的 `_state_sha256`，使 `verify()` 通过。直接调用点包括 `src/controller.mjs:20`（`CONFIG_FROZEN`）与 `src/p0.mjs:72`（`P0_OPTIONAL_NOT_DISPATCHED`）；`save/artifact/recordIntent/recordAck/recordTerminal` 均有前置 `verify()`。 | **CONFIRMED**，与主审 **R3-001（BLOCKER）** 完全一致。主审额外实测：aRound=10/bRound=9 → 0/0 后，一次 `store.event()` 使 verify 从拒绝变为接受，预算被重置。主审接受 OpenCode 关于 `controller.mjs:20` 的补充：`create()` 在 `init` + `artifact('frozen-manifest.json')` 之后直接调用 `store.event(id,'CONFIG_FROZEN',...)`，这是第二个裸写调用点；新任务刚 init，篡改窗口小，但仍应纳入 R3-001 修复。 | `logs/probe-r2-001.stdout.log`、`logs/probe-r3-residuals.stdout.log` |
| **Q2 CONFIRMED**：`SENSITIVE_PATH` 要求 `.env` 紧跟行首或 `/`/`\`；`" .env"` 的前导空格不匹配；`porcelainPaths` 保留前导空格；`safeChange` 与 `validateStaged` 均被绕过；`commitWorktree` 提交该文件。 | **CONFIRMED**，与主审 **R2-009 PARTIAL / 前导空格残留（HIGH）** 一致。主审实测 `" .env"` 与 `"sub/ .env"` 均被提交；尾随空格在 Windows 上无法 add。 | `logs/probe-r2-009.stdout.log` |
| **Q3 NOT_CONFIRMED**：`src/git.mjs:20` 的 `taskkill` spawn 无 `env`；`remote/p0_runner.py:304` 的 `Popen` execute worker 无 `env`；其余 `execArgv→childEnv`、`run()→child_env`、Harness `env=env` 正确。 | **CONFIRMED**，与主审 **R3-004（LOW）**、**R3-005（LOW）** 一致。主审实测 Node/Python 合成哨兵在 Git/Harness 路径均被过滤；静态确认两处裸 `spawn`/`Popen`。这使 **R2-005 判 PARTIAL** 而非 FIXED。 | `logs/probe-r2-005-node.stdout.log`、`logs/probe-r2-005-007-python.stderr.log`、`logs/probe-r3-residuals.stdout.log` |
| **Q4 CONFIRMED**：`invokePair` 用 `Promise.allSettled`；成功席先 `store.artifact()`+`store.save()` 持久化，再检测 `errors.length/successful.size`；throw 后 `step()` 置 `NEEDS_RECONCILIATION`，不自动重试；`REVIEW_PAIR_UNCERTAIN.completed` 只存角色名，但 artifact/history 独立留存可交叉验证。 | **CONFIRMED（证据保留子项）**，与主审 **R2-010 PARTIAL** 的正面部分一致。主审额外实测成功席 artifact 含 role/agentId/verdict/summary/findings/raw、history evidenceSha256 与 manifest 一致；失败席 dispatch 保持 `ACKNOWLEDGED`；第二次 `run` 不重派。**主审额外发现 OpenCode 未提及的 R3-003（MEDIUM）**：后续 `run()` 预检失败会把 `NEEDS_RECONCILIATION` 覆盖为 `BLOCKED`，丢失对账上下文。OpenCode 的“completed 仅存角色名”观察被主审接受为 LOW 信息，但 artifact/history 已足够交叉验证，不单列缺陷。 | `logs/probe-r2-010.stdout.log` |
| OpenCode 总判定 **CODE_VERDICT: FAIL**（Q1+Q2 安全边界失效、Q3 违反最小权限、Q4 独善其身不足） | **一致**。主审独立结论同为 **CODE_VERDICT: FAIL**，但主审的 FAIL 依据更广：R3-001（BLOCKER）、R2-009 前导空格（HIGH）、R3-003（MEDIUM），以及 F5/F6/F8/F9/F10 的未完成/未验证项。 | `AUDIT_REPORT.md` |

## 3. 主审独立发现、OpenCode 未覆盖

以下项目属于 `MAIN_AUDIT_ONLY`，不作为对 OpenCode 的否定，只是说明单席静态审查的覆盖边界：

- R2-001 的五入口矩阵：`run / approve / recover / artifact / recordIntent / recordAck / recordTerminal` 对 aRound/bRound/status/stage/history/frozen.policy 篡改的逐项拒绝与预算保留。
- R2-002 孤儿文件、同名重试、evidence 目录异常、缺失/篡改证据的 fail-closed 矩阵。
- R2-003 两个真实 SQLite 连接的确定性交错与 `readSnapshot` 一致性。
- R2-004 WAL 只读伴生文件（`-wal`/`-shm`）实测，主库 SHA-256 不变。
- R2-007 Windows 原始 Python 套件 4/4 PASS、`process_alive` Win32 行为、`status` 六路径、Windows `cancel` UNCERTAIN。
- R2-008 `--basis` 三种早期阶段恢复与 CLI 端到端。
- R2-009 rename/copy 双向、索引预置、`.ENV`、`.envrc`、`*.pem`、`id_rsa` 等完整矩阵。
- R2-010 两席成功、重复 Agent ID、第二次 run 不重派的实测。
- F1–F10 回归探针 12 项。
- R3-002 `authorizeRecovery` 不重算 frozen 完整性。
- R3-003 预检覆盖 `NEEDS_RECONCILIATION`。
- R3-006 CLI usage 字面 `\n`。
- R3-007 本地/远端 `APPROVE_WITH_COMMENTS` 不一致。
- R3-008 缩进 JSON 被拒。

## 4. 被反驳或修正的模型推断

本轮没有出现需要 `REFUTED` 的 OpenCode 结论；四条 Q1–Q4 均与主审源码/探针一致。需要说明的修正：

- OpenCode Q1 将 `src/controller.mjs:20` 列为直接调用点，主审核实**成立**；但该调用位于新任务 `init` 之后、`artifact` 之后，状态尚未被外部篡改，实际可利用窗口小于 `p0.mjs:72`。主审仍将其纳入 R3-001 的统一修复范围。
- OpenCode Q4 称“唯一风险：completed 仅存角色名而非证据哈希”。主审认为 artifact manifest + history 已独立留存哈希，**不构成新增缺陷**，仅在报告的事件字段可读性上记 INFO。
- OpenCode 未讨论 F5 Soul 迁移、F6 Windows 隔离、F9 原始日志脱敏、F10 进程树终止；这些仍是 NOT_VERIFIED/BLOCKED，不由单席静态审查解除。

## 5. 独立性声明

- Codex 未产出任何审查意见；OpenCode 两次调用均在独立上下文，仅收到固定源码、任务书与聚焦问题，未收到主审发现或对方意见。
- 两席均未执行测试、未修改文件、未联网、未调用真实 SDK/SSH/远端。
- 主审的实际运行证据来自 `logs/` 与 `evidence/TEST_RESULTS.txt`；模型报告只作为交叉参考，不作为 PASS 依据。
