# S0 固定对象独立技术复审说明

本文件是后续复审任务书材料，不代表已经启动复审或取得独立审计结论。

- 仓库：k176060444-lgtm/Paseo-workflow
- 基线／预期 Parent：b4bcfe93fde5a2538d87659c084881b6b25cf5b0
- 分支：fix/s0-three-node-p0-20261112t021428z
- 已冻结候选 Tree：4b30348bca7b1bb3a766a345e77ec0a525fe2789
- 固定代码 Commit：ff80df8e9771225dbe4bfc37011403a47c104668。审查以此 SHA 为准。
- 最终身份与完整文件清单：GIT_IDENTITY.json。
- 完整补丁：CODE_CHANGE.patch。
- 修改统计：CODE_CHANGE_FILES.json。
- 源码与原始证据：SOURCE.zip。
- R1–R7 对应表、准入缺口和风险：源码包内 docs/S0_THREE_NODE_P0_REMEDIATION.md。

审查时只读源码、完整 Diff、原始测试日志与签名契约，不采信实施者的“已通过”自述。不执行部署、模型调用、真实 Paseo 连接/Agent 创建、SSH、A2A、依赖安装或服务操作。执行测试如需另立测试席，应由 KK 另行明确授权；本任务书不会自动派发任何席位。

优先核验：

1. 统一原生 SDK 入口与单一节点清单；rusty 未合格、未参与或被跳过不能阻断全部合格的 5bao+9bao。
2. 任意两份不同物理节点的有效报告才形成 quorum；不能用配置标志、检测到 Provider 或无效签名替代独立证据。
3. 第二份有效报告到达后开始最多 600000ms 的第三席报告窗口。有效数、技术意见、争议、付费执行收口四项分开。UNKNOWN 不得冒充取消成功；archive 不等于终止。
4. 每个可能阻塞的连接、预检、创建、状态查询、Witness、轮询、取消、回读及清理调用都有有效 deadline。创建前有不可变 Job ID/Intent，失 ACK 或晚 ACK 不得重建任务。
5. 相同 cwd 和 daemon 内 Workspace 字符串可以跨物理节点复用；仍须核验各自 physicalId/serverId/Workspace/实际工作区。Tailscale 必须精确批准、有加密链路及应用密码认证，不能通过切换到 wss 绕过批准。
6. Store.commitRecovery 的公开入口不能绕过未闭合 Dispatch；核验先复现后修复的 Q1 三例，拒绝时原子性和 nonce 不得损坏。
7. 原始签名、Soul/Prompt/Intent/TaskSpec/Commit/Workspace/Agent、PRE/POST、OS 隔离不许弱化。检查实际 Store 边界，不能只看 Mock Adapter 返回值。
8. FAIL/QUESTION/NEEDS_SPECIALIST 或实质分歧必须保存原件并进入既定 Arbitrator 路径；不能多数投票自动 PASS。Arbitrator 必须审核最终代码及原始需求，不得豁免硬门禁。
9. 保留 Gate 0.1/0.2、Gate A/B、10+10 预算、改码后的新 P0 和 Gate 5.9 人工批准。不得修改生产矩阵、私钥、信任根或审批权限。

最终全套记录为 Node 210 PASS / 0 FAIL / 1 SKIP（211 tests），Python 11 PASS / 0 FAIL / 0 SKIP，退出码均为 0。Windows symlink 权限不足的跳过不是 PASS。模拟 SDK/Witness 和临时密钥只证明代码与这些模拟契约一致，不证明真实节点 OS 隔离、模型执行或 Witness 部署已经合格。

已有失败、超时和旧 fixture 记录均保留，查 PROVENANCE.json 的各轮退出码及取代关系。原脏树的 +39/-3 已单独冻结，不能冒充固定基线功能。

审查输出请逐项给出范围、BLOCKER/IMPORTANT/QUESTION/非阻断意见、文件与行号、依据、最终四档技术判决。独立技术判决与独立流程合规必须分开；本材料不能代替后续固定 Commit 复审、Arbitrator、Pro-Audit 或 KK 的最终批准。
