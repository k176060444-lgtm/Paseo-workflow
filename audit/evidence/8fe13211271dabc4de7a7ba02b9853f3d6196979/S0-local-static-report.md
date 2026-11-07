# Paseo-workflow S0 本地静态审计与离线探针（未完成版）

审计对象：`k176060444-lgtm/Paseo-workflow`，固定 `8fe13211271dabc4de7a7ba02b9853f3d6196979`。审计时间：2026-11-07，中国时间。总判定：**S0 INCONCLUSIVE；部署与真实调用 BLOCKED**。发现可复现的控制逻辑缺陷，Windows OS 隔离及真实双机身份均没有验收证据。

本报告由当前本地 Agent 完成，**不是 Codex CLI 独立报告，也不是 OpenCode 独立盲审报告**。本次未运行真实或付费模型；两份指定独立报告未产生，不能用本报告冒充。以下“模拟”均用内存替身和合成密钥，不访问真实节点、模型、数据库或网络。

## 1. 基线、范围与证据

- GitHub `main` 在开始及后续核验均为 `8fe13211271dabc4de7a7ba02b9853f3d6196979`；源码与测试副本 detached HEAD 均为该 SHA，两个副本的 `git status --porcelain` 均为空。
- Git tree 共有 **34 个文件**；逐文件 SHA-256 与 Git Blob 在 `source-manifest.json`，34/34 工作树字节与固定 Commit Blob 匹配。
- 11 份 Soul 的仓库 Blob 均与 `docs/SOUL_PROVENANCE.md` 所列上游固定 Commit 的相同路径匹配，11/11；详见 `soul-provenance-receipt.json`。
- 已逐文件读取 `src/`、`remote/`、`tests/`、`souls/`、`config/`、`docs/`，并检查 README、package.json、CI 和 .gitignore。语法检查与局部探针均不能代替完整 S0 双席和独立动态审计。
- 证据分类：**源码确认**表示已读固定代码；**离线模拟**表示实际运行被审模块、调用外部依赖时使用内存替身；**NOT_VERIFIED**表示未经过目标环境实测。不得将模拟写成物理节点、实际模型或生产验收通过。

## 2. 实际命令及结果

环境：Windows 10 `10.0.19044`，Node `v26.6.0`，npm `11.18.0`，Git `2.54.0.windows.1`，Python `3.14.7`；OpenCode `1.19.3`；`D:/codex/codex.cmd --version` 输出 `codex-cli 0.166.0`（裸 `codex` 不在当前 PATH）。未打开 Paseo、远端节点或模型。

| 命令 | 真实结果 | 限制 |
|---|---|---|
| `node --version` | exit 0，`v26.6.0` | 仅本机运行时 |
| `npm run check` | exit 0 | 七个 JS 文件语法检查；npm 临时缓存放入审计 scratch |
| `python3 -m unittest discover -s remote/tests -v` | exit 127，`python3: command not found` | 原命令实际失败，无任何 Python 测试被执行 |
| `npm test` | NOT_RUN | 测试创建 SQLite，并在结束时递归删除目录、删除 Controller 锁；当前“禁止 cleanup”及临时数据库写入确认边界尚未协调 |
| `python -m unittest discover -s remote/tests -v` | NOT_RUN | 源码中的测试会执行临时 `git commit` 和 `TemporaryDirectory` 删除；不能把存在的 `python` 当作这条测试已通过 |
| `node --test --test-name-pattern=permission policy is code-fixed tests/controller.test.mjs` | exit 0；1 case，1 pass，0 fail | 仅验证 providerOptions 的几个返回字段；不证明沙箱或系统权限生效 |
| `node <scratch>/synthetic_probe.mjs` | exit 0，6 组离线模拟 | 动态结果见 `synthetic-probe-receipt-v2.json`；模拟 third grace 为 0 毫秒，不代表 600 秒实测 |

上述命令的原始 stdout、stderr、退出码与耗时分别见 `official-command-receipts.json`、`selected-safe-test-receipt.json`、`synthetic-probe-receipt-v2.json`。审计脚本和证据均在单独 scratch；未修改固定版本代码。

## 3. 关键发现

### F1 — BLOCKER：审查员输出 BLOCKER 时仍可推进 Gate A

- 证据：`src/controller.mjs:87-96,151-156` 仅根据审查 verdict 判定 `pass`，同时收集 `findings`，但 verdict 为 PASS 时不检查 findings；`src/policy.mjs:96-102` 只要求 findings 为字符串数组。
- 离线复现：`synthetic_probe.mjs` 向实际 `WorkflowController.step` 输入 spec reviewer 的 `PASS` + `BLOCKER: synthetic critical defect`，另一审查员 PASS；实际阶段变为 `A_TEST`，状态 READY。
- 影响：矛盾的审查结果可继续流转；此探针不证明任何真实模型会产生该结果。
- 修复方向：冻结发现严重度及阻断规则，拒绝 PASS 与阻断发现自相矛盾的结果，留存并验证真实审查证据；增加反例回归。

### F2 — BLOCKER：可选第三席故障中断双席，且无取消/对账闭环

- 证据：`src/p0.mjs:45-66,73-80,83-90` 顺序提交和轮询，任一 SSH 错误直接抛出；`remote/p0_runner.py:141-145` 只提供 submit/status/execute，无 cancel。
- 离线复现：前两席模拟返回 ACCEPTED、第三席 submit 抛异常后，记录仅有三个 submit，无任何 status/撤销，review 直接抛错；另一个探针在设置 `extraThirdMs=0`、第三席 RUNNING 时返回双席 PASS，调用序列没有 cancel。
- 影响：启用的可选第三席不可用时，已受理的前两席无法按本次调用完成收集；第三席超过等待窗口时其工作可继续运行且迟到结果不会进入这次裁决。真实 600 秒、后台进程与成本均未测试。
- 修复方向：明确第三席可用性策略；对每席独立追踪持久提交、查询与取消意图，确保已受理作业可对账；执行真正的双席、第三席恢复、迟到及丢 ACK 注入测试。

### F3 — BLOCKER：不同路径的相同 HMAC 密钥可通过，物理身份仅来自配置

- 证据：`src/p0.mjs:25-44` 验 MAC，检查的是 `hmacKeyPath` 字符串互不相同；通过后从 `node.physicalId` 复制身份。`config/role-matrix.example.json:20-23` 中 physicalId 为人工配置。
- 离线复现：两个模拟节点使用不同假路径，但内容均为相同的 40 字节合成 key；均返回有效 HMAC，实际 `passed=true`、报告 2 份、physicalId 分别为 `configured-0/1`。
- 影响：代码不会发现跨节点密钥复用，也不能从配置字符串证明两台不同物理机；不表示真实设备一定复用了密钥。
- 修复方向：校验每节点密钥的独立性，防止读取或记录原始密钥；主机密钥绑定与物理节点证明另走用户认可的人工或硬件证据链。真实 SSH known_hosts、5bao/9bao 物理身份均 BLOCKED。

### F4 — HIGH：Paseo 0.15.2 等待函数的超时参数类型错误

- 证据：`src/agents.mjs:28` 调用 `agent.waitForFinish({timeoutMs:60*60*1000})`。仓库链接的上游 Paseo 源码固定于 `6c1b48d2962ec6a48d5a553e312dfcc1f94e2e7a`，其 `packages/client/package.json` 声明版本 0.15.2；`packages/client/src/index.ts:391,1008-1012` 接收 `timeoutMs?: number` 并原样传下去；`daemon-client.ts:6497-6511,7687-7695` 使用 `Number.isFinite(timeout)`，非数字时不向服务器发送 timeoutMs，客户端等待 timeout 设 0、不给等待器装定时器。
- 离线复现：用假 client 调用实际 `PaseoAgentRuntime.execute`，捕获实参为对象 `{timeoutMs:3600000}`，`Number.isFinite(arg) === false`。
- 影响：客户端没有设置预期的一小时等待限额；服务端具体行为、实际运行时表现尚未实测，不能断言必定永久卡死。
- 修复方向：按真实 0.15.2 API 传数字并验证超时、断连、后台 Agent 和人工对账；不要用假 client 结果代替真实 SDK 联调。

### F5 — HIGH：历史 Soul 与 JSON 判决/调度契约不一致

- 证据：`souls/spec_reviewer.md:21-24` 和 `quality_reviewer.md:21-24` 允许 `APPROVE` / `REQUEST_CHANGES`；`src/policy.mjs:92-100` 仅接受 PASS/FAIL/QUESTION/NEEDS_SPECIALIST/APPROVE_WITH_COMMENTS。`souls/worker_remediation.md:32` 要求不绕过 Arbitrator，而 `src/controller.mjs:200-203` 只在 dispute 时仲裁；`souls/arbitrator.md:19` 仍要求 Pro-Audit 记录。`souls/blind_*.md:14-15` 指向外部 A2A，而目标 P0 是 SSH Runner。
- 离线复现：调用实际 `parseAgentOutput`，`APPROVE` 与 `REQUEST_CHANGES` 均报 invalid verdict；PASS/FAIL 接受。
- 影响：合法历史 Soul 判决可能被当作不可信输出而阻断；多处角色文字与本次目标流程冲突。不能把 Controller 声称优先当作用户已批准更改 Soul。
- 修复方向：先形成字段、判决和交付物映射及 V2.1 差异清单，由用户审阅批准；随后再验证 Soul 注入和原文证据保留。

### F6 — BLOCKER：TEST_ONLY、审查角色和外部测试命令无已验证 OS 隔离

- 证据：`src/policy.mjs:75-87` 对 Tester 使用 provider READ_ONLY；`src/controller.mjs:98-106` 调用测试命令；`src/git.mjs:6-8,61-78` 在进程继承环境、无 OS 级网络/文件隔离下执行命令，测试后不再次固定工作树内容；`remote/p0_runner.py:92-125` 继承环境并仅用 Git status 和 HEAD 判断 clean。`docs/SECURITY.md:8-11,20-26` 已明确这些限制。
- 影响：Git worktree、模型权限字段和 clean 状态无法证明系统只读、外部文件/网络无副作用，或完整 TEST_ONLY 新增测试并合入最终 Commit；忽略文件和工作树外写入不由 Git status 覆盖。
- 修复方向：先设计并审批 Windows OS 权限、网络和子进程隔离；允许新增测试的范围、评审/归并与最终 P0 绑定需实现和单独验证。当前未做 OS ACL 或进程树实测。

### F7 — HIGH：派发账本和事件链不覆盖所有状态、并发写存在窗口

- 证据：`src/store.mjs:26-30` 初始化任务与 CREATED 事件分开；`36-43` 的 task save 有事务，但 `52-60` 派发记录和事件分开写；`62-71` 验事件链和最后的 task hash，不覆盖 dispatches 行或证据文件内容，而且无事件时不会报错；`73-79` 只在调用 withLock 时生效。`src/cli.mjs:40-52` 的 approve/recover 并不通过该 run 锁。
- 影响：崩溃或并发时可能出现派发状态与事件不一致；数据库或证据被特权用户修改也不是不可篡改证明。以上为源码推断，未做 SQLite 故障注入或并发实测。
- 修复方向：把派发状态与事件置于同一事务、对所有修改入口使用统一互斥及版本校验；核对证据哈希并引入外部锚点，测试断电与并发交错。

### F8 — HIGH：违规状态和恢复路径未闭环

- 证据：`src/controller.mjs:40-45,46-60,238-251` 的 preflight 在 run 锁及阶段错误处理之前；合规断言失败直接抛出，并非统一进入 BLOCKED；`260-273` 的人工恢复只接受 stage 为 BLOCKED，而不是 NEEDS_RECONCILIATION。`src/store.mjs:73-79` 的锁文件若进程崩溃可残留。
- 影响：代码有失败停下机制，但不能由此证明所有违规均生成可审计 BLOCKED 及能按批准恢复；未知状态不自动重派的常规防线存在，真实崩溃、失联与恢复未测。
- 修复方向：按错误类别冻结状态迁移和收据，覆盖 preflight、丢 ACK、锁残留、人工核对后恢复，禁止把不确定作业直接重派。

### F9 — HIGH：原始日志及继承环境缺少证明过的 Secret 边界

- 证据：`remote/p0_runner.py:95-104,116-139,168-170` 把继承环境交给 Harness，并写原始 stdout/stderr/runner.log；`src/git.mjs:6-8,61-68` 继承环境并持久化测试输出；`src/agents.mjs:32` 返回 raw；`src/store.mjs:17-24` 写证据，POSIX mode 不能替代 Windows ACL 验证。
- 影响：敏感信息若被子进程输出或写入任务内容，可进入日志；当前没有证据表明实际密钥已泄漏，也未读取任何用户密钥。
- 修复方向：最小环境白名单、按节点分离身份、限制日志和证据目录、必要脱敏并保留可审计原文策略；需真实 Windows ACL 与远端权限验证。

### F10 — MEDIUM：Git 与进程树副作用、状态查询并非纯只读

- 证据：`src/git.mjs:10-18,30-55` 创建 worktree、执行 `git add --all` 和本地 commit，并用 `taskkill /T /F` 尝试停止 Windows 进程树；`remote/p0_runner.py:86,116-122` 创建远端 worktree，timeout 使用 subprocess.run；`src/cli.mjs:32-35` 在 status/verify 前构造 Store，`src/store.mjs:7-14` 会创建目录和 SQLite 数据库。
- 影响：进程树终止和工作树隔离不能从实现推定已成立；status/verify 指向不存在的 state 路径时会创建状态文件。此处仅源码确认，未对真实进程实施 kill、未创建真实任务状态。
- 修复方向：明确只读查询的副作用；以用户批准的临时隔离环境验证工作树、进程树、超时和恢复；凭用户授权管理本地 Git 提交。

## 4. 合同核查与待确认项

| 项目 | 状态 | 证据边界 |
|---|---|---|
| 固定 Commit、34 文件与 11 Soul Blob | VERIFIED | GitHub 读取、文件清单与 Blob 比对；不代表业务正确 |
| Gate A/B 上限各 10 | NOT_VERIFIED | `policy.mjs:14-15`、`controller.mjs:141-143,172-175` 有计数代码；完整状态机测试未运行 |
| Gate B 首次验证计第 1 轮 | **待用户确认** | `controller.mjs:172-175` 与 `docs/ARCHITECTURE.md:33` 是实现口径；未代表用户已批准 |
| B 修改后最终 Commit 再 P0 | NOT_VERIFIED | `controller.mjs:195-214` 有 SHA 判断和转移；正式测试与真实 P0 未运行 |
| 两个不同物理节点、第三席 600 秒 | BLOCKED | 仅配置物理 ID；没有主机身份与 600 秒实测；离线探针是 0 毫秒 |
| Arbitrator 只在争议触发 | NOT_VERIFIED | 见 `controller.mjs:200-223`；旧 Soul 冲突、端到端未验证 |
| Compliance 违规停线 + 审批恢复 | BLOCKED | F7/F8，真实崩溃与恢复未验证 |
| 未知状态不自动重派 | NOT_VERIFIED | `controller.mjs:238-251` 有状态拦截；丢 ACK 和恢复路径未实测 |
| Gate 5.9 不发布 | VERIFIED（源码范围） | `controller.mjs:23-36` 只将 stage 置 CLOSED；未运行生产流程 |
| TEST_ONLY 新增测试与最终 Commit | BLOCKED | 当前 Tester 被设为只读；没有完整新增、评审、合并与重 P0 契约 |
| Agent JSON 与 Soul Markdown 交付物 | BLOCKED | F5；字段和证据映射未完成 |
| Windows OS 只读、隔离及进程树终止 | BLOCKED | 未进行 OS 级验证 |
| Paseo 0.15.2 本机认证、Provider、模型、Soul 注入 | BLOCKED | 尚未安装或连接、未调用模型；F4 是源码及模拟证据 |
| OpenCode JSONL、远端权限和 Job 生命周期 | BLOCKED | 未登录或联系任何远端节点；Python 原命令 exit 127 |
| 恢复路径、网络/文件权限、SSH known_hosts | BLOCKED | 无真实授权或目标节点/OS 证据 |

## 5. 后续分阶段计划（仅方案，未执行）

S0 完成条件：协调临时测试中的 SQLite、临时 Git commit 与测试目录生命周期；在不违反“禁止 cleanup”的受控边界下取得完整的原始测试日志；经明确授权后，使用独立上下文提交 Codex 和 OpenCode 两份报告，再由本地 Agent 做逐条交叉复核。任何模型调用及费用需另行明确授权。发现重大问题后保持部署停线。

S1 本机：逐项获批后，先盘点并备份现有 OpenCode/Codex/Hermes 的配置和哈希，避免复制或暴露凭据；确定隔离位置、回退点、Paseo 版本与 Controller 启动方式。按单项批准安装/验证，再以无模型模拟检查 Agent/Soul/测试和进程限制；本机真实单次只读固定 Commit 探针另行批准。回滚方案需保留证据，恢复仅被批准变更的配置/入口；停服务、卸载或删除需各自获批。

S2 远端：仅在用户逐项批准及完成 SSH 二次确认后，对 5bao/9bao 各自部署受限 P0 Runner，绝不要求它们安装 Paseo；rusty 不启用，除非用户点名授权。每节点独立随机 HMAC key，仅由用户控制的安全通道分别提供对应节点和本机验证端；不跨节点复用、不进入 GitHub 或云日志。确认固定 Commit、SSH 主机密钥、机器身份、只读权限与本地 Harness，先无模型模拟，再另行批准单次只读真实探针。回滚仅恢复已批准变更、保留日志；停止作业、密钥撤销及清理均需单独授权。

本次没有安装、修改服务/计划任务/防火墙/ACL/SSH 信任、上传密钥、远端部署、调用模型、自动 merge/push/deploy/restart 或执行清理。

## 6. 固定版本源码与证据链接

以下源码链接均绑定原始审计 Commit；证据包 SHA-256 为 `663c985197f9bfe8dd72261ad17279c8cf2cb4abf82efb4e37f93f2b3fb8d3dd`。本报告在原本地报告基础上增加本节，证据包内保留原报告及原始收据。

- 审计基线：https://github.com/k176060444-lgtm/Paseo-workflow/commit/8fe13211271dabc4de7a7ba02b9853f3d6196979
- 本次证据包：https://github.com/k176060444-lgtm/Paseo-workflow/blob/audit/s0-8fe132-evidence/audit/evidence/8fe13211271dabc4de7a7ba02b9853f3d6196979/Paseo-S0-8fe132-evidence.zip
- 角色审查结果处理：https://github.com/k176060444-lgtm/Paseo-workflow/blob/8fe13211271dabc4de7a7ba02b9853f3d6196979/src/controller.mjs#L77-L96
- P0 身份、HMAC 与派发：https://github.com/k176060444-lgtm/Paseo-workflow/blob/8fe13211271dabc4de7a7ba02b9853f3d6196979/src/p0.mjs#L25-L90
- 远端 Job 行为：https://github.com/k176060444-lgtm/Paseo-workflow/blob/8fe13211271dabc4de7a7ba02b9853f3d6196979/remote/p0_runner.py#L141-L189
- Paseo 等待调用：https://github.com/k176060444-lgtm/Paseo-workflow/blob/8fe13211271dabc4de7a7ba02b9853f3d6196979/src/agents.mjs#L13-L32
- 上游 SDK 接口：https://github.com/getpaseo/paseo/blob/6c1b48d2962ec6a48d5a553e312dfcc1f94e2e7a/packages/client/src/index.ts#L387-L391
- 上游 SDK 超时实现：https://github.com/getpaseo/paseo/blob/6c1b48d2962ec6a48d5a553e312dfcc1f94e2e7a/packages/client/src/daemon-client.ts#L6497-L6511
- Soul verdict 与解析器：https://github.com/k176060444-lgtm/Paseo-workflow/blob/8fe13211271dabc4de7a7ba02b9853f3d6196979/src/policy.mjs#L92-L103
- Soul 来源清单：https://github.com/k176060444-lgtm/Paseo-workflow/blob/8fe13211271dabc4de7a7ba02b9853f3d6196979/docs/SOUL_PROVENANCE.md
- Git 与测试执行：https://github.com/k176060444-lgtm/Paseo-workflow/blob/8fe13211271dabc4de7a7ba02b9853f3d6196979/src/git.mjs#L61-L78
- 账本与派发事务：https://github.com/k176060444-lgtm/Paseo-workflow/blob/8fe13211271dabc4de7a7ba02b9853f3d6196979/src/store.mjs#L26-L79
- 合规与恢复：https://github.com/k176060444-lgtm/Paseo-workflow/blob/8fe13211271dabc4de7a7ba02b9853f3d6196979/src/controller.mjs#L238-L273
- Gate B 首轮计数口径（待确认）：https://github.com/k176060444-lgtm/Paseo-workflow/blob/8fe13211271dabc4de7a7ba02b9853f3d6196979/src/controller.mjs#L172-L175
- 仓库自列验收阻断项：https://github.com/k176060444-lgtm/Paseo-workflow/blob/8fe13211271dabc4de7a7ba02b9853f3d6196979/docs/SECURITY.md#L18-L27
