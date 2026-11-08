# S0-R4 独立 CLI 审查交叉验证

**被审 Commit：** `5fa4a8ad1083c44c92e69f0fb84bdf900bd333ee`
**基线 Commit：** `fa157e1ce53374d539f4b5b5aa1129eccad7cb3b`
**主审：** Windows 21bao 本地独立审计
**原则：** 主审先独立完成静态审查、252 项离线测试/探针并冻结结论，再读取 CLI 报告。CLI 报告不反向修改主审测试数据；任何 CLI 意见必须由源码或独立探针复核后才能进入 FINDINGS。

---

## 1. 执行记录

### 1.1 Codex

| 项 | 值 |
|---|---|
| 命令 | `codex exec -s read-only --skip-git-repo-check --ephemeral -C offline-copy -o CODEX_REPORT.md -` |
| 输入 | `CLI_PROMPT_FOCUSED.md` |
| 开始/结束 | 2026-11-08 10:11（见 `CODEX_STARTED.txt` / `CODEX_FINISHED.txt`） |
| 退出码 | **1** |
| 输出 | 无有效报告；`CODEX_REPORT.md` 仅记录失败 |
| 原因 | 账户配额：`You've hit your usage limit ... try again at Nov 10th, 2026 3:58 PM.` |
| 结论 | **NOT_AVAILABLE**；未伪造、未重试付费模型 |

### 1.2 OpenCode

| 项 | 值 |
|---|---|
| 命令 | `opencode run --dir offline-copy --agent p1-audit --model magpie/group/deepseek-v4-pro --format default` |
| 输入 | `CLI_PROMPT_FOCUSED.md`（单条 prompt） |
| 权限 | `p1-audit` 只读 agent：`* deny`，仅 `read/glob/grep/list allow` |
| 退出码 | **0** |
| 输出 | `OPENCODE_REPORT.md`，4478 bytes |
| 结论 | **VALID**；`CODE_VERDICT: FAIL` |

OpenCode 读取：`src/store.mjs`、`src/controller.mjs`、`src/git.mjs`、`src/policy.mjs`、`remote/p0_runner.py`。未向其提供主审 FINDINGS、探针结果或测试计数。

---

## 2. 逐条交叉验证

| # | OpenCode 意见 | 主审复核 | 定性 |
|---|---|---|---|
| 1 | `#validateTaskTransition` 不校验 stage/status/pendingHuman/lastB/p0/reviewers；`save(t,'A_COMMIT_FROZEN')` + fake currentSha + approve 5.9 直达 CLOSED | **CONFIRMED** | **R5-001 BLOCKER**；`logs/probe-r5-stage.log` 8/8 |
| 2 | `init()` 仅检查 `!get(id)`，不校验任务内容；可注入终态/fake currentSha/frozen/taskSpec | **CONFIRMED** | **R5-002 BLOCKER**；`logs/probe-r5-trust.log` 7/7 |
| 3 | `artifact()` verify→anchor→fsync→recheck→INSERT→append 同一 `BEGIN IMMEDIATE`；同连接篡改捕获、第二连接锁阻塞、孤儿 fail-closed、明确非原子 | **CONFIRMED** | **R4-003 FIXED**；`logs/probe-r5-artifact.log` 5/5 |
| 4 | frozen 不可替换、TASK_SPEC 成对/匹配、候选后不可变、Controller 双重校验；Git 祖先校验缺失 | **CONFIRMED（Git 缺失）** | **R4-002 PARTIAL / R5-003 HIGH**；`probe-r5-rounds`、`probe-r5-trust` |
| 5 | 本地/远端仅接受唯一终止 verdict；FAIL→PASS、双围栏、示例、JSONL、截断均 fail-closed | **CONFIRMED** | **R4-005 FIXED**；本地 11/11、远端 16/16 |
| 6 | `safeChange` 覆盖 Cf/Default_Ignorable/Braille/Hangul；中文不误伤；`validateStaged` 扫完整 index 拒绝 base 120000/160000 | **CONFIRMED** | **R4-006/R4-007 FIXED**；`probe-r5-git` 25/25 |
| 7 | 正常 Planner→TASK_SPEC→Gate A→Gate B→Gate 5.9 流程保留；无 SQLite 嵌套事务/死锁；孤文件策略已文档化 | **CONFIRMED（无回归）** | 官方 happy-path 53 项 Node 中通过；`npm test` 52 pass/1 skip；无嵌套事务异常 |

---

## 3. 分歧与边界

### 3.1 OpenCode Q7 的 “NOT_CONFIRMED”

OpenCode 把问题表述为“新约束是否破坏正常流程”，回答 `NOT_CONFIRMED`，并明确说明 `step()` 流程保留、无 SQLite 嵌套事务/死锁。主审解释为 **未发现正常流程回归**，不是产品失败。官方 `npm test` 的 happy-path、Gate A/B、P0、5.9 测试均通过（52 pass/1 skip）。

### 3.2 Git 祖先校验

- OpenCode 指出 `git.prepare` 只做对象存在性检查，无 `merge-base --is-ancestor`；主审进一步确认 `Store.save()` 对 `baseSha/currentSha` **完全不调用 Git**，任意 40 字符即可写入并通过 `verify()`。这是 **R5-003 HIGH** 的直接证据，不只是 prepare 层缺失。

### 3.3 R4-003 的“原子性”

OpenCode 正确指出代码注释明确声明文件与 SQLite 非原子；主审探针确认注册失败留孤儿、`verify()` fail-closed。这不是缺陷，不能把“检测并停线”误写成“完整崩溃恢复”。

---

## 4. 一致结论

| 结论 | 主审 | OpenCode | 一致性 |
|---|---|---|---|
| `save()` 阶段/审批/P0 绕过 | CONFIRMED / BLOCKER | CONFIRMED | 一致 |
| `init()` 初始信任根/终态注入 | CONFIRMED / BLOCKER | CONFIRMED | 一致 |
| artifact 事务/孤儿 fail-closed | FIXED | CONFIRMED | 一致 |
| frozen/TASK_SPEC 约束 | PARTIAL | CONFIRMED（Git 缺失） | 一致 |
| 解析器唯一 verdict | FIXED | CONFIRMED | 一致 |
| Unicode/完整 index | FIXED | CONFIRMED | 一致 |
| 正常流程回归 | 无回归 | NOT_CONFIRMED（无回归） | 一致 |
| 整体代码 | **FAIL** | **FAIL** | 一致 |

**Codex 无有效报告，不能作为第三席独立证据。** OpenCode 是唯一有效 CLI 交叉审查；其意见已逐条复核，未直接写入 FINDINGS 而不验证。

---

## 5. 证据文件

- `CLI_PROMPT_FOCUSED.md` — 发给两家 CLI 的同一份只读 prompt
- `OPENCODE_REPORT.md` — OpenCode 原始输出（exit 0，4478 bytes）
- `OPENCODE_STDERR.log` — 读取轨迹
- `CODEX_REPORT.md` — Codex 失败记录（非审查报告）
- `CODEX_STDERR.log` — 配额原文
- `logs/probe-r5-stage.log` — R5-001/R5-002 复现
- `logs/probe-r5-trust.log` — init/恢复 basis 复现
- `logs/probe-r5-artifact.log` — R4-003 边界
- `logs/probe-r5-parser-local.log` / `probe-r5-parser-remote.log` — R4-005
- `logs/probe-r5-git.log` — R4-006/R4-007

**声明：** CLI 模型意见只用于交叉验证，不能代替本机测试；缺陷复现探针的 CONFIRMED 不代表产品通过。