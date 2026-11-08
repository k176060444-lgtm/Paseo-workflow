# S0-R7 安全整改：外部执行见证、原始证据根、一次性审批 nonce

基线固定 Commit：`20989c60226562a51886d5a979e773fecc7e4ddb`  
R6 审计证据：`db6d0fe730d757bf02c313b4f4e5b62cdf7ce61b`  
本轮分支：`fix/s0-r7-execution-attestations-20261108`

**本提交只是离线审计候选，未授权真实 P1/S1/S2；即使 CI 全绿，LIVE_INTEGRATION_STATUS 仍为 BLOCKED。**

## R7-001：外部执行见证成为强制条件

旧 `recordIntent/recordAck/recordTerminal + artifact + save` 只能证明 Controller 自己保存了几条数据，不能证明 Paseo 的 Reviewer/Tester 实际运行。现在每个 `ROLE_TERMINAL`、`REVIEW_SEAT_RECORDED` 和本地独立测试命令 `TEST_RECEIPTS` 都必须提供**外部签发的 Ed25519 执行见证**，在 Store 的同一事务里进行验签。原始 artifact、taskId、role、phase、固定 Commit、agentId、dispatchId 和去除 attest 字段后的 raw SHA-256 都被签名绑定，且必须与本地终止派发收据一致；只有 artifact/dispatch 而没有外部签名者时 fail-closed。A/B 双审通过和 Gate 5.9 再次回读关键 history 验证，不能使用任意两条虚构 Agent ID。

冻结的公共信任根清单新增可选 `execution` 公钥映射，与原 `human` 密钥**用途隔离**：

```json
{
  "schema": 1,
  "human": {"approved-operator": "<Ed25519 SPKI PEM>"},
  "execution": {"independent-paseo-witness": "<Ed25519 SPKI PEM>"}
}
```

运行前由独立操作者在已保护目录部署并固定 `P1_TRUST_ROOTS_SHA256`。**代码不生成、接收、存储执行见证的私钥**。Paseo SDK 的 create/ACK 本身不是加密签名。可信见证签发端还未部署：它必须通过独立的受保护主体向 Paseo 查询原始 Agent session/结果、确认 Provider/Commit/Role，再签发上述 statement；不得把签名私钥交给 Hermes、Controller 或 Agent，也不得简单签署 Controller 提交的自述。这是新的明确验收依赖，若缺失完整 P1 在首次 Agent 收据处停线。

离线 `tests/controller.test.mjs` 使用一次性生成的 witness 私钥只模拟独立签发器，其签名不构成真实 Paseo 身份证明。`tests/r7_security.test.mjs` 复现公开 API 伪造双审，确认不带见证签名的 A/B 两席无法写入可信 history。需要下一轮额外独立攻击验证所有阶段与伪造的有效签名上下文。

## R7-002：最终人工批准绑定整组证据

在 READY_FINAL 生成 `final-compliance.json` 时写入 `evidenceRoot`：对所有此前登记的原始证据 `(name,digest)` 和完整派发 `(id,phase,agent_id,state,created)` 进行规范化有序 SHA-256。签名者除了绑定 final Commit 和 final-compliance SHA，还签署这个 root。Store 的 Gate 5.9 重新计算 root；任何此前已登记 artifact 或 dispatch 的增删/替换都必须 fail-closed。只排除 self-referential 的 `final-compliance.json` 和新生成的 `approval-5-9.json`，其他证据全纳入。

此证据根**不是**外部不可变锚；任何能同时操纵信任根私钥和所有 SQLite/文件及恢复状态的强攻击者仍有重写能力。真正可追责的外部锚需后续另建。

## R7-003：签名 nonce 消费

新增 SQLite `consumed_approvals(key_id,nonce,task_id,gate)`，复合主键 `(key_id,nonce)`。Gate0.1/0.2/5.9 和 HUMAN_CONTROLLED_RECOVERY 在同一个 `BEGIN IMMEDIATE` 事务内校验、消费 nonce 并写入事件；重复消费拒绝、事务失败回滚。新增 `_nonce_sha256` 进入事件链校验。**verifyHumanProof 本身仍可重复验证签名（只读密码学计算），但认证批准的实际状态迁移必须一次性消费。**

这不是外部防回滚机制；对整份 DB 的快照回滚仍需外部持久锚。旧账本在新增表/hash 链后不自动静默迁移，必须独立备份、人工审计迁移计划与可信基线核对；切勿直接在旧生产状态目录运行此候选。

## 21bao 实测与 SDK 适配

上轮实测 Windows App/Daemon/CLI 0.15.3、SDK0.15.2，`ws://127.0.0.1:6767/ws` 成功；无 `/ws` 连接挂起。R7 在 SDK adapter 的 `open()` 前强制校验 loopback 地址和精确 `/ws`，拒绝不规范 URL；提供只读 `listAllAgents()`（`includeBackground:true`）与 `findExistingAgent(id)`（`refresh()`）接口。**没有自动重派**，未实现 providerOptions 精确 live/断线取消的正式验收。

下一轮将产品安全审计与已启动 Paseo SDK 实机读取分开评分：先在独立临时目录测只读查询、会话/Agent ID 对账、URL fail-fast、背景 Agent refresh；必要时单独获授权的小型 Agent 调用，禁止自动付费重试、修改正在运行的 Paseo App/Daemon 或现有会话。真实签发端和 Windows ACL/Job Object、TEST_ONLY、两物理 P0、Soul V2.1 等继续 NOT_VERIFIED。

## 测试

```sh
npm run check
npm test
python3 -m unittest discover -s remote/tests -v
```

最终 CI 仅证明离线代码和合成签发器测试。不得通过改变环境开关、复用测试密钥、虚构 Paseo 签名或绕过 `Store` 来强行解除 S0。
