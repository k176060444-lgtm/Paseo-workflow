# S0-R6 证据来源认证整改（审计候选，非实机验收）

固定父代码：`be0bc89dc4813cf1152399128a3caa34a12f4d70`  
独立失败审计证据：`1d799a3108553c29958f2f00a30b8aa77d99778e`  
整改分支：`fix/s0-r6-authenticated-evidence-20261108`

**状态：代码审计候选；完整 P1 LIVE / 真实 P0 / 自动部署继续 BLOCKED。**

## 本轮 R6 对策

- **R6-001/R6-003：** Gate 0.1、0.2、5.9 及受控恢复不再相信调用者写入的 actor/receipt/artifact；`src/auth.mjs` 要求由独立公钥信任清单验证的 Ed25519 签名，内容绑定 taskId、Gate、SHA/digest、actor、receipt、UUID nonce、签发时间。受控恢复使用 `gate=recovery`，同样签署任务 ID、当前恢复 basis（spec/config/commit）、审批人和收据，并绑定恢复目标和 nonce；不再允许只用 actor/receipt 重开。签名新鲜度：不得早于30分钟，不得超前2分钟。无签名、来源不受信任、根清单 SHA 不匹配全部拒绝。Store.save 自身在事务里二次验证，不能仅靠 Controller.approve。
- **R6-002：** A/B_REVIEW_PASS 必须存在 spec_reviewer 与 quality_reviewer 两席同 Commit、同轮次、不同 agentId、无未决 findings 的登记原始报告及对应终止 dispatch/ACK。仅通过 event name 无法跳过双审。
- **R6-004：** Store 的 Gate 5.9 最终判定自身重新检查 Git base/final commit 存在、祖先、当前 worktree HEAD。并通过冻结的 P0 节点清单与每席独立 HMAC key，复核原始节点签名报告、job ID、model/harness/physicalId、Commit、stdout hash、派发终止收据及两台物理席位。
- **R6-005：** 正式 Store 构造器拒绝任意 gitVerifier 注入；Git 真实性检查直接调用经过代码固定的 `verifyCommitEvidenceSync`。模拟测试改为真实临时 Git repo、自动生成真实 Commit，不再使用 fake verifier。
- **正常流程离线测试：** 临时生成 Ed25519 私钥、两个不同 P0 HMAC key 和一次性 Git 仓库来建立完整合成闭环；测试用私钥从不进入产品配置或 Git 仓库。模拟运行时将合成 Reviewer/Tester/P0 收据登记到独立测试数据库。

## 信任根和密钥纪律

本轮的 **public trust roots manifest** 格式：

```json
{
  "schema": 1,
  "human": {
    "approved-operator-id": "-----BEGIN PUBLIC KEY-----\n...Ed25519 SPKI...\n-----END PUBLIC KEY-----\n"
  }
}
```

需由部署者在受访问控制的外部目录安装公钥文件，通过 `P1_TRUST_ROOTS_FILE` 指向该文件，`P1_TRUST_ROOTS_SHA256` 在独立配置处预固定该文件内容的 SHA-256。新任务保存此根摘要；任务期间更换根清单，不允许自动批准。

签名 envelope：

```json
{
  "schema": 1,
  "keyId": "approved-operator-id",
  "statement": {
    "purpose": "P1_HUMAN_GATE_V1",
    "taskId": "TASK1234",
    "gate": "0.1",
    "digest": "<exact frozen/spec/commit SHA>",
    "actor": "<approved actor>",
    "receipt": "<human approval text>",
    "nonce": "<UUID>",
    "issuedAt": "<ISO 8601 UTC>"
  },
  "signature": "<Ed25519 signature of canonical(statement), base64>"
}
```

**私钥不允许出现在 Controller、Hermes、Paseo、GitHub 或模型提示词中。** 为实际签署 Gate，未来需要独立的审批客户端或隔离签名服务，它不得运行在被审 Agent 能修改/读取的上下文。没有部署这个服务之前，正式 Gate 一律停线。**公钥清单环境变量不是操作系统隔离机制**：拥有服务进程启动配置和文件写入权的攻击者可以替换信任根，必须通过 Windows 服务账户、ACL 及独立操作员确认来封锁。

## 严格保留的不足

1. Reviewer 原始报告和派发/ACK 仍来自同一 Controller 运行进程；本轮验证完整性和记录一致性，**还没有加密学意义上的 Paseo 服务器签名或独立执行证明**。下一轮可在 21bao 做 SDK dispatch/agentId/原始事件读取的受控实测，以确认真实 API 的证据来源。
2. Tester A/B 的测试命令与本地执行仍在 Controller 账户；原始输出可验证 SHA，但不能证明操作系统独立性。TEST_ONLY、沙箱/ACL/Job Object 尚需验收。
3. P0 报告的 HMAC 验证能够证明掌握批准节点密钥，但 `physicalId` 仍是预登记身份，不是硬件证明；真实 5bao/9bao/rusty 两机和第三席600秒暂未验证。
4. SQLite 内容/事件链没有外部不可变锚。能完全控制数据库和受保护信任根/密钥的攻击者仍可能伪造；需要外部审计锚、隔离密钥保管和可追责的操作者身份。
5. F5 Soul V2.1 迁移/交付物映射仍未批准，禁止擅自改动角色 Soul。
6. 此次编译/离线结果不能代替 Windows 实机 SDK；即使 Paseo Windows App 已运行，也不得自动把整套 P1 工作流从 S0 提升到 S1 或允许部署。

## 下轮 21bao 双轨验收

**轨道 A（产品审计）**：固定 Commit 全部 Node/Python 离线测试 + 独立重放上轮18步伪造链。必须拒绝无真实密钥的 Gate 0.1、无双 Reviewer 的 REVIEW_PASS、假 P0 HMAC、直接 Store Gate 5.9、gitVerifier stub。测试必须覆盖正常完整合成签名工作流，不得把缺陷重放 PASS 解释成产品 PASS。

**轨道 B（本机已可用的 Paseo App 实测）**：先只读识别 21bao 的实际 Daemon、CLI、SDK 版本及本机接口，仅在隔离一次性目录验证 SDK 连接/断连、Agent ID、派发/ACK、原始结果、会话对账。必要时至多一次短小、无敏感内容、无仓库写权限的 Codex 和 OpenCode 合成任务；必须遵守本机余额/费用与用户审批限制。严禁修改已有用户会话、Paseo 设置、Hermes 配置或远端 P0。**实测成功仅证明 SDK/Agent 某些接口可用，不等于真实 P1 流程放行。**

## R6-003 执行说明

`node src/cli.mjs approve` 与 `recover` 都要求 `--approval-proof SIGNED_JSON`。本轮**不提供自动签名脚本和私钥生成到项目目录的能力**，避免让 Agent/Controller 代替用户作出授权。真实签名需要由独立操作者安装受保护的本地签名端，先离线演练，绝不能读取现有 Hermes/Paseo 凭据或连接云端签名托管。
