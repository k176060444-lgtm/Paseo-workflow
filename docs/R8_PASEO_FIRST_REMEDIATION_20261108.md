# S0-R8 安全整改 + Paseo Connected Hosts 三机 P0 重构

固定父提交：`3e4e80e65960e55b774b6009728d5ba4e4e44a25`  
R8 审计证据：`5453830c778d99a4a94bc87d1e4e48ca64b140c6`  
分支：`fix/s0-r8-paseo-first-provenance-20261108`  
**这是代码与离线契约候选，任何真实 P1/S1/S2、远端付费模型与私钥部署仍为 BLOCKED。**

## R8 修复与残余信任边界

| 审计编号 | 新实现 | 限制 |
|---|---|---|
| R8-001 BLOCKER | `IndependentExecutionAttestor` 经 OS 本地 IPC 向独立服务请求签发；Paseo Agent 结果先取得执行签名，再标记 TERMINAL；Controller Tester 完成后通过 IPC 请求独立 OS 命令见证，并将其加入测试收据 | 独立 witness 服务尚未安装，默认没有签名私钥、没有自动降级；服务须独立查询 Paseo Agent 及 OS 日志、检查 role/Commit/原始输出，而不能盲信 Controller 请求 |
| R8-002 HIGH | 同一 Ed25519 SPKI 公钥内容或相同 Key ID 在 human/execution/P0 任意两个信任域中出现，立即拒绝加载 | 签发进程/权限隔离仍需要实机核查 |
| R8-003 MEDIUM | 新执行见证只允许在签发后30分钟内首次消费；`consumed_executions` 按签发者+nonce 去重并将摘要加入事务事件哈希链；历史回读复核签名及已消费记录，不因过了30分钟错误拒绝旧有效历史 | 数据库整体回滚仍需要外部不可变锚；旧账本不能直接自动迁移 |
| R8-004 LOW | 本地 A/B Review 席位写入时必须绑定当前 frozen SHA 及当前 A/B 轮次；不能用其他 Commit 的有效签名污染当前 Review 历史 | 本地审查意见仍属模型判断，不能代替 Tester 或外部 P0 |
| R8-005 MEDIUM | 人工审批 artifact 采用 Gate+签名 nonce 唯一文件名；保存前先查询已消费 nonce，失败后使用**新签名**重试不会因旧文件 EEXIST 被卡死，旧失败证据保留不删除 | 同一个已消费 nonce 仍拒绝重放；失败 artifact 留在审计记录，不宣称文件和 SQLite 跨系统原子性 |

## 本地 Agent 审查“甄别”规则

本地 `spec_reviewer` 与 `quality_reviewer` 仍必须分别完成：**不同 Agent ID、同 frozen Commit、不同审查职责、各自独立原始输出与验签、与真实终止 Paseo dispatch 对应**。Reviewer 的 verdict 必须经过本地严格解析，PASS+findings、HIGH/BLOCKER、QUESTION、FAIL、模糊 verdict、未分类建议等不能因为另一席 PASS 而通过。两席意见分开生成 `assessments`，不得将它们计入远端物理机 P0 盲审 quorum。

Tester 分两层：Paseo 的 Tester Agent 给出意见，Controller 的冻结命令在独立测试工作区运行；`testRun` 真实返回的 stdout/stderr、退出码、SHA 由独立 OS 见证检查并签名。只有两层都成功、无阻断 finding 才能放行。

## 三机 P0：Paseo 原生 Connected Hosts

- 21bao **唯一主编排端**：通过已连接的本地 Paseo Daemon `client.hosts.list()` 和 `client.hosts.client(serverId)` 路由到 5bao / 9bao / rusty 的远端 Paseo Daemon，不通过 SSH 命令或 `ssh://` 注册目标。
- 每台外机事先在自己的 Paseo Workspace 准备隔离只读 Git checkout。绑定 `registrationId/serverId/workspaceId/cwd/physicalId`、节点职责、模型和每台独立的公钥。不可按显示昵称或 Agent 文字自称认定身份。
- 执行前通过独立 witness 签署 `P1_P0_WORKSPACE_PREFLIGHT_V1`，证明实际 HEAD 正好是指定 Commit、工作树 clean；**必须在付费调用前**完成。每个外机用 Paseo 创建独立 Agent，返回 `{serverId,agentId}`；持久化 jobId、labels、ACK/terminal。
- 只接受独立的 `P1_P0_NODE_RESULT_V1` 签名原始报告，绑定 Job、Daemon、物理节点、Commit、model/harness、Agent、原始输出 SHA。21bao 不持有节点签名私钥，不接受 Agent 自报 PASS 充当签名。
- 60 秒轮询；最先两台不同物理节点的有效报告取得后，第三席最多额外等 600 秒；第三席若在窗口内完成必须纳入裁决。取消要有 Paseo 实际终止确认，未知则停线。
- 创建 ACK 丢失、路由中断、Agent ID 不确定一律 **NEEDS_RECONCILIATION**；`reconcileByLabels` 只做只读查询，不自动再次 create。
- 当前 `SshP0Adapter` 保留作为历史离线回归/人工灾难恢复代码，**正式 CLI 不再构造或调用它**。对于自动 P0，配置 `p0.transport='paseo'`，不支持 SSH 自动回退；底层必须使用私有 WireGuard 或等效加密直连及受保护授权，不允许裸公网 WebSocket。

## 尚待真实 21bao/远端验收的条件

1. **外部签发服务未部署**：`P1_ATTESTOR_SOCKET` 指向独立、受 OS ACL 限制的 IPC（Windows 命名管道 `\\.\\pipe\\p1-...`、Unix 绝对 socket）。服务本身必须拥有与 Controller 不同的签发身份，并独立复核真实 Paseo session/OS test 和远端物理节点；这个 repo 没有私钥，也不提供“根据请求直接签名”的生产服务。
2. **跨机 Paseo 未实机验证**：远端是否装有兼容 0.15.3 Daemon、直连路由、providers、Workspace API 与真实 Agent 取消/刷新能力，必须单独只读验证。21bao 本地能调用 Codex/OpenCode 不证明三机能调用。
3. **OS 可信隔离与外部不可变锚**、Windows Job Object、TEST_ONLY、Soul V2.1/交付物映射、真实物理机独立性与隐私网络仍 NOT_VERIFIED。
4. **旧状态迁移**：新增 `consumed_executions` 和 `_execution_nonce_sha256` 无自动兼容老事件链；不得将本修复直接指向已有状态文件。必须先独立备份、做离线迁移及审计再授权启用。
5. **精确 providerOptions、远程 `waitForFinish`、断线后恢复、`archive` 是否真正停止计费/进程**需本机 Paseo 实测确认。在没有明确确认之前任何模糊取消都继续 BLOCKED。

## 独立审计双轨

A：原始 Node/Python 回归 + R8 对抗探针，特别是唯一 nonce、同钥、24h 旧签名、跨 Commit Reviewer、审批失败后新签名重试、真实 IPC 生产接口和不凭空自签。  
B：只读核对真实 21bao Paseo Connected Hosts 列表及三机 Daemon 状态；未安装远端 Daemon 时记录 NOT_READY，**不得擅自 SSH 或安装**。如已准备好、用户单独授权，则在一次性隔离 workspace 跑极简跨机 Agent，验证 API 真实响应和原始事件；任何付费动作另行取得授权。

本轮即便 CI PASS，**CODE_VERDICT/EXECUTION_ATTESTATION/LIVE_INTEGRATION 必须分别判定，不得自动宣称 S1/S2 放行**。
