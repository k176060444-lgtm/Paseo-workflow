# 独立只读代码审计任务书 — Paseo-workflow S0-R2 第三轮

你是独立代码审计员。请只依据源码和你自己的静态推理作出判断，不要相信开发者自述、提交说明中的“已修复”声明，也不要相信任何上一轮审计结论。你不需要运行任何命令或测试；本次是**纯静态只读审查**。

## 审计对象（固定不可变）

- 仓库：`k176060444-lgtm/Paseo-workflow`
- 被审 Commit：`53bdaf2219292169ba4a24ef2f558c45bc26ddcf`
- 父提交：`6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4`
- 本地源码副本（完整 42 文件，已检出该 Commit）：`C:\Users\KK\AppData\Local\Temp\opencode\paseo-audit-s0-r2\offline-copy`
- 整改说明：`docs/R2_REMEDIATION_20261107.md`
- 架构/安全文档：`docs/ARCHITECTURE.md`、`docs/SECURITY.md`、`docs/SOUL_V21_MIGRATION_PENDING.md`、`docs/SOUL_PROVENANCE.md`

## 业务规则（V2.1，不可放宽）

Hermes/QQBot 接单；独立 Controller 控制阶段与持久状态；Paseo SDK 创建 Codex/OpenCode Agent 并注入角色 Soul；P0 负责跨物理节点独立盲审；程序化 Compliance Gate 检查流程合规。

- Gate 0.1 用户批准 intent + Role Matrix；Planner 产出 TASK_SPEC；Gate 0.2 用户批准精确 TASK_SPEC SHA。
- Worker TDD → Spec Reviewer 与 Quality Reviewer 同 Commit 独立双审 → Tester A；Gate A 最多 10 轮（含首轮）。
- P0 至少 2 台不同物理节点有效盲审；第三席在双席完成后额外最多等 600 秒；报告必须绑定确切 Commit。
- Gate B 最多 10 轮（含首轮）；无整改跳过 Remediation；无争议跳过 Arbitrator；代码变更后最终 Commit 必须重新获得 P0 盲审证据。
- Compliance Gate 违规立即停线、人工审批后受控恢复；最终停于人工 Gate 5.9，禁止自动部署。
- 状态不明不得盲目重派；丢 ACK / 超时 / 进程异常必须 NEEDS_RECONCILIATION，不得自动重试。

## 上一轮审计在 6c57a3d8 发现的问题（本轮整改声称已修，需独立复核）

- **R2-001 BLOCKER**：`run()` preflight 识别到状态被篡改后，异常处理又把该状态写入新的合法事件（re-anchor）；随后人工恢复保留被降低的预算。要求：篡改 aRound/bRound、任务状态或事件后，分别测试 `run`、`approve`、`recover`、`artifact`、`dispatch` 五个入口是否都拒绝，且损坏状态不会被任何路径重新封存；10+10 预算不能被降低或重置。
- **R2-002 MEDIUM**：artifact 文件先落盘，SQLite 登记事务失败后留下孤儿文件；旧版 verify 接受孤儿、同名重试 EEXIST。要求：证据登记事务失败、孤儿文件、同名重试、目录异常是否正确 fail-closed；区分“检测并停线”与“完整崩溃恢复”。
- **R2-003 MEDIUM**：`inspect()` 用多个独立 SELECT，可能混合两个数据库版本。要求：同一 SQLite 读事务内读取任务、调度、事件和证据哈希。
- **R2-004 LOW**：只读打开现有 WAL 数据库会创建/保留 `-wal`/`-shm` 辅助文件。要求：记录这一文件系统副作用，但不得用 `immutable=1` 在活跃 WAL 上掩盖。
- **R2-005 HIGH**：远端 Git helper 仍继承不相关的环境变量（Harness 已用白名单）。要求：远端 Git helper、Harness 子进程全部遵守最小环境白名单；用合成环境变量验证。
- **R2-006 HIGH**：本地/远端 Markdown+JSON 输出、旧 verdict 归一化、PASS 携带 BLOCKER、报告交付物及历史 Soul V2.1 迁移缺口。要求：解析兼容不等于 Soul 迁移批准；不得擅自修改未批准的 Soul。
- **R2-007 MEDIUM**：Windows 上原始 Python 测试 ERROR（WinError 87 / status 失败 / 临时目录清理错误）。要求：Windows 实际运行 Python 原始测试并保留原始 stderr/退出码。
- **R2-008 MEDIUM**：无 Commit 的 BLOCKED 任务无法通过公开 CLI 恢复（`--sha` 必填且不匹配 null）。要求：按冻结 config/TASK_SPEC 摘要（`--basis`）受控恢复；错误摘要、未决派发、损坏账本必须阻断。
- **R2-009 HIGH**：`git status --porcelain -z` 的 rename 第二个路径被 `slice(3)` 截断；`must().trim()` 去掉前导状态空格，使 tracked `.env` 被当成 `env`；敏感路径检查漏检。要求：在无远端、仅合成内容的一次性 Git 仓库复现 tracked `.env`、`.env.production`、rename/copy 双路径、前导空格、porcelain -z、索引、symlink、路径穿越；重点判断是否仍能误提交敏感路径。
- **R2-010 MEDIUM**：双 Reviewer 一成一败时，成功席的原始证据/身份/摘要/历史未保存。要求：成功席完整保留；失败席保持对账状态且不重复派发。

## 原始 F1–F10（必须检查是否回归）

F1 PASS+BLOCKER；F2 三席 quorum/第三席/取消/丢 ACK；F3 重复 HMAC 密钥与物理身份；F4 `waitForFinish` 数值参数；F5 Soul/verdict/交付契约；F6 Windows OS 隔离/TEST_ONLY 新增测试归并/真实 Harness；F7 SQLite 事务/事件链/证据哈希；F8 合规停线与人工恢复；F9 子进程环境与原始日志 Secret 边界；F10 只读查询/WAL/进程树终止。

## 你必须重点独立判断的问题

1. **是否存在任何写入口仍能在不校验账本的情况下把“已被篡改的状态”写成新的可信链头？** 注意 Controller、Store、P0 adapter、CLI 的所有写路径，而不只是 `run` 的 preflight catch。请给出文件:行号和调用链。
2. **R2-009 的敏感路径检查是否存在仍可绕过的方式？** 特别检查路径字符串的前导/尾随空格、rename/copy 的源与目标、大小写、子目录、索引 mode（symlink 120000 / gitlink 160000）、Windows NTFS 文件名语义、`git add --all` 前后索引变化。给出可复现的文件名与 Git 命令序列。
3. **R2-005 是否覆盖了所有子进程？** 检查 `remote/p0_runner.py` 的 `subprocess.run` 与 `subprocess.Popen`、`src/git.mjs` 的 `spawn`、以及任何其他 spawn/exec 路径；指出仍继承完整环境的进程。
4. **R2-006 的 Markdown+JSON 解析器是否有边界缺陷？** 检查缩进 JSON、trailing prose、多行格式化 JSON、fenced 后 trailing text、旧 verdict、PASS+任意 finding、APPROVE_WITH_COMMENTS 严重度门槛；本地与远端是否一致。
5. **R2-010 一成一败时成功席证据是否真的完整？** 检查 `invokePair` 保存顺序、失败席 dispatch 状态、第二次 `run` 是否可能覆盖对账状态或重复派发。
6. **R2-008 的 `--basis` 是否可被错误摘要/未决派发/损坏账本绕过？** 检查 `authorizeRecovery` 的校验顺序与 frozen 完整性。
7. **R2-001 的 10+10 预算是否可能通过合法入口或状态机路径被降低/重置？** 检查 `aRound/bRound` 的所有读写点、`authorizeRecovery` 的阶段选择、`B_ENTER`/`A_WORKER` 的预算检查。

## 输出格式（Markdown）

请输出一份完整报告，包含：

1. **总判定**：`AUDIT_STATUS`（COMPLETE / PARTIAL / BLOCKED）、`CODE_VERDICT`（PASS / FAIL / INCONCLUSIVE）、`LIVE_INTEGRATION_STATUS`（BLOCKED / NOT_VERIFIED）。
2. **R2-001～R2-010 表**：每项给 `FIXED / PARTIAL / NOT_FIXED / NOT_VERIFIED`，附 `文件:行号`、静态推理依据、残余风险。
3. **F1–F10 表**：是否回归、依据、未验证项。
4. **新发现**：按 BLOCKER / HIGH / MEDIUM / LOW 分级，每条包含位置、触发条件、影响、最小修复建议。
5. **明确未验证项**：不要用“代码看起来正确”替代真实运行证据；不要声称你运行了测试。
6. **独立性声明**：说明你只做了静态只读审查，未修改文件、未执行命令、未联网、未调用模型/SDK/SSH/远端。

## 硬性禁止

- 禁止修改、创建、删除任何文件；禁止 `git add/commit/push`。
- 禁止运行测试、构建、安装、启动 Paseo 或任何服务。
- 禁止 SSH、A2A、远端节点、网络请求、真实模型/Provider 调用。
- 禁止读取或输出任何真实密钥、token、凭据；如遇到疑似密钥，只报告路径与风险，不复制值。
- 禁止把“提交说明声称已修复”或“测试文件存在”当作修复证据。

现在开始独立审查。请先读取 `docs/R2_REMEDIATION_20261107.md`、`src/store.mjs`、`src/controller.mjs`、`src/git.mjs`、`src/policy.mjs`、`src/p0.mjs`、`remote/p0_runner.py`，再读取测试与文档，最后输出报告。
