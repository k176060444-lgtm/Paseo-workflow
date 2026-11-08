# Paseo-workflow S0-R3 第四轮独立复审报告

**AUDIT_STATUS: COMPLETE**
**CODE_VERDICT: FAIL**
**LIVE_INTEGRATION_STATUS: BLOCKED**

- 被审固定 Commit：`fa157e1ce53374d539f4b5b5aa1129eccad7cb3b`
- 父提交：`53bdaf2219292169ba4a24ef2f558c45bc26ddcf`
- Tree：`63603935af671cd68d0013641fe15f07ab4013da`
- 整改说明：`docs/R3_REMEDIATION_20261108.md`
- 上一轮审计证据 Commit：`f38604e7cc25f97802ff3b511cc26c48a3c666e3`（`audit/s0-53bdaf2-evidence`）
- 环境：21bao / Windows 10 19044；Node v26.6.0、npm 11.18.0、Python 3.11.15、Git 2.54.0.windows.1、Codex 0.166.0、OpenCode 1.19.3
- Paseo 只读探测：**Paseo.exe 正在运行（PID 9636 / 10164 / 12000，Session Services）**；不在 PATH；`%LOCALAPPDATA%\@getpaseodesktop-updater\installer.exe` 存在（145,569,446 bytes，2026-11-08 07:59）。本轮**未启动、停止、更新、配置或接管**任何 Paseo App/Daemon；所有测试使用 fake runtime/一次性仓库。
- 范围：固定 Commit 静态审查、本机 Windows 离线 Node/Python 原始套件、独立对抗探针、Codex/OpenCode 独立复审、证据上传。**未部署、未做真实 P1 调用、未修改生产配置、未触碰远端 SSH/P0。**

本报告的 `FIXED` 仅指被列出的离线子项，不代表真实 SDK、Windows OS 隔离、真实远端 P0 或生产验收通过。

---

## 1. 决定性结论

### 1.1 R4-001（BLOCKER）— `Store.save()` 仍是公开的状态写入/再封存路径，可重置 10+10 预算

- 位置：`src/store.mjs:72-78`（`save`）、`src/store.mjs:5-15`（`#trustedEventWrite`）、`src/store.mjs:127-147`（`verify`）。
- 实测：BLOCKED 任务 `aRound=10,bRound=9`；`t=store.get(id); t.aRound=0; t.bRound=0; store.save(t,'BUDGET_RESET')` → `save` 只校验**更新前的旧行**（`:74`），随后无条件 `UPDATE tasks`（`:75`）并用 trusted 追加写新事件（`:76`）；`verify()` 通过，`get(id)` 显示 0/0。
- 同一路径还可替换 `status/stage/history`；修改 `frozen` 内容并重算 `digest`、修改 `taskSpec` 并重算 `taskSpecSha`，`authorizeRecovery` 均接受（R4-002）。
- 影响：R3-001 声称的“私有事件写入权限边界”只约束了 `event()`，没有约束“调用方传入任意 `t`”的 `save()`。任何有 Store 访问权的进程内调用者（或未来 Controller 缺陷）都能重置预算并让账本自洽。这是 BLOCKER，不是仅理论问题。

### 1.2 R4-003（BLOCKER）— `artifact()` 的 verify 在文件写入/事务之外，并发篡改会被 trusted 追加再封存

- 位置：`src/store.mjs:42-59`：`:44 verify` → `:51-52 open/write/fsync` → `:54-57 transaction` + `:56 #appendVerifiedMutation`。
- 实测：在 `fs.writeFileSync` 期间把 `aRound/bRound` 改为 0/0，`artifact()` 随后追加 `ARTIFACT_REGISTERED`；`verify()` 通过，`get(id)` 显示 0/0。
- 影响：并发写者可在 fsync 窗口重置预算；事务内没有再次校验状态哈希。与 R4-001 同一威胁模型，窗口更窄但真实。

### 1.3 R4-002（HIGH）— `assertFrozenIntegrity` 只做自洽检查，伪造匹配 digest/sha 与不完整 TASK_SPEC 均可恢复

- 位置：`src/controller.mjs:40-46`、`:307-325`。
- 实测：
  - 改 `frozen.intent` 并重算 `frozen.digest` → `authorizeRecovery` 接受，进入 PLANNER；
  - 改 `taskSpec` 并重算 `taskSpecSha` → 接受，进入 A_WORKER；
  - `taskSpec` 非空但 `taskSpecSha=null` → 跳过检查，恢复到 PLANNER；
  - `taskSpecSha` 非空但 `taskSpec=null` → 跳过检查，恢复到 PREPARE。
- 旧 digest/旧 sha 的简单篡改已被拒绝（R3-002 正面子项成立）；但“只有 `save()` 能重算摘要”这一前提没有被约束，所以完整性检查可被同进程调用者绕过。无密钥本地哈希链的固有限制已在 `docs/SECURITY.md` 声明，但公开 `save()` 使伪造门槛过低。

### 1.4 R4-005（HIGH）— 两个独立 verdict 对象会被接受，末尾 PASS 可覆盖前文真实 FAIL

- 位置：`src/policy.mjs:94-113`、`remote/p0_runner.py:140-161`。
- 实测：`parseAgentOutput('## report\n' + FAIL对象 + '\n' + PASS对象)` 返回 **PASS**（summary=`example after verdict`）；内联 `Example: {...}` 形式则被拒绝。
- 影响：报告含真实 FAIL 及末尾 PASS 示例/参考时，审核门会被误判为 PASS。解析器没有要求“只有一个 verdict 对象”或“终止对象是唯一 verdict 对象”。这不是测试结果误报，而是解析信任边界缺陷。

### 1.5 R4-006（MEDIUM）— 不可见 Unicode 前缀黑名单不完整

- 位置：`src/git.mjs:78-86`。
- 实测：`U+00AD.env`、`U+034F.env`、`U+180E.env`、`U+3164.env`、`U+2800.env` 均被 `commitWorktree` 接受；`U+200B.env` 被拒绝。
- 影响：这些不是 NTFS 上的字面 `.env` 别名，但视觉上近似 `.env`，绕过了“拒绝不可见/格式字符歧义路径”的防御意图。属 MEDIUM 加固缺口，不是已证明的字面 `.env` 提交。

### 1.6 已修复/已改善

- **R3-001 的部分**：独立 `Store.event()` 现在在 `BEGIN IMMEDIATE` 事务内先 `verify`，篡改状态被拒绝且不追加事件；`artifact()` 入口、`recordIntent/recordAck/recordTerminal`、`init` 均 fail-closed。
- **R3-003**：`run()` 在任何 live 预检前 `verify` 并拒绝 `NEEDS_RECONCILIATION`/`inflight`；缺 `P1_LIVE_ALLOWED` 时不再覆盖 stage/status/pendingHuman，不重派；旧“对账被覆盖”缺陷探针现在按预期失败（实际保持 NEEDS_RECONCILIATION）。
- **R2-009 主路径**：前导/尾随空格、tab、NBSP/em space、U+200B/FEFF/202A/2060、控制字符、全角/小全角点、全角斜线、rename 双向、copy、staged index、真实本地 submodule gitlink 全部被拒绝；正常文件（`foo.env`、`env`、`normal.txt`、`.gitignore`、`sub/normal.txt`、`my.env.txt`）正常提交。
- **R3-004/005**：`taskkill` 使用 `childEnv()`；远端 `Popen` 使用 `child_env(cfg)`；真实 submit/execute/harness 合成哨兵测试得到 `SENTINEL=ABSENT`。
- **R3-006/007**：CLI 换行已修；本地/远端 APPROVE_WITH_COMMENTS 的 LOW/MEDIUM/INFO/ADVISORY 与 HIGH 门禁一致；P0 `passed` 仍要求无未决 findings、两席不同物理节点；LOW 注释不会让 P0 通过。
- **R2-002/003/004/007/010**：孤儿/目录异常 fail-closed、inspect 单快照、WAL 副作用记录、Windows Python 7/7、双审成功席证据保留均保持。

---

## 2. R3-001～R3-008 逐项结论

| ID | 原严重度 | 结论 | 已核实 | 残余/未验证 |
|---|---|---|---|---|
| R3-001 | BLOCKER | **NOT_FIXED** | 独立 `event()`/artifact 入口/dispatch/init 均拒绝篡改；`event()` 在事务内 verify。 | **R4-001 `save()` 可重置预算；R4-003 artifact fsync 窗口可再封存。** 私有 `#trustedEventWrite` 不覆盖公开 `save()` 的任意 `t`。 |
| R3-002 | MEDIUM | **PARTIAL** | 旧 digest/旧 sha 被 `authorizeRecovery` 拒绝；超预算、改 policy、未决派发、非 BLOCKED、错误 basis 均拒绝。 | **R4-002**：重算 digest/sha、`frozen`/`taskSpec` 只有一个存在时可通过；无外部锚定。 |
| R3-003 | MEDIUM | **FIXED** | `run()` 先 verify，再拒绝 NEEDS_RECONCILIATION/inflight；缺 live flags 不改状态；失败预检只对 READY+非 inflight 置 BLOCKED；真实双审一成一败和 execute 失败均不重派。 | 无自动 reconcile 命令，仍需人工外部对账（fail-closed）。 |
| R3-004 | LOW | **FIXED** | `taskkill` 带 `env:childEnv()`；真实子进程看不到合成哨兵；timeout kill 仍生效。 | — |
| R3-005 | LOW | **FIXED** | `Popen` 带 `env=child_env(cfg)`；真实 submit/execute/harness 的 stdout 为 `SENTINEL=ABSENT`；mock kwargs 不含哨兵且含 PATH。 | 远端真实 OpenCode/凭据兼容 NOT_VERIFIED。 |
| R3-006 | LOW | **FIXED** | CLI help 两条 recover 命令为真实换行。 | — |
| R3-007 | MEDIUM | **FIXED** | 本地/远端 APPROVE_WITH_COMMENTS 的 LOW/MEDIUM/INFO/ADVISORY 保留，HIGH/unclassified 降 FAIL；PASS+任意 finding 拒绝；P0 单 LOW 席 + PASS 不通过，LOW+FAIL 为 dispute；单席/重复物理 ID 不成双机。 | 真实双机/600s 未验证。 |
| R3-008 | MEDIUM | **PARTIAL** | 缩进/pretty/CRLF/单终止围栏 JSON 接受；trailing prose、截断、非终止围栏拒绝；嵌套/内联示例不覆盖；最后一个独立对象为权威。 | **R4-005 HIGH：两个独立 verdict 对象时末尾 PASS 覆盖前文 FAIL。** R4-004 LOW：示例围栏+终止判决围栏整体拒绝。 |

**R3 统计：FIXED 5（R3-003/004/005/006/007）、PARTIAL 2（R3-002/008）、NOT_FIXED 1（R3-001）、NOT_VERIFIED 0。**

---

## 3. 原 F1–F10 回归

| ID | 结论 | 依据与残余 |
|---|---|---|
| F1 | **FIXED** | PASS+任意 finding/APPROVE_WITH_COMMENTS+HIGH/非法 verdict 拒绝；本地/远端与 P0 三重检查。 |
| F2 | **MITIGATED_FAIL_CLOSED** | 两席 quorum、第三席、取消、丢 ACK 离线通过；真实双机/600s/Linux 进程组 NOT_VERIFIED。 |
| F3 | **MITIGATED_FAIL_CLOSED** | 重复 key 字节、physicalId 不匹配拒绝；真实物理身份 NOT_VERIFIED。 |
| F4 | **FIXED** | `waitForFinish(3600000)` 数字参数；真实 SDK/daemon NOT_VERIFIED。 |
| F5 | **NOT_FIXED** | 11 Soul blob 与 provenance 一致，但 6 个 Soul 仍含 legacy APPROVE/REQUEST_CHANGES/Pro-Audit 文本；无法定 Markdown/JSON 交付物映射。 |
| F6 | **NOT_VERIFIED** | 仅权限声明/离线 fixture；Windows SID/ACL/网络/Job Object、TEST_ONLY 归并、真实 SDK/Harness 未验收。 |
| F7 | **PARTIAL** | 事务/事件链/证据哈希保持；**R4-001 `save()` 与 R4-003 artifact 窗口仍可再封存**。 |
| F8 | **PARTIAL** | 停线、R3-003 对账保护、无 Commit 恢复成立；**R4-001/R4-002 仍开放**。 |
| F9 | **PARTIAL** | Node/Git/Harness/taskkill/Popen 环境白名单成立；原始日志未脱敏、Windows ACL NOT_VERIFIED。 |
| F10 | **MITIGATED_FAIL_CLOSED** | 只读查询不创建、inspect 单快照、Windows liveness 已修；WAL 伴生文件按设计保留；真实进程树终止 NOT_VERIFIED。 |

**F 统计：FIXED 2、PARTIAL 3、MITIGATED_FAIL_CLOSED 3、NOT_FIXED 1、NOT_VERIFIED 1。**

**与上一轮（S0-R2，`f38604e`）的差异及理由：**

- **F9：MITIGATED_FAIL_CLOSED → PARTIAL。** 上一轮环境继承只做了部分修复；本轮 Node/Git/taskkill/Popen/Harness 全部最小环境已实测通过，但原始日志未脱敏、Windows ACL 未验证，故不能整体 FIXED，按 PARTIAL 记录。
- **R2-005：PARTIAL → FIXED。** 上一轮遗留的 `taskkill`/`Popen` 环境继承已修，并用合成哨兵真实子进程验证 `SENTINEL=ABSENT`；原始日志/ACL 仍作为 F9 的独立 NOT_VERIFIED 项。
- **R2-008：FIXED → PARTIAL。** 上一轮只覆盖“旧 digest/旧 sha”篡改；本轮发现 `save()` 可同时重算匹配 digest/sha，且 `taskSpec` 与 `taskSpecSha` 只有一个时跳过校验（R4-002）。
- **R2-010：PARTIAL → FIXED。** R3-003 已阻止 `run()` 覆盖 `NEEDS_RECONCILIATION`；本轮成功席 artifact/history/identity/summary/findings/raw 完整保留，失败席保持 ACKNOWLEDGED 且不重派；无自动 reconcile 仍作为残余操作风险。
- **R2-009：维持 PARTIAL。** 上一轮的 leading-space 绕过已修；本轮新增/保留不可见格式字符黑名单不完整（R4-006）与 Windows symlink EPERM NOT_VERIFIED。

---

## 4. R2-001～R2-010 回归

| ID | 结论 | 要点 |
|---|---|---|
| R2-001 | **PARTIAL** | run/approve/recover/artifact/dispatch 的直接篡改入口拒绝；**R4-001/R4-003** 仍可重置预算。 |
| R2-002 | **FIXED** | 登记失败孤儿、同名重试、evidence 目录异常、缺失/篡改证据全部 fail-closed；无自动修复。 |
| R2-003 | **FIXED** | 两连接确定性交错下 readSnapshot 单版本；rollback 干净。 |
| R2-004 | **FIXED（hardening）** | 只读 WAL 创建/保留 `-wal/-shm`，主库 SHA-256 不变；文档已声明。 |
| R2-005 | **FIXED** | Node/Git/Harness/taskkill/Popen 全部最小环境；真实哨兵正反测试通过；原始日志/ACL 另计 NOT_VERIFIED。 |
| R2-006 | **PARTIAL** | Markdown+JSON/legacy/PASS+findings 兼容已修；Soul 迁移、交付物映射仍缺失；**R4-005/R4-004 解析问题**。 |
| R2-007 | **FIXED** | Windows 原始 Python 7/7 PASS、exit 0；process_alive/status 六路径正确；cancel Windows UNCERTAIN。 |
| R2-008 | **PARTIAL** | `--basis` 三种早期 BLOCKED 恢复、CLI 端到端；旧 digest/sha 拒绝；**R4-002 重算摘要/不完整对可通过**。 |
| R2-009 | **PARTIAL** | 前导/尾随空格、不可见字符（黑名单内）、NFKC、rename/copy、staged index、真实 gitlink 全部拒绝；**R4-006 黑名单外不可见前缀可提交**；Windows symlink EPERM NOT_VERIFIED。 |
| R2-010 | **FIXED** | 成功席 artifact/history/agentId/verdict/summary/findings/raw 完整；失败席 ACKNOWLEDGED；不重派；R3-003 不再覆盖对账状态。 |

**R2 统计：FIXED 6（R2-002/003/004/005/007/010）、PARTIAL 4（R2-001/006/008/009）、NOT_FIXED 0、NOT_VERIFIED 0。**

---

## 5. 新发现汇总

| ID | 严重度 | 标题 | 关键位置 |
|---|---|---|---|
| R4-001 | **BLOCKER** | `Store.save()` 任意任务对象再封存，aRound/bRound 可重置 | `src/store.mjs:72-78` |
| R4-002 | **HIGH** | `assertFrozenIntegrity` 自洽检查；重算 digest/sha、不完整 TASK_SPEC 可通过恢复 | `src/controller.mjs:40-46,307-325` |
| R4-003 | **BLOCKER** | `artifact()` verify 在文件写入/事务外；并发篡改被 trusted 追加再封存 | `src/store.mjs:42-59` |
| R4-004 | **LOW** | 多围栏（示例+终止判决）整体拒绝，保守 fail-closed | `src/policy.mjs:94-113` |
| R4-005 | **HIGH** | 两个独立 verdict 对象被接受，末尾 PASS 覆盖前文 FAIL | `src/policy.mjs:94-113`、`remote/p0_runner.py:140-161` |
| R4-006 | **MEDIUM** | U+00AD/U+034F/U+180E/U+3164/U+2800 前缀可提交（非字面 .env 别名） | `src/git.mjs:78-86` |
| R4-007 | **LOW** | `validateStaged` 只复核 diff --cached 中的 symlink/gitlink，不复核 base 索引项 | `src/git.mjs:91-100` |

**残余统计：BLOCKER 2、HIGH 2、MEDIUM 1、LOW 2，共 7。**

---

## 6. 本机离线测试证据

完整命令、cwd、退出码、原始 stdout/stderr 见 `TEST_RESULTS.txt` 与 `TEST_SUMMARY.json`。

| 批次 | 用例 | PASS | FAIL | ERROR | SKIP | exit |
|---|---:|---:|---:|---:|---:|---:|
| `npm run check` | — | — | — | — | — | 0 |
| 原始 Node 全套 | 44 | 44 | 0 | 0 | 0 | 0 |
| 原始 Python 全套 | 7 | 7 | 0 | 0 | 0 | 0 |
| R4 写路径矩阵 | 12 | 12 | 0 | 0 | 0 | 0 |
| R3-002/003 恢复/对账 | 12 | 12 | 0 | 0 | 0 | 0 |
| R2-009 路径矩阵 | 50 | 50 | 0 | 0 | 0 | 0 |
| R3-004/005 Node 环境 | 5 | 5 | 0 | 0 | 0 | 0 |
| R3-007 P0 语义 | 6 | 6 | 0 | 0 | 0 | 0 |
| R3-006/008 本地解析 | 8 | 8 | 0 | 0 | 0 | 0 |
| R3-005/007/008 Python 远端 | 10 | 10 | 0 | 0 | 0 | 0 |
| R2-002/003/004 回归 | 10 | 10 | 0 | 0 | 0 | 0 |
| R2-006/Soul 回归 | 14 | 14 | 0 | 0 | 0 | 0 |
| R2-010 回归 | 4 | 3 | 1 | 0 | 0 | 1 |
| F1–F10 回归 | 12 | 12 | 0 | 0 | 0 | 0 |
| **合计** | **194** | **193** | **1** | **0** | **0** | — |

**口径说明：**

- 探针 PASS 表示断言成立；R4-001/R4-003/R4-002/R4-005/R4-006 等是缺陷复现探针，PASS 表示缺陷被确认，**绝不表示产品通过**。
- `regress-r2-010-pair` 的唯一失败是**上一轮缺陷复现探针**：它期望 NEEDS_RECONCILIATION 被覆盖为 BLOCKED；实际保持 NEEDS_RECONCILIATION（R3-003 已修）。这是正向结果，不是产品失败。
- 未做真实 Paseo SDK/远端 OpenCode/SSH/P0/真实模型调用；`P1_LIVE_ALLOWED` 只在个别夹具中设置/删除，不构成安全证明。
- GitHub CI 42428999820 的 44/44 Node、7/7 Python 仅作参考，本机独立结果见上。

---

## 7. 独立 CLI 审查与交叉验证

### 7.1 Codex

- 调用：`codex exec -s read-only --skip-git-repo-check --ephemeral -C offline-copy -o CODEX_REPORT.md -`，stdin 为 `PROMPT_FOCUSED.md`。
- 结果：**NOT_AVAILABLE**，exit 1，账户配额限制：`You've hit your usage limit ... try again at Nov 10th, 2026 3:58 PM.` 原始 stderr 保留在 `cli_reports/codex.stderr.log`；未生成报告。

### 7.2 OpenCode

- 调用：`opencode run --dir offline-copy --agent p1-audit --model magpie/group/deepseek-v4-pro --format default`，输入 `PROMPT_FOCUSED.md`（只读 6 个核心文件、6 个定点问题）。
- 结果：**VALID**，exit 0，3044 bytes；原始输出 `OPENCODE_REPORT.md`，stderr `opencode.stderr.log`。
- 独立结论：`CODE_VERDICT: FAIL`；确认 `save()` re-anchor、`artifact()` fsync 窗口、R3-002 自洽检查/不完整 pair、R3-003 对账保护；指出不可见字符黑名单缺口、末尾 PASS 覆盖前文 FAIL、`validateStaged` 只复核 diff --cached。
- 两席互不喂意见；主审在独立完成源码审查、194 项测试与探针后才读取 OpenCode 报告。

### 7.3 交叉验证

见 `CROSS_REVIEW_VALIDATION.md`。逐条复核结果：OpenCode 的 R4-001/R4-003/R3-002/R3-003 意见 **CONFIRMED**；不可见字符 **CONFIRMED（MEDIUM 加固缺口，非字面 .env 别名）**；末尾 PASS 覆盖前文 FAIL **CONFIRMED（R4-005 HIGH）**；`validateStaged` base 索引项 **STATIC_CONFIRMED，NOT_VERIFIED**。无 REFUTED 的安全结论。

---

## 8. 必须继续保持的 BLOCKED / NOT_VERIFIED

1. **R4-001/R4-003** 写入口再封存/预算重置未修；R3-001 不能判 FIXED。
2. **R4-002** 重算摘要/不完整 TASK_SPEC 可通过恢复；R3-002 只能判 PARTIAL。
3. **R4-005** 末尾 PASS 可覆盖前文真实 FAIL；解析信任边界未闭。
4. **R4-006** 黑名单外不可见前缀可提交（非字面 `.env`，但视觉近似）。
5. Windows 不同进程身份/SID、文件 ACL、网络与 Job Object 未真实验收。
6. TEST_ONLY 新增测试、独立审查及归并到最终 Commit 的完整闭环未完成。
7. 真实 Paseo SDK/daemon 认证、超时/断连、Agent 生命周期、真实远端 OpenCode JSONL/权限/作业生命周期未验收。
8. 两台真实物理 P0 主机、可信主机/密钥映射、真实第三席 600 秒、Linux 进程组取消未验收。
9. Windows symlink（120000）提交拒绝因宿主 EPERM 未能执行；base 索引中的 pre-existing symlink/gitlink 未复核。
10. OS 崩溃/断电、多进程压力、外部不可变锚定、审批主体认证、Soul V2.1 迁移与法定交付物映射未完成。

**处理原则：上述任一项未满足，真实执行必须 fail-closed；不得以离线测试 PASS、CI PASS 或模型意见解除。**

---

## 9. 只读审计边界声明

### 已确认未执行

- 未修改被审仓库源码；未修改 main、PR #1/#2/#3、修复分支或历史证据分支；仅向新建 `audit/s0-fa157e1-evidence` 分支新增 `audit/evidence/` 文件。
- 未启动、停止、更新、配置、接管 Paseo App/Daemon；只读探测到 3 个 Paseo.exe 进程及 updater installer。
- 未 SSH 到 5bao/9bao/rusty；未做远端 P0/A2A；未分发密钥。
- 未调用真实 Paseo SDK/Harness 做联调；OpenCode 仅作独立静态审查（模型/命令/退出码已保留），Codex 因配额失败；二者均未参与真实工作流执行。
- 未修改 Hermes、Codex、OpenCode、Magpie/代理、系统 PATH、服务或用户工作目录；未读写真实密钥值。
- 未部署、未合并、未自动清理生产状态。

### 已执行

- `git clone/fetch/rev-parse/cat-file/diff/ls-tree/hash-object` 只读；`git archive` 固定 Commit 到隔离 `offline-copy`。
- `npm run check`、`npm test`、`python -B -m unittest ...`、自写 Node/Python 对抗探针；一次性本地 Git 仓库、临时 SQLite、fake SDK/P0。
- 本机 Codex/OpenCode 只读审查（read-only sandbox / 只读 agent）。
- 证据仅写入本机临时工作区和新建 `audit/evidence/fa157e1.../`。

### 环境完整性（本审计前后）

| 文件 | 审计前 SHA-256 | 审计后 SHA-256 | 结论 |
|---|---|---|---|
| `C:\Users\KK\.codex\config.toml` | `28ef096584cdb51edee96c8a8182afadc5774bbcfc8b16813ac6532406657944` | 同左 | 本审计前后未变 |
| `C:\Users\KK\.config\opencode\opencode.jsonc` | `1652e9626f1dbee1c505fb539a96b6145bf59173f879e0fed174e5678c3a40ea` | 同左 | 本审计前后未变 |
| `C:\Users\KK\AppData\Local\hermes\config.yaml` | `21dea749e82a00ff9750c279f2dbeff3e64dbe745ad9d5640823fb7bf6b99bba` | 同左 | 本审计前后未变 |

> 与上一轮记录相比，Codex/OpenCode 配置哈希已变化（外部会话改动），不是本审计造成；本审计只保证本轮前后一致。

- Paseo 只读探测：`Paseo.exe` PID 9636/10164/12000；`%LOCALAPPDATA%\@getpaseodesktop-updater\installer.exe` 145,569,446 bytes；不在 PATH；未发现 Programs/Roaming 安装目录。未做任何启动/停止/更新/配置动作。

---

## 10. 交付物与固定链接

- 仓库：https://github.com/k176060444-lgtm/Paseo-workflow
- 被审固定 Commit：https://github.com/k176060444-lgtm/Paseo-workflow/commit/fa157e1ce53374d539f4b5b5aa1129eccad7cb3b
- 证据分支：`audit/s0-fa157e1-evidence`（以 `fa157e1` 为基线，仅新增 `audit/evidence/`）
- 证据根目录：`audit/evidence/fa157e1ce53374d539f4b5b5aa1129eccad7cb3b/`
- 本报告：`.../AUDIT_REPORT.md`
- 机器可读发现：`.../FINDINGS.json`
- 测试结果：`.../TEST_RESULTS.txt`、`.../TEST_SUMMARY.json`
- 交叉验证：`.../CROSS_REVIEW_VALIDATION.md`
- 环境完整性：`.../ENVIRONMENT.json`
- 证据清单：`.../EVIDENCE_MANIFEST.json`
- 独立报告：`.../OPENCODE_REPORT.md`（有效，exit 0）、`.../CODEX_REPORT.md`（配额失败记录）
- 完整 ZIP：`.../Paseo-S0-R3-fa157e1-Review.zip`

**最终判定：** 代码 **FAIL**；离线测试全过不等于产品验收；真实集成 **BLOCKED**。在 R4-001、R4-003、R4-002、R4-005 以及第 8 节各项关闭前，不得进入 S1/S2 或真实工作流执行。等待用户下一步授权。