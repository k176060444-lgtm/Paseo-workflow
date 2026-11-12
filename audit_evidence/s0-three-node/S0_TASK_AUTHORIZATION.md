# 本轮 S0 整改授权与需求原文

来源：KK 在当前会话发布并在压缩边界后重申的任务正文。以下为该任务内容；它不是 Gate 5.9 部署批准，也不是独立审计报告。

任务：Paseo Coding Pipeline V2 — S0 统一三节点 P0 编排定向整改

仓库：k176060444-lgtm/Paseo-workflow
固定基线 Commit：
b4bcfe93fde5a2538d87659c084881b6b25cf5b0

用户最新裁定：rusty Paseo 认证专项已经通过，基础设施 CONDITIONAL。本轮正式回到 S0 代码整改，不再调查或修改 Daemon。

一、主线及角色裁定

1. 5bao、9bao 是优先双盲审节点；rusty 是可选第三席。
2. 三台候选节点统一采用 Paseo 原生 SDK，正式 P0 调度不得使用 SSH 或 Hermes A2A。
3. 支持任意两台不同物理节点形成有效报告 quorum，但 rusty 必须先满足自身硬性证据门禁才能计数。
4. rusty 未准备好、未参与或被跳过，不得阻断已经符合全部条件的 5bao+9bao 双盲审。
5. 两份有效报告成立后，第三席最多额外等待 10 分钟。
6. 技术结论存在争议时交由 Arbitrator 最终裁决；Arbitrator 始终审核最终代码完成度及最初用户需求符合性。
7. Arbitrator 不得豁免物理独立性、签名、原始证据、PRE/POST、OS 隔离等流程硬门禁。
8. 有效报告数量、技术结论、争议状态、付费任务执行收口状态必须分别记录，不得混为一个 PASS。

二、执行权限

本轮批准在独立修复分支开展必要的源码、配置示例及测试整改。

禁止：
- 修改 main 或直接合并。
- 重启、升级、修改 21bao、5bao、9bao、rusty 的 Paseo 服务。
- 执行真实跨机任务、付费模型调用或新的 P0 派发。
- SSH Coding 调度。
- npm install/npm ci 或未经批准的依赖安装。
- 修改生产角色模型矩阵、私钥、信任根或审批权限。
- 清理既有证据、历史 npm 事件或覆盖未提交修改。

当前工作树已有 p0_paseo.mjs 及测试文件的未提交差异。先只读冻结其 Diff、文件摘要及来源，在独立工作区基于固定 Commit 建立新分支，按需移植经核对的修改。不得把未提交内容冒充固定 Commit 已审功能。

整改必须保留既定的每步 Compliance PRE/POST、Gate 0.1/0.2、Gate A/B、10+10 预算、P0 重新盲审及 Gate 5.9 人工最终批准。不得由整改 Agent 自行签发独立审计 PASS。

三、S0 代码整改范围

R1：统一 P0 调度。

以 PaseoP0Adapter 为统一入口，5bao、9bao、rusty 使用相同的节点清单和原生通信契约。移除生产流程中 rusty A2A 的强制依赖，历史 A2A 记录仍可只读核验。

先确保两台已合格的 Paseo 节点能够完整执行。rusty 必须具有独立的 eligibility/preflight 状态，不合格就跳过，不得用无效报告补足 quorum。

R2：修正第三席逻辑。

取得两份不同物理节点的有效报告后，开始最多 600000ms 的额外等待。第三席未派发、未准备好或无有效报告，不得自动否定双席技术 quorum。

如果第三席已经派发且仍在执行，必须单独处理取消、终止回读和未知执行状态。archive 不等于终止，不能静默遗留付费任务。

缺少可靠终止能力的第三席应禁止自动付费派发，允许以 NOT_DISPATCHED/SKIPPED 记录，而不是让主线产生无法收口的任务。

R3：统一超时和 ACK 纪律。

对连接、预检、创建、状态查询、见证、轮询和取消设置有效 deadline。不能因单个 await 永久阻塞。

任务创建前保存不可变 Job ID、Dispatch Intent 和关联身份。ACK 丢失、任务状态未知时必须保持 UNKNOWN/NEEDS_RECONCILIATION，禁止自动重新创建任务。

R4：修正节点验证。

不同物理节点允许使用相同 cwd 字符串，但必须分别验证 physicalId、serverId、Workspace 和实际工作区。

对于 rusty 的 Tailscale 地址，只允许经过明确配置批准、具备加密链路和应用密码认证的端点，不得删除整个网络校验。

R5：RustyHand 的处理边界。

rusty 当前检测到 rustyhand Provider，但其独立会话、权限适配、原生任务身份及 Witness 证据未闭合。

本轮不得简单添加 rustyhand 字符串白名单，或返回空 permission options 放行。

可先将 rusty 标记为 P0_INELIGIBLE，保证 5bao+9bao 主线不依赖 RustyHand。保留以后通过独立验收后启用 rusty 的配置化入口。

R6：Store 和签名链。

保留 P0 原始签名、Soul、Prompt、Intent、TaskSpec、Commit、Workspace、Agent、PRE/POST 绑定。

确认过去 S0 报告中的 Q1：Store.commitRecovery 公开入口是否可能绕过未闭合 Dispatch 对账。先增加负向测试，成立则修复；不成立则提交可重复验证的证据。

R7：技术结论与流程判决分离。

有效的第三席若提出不同技术结论，应触发争议处理，而不是直接覆盖双席结果。

两份报告有效不代表技术验收自动 PASS。存在 FAIL、QUESTION 或实质分歧时应保存原始报告并进入既定 Arbitrator 裁决路径。

最终用户需求符合性和代码完成度审核仍为必经步骤。

四、测试要求

新增至少以下场景：

- 5bao+9bao 有效，rusty 不可用，主线不被阻断。
- rusty 未达到 Witness/隔离要求，不计入 quorum。
- 5bao 不可用，另一主节点与满足全部硬门禁的模拟 rusty 可以形成 quorum。
- 仅有一台有效节点时禁止通过。
- 第三席超过 10 分钟仍未完成。
- 第三席取消确认失败或 ACK 丢失。
- 任意 SDK 调用永久无响应时触发 deadline。
- 两份有效报告的技术意见冲突。
- 两台不同物理主机使用相同 cwd。
- 恢复接口面对未闭合 Dispatch。
- 无效签名、错误 serverId、错误 Workspace、错误 Commit 均被拒绝。

全部使用模拟 SDK/Witness，不创建真实 Paseo Agent，不调用模型。

运行现有离线测试和新增回归；不得通过降低断言或修改原始需求制造全绿。

五、交付要求

提交：

1. 逐项 R1–R7 的修复与测试对应表。
2. 新分支 Commit、Tree、Parent。
3. 完整修改文件清单和 Git Diff。
4. 测试原始日志、退出码、PASS/FAIL/SKIP。
5. 5bao+9bao 主线的静态及模拟验收结果。
6. rusty 仍未达到的准入条件。
7. 任何没有闭合的问题和残余风险。
8. 后续独立固定 SHA 技术复审所需材料。

完成修复后停止，不得自行宣布 S0 PASS，不得部署、不合并、不运行真实 P0 或进入 S1–S6。

最终整改原则：

优先把 5bao+9bao 的真实双盲审主线做正确、做可靠；rusty 作为可选第三席，既不降低硬门禁，也不成为主流程的必要依赖。充分复用 Paseo 原生能力，避免重复造轮子。
