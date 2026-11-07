# Paseo-workflow S0 固定 Commit 独立整改审计报告

## 总判定

**S0：BLOCKED；不得据此解除真实执行、部署或远端调用阻断。**

审查目标为 `6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4`，树 `31084b689af34414dafd4c5c3f136f96e6f29d43`，基线为 `8fe13211271dabc4de7a7ba02b9853f3d6196979`。以下结论基于用户提供的固定 Blob、差异及离线日志；本审计没有调用工具，也没有亲自运行探针或测试。

核心整改已有代码和 Node 离线回归证据支持：F1、F3、F4、F7 的指定子问题可判 **FIXED**；F2 的部分控制逻辑可判 **MITIGATED_FAIL_CLOSED**。但远端 Python 测试在 Windows 上以 exit 1 报错，且触发临时目录清理时遇到文件占用；Windows 隔离、真实远端物理身份、真实 SDK/模型及进程组取消都没有验收证据。另有从代码可直接定位的 F2/F8 状态闭环、F7 事件链完整性和 F10 查询锁问题，仍构成阻断。

## 证据边界与离线运行结果

- **目标身份：**所给 `ENVIRONMENT.json` 记载目标 SHA、tree、parent 与固定元数据一致，snapshot `verified: 39`。这支持本次材料针对固定目标快照，但本审计未自行重算 Git 对象。
- **Node：**所给离线日志记录完整 Node 测试 exit 0，25 tests、25 pass、0 fail、0 skipped；日志中的 P0、SDK、SQLite 和状态机验证使用模拟或临时资源，不能证明真实节点、模型、Windows 隔离或 600 秒行为。
- **Python：**所给完整输出为 1 test、1 ERROR、exit 1。`status` 子进程返回非零，随后临时目录清理报告 Windows `WinError 32/5`，称 checkout 被其他进程占用。提供的 stderr 没有包含 `status` 子进程自己的详细 stderr，不能据此确定其最初失败原因。
- **语法：**所给 Node 语法检查收据均为 exit 0。没有据此推断 Python 测试通过。
- **未验证项：**未执行真实 Paseo SDK/daemon、真实 Codex/OpenCode/模型、SSH 节点、Linux Runner、真实 600 秒等待、Windows ACL/网络/进程隔离或 Windows Job Object 验收。
- **身份与审批边界：**`physicalId`、审批收据文本、`P1_LIVE_ALLOWED` 和 `P1_HOST_ISOLATION_ATTESTED` 都不能单独证明硬件身份、授权主体身份或安全沙箱已经生效。

## F1–F10 判定矩阵

| Finding | 判定 | 严重度 | 依据与边界 |
|---|---|---:|---|
| F1 PASS 携带阻断发现 | **FIXED（代码逻辑）** | BLOCKER（若复发） | `policy.mjs` 在解析边界拒绝 PASS 与 findings 矛盾；review pair 也独立检查。Node 离线反例测试有记录。严重度仍由自由文本前缀识别，不能涵盖任意自然语言表达。 |
| F2 三席 quorum、预检、取消/ACK | **MITIGATED_FAIL_CLOSED** | BLOCKER | 预检后提交、两席 quorum、第三席窗口及取消 ACK 检查已实现；Node 模拟覆盖预检失败、丢 ACK、取消回执。仍存在漏掉迟到第三席有效冲突报告和远端取消错误的缺陷；真实 Linux 进程组、后台服务、600 秒未验证。 |
| F3 HMAC 重复与物理身份 | **FIXED（密钥重复子问题）；物理身份 NOT_VERIFIED** | BLOCKER | `validateInventory()` 比较 key 内容摘要并拒绝重复；报告签名绑定配置 physicalId。physicalId 仍是管理侧声明，不能证明不同物理机器，真实主机身份 BLOCKED。 |
| F4 Paseo 等待参数 | **FIXED（调用形态）；真实 SDK NOT_VERIFIED** | HIGH | 由对象改为数字超时 `3600000`；Node 测试只验证 fake client 收到数字。真实 SDK/daemon 超时、断连和后台 Agent 生命周期未验证。 |
| F5 Soul、判决及交付契约 | **MITIGATED_FAIL_CLOSED** | HIGH | `APPROVE`/`REQUEST_CHANGES` 被归一化，减少旧判决被拒问题；但 Soul 迁移未获批准，blind Soul 仍写外部 A2A，正式 Markdown 交付物到 JSON 的映射不完整。 |
| F6 Windows OS 隔离、TEST_ONLY 新增/归并、真实 Harness | **NOT_VERIFIED / BLOCKED** | BLOCKER | 模型权限字段、专用 OpenCode 配置和离线 fake 测试不能证明 Windows 文件/网络/进程隔离；TEST_ONLY 新增测试并审查归并缺失；真实 Paseo/远端 OpenCode 未测。 |
| F7 SQLite、派发、事件链及证据摘要 | **MITIGATED_FAIL_CLOSED** | HIGH | 事务、派发摘要、artifact manifest 与文件摘要检查已有实现和 Node 模拟测试；但事件验证不要求每个事件中的状态、派发、artifact 摘要对应当时真实快照，事件可删除/重写并重算整条链。崩溃/WAL/特权篡改仍未验证。 |
| F8 合规失败停线与人工恢复 | **MITIGATED_FAIL_CLOSED；仍有 BLOCKER 缺陷** | HIGH | run preflight 失败会写 BLOCKED；NEEDS_RECONCILIATION 不可直接 recover。仍有预检先于既有状态门禁的问题，以及初始 P0 失败后恢复可跳回 B_ENTER 的风险。 |
| F9 子进程环境与日志边界 | **MITIGATED_FAIL_CLOSED** | HIGH | Git/测试/SSH 和远端 Harness 使用白名单环境；远端 umask 与 Node 日志记录属代码事实。环境白名单可能缺少运行时认证所需变量；原始输出可能含敏感信息；真实 ACL、远端权限与凭据兼容未验证。 |
| F10 只读查询、审批锁、进程树 | **MITIGATED_FAIL_CLOSED；只读并发仍有缺陷** | MEDIUM | status/verify 对缺失 DB 不创建状态目录，approve/recover 加锁。`inspect()` 的读链校验与并发写未形成同一一致性快照；Windows 进程树终止仍未验证。 |

## 发现详情

### BLOCKER

#### F2-a：第三席迟到结果可被纳入 quorum，却未纳入裁决

`src/p0.mjs:96-115,117-140` 在两份报告达到 quorum 后开始额外等待；窗口到期即退出轮询，再对尚未报告的 job 发 cancel。若第三席在最后一次 `status` 之后、`cancel` 请求处理之前已经完成，cancel 可返回 `FINISHED`，代码会把该报告加入 `reports`（123–125），但此时**不会再运行 verdict、findings、dispute 的汇总**；之后的 `passed`、`dispute`、`findings` 是基于全部 `reports` 计算的，因此此特定路径实际会纳入。相反，若窗口到期后第三席仍运行，只有取消成功才继续；取消不确定会停线。这一控制路径总体有 fail-closed 保护，但测试只用 `extraThirdMs:0` 和预制 fake 回执，未覆盖竞态边界与迟到冲突，故真实时序仍 NOT_VERIFIED，而非直接认定必然漏裁决。

**最小修复：**为窗口截止定义明确的报告接收截止点；取消前后统一进入一次最终收集/校验与汇总，覆盖取消竞态和迟到 FAIL/QUESTION。

#### F2-b：逐席提交顺序中，前席 ACK 丢失后的后席不会提交或逐席对账

`src/p0.mjs:80-95` 按节点顺序提交。某席 `submit` 失败或 ACK 不合约时立即抛错，后续席不会提交；先前已接受的 job 留下非 TERMINAL dispatch。Controller 将未知执行转入 `NEEDS_RECONCILIATION`，符合不自动重派原则，但没有在本次调用内对已成功派发席进行状态收集/取消。Python 测试只覆盖第三席丢 ACK 后不静默放行，未证明前席任务得到取消或可持续对账。

**影响：**工作流会停线，但可能有在途任务继续运行；账本需人工逐席核对，不能把“停线”误报为所有远端任务已经终止。

**最小修复：**保存每席提交状态，并在提交阶段失败后对已接受 job 进行查询/取消和持久化对账；取消不确定时维持 BLOCKED。

#### F2-c：取消身份检查只核对 PID 命令行，未证明目标仍是该 Job 的进程组

`remote/p0_runner.py:38-45,56-87` 通过 `/proc/<pid>/cmdline` 中是否包含 runner 路径、job id 和 `execute` 判断 PID 归属，然后直接 `killpg(pid, ...)`。`Popen(start_new_session=True)` 的 PID 与 PGID 初始相同，但代码没有读取并校验目标进程的 PGID、启动时间或 session 身份；PID 复用、同参数进程及子进程逃离进程组的处理也未建立可靠绑定。`killpg(pid,0)` 只检查该进程组是否存在，不能证明 OpenCode 自启 daemon 已退出。

**影响：**取消返回 CANCELLED 仍不能作为真实零残留证明；这与整改记录所列 Linux 子进程组及 OpenCode 后台服务未验证相符。

**最小修复：**对 job 使用可核验的 OS 级进程组/作业对象身份，确认组和后代进程终止后才返回确定取消 ACK；否则始终 `CANCEL_UNCERTAIN`。真实 Linux/Windows 进程树验收仍为 BLOCKED。

#### F3：节点身份仍是配置声明，SSH Alias 不等于不同物理主机证明

`src/p0.mjs:27-39,41-58` 验证 physicalId、SSH alias、密钥内容唯一，并验证签名报告里的 physicalId 与配置相符。`remote/p0_runner.py:219-223` 的 probe 同样返回配置中的 nodeId/physicalId。攻击者或错误配置若把两个 alias 指向同一主机且在该主机配置两份密钥和两个 physicalId，当前逻辑无法识别。配置样例的 `physicalId` 也明确为待确认字符串（`config/role-matrix.example.json:21-23`）。

**影响：**代码能防配置 ID 重复和同密钥复用，但不能据此证明有两台不同物理节点。双席 quorum 的物理身份条件仍未验收。

**最小修复：**部署阶段用独立可信主机清单和已固定 SSH 主机密钥核实 alias 到机器的映射；把核验收据与节点公钥/身份绑定。不能把 env 开关或管理侧字符串当硬件证明。

#### F6：权限声明及环境开关不构成 Windows OS 隔离

`src/policy.mjs:75-87` 生成 Harness 权限选项；`src/cli.mjs:45-53` 仅在两个环境变量均为 `YES` 时连接 Paseo；`README.md:52` 和 `docs/SECURITY.md:3,8-10,22` 明确它们是人工开关且 OS 隔离仍待验证。`src/git.mjs:15-33` 仍以普通子进程执行测试命令，传入有限环境变量但没有 Windows 受限账户、ACL、网络限制或 Job Object 证明。`src/controller.mjs:102-110` 执行冻结测试命令，没有实现 Tester 动态新增测试文件、审查再归并正式 Commit 的完整流程。

**影响：**不能证明只读角色不能写工作区外文件、不能联网或启动脱离控制的进程；也不能满足 Soul 对 Tester 新增测试和最终提交整合的契约。模拟权限测试只检查返回配置字段。

**最小修复：**先实现经审查的 TEST_ONLY 新增/审查/归并流程，再以受限 Windows 身份及系统级网络/文件/进程隔离执行验证；独立验收真实 Paseo、OpenCode 和远端 OpenCode。此前保持 BLOCKED。

#### F8-a：live preflight 在已有终态/异常状态检查之前，可能把状态覆盖成 BLOCKED

`src/controller.mjs:127-129` 的 `step()` 会跳过 `TERMINAL` 和 `INFLIGHT`；但 `run()` 在 `245-252` 先对任何非 TERMINAL stage 执行 preflight，失败即把 stage/status 改成 BLOCKED。`TERMINAL` 集合包含 `NEEDS_RECONCILIATION`（`policy.mjs:16-17`）。因此一个已有 `NEEDS_RECONCILIATION` 任务再次调用 `run` 时，若 live 开关或合规校验失败，会把对账状态覆盖为 BLOCKED，而不是维持原状态。由于 `authorizeRecovery()` 只允许 BLOCKED，状态分类变化会影响人工恢复路径，且原有未知执行语义被弱化。

**静态复现：**构造 `stage/status=NEEDS_RECONCILIATION` 的任务，调用 `run()`，令 `livePreflight` 因缺少 flag 或账本验证失败；按上述分支会写入 `stage/status=BLOCKED`。未亲自运行该探针。

**最小修复：**preflight 前只允许可运行的 READY 阶段；对 `INFLIGHT`、`NEEDS_RECONCILIATION`、其他终态保持原状态且拒绝调用。合规失败应记录原因，但不能改变不确定执行的类别。

## HIGH

#### F5：兼容判决解决了解析，不代表 Soul 合同已对齐

`src/policy.mjs:92-109` 将旧别名规范化，`docs/SOUL_V21_MIGRATION_PENDING.md:5-15` 明确迁移仍待批准，且现有 JSON 仅含有限字段。`souls/blind_a.md:14-21` 等仍描述外部 A2A，而执行层是 SSH Runner；`souls/worker_remediation.md:32` 仍要求不绕过后续 Arbitrator。解析别名本身没有解决职责、证据原文与法定报告的对应关系。

**最小修复：**由用户审核并批准新 Soul 及哈希，定义每个 Markdown 交付物与 JSON 字段、原始报告和证据的完整映射，随后以真实输出验证。

#### F7-a：事件摘要仅在事件写入时取“当前状态”，未验证每个事件的快照字段

`src/store.mjs:69-77` 写入事件时把当前 task、dispatch、artifact 摘要放入 payload；`104-122` 验证事件哈希链，但只在链末对 task、dispatch、artifact 摘要做一次比较。中间事件的 `_state_sha256`、`_dispatch_sha256`、`_artifact_sha256` 没有与其对应的当时状态核验，也未验证事件的 state/dispatch 摘要变化是否匹配该事件类型。具有数据库写权限的人若重建事件链并重算摘要，可伪造自洽账本；文档也承认无外部锚定时特权攻击者可改写整链（`docs/ARCHITECTURE.md:66`、`docs/SECURITY.md:16`）。

**影响：**实现能发现简单漂移和当前文件哈希变化，但不是不可篡改账本；完整历史事件一致性也未得到验证。

**最小修复：**对每个事件重放并核验对应状态版本，或以事务内版本号/快照哈希绑定状态迁移；敏感审计再使用独立外部锚点。

#### F7-b：证据文件落盘与 SQLite 登记并非原子操作

`src/store.mjs:33-48` 先以 `wx` 创建并 fsync 文件，再开 SQLite 事务插入 artifact 与事件。进程若在文件创建后、事务提交前崩溃，会留下未登记孤儿证据；若事务失败也不会回滚文件。`verify()` 只遍历数据库登记的 artifacts（117-120），不枚举并拒绝 evidence 目录中的未登记文件。

**影响：**摘要清单只能覆盖已登记文件；孤儿证据可能未被 `verify()` 发现。此处为静态代码推断，未进行崩溃注入。

**最小修复：**设计可恢复的两阶段写入/临时文件协议，并在 verify 中检查目录与登记清单双向一致；添加崩溃点测试。

#### F8-b：人工恢复到 B_ENTER 未必重做被违规阶段所需的完整验证

`src/controller.mjs:277-296` 在 `p0Initial` 已存在时一律回到 `B_ENTER`。若违规或账本问题发生在 Gate B 后段，而 `currentSha` 已变化但 `p0Final` 缺失或绑定旧 Commit，进入 B 后可能重新整改/测试；P0 最终检查会根据 commit 比较重新触发，但是否重做所有应有审核依赖当前状态字段与 findings，缺少按 blockedStage/违规类型的恢复矩阵。`recover` 还依赖操作者提供的 actor/receipt 字符串，不能证明批准者身份。

**最小修复：**保存并校验违规阶段、原始 SHA 和各验证证据；按迁移矩阵回到最早需重验的阶段，不允许仅凭字符串审批恢复。保留丢 ACK 的人工对账凭据。

#### F9：环境白名单降低继承泄漏，但并未证明 Harness 认证可用或日志无敏感信息

`src/git.mjs:8-13` 只保留少数环境变量，`remote/p0_runner.py:23-36` 采用类似白名单且允许配置扩展；`remote/p0_runner.py:197-207` 持久化 stdout/stderr 并将摘要签名。白名单测试只证明一个任意变量被排除（`tests/security_regression.test.mjs:81-85`），没有验证 OpenCode/Codex 的真实认证来源。任何 Harness 输出的 token、用户数据仍会原样进入日志与证据。

**最小修复：**在不输出凭据的条件下验证认证路径和最小环境；定义原始输出访问 ACL、保留期限与泄漏检测策略，并在真实 Windows/Linux 目录权限下验收。

#### F4：Python 失败暴露了 Windows Runner 生命周期不兼容，原因尚未定位

`remote/p0_runner.py:247-249` 用 `subprocess.Popen` 异步启动 `execute`，立即写 PID 并返回 ACCEPTED。日志显示之后 `status` 子进程退出 1，随后 cleanup 因 `checkout` 文件占用失败；但没有 `status` stderr 细节，不能断定是 runner 子进程、Git worktree、句柄继承还是其他原因。测试使用临时 Git 仓库和 `TemporaryDirectory`，运行在 Windows，且 `test_runner.py:15,40-45` 在结果完成前轮询；没有显式清理 worktree 或确认执行子进程退出。

**最小修复：**先补充保留的子进程 stdout/stderr 和状态文件诊断，在 Windows/Linux 分开验证 Runner 生命周期；明确等待 execute 退出并清理临时 worktree 后再退出测试。仅依据现有日志，不能宣称 Python 全绿或把错误归因于单一根因。

## F1–F10 逐项审计记录

### F1 — PASS + BLOCKER

**判定：FIXED（核心放行路径）。严重度：原 BLOCKER 子问题有 Node 离线反例证据；残余为 HIGH/待验证。**

- `src/policy.mjs:92-109`：旧 verdict 别名规范化后，PASS 有 findings 或阻断等级时抛错；`111-115` 定义阻断等级匹配。
- `src/controller.mjs:70-78`：普通 invoke 对 PASS + findings 拒绝；`80-100`：并行审查的 `pass` 同时要求两席均 PASS、无阻断发现，且 PASS 必须 findings 为空。
- **离线事实：**Node 输出记录 F1 两项测试通过，覆盖旧 verdict 规范化和 fake review pair 收到 BLOCKER 后不 pass。不能证明真实 Reviewer 输出契约。
- **残余：**阻断等级依赖字符串正则（`policy.mjs:111-114`）；例如报告以非标准文字描述严重缺陷、但 findings 不以规定前缀开头时，程序不会识别该语义。下一版应将 severity 设为结构化必填字段并在 schema 中固定。

### F2 — 三席预检、提交、第三席等待和取消/ACK

**判定：MITIGATED_FAIL_CLOSED。严重度：BLOCKER 子问题部分改善，取消与远端生命周期 BLOCKED。**

- `src/p0.mjs:27-39`：最低两节点、physicalId/SSH alias/key 内容唯一性检查；`60-95`：先 probe，再仅向可达席提交，提交前记 intent，丢 ACK 抛错。
- `src/p0.mjs:96-140`：至少两份有效不同 physicalId 报告后计时；窗口到期对仍无报告席发 cancel，要求匹配 jobId 且 `CANCELLED` ACK，否则拒绝放行；取消前若报告已完成则验证并纳入。
- `remote/p0_runner.py:47-87`：Linux 才执行 cancel；无 pid、非 Linux 或无法确认 PID 时返回 `CANCEL_UNCERTAIN`。
- **离线事实：**Node 日志有 F2 预检失败、迟到席取消回执、丢 submit ACK、5bao 不可用而 9bao+rusty 构成双席的模拟测试通过。未使用真实 SSH、远端 Runner 或 600 秒等待。
- **阻断子问题：**`src/p0.mjs:80-95` 是逐席提交，某席 ACK 丢失会使前面已提交的席保持在途而本轮立即退出；这会停线但没有自动逐席收尾。Linux cancel 通过 PID cmdline 判断归属而非强绑定进程组，且无法排除 OpenCode 自启动服务（Python 行 38-45、56-87）。
- **最小修复：**逐席记录并核对所有已提交作业；丢 ACK 后对先前已接受席进行 status/cancel 对账；用可验证进程组生命周期证明确定终止。第三席冲突/迟到报告竞态须单独注入。
- **持续 BLOCKED：**真实 Linux 进程组终止、OpenCode daemon 残留、600 秒计时和 ACK 丢失后的远端查询均未验证。

### F3 — 重复 HMAC 与不同物理节点

**判定：密钥复用子问题 FIXED；物理身份 NOT_VERIFIED。严重度：BLOCKER。**

- `src/p0.mjs:27-39`：各节点 HMAC 内容 SHA-256 指纹在内存中去重，不记录摘要；`41-58`：MAC 校验后核对签名 body 中 physicalId。
- **离线事实：**Node 回归测试记录“不同路径但相同 key bytes 不派发”、physicalId 签名不匹配拒绝；均为合成 key/fake SSH。
- **限制：**physicalId 来自节点配置，probe 由远端配置原样返回（`remote/p0_runner.py:219-223`），`sshAlias` 唯一也不能证明别名最终对应不同主机。HMAC 证明持有对应密钥的一方签过报告，不证明硬件身份或实际模型。
- **最小修复：**部署证据需绑定 SSH host key 与独立机器清单，并由人工核实不同机器；当前物理身份仍 BLOCKED。

### F4 — Paseo 等待参数

**判定：FIXED（参数类型错误）；真实联调 NOT_VERIFIED。严重度：HIGH。**

- `src/agents.mjs:20-32` 现在调用 `agent.waitForFinish(60*60*1000)` 数字参数。
- **离线事实：**Node 日志记录 fake SDK 收到 `3600000`。没有调用 `@getpaseo/client` daemon 或模型。
- **最小修复/验收：**真实 0.15.2 SDK 的超时、断连、后台 Agent 终态与重复调用处理需在获批隔离环境验证；在此之前该运行时能力保持 BLOCKED。

### F5 — Soul 判决、调度与法定交付物

**判定：MITIGATED_FAIL_CLOSED。严重度：HIGH。**

- `src/policy.mjs:96-109`：接受旧 `APPROVE`、`REQUEST_CHANGES` 并分别规范化 PASS/FAIL。
- `docs/SOUL_V21_MIGRATION_PENDING.md:5-15`、`docs/SOUL_PROVENANCE.md:3-5,21` 明确保留历史原文，迁移未获正式批准；旧 Soul 的 Arbitrator、Pro-Audit、A2A 表述仍未在源码中更新。
- `src/controller.mjs:220-227` 仅在 dispute 阶段执行 Arbitrator，与部分旧 Soul 的流程文字存在差异；`src/policy.mjs:92-109` 的 JSON 契约没有覆盖报告中要求的 task/phase/commit/TASK_SPEC/Soul SHA、法定 Markdown 与原始证据映射。
- **离线事实：**Node 测试覆盖 parser 接受旧别名；没有验证 11 份 Soul 的真实注入或用户批准迁移。
- **最小修复：**经用户审阅后更新并签准 Soul；定义完整 Markdown/JSON 双向字段映射和原始报告保留，随后实测固定版本 Runner 输出。

### F6 — TEST_ONLY 与 OS 隔离

**判定：NOT_VERIFIED；正式链路 BLOCKED。严重度：BLOCKER。**

- `src/policy.mjs:75-87` 只向 Harness 返回权限配置；Tester 仍是只读权限。
- `src/controller.mjs:102-110` 在独立 test checkout 执行冻结命令，但未实现 Tester 添加测试文件、独立审查、合并正式候选 Commit 的交付链。
- `src/git.mjs:15-33` 只是限制子进程环境、超时与尝试杀进程；没有 Windows ACL、受限用户、网络隔离或 Job Object。
- `docs/SECURITY.md:8-11,22-26` 明确指出 OS 沙箱及 TEST_ONLY 增量流程未完成。README 的两个 `YES` flag 也只是人工开关（`README.md:50-52`）。
- **验证事实：**Node 测试检查 provider options 的字段；它不是 OS 权限测试。未运行 Windows ACL、网络或进程树探针。
- **最小修复：**实现并审核 TEST_ONLY 测试增量进入最终 Commit 的流程；在 Windows 受限账户下验证文件、网络、子进程和清理边界；远端 Linux 分开验收。此前保持 BLOCKED。

### F7 — SQLite 事务、事件链、dispatch 与证据摘要

**判定：MITIGATED_FAIL_CLOSED。严重度：HIGH。**

- `src/store.mjs:21-25,50-56,62-67,79-101`：任务初始化、状态保存、dispatch intent/ACK/terminal 与对应事件均使用事务。artifact 文件与 manifest/event 事务化登记（33-48），但物理文件创建不在 SQLite 事务内。
- `src/store.mjs:27-31,69-77,104-122`：事件摘要包含 state/dispatch/artifact hashes；`verify()` 校验链、末事件状态摘要、dispatch/artifact 集合和已登记文件内容哈希。
- **离线事实：**Node 日志记录篡改 dispatch 行、证据文件可被检测，重复 intent 回滚；均为临时 SQLite 模拟，没有故障注入或管理员重建整链测试。
- **残余缺陷：**verify 只对比最后事件的摘要与当前状态，未重放每个中间事件快照；artifact 写入存在“文件先落盘、数据库后登记”窗口，且未检测未登记孤儿文件。没有外部锚定，特权用户可重写数据库与整条链。
- **最小修复：**用事件重放/版本化状态校验每一条迁移；采用可恢复的证据两阶段提交并核验目录与 manifest 双向完整；对高保证审计做离线签名锚定。

### F8 — 合规失败停线、预检顺序与人工恢复

**判定：MITIGATED_FAIL_CLOSED，但仍有 BLOCKER 子问题。严重度：HIGH（状态分类缺陷达到 BLOCKER）。**

- `src/controller.mjs:40-45,243-253`：preflight 失败会在持锁后写 `BLOCKED`，保留 `blockedStage` 与原因。
- `src/controller.mjs:257-268`：阶段执行异常时，有 inflight 或非 TERMINAL dispatch 转为 `NEEDS_RECONCILIATION`，其余转 BLOCKED。
- `src/controller.mjs:277-296`：人工恢复要求明确 BLOCKED、无 inflight、所有 dispatch terminal、SHA 一致并有 actor/receipt 文本；恢复进入重验阶段，不直接 PASS。
- **静态缺陷：**`TERMINAL` 包含 `NEEDS_RECONCILIATION`，但 `run()` 在检查状态前调用 preflight。对账任务再次 `run` 且 preflight 失败，代码会覆盖为 BLOCKED（`controller.mjs:245-250`），让不确定任务进入另一恢复路径。没有给出的测试覆盖此迁移。
- **人工身份边界：**actor 与 receipt 是字符串校验（`controller.mjs:278-285`），并不认证审批者身份；环境 flag 也不是认证或隔离证明。
- **最小修复：**调用 preflight 前拒绝所有非 READY 状态，不改变 `NEEDS_RECONCILIATION`；按违规阶段和已有证据建立明确恢复迁移表，要求外部可核验的人工批准记录。

### F9 — 子进程环境与日志 Secret 边界

**判定：MITIGATED_FAIL_CLOSED。严重度：HIGH，真实凭据兼容和 ACL BLOCKED。**

- `src/git.mjs:8-13` 设置本机子进程环境白名单；`src/p0.mjs:17-24` 用 SSH BatchMode 与 StrictHostKeyChecking；`remote/p0_runner.py:21-36,164-173` 使用 umask、远端环境白名单和专用 OpenCode 权限配置。
- `remote/p0_runner.py:197-207` 保存原始 stdout/stderr、写日志 hash 并签名；本机 `src/agents.mjs:32` 返回 raw，artifact 由 Store 落盘。
- **离线事实：**Node 测试只证明人为注入的一个任意环境变量未传给子进程。Python 完整测试失败，不能作为白名单端到端证据。
- **影响：**环境白名单可能漏掉 Harness 认证配置，导致运行失败；若进程输出敏感内容，原始日志会持久化。当前无真实泄露证据，也没有读取用户凭据。
- **最小修复：**在不暴露凭据的前提下核验实际认证来源和最小环境；对证据目录、远端 spool 和日志设置并实测 ACL/权限；定义原始输出敏感数据处理与保留规则。

### F10 — 只读查询、锁及进程副作用

**判定：MITIGATED_FAIL_CLOSED；读一致性与进程组仍 NOT_VERIFIED。严重度：MEDIUM。**

- `src/cli.mjs:32-45`：status/verify 以 `readOnly:true` 开 Store；approve/recover 使用 `withLock`。
- `src/store.mjs:7-18`：只读模式不 mkdir、不建表；缺失 DB 会报错。Node 离线测试记录缺失状态目录不会被创建。
- **静态缺陷：**`status/verify` 不获取同一任务锁，`inspect()` 在读 dispatch 列表与 `verify()` 之间可能遇到并发写。SQLite 单条语句一致不等于多步读取同一快照；报告可能混合不同状态时点，或在运行中的事务中观察不完整审计视图。当前 CLI 输出只是状态查看，但不能把它当一致快照审计。
- `src/git.mjs:17-31` 的 Windows 超时只调用 `taskkill /T /F`，失败时回退 kill 根 PID；之后最多等待固定 10 秒并以异常表示无法确认。代码注释也承认需要 Job Object 审计。没有真实进程树验证。
- **最小修复：**只读 inspect 在 SQLite read transaction 中取 task、dispatch、events 与 artifacts 一致快照；Windows 使用可验证的 Job Object/等效机制并测试后代进程退出。