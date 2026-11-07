# Paseo-workflow 固定提交 `6c57a3d8` 只读审计报告

## 0. 审计边界与证据

- 目标 Commit：`6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4`；基线：`8fe13211271dabc4de7a7ba02b9853f3d6196979`。
- 本次为**只读静态审计**：未调用工具、未运行测试、未联网、未调用模型/SDK/SSH/远端，也未实施 S1。
- 本次没有另一名审计员的报告可供参考，也不猜测其意见。
- 给定 `logs/node-full.stdout.log` 显示 25/25 pass；`logs/python-full.stderr.log` 显示 1 test、1 ERROR。以上均为**引用给定日志，不是本次亲自执行**。
- `P1_LIVE_ALLOWED`、`P1_HOST_ISOLATION_ATTESTED` 是人工开关，不是认证；目录存在、JSON 字段、SQLite 记录、HMAC key 路径同样不是物理身份或 OS 隔离证明。`docs/SECURITY.md:32` 亦说明测试使用假 Agent、假 P0、假 Git。

## 1. 总判定

**INCONCLUSIVE，不得判 PASS；部署与真实调用 BLOCKED；不建议进入 S1。**

源码层较基线明显改善：F1、F3 的密钥内容去重、F4 的源码参数、F7 的账本绑定、F10 的只读查询均已落地，并可由给定 Node 日志间接佐证。但 F2 仍有已受理作业泄漏窗口，F8 恢复链未闭环，F9 原始日志边界未解决，F5 契约迁移未完成；F6、F3 的物理身份、F4 的真实 SDK、远端 OpenCode 与进程组取消全部 **NOT_VERIFIED/BLOCKED**。给定 Python 远端 Runner 测试实际为 ERROR，不能作为远端闭环证据。

## 2. F1–F10 逐项判定

| 项 | 判定 | 级别/残余 | 依据 |
|---|---|---|---|
| F1 审查员 PASS+BLOCKER | **FIXED** | 原 BLOCKER 已关闭 | `policy.mjs:92-107` 规范化并拒绝 PASS 携带 findings/阻断项；`controller.mjs:70-72,98-99` 双重校验；`p0.mjs:56` 拒绝 P0 矛盾 PASS。给定日志 F1 两条用例 pass。 |
| F2 第三席故障/取消 | **MITIGATED_FAIL_CLOSED** | HIGH 残余 | `p0.mjs:66-78` 探针失败可跳过；`117-133` 增加 cancel 与回执；丢 ACK 阻断。但 submit/status 失败时已受理作业仍未取消，见 D2。 |
| F3a 相同密钥不同路径 | **FIXED** | — | `p0.mjs:31-38` 按密钥内容 SHA-256 去重；给定日志 F3 用例 pass。 |
| F3b 物理身份 | **NOT_VERIFIED** | BLOCKED | `p0.mjs:29-30,50,57-58` 仍以配置 `physicalId` 与密钥持有为身份声明；远端 probe 只回传配置值，不能证明不同物理机。 |
| F4a 源码超时参数 | **FIXED** | — | `agents.mjs:28` 已改为数字 `waitForFinish(60*60*1000)`；给定日志 F4 用例 pass。 |
| F4b 真实 SDK/模型 | **NOT_VERIFIED** | BLOCKED | 未连接 Paseo 0.15.2、未调用真实 Provider/模型；假 client 测试不能替代真实联调。 |
| F5 Soul/JSON/调度契约 | **NOT_FIXED** | 部分缓解 | `policy.mjs:96-99` 仅兼容 `APPROVE/REQUEST_CHANGES`；Soul 的 Markdown 交付物、Pro-Audit 文字、`NOT_TRIGGERED` 记录仍未对齐，`docs/SOUL_V21_MIGRATION_PENDING.md` 明确未批准。见 D6。 |
| F6 OS 隔离/TEST_ONLY/真实远端 | **NOT_VERIFIED** | BLOCKER | `policy.mjs:75-87` 只是 Provider 权限字段；`git.mjs:74-85` 仍在继承环境执行测试；`docs/SOUL_V21_MIGRATION_PENDING.md:11` 明确 TEST_ONLY 新增/归并未完成。 |
| F7 派发账本/事件链 | **FIXED** | 外部锚定 NOT_VERIFIED | `store.mjs:27-32,62-68,73-77,104-122` 将 dispatch/artifact 哈希纳入事件并由 `verify` 校验；`recordIntent` 事务化。给定日志 F7 用例 pass；但 `docs/SECURITY.md:16` 承认特权者可重写整链。 |
| F8a 预检/违规停线 | **FIXED** | — | `controller.mjs:242-253` 预检在锁内，失败进入 BLOCKED；`258-267` 异常按 uncertain 分流。 |
| F8b 恢复闭环/锁残留 | **NOT_FIXED** | HIGH 残余 | `controller.mjs:280` 恢复仅接受 BLOCKED；`policy.mjs:16-17` 将 NEEDS_RECONCILIATION 列为终态；`cli.mjs:27,44` 与 `controller.mjs:284` 使无 Commit 的早期阻断无法恢复；`store.mjs:124-132` 崩溃遗留锁。见 D1、D4。 |
| F9 Secret 边界 | **NOT_FIXED** | 部分缓解 | `git.mjs:8-14`、`remote/p0_runner.py:26-36` 已做环境白名单，给定 F9 用例 pass；但 `git.mjs:80`、`agents.mjs:32`、`p0_runner.py:197-198` 仍持久化原始 stdout/stderr/raw，无脱敏；Windows ACL 未验证。 |
| F10a status/verify 只读 | **FIXED** | — | `cli.mjs:36` 以 readOnly 构造 Store；`store.mjs:7-13` 在只读模式拒绝建目录/建库；给定 F10 用例 pass。 |
| F10b 进程树/工作树 | **NOT_VERIFIED** | BLOCKED | `git.mjs:19-27` 仍用 `taskkill /T /F`，无 Windows Job Object；worktree 创建、测试命令副作用与真实进程组取消未实测。 |

未发现明确 **REGRESSION**。

## 3. 详细缺陷（六项）

### D1 — HIGH：F8 恢复链死路，不确定状态与无 Commit 阻断无法受控恢复

- 位置：`src/controller.mjs:69,128,257,278-284`；`src/policy.mjs:16-17`；`src/cli.mjs:27,44`。
- 静态事实：`invoke` 捕获异常后把状态置为 `NEEDS_RECONCILIATION`；`authorizeRecovery` 只接受 `stage==='BLOCKED'`；`NEEDS_RECONCILIATION` 又是 TERMINAL，后续 `run` 也不会继续。另在 PLANNER/PREPARE 早期被 BLOCKED 时 `currentSha` 为 null，而 CLI 的 `need('sha')` 拒绝空值，`assert(t.currentSha===expectedSha)` 无法满足。
- 影响：一次 Runtime/SSH 不确定异常即可让任务永久无法通过现有 CLI 恢复，只能手工改库，违背“人工收据受控恢复”的审计要求。属可用性与证据闭环缺陷，不是自动放行。
- 可复核步骤（静态，未执行）：用假 runtime 令 `execute` 抛错，观察 `NEEDS_RECONCILIATION` 后调用 `recover`；再构造 PREPARE 阶段 BLOCKED，检查 `--sha` 无法匹配 null。两者均会触发断言失败。
- 最小修复：增加显式 `reconcile` 流程，要求核对所有 dispatch 为 TERMINAL、inflight 为空并保存人工收据后，才允许 `NEEDS_RECONCILIATION → BLOCKED` 或重验阶段；对尚未产生 Commit 的阶段允许 `expectedSha` 为空并记录原因。

### D2 — HIGH：F2 已受理 P0 作业在 submit/status 失败时未被取消

- 位置：`src/p0.mjs:81-95`（submit 循环）、`97-110`（轮询）、`117-133`（取消仅在循环正常结束后执行）。
- 静态事实：任一节点 `ssh(submit)` 抛错或 ACK 断言失败时，前面已 `ACCEPTED` 的节点不会进入轮询，也不会被 cancel；轮询中遇到 `FAILED/UNKNOWN/CANCEL_REQUESTED` 时直接抛出，同样不取消其他仍在运行的作业。
- 影响：两席已受理、第三席 submit 丢 ACK 时，整个 P0 失败关闭，但已付费作业继续运行，且缺乏取消回执；与 F2 的“可对账闭环”目标不符。
- 可复核步骤（静态，未执行）：用假 SSH 记录调用序列，节点 1/2 返回 ACCEPTED、节点 3 submit 抛错；或在节点 3 status 返回 FAILED 时检查是否出现 cancel 调用。预期没有。
- 最小修复：将 submit/poll 包入 try/finally，对所有非终态 job 逐个 best-effort cancel 并保存回执；cancel 不明确时保留 `NEEDS_RECONCILIATION`，禁止静默放行。仅在全部未完成可选作业已取消并留证后，才允许两席 quorum 完成。

### D3 — MEDIUM：F9/F10 关联，Git 重命名条目可绕过敏感路径检查

- 位置：`src/git.mjs:55-62`。
- 静态事实：`git status --porcelain -z` 的重命名条目由两个 NUL 分隔路径组成，第二个路径没有 3 字符状态前缀；代码对所有条目统一 `e.slice(3)`，会截断第二个路径。随后敏感文件名正则与 symlink 检查只作用于被截断/错误路径。
- 影响：将已跟踪的 `id_rsa`、`.env` 等敏感名重命名为普通名时，原名可能不被检查；`git add --all` 后仍可能进入 Commit。属防御绕过风险，实际可利用性需在临时仓库确认。
- 可复核步骤（静态，未执行）：在临时副本构造“敏感名 → 普通名”的重命名，读取 `status --porcelain -z` 的原始字节，确认第二个路径经 `slice(3)` 后不再匹配正则。
- 最小修复：按 porcelain v1 `-z` 正确解析普通条目与 rename/copy 条目，检查新旧两个路径；或 `git add` 后以 `git diff --cached --name-status -z` 复核全部路径，并同时检查 symlink 类型。

### D4 — MEDIUM：F8 锁文件崩溃残留且无受控解锁入口

- 位置：`src/store.mjs:124-132`。
- 静态事实：锁文件以 `'wx'` 创建，正常结束在 `finally` 删除；进程崩溃或被杀时文件残留，后续 `withLock` 直接 `EEXIST`。注释称“需外部人工核对”，但代码与 CLI 没有对应的受控解锁命令。
- 影响：一次控制器崩溃即可阻断 `run/approve/recover`，操作者只能手工删锁，缺少审计收据，可能误删活跃锁。
- 可复核步骤（静态，未执行）：在临时状态目录打开锁后强杀进程，再执行任意 `withLock` 路径，观察 `EEXIST`。
- 最小修复：锁文件写入 PID/创建时间；冲突时校验 PID 存活，提供 `unlock --receipt` 人工受控解锁并写事件；或改用 OS 级 advisory lock 并定义超时策略。

### D5 — MEDIUM：F7/F8 关联，双审一成一败时成功审查的证据被丢弃

- 位置：`src/controller.mjs:84-89`。
- 静态事实：`Promise.allSettled` 后只要任一 rejected，就只保存 `errors` 并置 `REVIEW_PAIR_UNCERTAIN`；成功那一席的 `agentId/verdict/findings` 未写 artifact、未进 history、未记录逐席终态。
- 影响：恢复时无法知道哪一席已完成、其结论是什么；已成功的付费审查结果丢失，证据链不完整。Gate 仍会阻断，但属审计与对账缺陷。
- 可复核步骤（静态，未执行）：假 runtime 令 spec_reviewer resolve、quality_reviewer reject，检查 `REVIEW_PAIR_UNCERTAIN` 事件中是否只有 errors、无成功结果。
- 最小修复：对每个 settled 结果分别落 artifact、history 与逐席 dispatch 终态；失败项记录角色与错误；全部登记后再抛出不确定性错误。

### D6 — LOW：F5 仲裁未触发未留痕，Soul 文字仍与调度契约冲突

- 位置：`src/controller.mjs:205-208`；`docs/SOUL_V21_MIGRATION_PENDING.md:8`；`souls/worker_remediation.md:32`。
- 静态事实：无争议时 `B_TEST` 直接进入 `READY_FINAL`，没有记录 `ARBITRATOR_NOT_TRIGGERED`；迁移文档明确要求记录该事件。Soul 仍写“不绕过后续 Tester B 与 Arbitrator”，而控制器只在 `p0Dispute` 时调用仲裁。
- 影响：最终案卷无法证明仲裁为何未触发，Soul 与程序行为不一致；不构成安全放行，但影响合规可追溯性。
- 可复核步骤（静态，未执行）：按给定 happy-path 日志的流程检查账本，预期只有 `P0_FINAL_PASS`/`GATE_B_TEST_PASS`，无仲裁未触发事件。
- 最小修复：在无争议路径写 `ARBITRATOR_NOT_TRIGGERED` 事件并附原因；待用户批准 Soul V2.1 后，在单独提交中统一 `worker_remediation` 与仲裁描述。

## 4. 固定 BLOCKED/NOT_VERIFIED 的验收项

- **BLOCKER（验收）**：Windows OS 级只读、网络/文件隔离、TEST_ONLY 新增测试与归并最终 Commit——**BLOCKED/NOT_VERIFIED**。当前 TEST_ONLY 在 Agent 侧实际降为只读，Controller 只执行冻结命令；`docs/SOUL_V21_MIGRATION_PENDING.md:11` 明确完整链路未实现。
- **BLOCKER（验收）**：真实 Paseo SDK、真实模型/Provider、Soul 注入、远端 OpenCode JSONL 适配——**NOT_VERIFIED**。给定 Node 日志使用假 Agent/fake P0（`docs/SECURITY.md:32`），不能替代真实联调。
- **BLOCKER（验收）**：5bao/9bao 物理身份与 SSH 主机密钥、两席/第三席真实 600 秒行为——**NOT_VERIFIED**。HMAC 只能证明密钥持有；`physicalId` 仍是配置声明。
- **BLOCKER（验收）**：Windows 进程组/进程树取消——**NOT_VERIFIED**。`taskkill /T /F` 无 Job Object 实测；远端 `os.killpg` 仅 Linux 路径。
- 给定 Python 日志中 `test_native_harness_durable_job_and_hmac` 为 ERROR（`status` 命令退出 1，并伴随 Windows 临时目录删除失败），说明远端 Runner 的 status/临时工作树路径尚未通过；不能引用为远端闭环证据。

## 5. 结论

固定提交在源码层修复了 F1、F3 密钥复用、F4 参数、F7 账本绑定和 F10 只读查询，F2 也改为失败关闭并加入取消路径；但仍不能判 PASS。D1/D2 是 HIGH 级恢复与作业生命周期缺陷，D3–D6 是证据与边界缺陷；F6、物理身份、真实 SDK/远端 OpenCode、TEST_ONLY 归并及进程组取消仍为 BLOCKED/NOT_VERIFIED。建议保持部署停线，先完成上述最小修复与真实隔离验收，再考虑进入 S1。