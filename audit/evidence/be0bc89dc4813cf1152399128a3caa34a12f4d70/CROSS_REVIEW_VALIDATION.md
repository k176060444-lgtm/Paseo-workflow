# S0-R5 独立 CLI 审查交叉验证

**被审 Commit：** `be0bc89dc4813cf1152399128a3caa34a12f4d70`
**基线 Commit：** `5fa4a8ad1083c44c92e69f0fb84bdf900bd333ee`
**主审：** Windows 21bao 本地独立审计
**原则：** 主审先独立完成静态审查、257 项离线测试/探针并冻结结论，再读取 CLI 报告。CLI 意见必须由源码/独立探针复核后才能进入 FINDINGS。

---

## 1. 执行记录

### 1.1 Codex

| 项 | 值 |
|---|---|
| 命令 | `codex exec -s read-only --skip-git-repo-check --ephemeral -C offline-copy -o CODEX_REPORT.md -` |
| 输入 | `CLI_PROMPT_FOCUSED.md` |
| 开始/结束 | 2026-11-08T11:43:34+08:00 / 2026-11-08T11:44:08+08:00 |
| 退出码 | **1** |
| 输出 | 无有效报告；`CODEX_REPORT.md` 仅记录失败 |
| 原因 | 实际运行到 **39,541 tokens** 后 `429 Too Many Requests`，重试上限耗尽 |
| 结论 | **NOT_AVAILABLE**；未伪造、未无限重试 |

### 1.2 OpenCode

| 项 | 值 |
|---|---|
| 命令 | `opencode run --dir offline-copy --agent p1-audit --model magpie/group/deepseek-v4-pro --format default` |
| 输入 | `CLI_PROMPT_FOCUSED.md`（单条 prompt） |
| 权限 | `p1-audit` 只读 agent：`* deny`，仅 `read/glob/grep/list allow` |
| 退出码 | **0** |
| 输出 | `OPENCODE_REPORT.md`，3897 bytes |
| 结论 | **VALID**；`CODE_VERDICT: FAIL` |

OpenCode 读取：`src/store.mjs`、`src/controller.mjs`、`src/git.mjs`、`src/policy.mjs`、`remote/p0_runner.py`、`tests/fixtures.mjs`。未向其提供主审 FINDINGS、探针结果或测试计数。

---

## 2. 逐条交叉验证

| # | OpenCode 意见 | 主审复核 | 定性 |
|---|---|---|---|
| 1 | 白名单覆盖全部 stage/status，但审批 artifact 只是自洽文件、`A_REVIEW_PASS/B_REVIEW_PASS` 无 Reviewer 证据、公开 `artifact+save` 可伪造完整 CLOSED | **CONFIRMED** | **R5-001 NOT_FIXED / R6-001 BLOCKER / R6-002 HIGH**；`logs/probe-r5-forged-flow.log` 18/18 步 |
| 2 | `#validateCreation` 强制 Gate 0.1/零预算/无预置，frozen/Soul/权限矩阵不可伪造；`tests/fixtures.mjs` 仅测试引用 | **CONFIRMED** | **R5-002 FIXED**；`logs/probe-r5-init-event.log` 13/13 |
| 3 | Git verifier 检查对象/commit/祖先/worktree HEAD；但 **Store GATE_5.9 保存路径不重验**，且构造器可注入 `gitVerifier:()=>true` | **CONFIRMED（两处缺口）** | **R5-003 PARTIAL**；**R6-004 HIGH / R6-005 MEDIUM**；`probe-r5-forged-flow` 末步 + `probe-r5-verifier-stub` |
| 4 | `#validateFinalGate` 只查 DB 字段与已登记 artifact 自洽；无 Reviewer/Tester/P0 身份、无 HMAC 复验、无外部锚 | **CONFIRMED** | **R6-001/R6-003**；`probe-r5-forged-flow` |
| 5 | 公开 `Store.event` 仅允许 CONFIG_FROZEN/P0_OPTIONAL_NOT_DISPATCHED；history 追加只允许四类事件且需登记 artifact | **CONFIRMED** | **R5-001 子项 FIXED**；`probe-r5-init-event` |
| 6 | 正常链 0.1→Planner→0.2→A→P0→B→5.9、预算耗尽、双审失败、P0 冲突、最终 Commit 变化均有合法路径；无 SQLite 嵌套事务 | **CONFIRMED（无回归）** | 官方 `npm test` 62 项（61 PASS/1 SKIP）含 happy path、10 轮、P0、变更 Commit 测试 |
| 7 | 四层：字段完整性已实现；真实人工身份 NOT_VERIFIED；外部锚 NOT_VERIFIED；P0 HMAC 采集已实现但 Gate 5.9 不复验 | **CONFIRMED** | 报告第 8 节逐层列出 |

---

## 3. 分歧与边界

### 3.1 “白名单完整”不等于 R5-001 已修

OpenCode 正确指出白名单覆盖完整；主审进一步用公开 `Store.artifact` 伪造所有审批/Tester/P0/final-compliance，18 步走完状态机并 CLOSED。白名单只约束**事件顺序**，不认证**证据来源**。因此 R5-001 仍为 **NOT_FIXED**。

### 3.2 R5-003 的两个缺口

- **Store Gate 5.9 路径**：`Controller.approve` 会调用 `verifyCommitEvidenceSync`，但直接 `Store.save(t,'GATE_5.9_APPROVED')` 不会；主审在伪造流最后把 `store.gitVerifier` 替换为抛错函数，仍成功 CLOSED，证明该路径未重验 Git。
- **可注入 verifier**：`new Store(root,{gitVerifier:()=>true})` 接受假 SHA 的 `WORKTREE_PREPARED`；构造器只断言“是函数”，不证明是生产验证器。测试需要注入，但生产缺少验证器身份/不可关闭保证。

### 3.3 OpenCode Q6 的“正常流程”

OpenCode 明确正常链与失败路径均有合法迁移，未发现嵌套事务/死锁。主审官方套件 62 项中 happy path、Gate A/B 10 轮、P0 双机、最终 Commit 重 P0 均通过；正常流程 **无回归**。

### 3.4 四层边界

- **A. 代码级事件/字段完整性**：部分实现（哈希链、artifact digest、状态白名单）。
- **B. 真实人工身份认证**：**NOT_VERIFIED**（actor/receipt 仅字符串）。
- **C. 外部不可变证据锚定**：**NOT_VERIFIED**（仅本地 SQLite/文件）。
- **D. 真实 P0 身份/HMAC**：采集层有 HMAC/物理 ID 测试，但 Gate 5.9 不复验 HMAC；**真实远端 P0 未验证**。

---

## 4. 一致结论

| 结论 | 主审 | OpenCode | 一致性 |
|---|---|---|---|
| R5-001 阶段/审批/P0 伪造 | NOT_FIXED / BLOCKER | CONFIRMED（漏洞成立） | 一致 |
| R5-002 init 创建约束 | FIXED | CONFIRMED | 一致 |
| R5-003 Git verifier | PARTIAL（两缺口） | CONFIRMED（含缺口） | 一致 |
| Gate 5.9 仅字段自洽 | CONFIRMED | CONFIRMED | 一致 |
| 事件边界/history | FIXED 子项 | CONFIRMED | 一致 |
| 正常流程回归 | 无回归 | 无回归 | 一致 |
| 整体代码 | **FAIL** | **FAIL** | 一致 |

**Codex 无有效报告（429/39,541 tokens），不能作为第三席独立证据。** OpenCode 是唯一有效 CLI 交叉审查；其意见已逐条复核并补充为 R6-004/R6-005。

---

## 5. 证据文件

- `CLI_PROMPT_FOCUSED.md`
- `OPENCODE_REPORT.md`（exit 0，3897 bytes）
- `OPENCODE_STDERR.log`
- `CODEX_REPORT.md`（429 失败记录）
- `CODEX_STDERR.log`（含 39,541 tokens / 429）
- `logs/probe-r5-forged-flow.log` — 18 步伪造 CLOSED
- `logs/probe-r5-init-event.log` — init/event 13/13
- `logs/probe-r5-git-verify.log` — Git 13/13
- `logs/probe-r5-verifier-stub.log` — 可注入 verifier
- `logs/probe-r5_parser.log`、`logs/probe-r5_parser_remote.log` — 解析器
- `logs/probe-r5_git_paths.log` — 路径/index

**声明：** CLI 模型意见只用于交叉验证，不能代替本机测试；缺陷复现探针的 CONFIRMED 不代表产品通过。