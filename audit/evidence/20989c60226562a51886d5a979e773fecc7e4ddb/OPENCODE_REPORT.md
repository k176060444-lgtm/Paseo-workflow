# Paseo-workflow 静态只读审计（固定提交 20989c6）

**R6-001 认证 Gate — CONFIRMED**
`auth.mjs:31-58` 的 `verifyHumanApproval` 经 `canonical(statement)` 签名并逐项 assert，绑定 keyId(35)、taskId/gate/digest/actor/receipt(38-39)、evidenceSha256(41-44)、nonce(47)、issuedAt(50-52)。`loadTrustRoots`(`auth.mjs:12-15`) 对 trust-root SHA 不符即返回 null → `verifyHumanProof` fail-closed；`verify` 用 Ed25519(`auth.mjs:55-57`)。`Store.save` 在 `transaction` 内走 `#checkGateReceipt`(`store.mjs:144-147`) 用持久化 `oldTask` 重读审批 artifact 并二次 `verifyHumanProof`，非只信 Controller。

**R6-002 双审 — NOT_CONFIRMED（独立来源）**
`#verifyReviewerPair`(`store.mjs:219-244`) 结构上强制两席同 sha/phase、不同 agentId、注册 artifact、TERMINAL dispatch。但 reviewer 证据（artifact+dispatch）全为 Controller 自录、无 HMAC/Ed25519 外部签认，持有 Store 句柄者可用公开 `recordIntent/recordAck/recordTerminal/artifact/save` 伪造两席通过 A/B_REVIEW_PASS——属 Controller 内部记录，非独立来源。

**R6-003 重放/过期 — NOT_CONFIRMED（仅恢复消费 nonce）**
仅 `#verifyRecoveryReceipt`(`store.mjs:264-268`) 查询 events 持久消费 recoveryNonce；Gate 0.1/0.2/5.9 无 nonce 去重表，`verifyHumanProof`(`auth.mjs:31`) 无状态、窗口内可重复接受同一 envelope。防重放靠 workflow 单次不可逆转移+签名绑定 taskId/gate/digest，故门本身不可重放。时间窗 30min 过去/2min 未来(`auth.mjs:51`) 有效。

**R6-004 Git/P0 — CONFIRMED**
`GATE_5.9_APPROVED` 经 `#validateFinalGate`(`store.mjs:176`) 调 `verifyCommitEvidenceSync`(`git.mjs:152-176`) 重验对象存在、merge-base 祖先、worktree HEAD。`#verifyP0Nodes`/`SshP0Adapter.verify`(`p0.mjs:41-62`) 校验 HMAC、jobId、commit、physicalId、model/harness、stdoutSha256 格式；`store.mjs:211-214` 要求 TERMINAL dispatch、`store.mjs:217/170-171` 要求两物理席位。

**R6-005 verifier — CONFIRMED**
构造器 `store.mjs:20-21` `assert(gitVerifier===undefined)` 拒绝注入；Store 只用 import 的 `verifyCommitEvidenceSync`（无 `this.gitVerifier` 属性读取），运行时覆盖属性无效；失败抛错且 `save` 事务回滚 → fail-closed。

**Gate 5.9 证据来源 — CONFIRMED（描述属实）**
`final-compliance.json`(`controller.mjs:277-282`) 仅以 evidenceSha256 绑定人工签名；Reviewer/Tester 原始证据为 Controller 自录（唯 P0 有 HMAC 节点签认）；人工签名只证明批准了 Controller 汇总的 compliance digest，不证明 Reviewer/Tester 独立执行真实性。

**回归 — CONFIRMED**
静态路径+测试文件覆盖：happy path 合成链、A/B 各 10 轮、Reviewer 一成一败(`r2_regression:114`)、P0 冲突/仲裁、错误审批(`r5_regression:55,84`)、受控恢复(`r6_auth:136`)。`transaction()` 未被重入调用（`#trustedEventWrite` 守卫 `store.mjs:14-19` 防嵌套 event append），`withLock` 与 DB 事务不嵌套，未见嵌套事务/锁问题。

**CODE_VERDICT: PASS**

（注：R6-002 独立性、R6-003 门级 nonce 未持久消费为架构性/信任域内限制，未构成对未授信 agent 的 fail-open；未运行测试。）
