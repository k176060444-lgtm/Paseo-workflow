# S0 独立审计 F1–F10 整改记录（修复候选；不等于验收）

基线：`main@8fe13211271dabc4de7a7ba02b9853f3d6196979`；审计证据为 `audit/s0-8fe132-evidence` 分支。本修复候选须在新的独立分支进行复审，不改变原始审计证据或历史源 SHA。

## 源码整改与待验收边界

| Finding | 代码变更 | 修复判定 |
| --- | --- | --- |
| F1 BLOCKER | 检查 `PASS + findings` 自相矛盾；严重度标记 `BLOCKER/HIGH/P0/P1` 不得放行；兼容旧 `APPROVE/REQUEST_CHANGES`；反例测试 | 离线回归覆盖；真实 Reviewer 结构化输出 **NOT_VERIFIED** |
| F2 BLOCKER | P0 各席 `probe` 后独立提交；第三席预探测失败可不派发，已派发却丢 ACK 必须停线；双席后第三席最多 600 秒；在途第三席走 `cancel`，无确定取消 ACK 不放行 | Python/Linux 子进程组终止、OpenCode 自身后台服务及真实 600 秒 **NOT_VERIFIED** |
| F3 BLOCKER | 同内容不同路径的 HMAC key 在派发前拒绝；远端签名报告绑定 `physicalId`，确认 SSH 节点别名不同 | `physicalId` 仍是管理侧核验的身份声明，**不是物理硬件证明**；5bao/9bao 实机独立性 BLOCKED |
| F4 HIGH | Paseo 0.15.2 `agent.waitForFinish(3600000)` 数字参数；模拟验证调用参数 | 真实 SDK/daemon 超时、断线仍 BLOCKED |
| F5 HIGH | 解析器兼容旧 Reviewer 判决 `APPROVE/REQUEST_CHANGES`；另附 Soul 迁移清单 | **Soul 1.1.0 尚不能作为已批准 V2.1 新版本**；用户审查后才可替换，完整 Markdown/JSON 法定交付物映射未完成 |
| F6 BLOCKER | 权限仍按角色硬编码，Tester Agent 使用更严格只读；对 OS/TEST_ONLY 真实隔离不假称修复 | Windows 受限进程身份、网络、文件和测试新增/归并流程 **仍 BLOCKED** |
| F7 HIGH | tasks、dispatches、events 与证据清单摘要进行事务绑定，校验真实文件哈希和在途派发变化 | 对管理员恶意重写库/日志不提供抗篡改保证；崩溃、磁盘损坏与 Windows WAL 仍 NOT_VERIFIED |
| F8 HIGH | run preflight 不合规写入 BLOCKED；未知执行保持 NEEDS_RECONCILIATION；恢复拒绝存在非 TERMINAL 派发的任务，不能跳过技术复验 | 丢 ACK 的外部查询/人工对账及杀死进程残留能力尚未实机验证 |
| F9 HIGH | Git/test/SSH 子进程使用白名单环境；远端 Python Runner 仅继承所需环境，远端日志文件由 `umask 077` 保护 | 原始模型输出可能包含敏感内容；Windows ACL、远端日志边界和密钥保存仍 BLOCKED；仅存放在用户管理的本地目录 |
| F10 MEDIUM | `status/verify` 只读打开现有数据库；人工审批和恢复使用同一任务锁；超时无法确认退出时上报 UNKNOWN | Windows Job Object 及真正的进程树隔离仍需实机测试 |

## 不应误判为已通过的项目

1. 本分支的离线测试使用 fake Agent、fake P0、临时 SQLite 和临时 Git 工作树；不涉及实际 Codex/OpenCode/Paseo 模型调用。
2. P0 Python Runner 的 `cancel` 使用 Linux 进程组信号，可能无法覆盖由 OpenCode 自己启动的独立 daemon；不能证明零进程残留，`CANCEL_UNCERTAIN` 必须停线。
3. 远端 HMAC 证明报告在已配置节点 key 的控制域内产生，不证明物理机器身份，也不证明实际计费模型。
4. Windows ACL、TEST_ONLY 动态添加测试/审核/归并进入正式 Commit、Tester 原始收据真实性和 Soul 正式迁移仍是独立验收门槛。
5. 修改 SQLite 事件结构后，旧运行状态不支持静默原地升级；此候选只针对全新、空状态目录。现有任务必须做专门的迁移审计或保持冻结。
6. `P1_LIVE_ALLOWED` 和 `P1_HOST_ISOLATION_ATTESTED` 只是人为开关，不是安全证书。不要设置为 `YES` 来绕过尚未证明的隔离能力。
7. 仓库原本采用的 Gate B 无整改时计为第 1 轮，仍为待用户单独确认口径；本修复未修改计数规则。

## 本地 Agent 下一轮 S0 步骤

1. 严格固定本修复候选 Commit，先 `npm run check`、`npm test`、`python -m unittest discover -s remote/tests -v`；Node 22+，Python 3.10+。
2. 分别对照原始 F1–F10 逐项复现，特别关注真实 `P0 runner.cancel` 的退出时序/僵尸进程、`Store.verify` 破坏检测、命名角色判决正则、环境白名单使本机认证不可用时的安全停线。
3. Codex 与 OpenCode 必须在不同上下文独立审计，不先交换结论。所有未在真实环境执行的检查保持 NOT_VERIFIED；S0 仍不能称 COMPLETE，直到双独立报告与完整命令收据齐备。
4. S1/S2 是否允许安装/部署由用户另外授权。即使本分支 CI PASS 也不解除运行时和 OS 隔离的 BLOCKER。
