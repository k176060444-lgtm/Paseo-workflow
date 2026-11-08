# S0-R3 独立 CLI 审查交叉验证

**被审 Commit：** `fa157e1ce53374d539f4b5b5aa1129eccad7cb3b`
**主审：** Windows 21bao 本地独立审计
**交叉验证日期：** 2026-11-08
**原则：** 主审先独立完成源码审查、194 项离线测试/探针并冻结结论，再读取 CLI 报告。CLI 报告不得反向修改主审测试数据；任何 CLI 意见都必须由源码或独立探针复核后才能进入 FINDINGS。

---

## 1. 独立审查执行记录

### 1.1 Codex

| 项 | 值 |
|---|---|
| 命令 | `codex exec -s read-only --skip-git-repo-check --ephemeral -C offline-copy -o CODEX_REPORT.md -` |
| 输入 | `CLI_PROMPT_FOCUSED.md`（stdin） |
| 开始/结束 | 2026-11-08（见 `CODEX_STARTED.txt` / `CODEX_FINISHED.txt`） |
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
| 输出 | `OPENCODE_REPORT.md`，3044 bytes |
| 结论 | **VALID**；`CODE_VERDICT: FAIL` |

OpenCode 读取的核心文件：`src/store.mjs`、`src/controller.mjs`、`src/git.mjs`、`src/p0.mjs`、`src/policy.mjs`、`remote/p0_runner.py`。未向其提供主审 FINDINGS、探针结果或测试计数。

---

## 2. 逐条交叉验证

| # | OpenCode 意见 | 主审复核 | 定性 | 依据 |
|---|---|---|---|---|
| 1 | `Store.save()` 只校验旧行后无条件写 `t`；`aRound=0/bRound=0` 被 `verify()` 接受；`#trustedEventWrite` 不阻止公开 `save()` | **CONFIRMED** | **R4-001 BLOCKER** | `src/store.mjs:72-78`；`logs/probe-r4-write-paths.stdout.log`；`logs/quick-r3.log` |
| 2 | `artifact()` 在文件写入前 verify，事务外 fsync；并发篡改可被 trusted 追加 re-anchor | **CONFIRMED** | **R4-003 BLOCKER** | `src/store.mjs:42-59`；`logs/probe-r4-write-paths.stdout.log` |
| 3 | `assertFrozenIntegrity` 仅自洽；重算 digest/sha 可通过；`taskSpec`/`taskSpecSha` 只有一个时跳过 | **CONFIRMED** | **R4-002 HIGH / R3-002 PARTIAL** | `src/controller.mjs:40-46,307-325`；`logs/probe-r4-write-paths.stdout.log`；`logs/probe-r3-002-003.stdout.log` |
| 4 | `run()` 保留 NEEDS_RECONCILIATION/inflight，不重派；catch 守卫只对 READY 非 inflight 置 BLOCKED | **CONFIRMED** | **R3-003 FIXED** | `src/controller.mjs:260-299`；`logs/probe-r3-002-003.stdout.log`；旧缺陷探针按预期失败 |
| 5 | `safeChange` 黑名单遗漏 U+00AD/U+034F/U+180E/U+3164/U+2800；NFKC 只用于敏感路径探测；`validateStaged` 不复核 base 索引 symlink/gitlink | **PARTIALLY_CONFIRMED** | **R4-006 MEDIUM / R4-007 LOW / R2-009 PARTIAL** | `logs/open-code-claims.log`：5 个前缀均被接受；但这些不是 NTFS 上的字面 `.env` 别名，故不是已证明的字面 `.env` 提交绕过。全角 `.env` 已在路径矩阵中被拒绝；全角非敏感名不是缺陷。base 索引项为静态确认，未执行。 |
| 6 | `taskkill`/`Popen`/Harness 使用最小环境 | **CONFIRMED** | **R3-004/005 FIXED** | `src/git.mjs:19-21`；`remote/p0_runner.py:297-307`；`logs/probe-r3-004-005-env.stdout.log`；`logs/probe-r3-005-007-008-python.stderr.log` |
| 7 | 本地/远端 APPROVE_WITH_COMMENTS 的 LOW/MEDIUM/INFO/ADVISORY 与 HIGH 门禁一致 | **CONFIRMED** | **R3-007 FIXED** | `src/policy.mjs:123-128`；`src/p0.mjs:49-62`；`remote/p0_runner.py:180-190`；三组探针 |
| 8 | 解析器信任末尾围栏/最后一个裸 JSON；末尾 PASS 可覆盖前文真实 FAIL | **CONFIRMED（限于两个独立 verdict 对象）** | **R4-005 HIGH / R3-008 PARTIAL** | `logs/open-code-claims.log`：`FAIL\nPASS` → PASS；内联 `Example: {...}` → 拒绝。多围栏示例+终止判决整体拒绝为 **R4-004 LOW**。 |

---

## 3. 分歧与边界

### 3.1 OpenCode 的 R2-009 “NOT_CONFIRMED（仍有绕过）”

- **接受的部分：** 黑名单确实遗漏 5 个不可见/格式前缀；`U+200B` 被拒绝，但 U+00AD/U+034F/U+180E/U+3164/U+2800 被接受。
- **不接受的部分：** 这些名字在 NTFS 上不是 `.env`，不会匹配 `SENSITIVE_PATH` 的字面 `.env` 规则；因此不能称为“字面 `.env` 敏感路径进入 Commit”。它们是**视觉歧义/防御纵深**缺口，定级 **MEDIUM**（R4-006），不是 R2-009 的 HIGH 直接绕过。
- **R2-009 总体：PARTIAL**——前导/尾随空格、NFKC、rename/copy、staged index、真实 gitlink 已修；不可见黑名单不完整；Windows symlink EPERM 未执行。

### 3.2 OpenCode 的 “NFKC 只用于 SENSITIVE_PATH，全角名仍可进入 Commit”

- **REFUTED 作为敏感路径绕过：** 全角 `.env` 经 NFKC 后为 `.env`，路径矩阵已拒绝；全角 `ｅｎｖ` 不是 `.env`，不属于敏感路径。
- **保留：** NFKC 结果只用于匹配，不用于磁盘解析；这是设计选择，不是本次可复现的绕过。

### 3.3 OpenCode 的 “baseRef 已存在的 symlink/gitlink 不复核”

- **STATIC_CONFIRMED：** `validateStaged` 只对 `diff --cached` 中出现的 mode 120000/160000 断言。
- **NOT_VERIFIED：** Windows EPERM 无法创建 symlink；未构造 base 仓库中的 pre-existing sensitive symlink。它不是本次新提交新增路径的已证明绕过，列为 **R4-007 LOW** 加固项。

### 3.4 OpenCode 的 “末尾 PASS 覆盖前文 FAIL”

- **CONFIRMED：** 两个独立 verdict 对象时，最后一个 PASS 被采纳。
- **定级：** **R4-005 HIGH**。这是解析信任边界缺陷，不是测试误报；但不提升为 BLOCKER，因为 Reviewer Agent 本身就能直接输出 PASS，解析器不是唯一信任源。仍必须修复，否则真实 FAIL 可被格式歧义吞掉。

---

## 4. 一致结论

| 结论 | 主审 | OpenCode | 一致性 |
|---|---|---|---|
| `Store.save()` 可重置预算/再封存 | CONFIRMED | CONFIRMED | 一致 |
| `artifact()` fsync 窗口可再封存 | CONFIRMED | CONFIRMED | 一致 |
| R3-002 仅自洽、重算摘要/不完整 pair 可通过 | CONFIRMED | CONFIRMED | 一致 |
| R3-003 对账状态保护 | FIXED | CONFIRMED | 一致 |
| R3-004/005 最小环境 | FIXED | CONFIRMED | 一致 |
| R3-007 严重度门禁 | FIXED | CONFIRMED | 一致 |
| 不可见字符黑名单不完整 | PARTIAL/MEDIUM | 指出缺口 | 方向一致，定级收窄 |
| 末尾 PASS 覆盖前文 FAIL | HIGH | 指出 FAIL→PASS | 一致 |
| R2-009 字面 `.env` 前导空格绕过 | 已修 | 未逐项复测 | 主审有独立 50 项矩阵 |
| 整体代码 | **FAIL** | **FAIL** | 一致 |

**Codex 无有效报告，不能作为第三席独立证据。** OpenCode 是唯一有效 CLI 交叉审查；其意见已被逐条复核，未直接写入 FINDINGS 而不验证。

---

## 5. 证据文件

- `CLI_PROMPT_FOCUSED.md` — 发给两家 CLI 的同一份只读 prompt
- `OPENCODE_REPORT.md` — OpenCode 原始输出（exit 0）
- `OPENCODE_STDERR.log` — OpenCode stderr（读取文件轨迹）
- `CODEX_REPORT.md` — Codex 失败记录（非审查报告）
- `CODEX_STDERR.log` — Codex 配额原文
- `logs/probe-r4-write-paths.stdout.log` — R4-001/R4-003/R4-002 复现
- `logs/open-code-claims.log` — 不可见前缀与 FAIL→PASS 复现
- `logs/probe-r3-002-003.stdout.log` — R3-003 与恢复矩阵
- `logs/probe-r3-006-008-local.stdout.log` — 解析器矩阵
- `logs/probe-r3-005-007-008-python.stderr.log` — 远端环境/解析

**声明：** CLI 模型意见只用于交叉验证，不能代替本机测试，也不能把“缺陷复现探针 PASS”当成产品通过。