# Paseo-workflow S0-R2 第三轮独立复审报告

**AUDIT_STATUS: COMPLETE**
**CODE_VERDICT: FAIL**
**LIVE_INTEGRATION_STATUS: BLOCKED**

- 被审固定 Commit：`53bdaf2219292169ba4a24ef2f558c45bc26ddcf`
- 父提交：`6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4`
- Tree：`8a96a79f86ed0d4622bc420f4844c1e1839165d8`
- 整改说明：`docs/R2_REMEDIATION_20261107.md`
- 上一轮证据输入：`audit/s0-6c57a3d8-evidence` 分支的 `FINDINGS.json`、`AUDIT_REPORT.md`、`CODEX_REPORT.md`、`OPENCODE_REPORT.md`、`CROSS_REVIEW_VALIDATION.md`
- 审计环境：21bao / Windows 10；Node v26.6.0、npm 11.18.0、Python 3.11.15、Git 2.54.0.windows.1、Codex 0.166.0、OpenCode 1.19.3（与旧记录中的 Python 3.14.7 不符，以本次只读探测为准）
- 审计范围：固定 Commit 的源码静态审查、本机 Windows 离线 Node/Python 原始套件、独立对抗探针、本机 Codex/OpenCode 独立审查、证据上传。**未安装/启动 Paseo，未做真实 SDK/Harness/SSH/P0 调用，未修改生产配置，未部署。**

本报告的 `FIXED` 只表示被列出的子项在离线源码/测试范围内成立，**不代表真实集成、Windows OS 隔离、真实模型或生产验收通过**。GitHub CI Run 42374051963 的 34 项 Node / 4 项 Python 仅作外部参考；本机独立运行结果见第 5 节。

---

## 1. 决定性结论

### 1.1 已确认的阻断问题

**R3-001（BLOCKER，新发现）— `Store.event()` 是未校验账本的写入口，可把篡改状态重新封存并重置 10+10 预算。**

- 位置：`src/store.mjs:70-79`（`event()` 自身不调用 `verify()`、不开事务）；直接调用点包括 `src/p0.mjs:72`（`P0_OPTIONAL_NOT_DISPATCHED`，P0 异步轮询期间）与 `src/controller.mjs:20`（`create()` 中 `CONFIG_FROZEN`，新任务 init/artifact 之后，可利用窗口较小但仍应纳入修复）。
- 实测：初始化 `aRound=10,bRound=9` → 直接 `UPDATE tasks SET data` 改为 `aRound=0,bRound=0` → `verify()` 拒绝（`persisted task state differs from ledger`）→ 调用一次 `store.event(...)` → `verify()` 接受，任务预算变为 0/0。
- 影响：R2-001 要求的“检测到损坏不得重新封存、预算不得降低/重置”在 `run/approve/recover/artifact/dispatch` 五个入口已成立，但 `event()` 这条写路径仍可完成 re-anchor。任何调用 `Store.event()` 的代码（当前是 P0 probe-skip 路径，未来任何新增调用者）都能把已检测的篡改变成可信链头。
- 最小修复：`event()` 内部先 `verify(id)` 并包进事务，或将其降为私有 helper；`p0.mjs` 改为调用经过校验的 store 方法。

**R2-009（HIGH，残留）— 前导空格文件名仍可绕过敏感路径检查并被提交。**

- 位置：`src/git.mjs:54`（`SENSITIVE_PATH` 要求 `.env` 前是字符串开头或 `/`/`\`）、`src/git.mjs:72-78`（`safeChange` 直接匹配原始路径字符串）。
- 实测（Windows 一次性本地仓库、仅合成内容、无 remote）：
  - `" .env"`：`git status --porcelain -z` 输出 `??  .env\0`，`porcelainPaths` 返回 `[" .env"]`，`SENSITIVE_PATH.test(" .env")` 为 false，`commitWorktree` 成功提交为 `.env`。
  - `"sub/ .env"`：同样被接受（`R2-009-NESTED-LEADING-SPACE=ACCEPTED`）。
  - 尾随空格 `".env "` 在 Windows 上 `git add` 报 `No such file or directory`，未形成提交。
- 影响：敏感文件可进入本地 Commit；虽然没有 remote、没有真实密钥，但后续若被推送/审查，会破坏“拒绝提交敏感路径”的保证。
- 最小修复：对每个路径组件做规范化/trim 后匹配，并拒绝 basename 与 trim 后不一致的路径；增加前导/尾随空格回归测试。

**R3-003（MEDIUM，新发现）— `run()` 预检失败会把 `NEEDS_RECONCILIATION` 覆盖成 `BLOCKED`，丢失对账上下文。**

- 位置：`src/controller.mjs:255-267`（preflight catch 只看 `TERMINAL.has(start.stage)`，不看 `start.status` / `start.inflight`）。
- 实测：双审一成一败后 `status=NEEDS_RECONCILIATION, stage=A_REVIEW`；未设置 `P1_LIVE_ALLOWED` 时调用 `run()`，状态变为 `BLOCKED/BLOCKED`，`pendingHuman='Preflight failed: live dispatch disabled...'`，原始“Concurrent reviewer execution uncertain”丢失。
- 影响：运维对账信息被覆盖；失败席仍保留 `ACKNOWLEDGED` dispatch，因此恢复仍被拒绝，不构成执行放行，但违反“状态不明不得盲目重派/不得覆盖对账状态”的原则。

### 1.2 已修复的主路径

- R2-001 的五个入口：篡改 `aRound/bRound/status/stage/history/frozen.policy` 后，`run`、`approve`、`recover`、`artifact`、`recordIntent/recordAck/recordTerminal` 全部拒绝；篡改后状态仍被 `verify()` 检出；已消耗的 A/B 预算在受控恢复后保持为 10/10，`run` 进入 `STOPPED_BUDGET`。
- R2-002：证据登记事务失败留下孤儿文件后 `verify()` 拒绝；同名重试拒绝；evidence 目录被替换为文件、目录内出现子目录、已登记文件缺失/被改，全部 fail-closed。
- R2-003：两个真实 SQLite 连接确定性交错时，`readSnapshot` 只见旧版本，退出后见新版本；快照内 `verify()` 与状态一致；失败回滚干净。
- R2-007：Windows 原始 Python 套件 `4/4 PASS, exit 0`，上一轮的 WinError 87 / status 失败 / 临时目录清理错误未复现；`process_alive` 对 self/dead/nonexistent/PID 4 行为正确（无权限 => false，fail-closed）；`status` 六种路径全部正确；Windows `cancel` 返回 `CANCEL_UNCERTAIN`。
- R2-008：无 Commit 的 BLOCKED 任务通过 `--basis`（taskSpecSha 或 frozen.digest）受控恢复；错误 basis、伪造 Git SHA、未决派发、损坏账本、非 BLOCKED 全部拒绝；CLI 端到端验证。
- R2-010：真实 `PaseoAgentRuntime` + 进程内假 SDK 的一成一败场景中，成功席的 artifact（role/agentId/verdict/summary/findings/raw）、history 与 evidence hash 完整保留；失败席 dispatch 保持 `ACKNOWLEDGED`；第二次 `run` 不重派；两席成功正常记录两份证据；重复 Agent ID 先保存证据再 fail-closed。

---

## 2. R2-001～R2-010 逐项结论

| ID | 原严重度 | 本轮结论 | 已核实内容 | 残余风险 / 未验证 |
|---|---|---|---|---|
| R2-001 | BLOCKER | **PARTIAL** | `run/approve/recover/artifact/recordIntent/recordAck/recordTerminal` 对 aRound、bRound、status、stage、history、frozen.policy 篡改全部拒绝；预算保留；`STOPPED_BUDGET` 可达。 | **R3-001：`Store.event()` 未校验、无事务，`p0.mjs:72` 直接调用，可 re-anchor 并把 10→0、9→0。** 本地无密钥哈希链仍不能抵抗有全库写权限者重算。 |
| R2-002 | MEDIUM | **FIXED** | 注入 `ARTIFACT_REGISTERED` 失败 → 孤儿文件保留、`verify()` 报 `unregistered evidence file requires reconciliation`；同名重试拒绝；evidence 目录异常、子目录、缺失/篡改文件全部 fail-closed；无自动修复 API。 | 仅“检测并停线”，没有完整崩溃恢复协议；需人工对账，符合整改说明的声明。 |
| R2-003 | MEDIUM | **FIXED** | `readSnapshot` 在 `BEGIN` 后建立同一读版本；并发 writer 提交后，快照内仍读旧值；退出后读新值；`verify()` 与状态一致；失败 ROLLBACK。 | 文件系统哈希读取不在 SQLite 快照内；未做 OS 崩溃/断电压力测试。 |
| R2-004 | LOW | **FIXED（hardening）** | 只读打开现有 WAL 库创建并保留 `workflow.sqlite-wal` / `-shm`；主库 SHA-256 前后一致；整改说明已公开该副作用并拒绝 `immutable=1` 掩盖。 | 文件系统副作用按设计保留。 |
| R2-005 | HIGH | **PARTIAL** | Node `childEnv`、Python `child_env`、远端 `run()`、Harness 子进程均过滤合成哨兵；allowlist 合法名通过、非法名拒绝。 | **R3-004：`git.mjs:20` 的 `taskkill` spawn 无 `env`；R3-005：`p0_runner.py:304` 的 `Popen` execute worker 无 `env`，继承完整环境。** 真实凭据兼容/ACL 未验证。 |
| R2-006 | HIGH | **PARTIAL** | 本地 Markdown+bare/fenced JSON、CRLF、legacy APPROVE/REQUEST_CHANGES、PASS+任意 finding、APPROVE_WITH_COMMENTS 严重度门槛全部正确；远端 Markdown+JSON、legacy、PASS+finding 正确；11 个 Soul blob 与 provenance 全部一致。 | **Soul V2.1 迁移仍未批准**；6 个 Soul 仍含 legacy `APPROVE/REQUEST_CHANGES/Pro-Audit` 文本；**无法定 Markdown/JSON 交付物映射**；本地/远端 `APPROVE_WITH_COMMENTS` 规则不一致（R3-007）；缩进 JSON 被拒（R3-008）。 |
| R2-007 | MEDIUM | **FIXED** | Windows 原始 Python 套件 4/4 PASS、exit 0；无 WinError 87 / status 失败 / 清理错误；`process_alive` Win32 实现正确；`status` 六路径正确；`cancel` Windows 返回 `CANCEL_UNCERTAIN`。 | 真实 Linux Runner、进程组零残留、600 秒计时仍 NOT_VERIFIED；存活不等于归属。 |
| R2-008 | MEDIUM | **FIXED** | `--basis` 覆盖 pre-spec / post-spec / post-worktree 三种早期 BLOCKED；错误 basis、伪造 SHA、未决派发、损坏账本、非 BLOCKED 全部拒绝；CLI 端到端成功/失败路径均验证。 | **R3-002：`authorizeRecovery` 不重算 frozen 完整性**，配合 R3-001 可接受伪造 digest（后续 live preflight 仍阻断）。 |
| R2-009 | HIGH | **PARTIAL** | tracked `.env`、untracked `.env`、`.env.production`、rename 双向、copy、`sub/.env`、`.ENV`、`.envrc`、`*.pem`、`id_rsa`、`id_ed25519`、预置索引、malformed porcelain 全部拒绝；`foo.env` 正确放行；porcelain -z rename/copy/空格/引号/换行解析正确。 | **前导空格 `" .env"` 与 `"sub/ .env"` 仍被提交（CONFIRMED）**。Windows 无权限创建 symlink；本地 submodule 添加失败；symlink/gitlink 拒绝逻辑仅静态确认，NOT_VERIFIED。 |
| R2-010 | MEDIUM | **PARTIAL** | 一成一败时成功席 artifact/history/agentId/verdict/summary/findings/raw/evidence hash 完整；失败席 `ACKNOWLEDGED`；不重复派发；两席成功正常；重复 Agent ID 先保存再拒绝。 | **R3-003：后续 `run()` 的 preflight 失败会把 `NEEDS_RECONCILIATION` 覆盖为 `BLOCKED`**，丢失对账信息。 |

**R2 统计：FIXED 4（R2-002/003/004/007/008 中的 007、008 计入）、PARTIAL 6、NOT_FIXED 0、NOT_VERIFIED 0。** 精确计数：FIXED = R2-002、R2-003、R2-004、R2-007、R2-008（5 项）；PARTIAL = R2-001、R2-005、R2-006、R2-009、R2-010（5 项）。合计 10。

> 注：上表 R2-007/R2-008 的“FIXED”仅指原缺陷的离线/Windows 本地子项；真实 Linux/远端/物理身份仍未验证。

---

## 3. 原 F1–F10 回归复核

| 原 ID | 原严重度 | 本轮结论 | 依据与残余 |
|---|---|---|---|
| F1 | BLOCKER | **FIXED** | `parseAgentOutput` 拒绝 PASS+任意 finding、APPROVE_WITH_COMMENTS+非 LOW、非法 verdict、空 summary、非字符串 findings；`step()`/`invokePair`/`P0.verify` 三重检查。无回归。 |
| F2 | BLOCKER | **MITIGATED_FAIL_CLOSED** | 三种双席组合、第三席 probe 失败、第三席 cancel 返回 FINISHED+FAIL/PASS、cancel nodeId 不匹配、丢 ACK 全部离线复现；真实双机、600 秒、Linux 进程组未验证。 |
| F3 | BLOCKER | **MITIGATED_FAIL_CLOSED** | 同字节不同路径 key 在派发前拒绝；签名 physicalId 不匹配拒绝；真实物理主机身份仍 NOT_VERIFIED。 |
| F4 | HIGH | **FIXED（参数形态）** | `waitForFinish(60*60*1000)` 数字参数；真实 SDK/daemon 超时/断连 NOT_VERIFIED。 |
| F5 | HIGH | **NOT_FIXED** | 解析兼容已修，但 Soul V2.1 迁移未批准、6 个 Soul 仍含 legacy 文本、无法定 Markdown/JSON 交付物映射。 |
| F6 | BLOCKER | **NOT_VERIFIED** | 仅验证权限矩阵声明；Windows SID/ACL/网络/Job Object、TEST_ONLY 新增测试审查归并、真实 SDK/远端 Harness 全部未验收。 |
| F7 | HIGH | **PARTIAL** | 事务写入、dispatch/artifact 摘要、证据文件哈希已修；**`Store.event()` 仍是未校验的写入口**，事件链可被重新封存。 |
| F8 | HIGH | **PARTIAL** | 停线、预检 BLOCKED、无 Commit 恢复、未决派发拒绝均成立；**R3-001 re-anchor 与 R3-003 对账状态覆盖**仍开放。 |
| F9 | HIGH | **MITIGATED_FAIL_CLOSED** | Node/Python/远端 Git/Harness 白名单成立；`taskkill`/`Popen` 仍继承完整环境；原始日志未脱敏、Windows ACL 未验证。 |
| F10 | MEDIUM | **MITIGATED_FAIL_CLOSED** | 只读查询不创建状态、`inspect` 一致快照、Windows liveness 已修；WAL 伴生文件副作用已记录；真实进程树终止未验证。 |

**F 统计：FIXED 2（F1、F4）、PARTIAL 2（F7、F8）、MITIGATED_FAIL_CLOSED 4（F2、F3、F9、F10）、NOT_FIXED 1（F5）、NOT_VERIFIED 1（F6）。合计 10。**

---

## 4. 新发现（R3 系列）

| ID | 严重度 | 位置 | 触发条件 | 实际结果 | 最小修复 |
|---|---|---|---|---|---|
| R3-001 | **BLOCKER** | `src/store.mjs:70-79`、`src/p0.mjs:72` | 任务状态被篡改后，任何代码调用 `store.event()` | `verify()` 从拒绝变为接受，`aRound=0,bRound=0` | `event()` 内 `verify()`+事务；`p0.mjs` 改用受校验方法 |
| R3-002 | MEDIUM | `src/controller.mjs:295-320` | 篡改 `frozen` 但不改 `digest`，再用 `event()` re-anchor，然后 `--basis=digest` | 恢复被接受并写 `HUMAN_CONTROLLED_RECOVERY`；后续 live preflight 拒绝 | `authorizeRecovery` 首先校验 `frozen.digest===sha256(frozen without digest)` |
| R3-003 | MEDIUM | `src/controller.mjs:255-267` | `status=NEEDS_RECONCILIATION, stage=A_REVIEW` 时预检失败 | `status/stage` 被覆盖为 `BLOCKED`，对账原因丢失 | preflight catch 不修改 `NEEDS_RECONCILIATION` 或有 `inflight` 的任务 |
| R3-004 | LOW | `src/git.mjs:19-21` | Windows 子进程被杀 | `taskkill` 继承完整父环境 | `env:childEnv()` |
| R3-005 | LOW | `remote/p0_runner.py:304-305` | 远端 submit 启动 execute worker | `Popen` 无 `env`，继承完整 runner 环境 | `env=child_env(config)` |
| R3-006 | LOW | `src/cli.mjs:27` | `node src/cli.mjs help` | usage 显示字面 `\n` | 模板字符串改为真实换行 |
| R3-007 | LOW | `src/policy.mjs:118-129`、`remote/p0_runner.py:182-189` | `APPROVE_WITH_COMMENTS` + LOW finding | 本地接受，远端降为 FAIL | 统一严重度门禁或显式声明远端更严 |
| R3-008 | LOW | `src/policy.mjs:94-110`、`remote/p0_runner.py:140-161` | Markdown 后接两空格缩进的最终 JSON | 本地抛错、远端 QUESTION | 允许最终对象前有空白，且必须是最后一个非空内容 |

---

## 5. 本机离线测试证据

运行环境与逐批命令、cwd、退出码、原始 stdout/stderr 见 `TEST_RESULTS.txt` 与 `TEST_SUMMARY.json`。汇总：

| 批次 | 用例 | PASS | FAIL | ERROR | SKIP | exit |
|---|---:|---:|---:|---:|---:|---:|
| `npm run check` | — | — | — | — | — | 0 |
| 原始 Node 全套（未改测试） | 34 | 34 | 0 | 0 | 0 | 0 |
| 原始 Python 全套（未改测试） | 4 | 4 | 0 | 0 | 0 | 0 |
| R2-001 矩阵探针 | 17 | 17 | 0 | 0 | 0 | 0 |
| R2-002/003/004 探针 | 10 | 10 | 0 | 0 | 0 | 0 |
| R2-005 Node 环境探针 | 5 | 5 | 0 | 0 | 0 | 0 |
| R2-006 解析/Soul 探针 | 14 | 14 | 0 | 0 | 0 | 0 |
| R2-008 恢复探针（含 CLI） | 11 | 11 | 0 | 0 | 0 | 0 |
| R2-009 Git 敏感路径探针 | 18 | 18 | 0 | 0 | 0 | 0 |
| R2-010 双审探针 | 4 | 4 | 0 | 0 | 0 | 0 |
| F1–F10 回归探针 | 12 | 12 | 0 | 0 | 0 | 0 |
| R3 残余探针 | 5 | 5 | 0 | 0 | 0 | 0 |
| R2-005/006/007 Python 远端探针 | 26 | 26 | 0 | 0 | 0 | 0 |
| **合计（有计数批次）** | **160** | **160** | **0** | **0** | **0** | — |

**口径说明：**

- 探针 `PASS` 表示探针断言成立；其中 R2-001 RESIDUAL、R2-009 RESIDUAL、R3-001～R3-005 等是**缺陷复现探针**，PASS 表示“缺陷被确认”，**绝不表示产品通过**。
- 原始 Python 套件在上一轮为 `1 ERROR, exit 1`；本轮为 `4 tests, 4 passed, exit 0`，原始 stderr 完整保存在 `logs/python-full.stderr.log`。没有修改原测试断言。
- 未做真实 Paseo SDK、真实 OpenCode JSONL、真实 SSH/P0、真实模型调用；`P1_LIVE_ALLOWED` / `P1_HOST_ISOLATION_ATTESTED` 只是测试夹具中的开关，不是安全证明。
- GitHub CI 的 34 + 4 结果与本机一致，但不作为本机验收替代。

---

## 6. 独立 CLI 审查与交叉验证

### 6.1 Codex

- 调用：`codex exec -s read-only --skip-git-repo-check --ephemeral -C <offline-copy> -o CODEX_REPORT.md -`，stdin 为 `PROMPT.md`。
- 结果：**NOT_AVAILABLE**。exit 1，stderr 完整保留在 `cli_reports/codex.stderr.log`：
  `You've hit your usage limit. Upgrade to Pro ... try again at Nov 10th, 2026 3:58 PM.`
- 没有生成 `CODEX_REPORT.md`。这是**外部账户配额限制**，不是代码/配置错误，也不是审计结论。

### 6.2 OpenCode

- 首次调用：`opencode run --dir <offline-copy> --agent p1-audit --model magpie/group/deepseek-v4-pro --format default`，完整 `PROMPT.md`（8.4 KB，42 文件范围）。**timeout 600s → exit 124**，仅产生 289 字节中间叙述，无最终报告。原始 stderr/stdout 保留在 `cli_reports/OPENCODE_REPORT.md` 与 `cli_reports/opencode.stderr.log`。
- 第二次调用（22:53:02–22:55:40）：同 agent/model，`PROMPT_FOCUSED.md`（1.5 KB，只读 5 个核心文件、4 个定点问题）。**exit 0，3594 bytes 有效报告**，见 `OPENCODE_FOCUSED_REPORT.md` 与 `opencode2.stderr.log`。
- OpenCode 聚焦复审的独立结论：
  - Q1 **CONFIRMED**：`store.mjs:70-79` 的 `event()` 是裸写口，可 re-anchor 篡改状态；补充 `controller.mjs:20` 与 `p0.mjs:72` 两个调用点。
  - Q2 **CONFIRMED**：前导空格 `" .env"` 绕过 `SENSITIVE_PATH` 并被 `commitWorktree` 提交。
  - Q3 **NOT_CONFIRMED**：`git.mjs:20` 的 `taskkill` 与 `p0_runner.py:304` 的 `Popen` 均继承完整环境。
  - Q4 **CONFIRMED**：`invokePair` 先持久化成功席 artifact/history，再检测失败；置 `NEEDS_RECONCILIATION`，不自动重派。
  - 总判定 **CODE_VERDICT: FAIL**，与主审一致。
- 两次均未向 OpenCode 提供主审结论，也未提供 Codex 意见；两席互不喂意见。逐条交叉验证见 `CROSS_REVIEW_VALIDATION.md`。

### 6.3 交叉验证

见 `CROSS_REVIEW_VALIDATION.md`。主审对 OpenCode 的每条意见做“源码/探针复核”，区分：
- `CONFIRMED`：与主审实测/源码一致；
- `REFUTED`：有反证；
- `NOT_VERIFIED`：双方都无法在离线范围证明；
- `MAIN_AUDIT_ONLY`：OpenCode 未提及、主审独立发现。

主审结论不采用多数票，也不把模型自报当作验收。

---

## 7. 必须继续保持的 BLOCKED / NOT_VERIFIED

1. **R3-001** `Store.event()` re-anchor 未修；R2-001 不能判 FIXED。
2. **R2-009 前导空格**可提交 `.env`；未修前不得声称敏感路径防护完整。
3. **R3-003** `NEEDS_RECONCILIATION` 被预检覆盖；对账上下文会丢失。
4. Windows 不同进程身份/SID、文件 ACL、网络与凭据边界未真实验收；环境变量和权限 JSON 不能替代。
5. TEST_ONLY 新增测试、独立审查及归并到最终 Commit 的完整闭环未完成。
6. 真实 Paseo SDK/daemon 认证、超时/断连、Agent 生命周期及真实远端 OpenCode JSONL/权限/作业生命周期未验收。
7. 两台不同物理 P0 主机及可信主机/密钥映射未验收；`physicalId`、SSH alias 及 HMAC 持有证明不足以完成此验收。
8. 真实第三席 600 秒行为、Linux 进程组和 Windows Job Object/整棵进程树取消未验收。
9. Windows symlink（120000）与 gitlink（160000）提交拒绝未能实机执行（宿主权限/本地 submodule 限制），仅静态确认。
10. OS 崩溃/断电、多进程压力、外部不可变锚定和审批主体认证未测。

**处理原则：上述任一项未满足，真实执行必须 fail-closed；不得以离线测试 PASS 或 GitHub CI PASS 解除。**

---

## 8. 只读审计边界声明

### 已确认未执行

- 未修改被审仓库任何文件；未 commit、未 push 到 main/修复分支/PR #1/#2/旧证据分支（仅向新建的 `audit/s0-53bdaf2-evidence` 分支新增 `audit/evidence/` 文件）。
- 未安装、启动、配置 Paseo；未运行真实 SDK/Harness 工作流。
- 未 SSH 到 5bao/9bao/rusty；未调用远端 P0、未做 A2A、未分发密钥。
- 未调用真实付费模型/Provider 完成审计结论；OpenCode 仅用于独立静态审查，Codex 因配额失败。
- 未修改系统 PATH、服务、用户目录、全局模型/认证配置；未读写真实密钥值。
- 未部署、未合并、未自动清理生产状态。

### 已执行的只读/隔离动作

- `git clone` / `git fetch` / `git rev-parse` / `git cat-file` / `git diff` / `git ls-tree` / `git hash-object`（只读）。
- 固定 Commit 的 `git archive` 复制到隔离临时目录 `offline-copy`；所有测试在临时目录/一次性 Git 仓库执行。
- `npm run check`、`npm test`、`python -B -m unittest ...`、自写 Node/Python 对抗探针。
- 本机 Codex/OpenCode CLI 只读审查（read-only sandbox / 只读 agent）。
- 证据与报告仅写入本机临时工作区和新建审计证据分支 `audit/evidence/53bdaf22.../`。

### 临时目录隔离

- 工作区：`C:\Users\KK\AppData\Local\Temp\opencode\paseo-audit-s0-r2`
- 被审源码副本：`...\offline-copy`（42 文件，`git archive` 自固定 Commit）
- 夹具：`%TEMP%\p1-*` 一次性目录，测试后清理；Windows SQLite 句柄延迟释放时会记录 `CLEANUP-WARNING`，不伪造清理成功。
- 未触碰 `Paseo-workflow` 原 clone 的工作树；固定 Commit checkout 状态干净。

### 环境前后哈希（关键配置）

| 文件 | 审计前 SHA-256 | 审计后 SHA-256 | 结论 |
|---|---|---|---|
| `C:\Users\KK\.codex\config.toml` | `0f360f805b2879e7d45a5dee1db41d1dca53ca0791ec874bdb76f33dd14b1f8b` | 同左 | 未变 |
| `C:\Users\KK\.config\opencode\opencode.jsonc` | `3228e544d38fb57d576a5f976e4636d40a5232a31c27e9fac280b8863c377ff2` | 同左 | 未变 |
| `C:\Users\KK\AppData\Local\hermes\config.yaml` | `21dea749e82a00ff9750c279f2dbeff3e64dbe745ad9d5640823fb7bf6b99bba` | 同左 | 未变 |

（Codex/OpenCode 二进制 wrapper：`D:\codex\codex` 177 bytes、`D:\opencode\opencode` 210 bytes，未改动。）

---

## 9. 交付物与固定链接

- 仓库：https://github.com/k176060444-lgtm/Paseo-workflow
- 被审固定 Commit：https://github.com/k176060444-lgtm/Paseo-workflow/commit/53bdaf2219292169ba4a24ef2f558c45bc26ddcf
- 证据分支：`audit/s0-53bdaf2-evidence`
- 证据根目录：`audit/evidence/53bdaf2219292169ba4a24ef2f558c45bc26ddcf/`
- 本报告：`.../AUDIT_REPORT.md`
- 机器可读发现：`.../FINDINGS.json`
- 测试结果：`.../TEST_RESULTS.txt`、`.../TEST_SUMMARY.json`
- 交叉验证：`.../CROSS_REVIEW_VALIDATION.md`
- 环境核验：`.../ENVIRONMENT.json`
- 证据清单：`.../EVIDENCE_MANIFEST.json`
- 独立报告：`.../OPENCODE_REPORT.md`（首次超时原始输出，exit 124）、`.../OPENCODE_FOCUSED_REPORT.md`（聚焦复审，exit 0）、`.../CODEX_REPORT.md`（配额失败记录，NOT_AVAILABLE）

**最终判定（不虚构）：** 代码 **FAIL**；离线测试全部通过不等于产品验收；真实集成 **BLOCKED**；在 R3-001、R2-009 前导空格、R3-003 以及第 7 节各项未关闭前，不得进入 S1/S2 或真实工作流执行。

等待用户下一步授权。
