你是独立只读代码审计员。只做静态审查，不修改文件、不运行测试、不联网。

对象：Paseo-workflow 固定提交 `3e4e80e65960e55b774b6009728d5ba4e4e44a25`（基线 `20989c60226562a51886d5a979e773fecc7e4ddb`，上一轮证据 `db6d0fe730d757bf02c313b4f4e5b62cdf7ce61b`），源码 `C:\Users\KK\AppData\Local\Temp\opencode\paseo-audit-s0-r7\repo`。

只读：`src/auth.mjs`、`src/store.mjs`、`src/controller.mjs`、`src/agents.mjs`、`src/git.mjs`、`tests/fixtures.mjs`、`tests/controller.test.mjs`、`tests/r7_security.test.mjs`、`docs/R7_EXECUTION_PROVENANCE_20261108.md`。

逐条回答，必须给 `文件:行号`，每条 **CONFIRMED / NOT_CONFIRMED / UNCERTAIN**：

1. **R7-001 执行见证**：`verifyExecutionAttestation` 是否绑定 taskId/role/phase/commit/agentId/dispatchId/rawSha256；错误签发者、篡改 raw、替换 agentId/dispatchId、跨 task/commit/role/phase 是否拒绝？公开 `recordIntent/recordAck/recordTerminal + artifact + save` 无执行签名时是否仍能通过 A/B_REVIEW_PASS？
2. **真实签发端**：仓库内是否有真实、隔离的 Paseo/OS 见证签发实现？`PaseoAgentRuntime.execute` 与 `git.testRun` 是否实际产出 execution attestation？还是只有测试 fixture 的本地私钥？正常生产 Controller 是否会在首次 ROLE_TERMINAL/TEST_RECEIPTS 停线？
3. **用途隔离/时效**：human 与 execution 公钥是否强制不同？同一公钥同时放入两域是否被接受？`verifyExecutionAttestation` 是否检查 issuedAt 下界/过期，旧签名能否重放？
4. **R7-002 evidenceRoot**：final-compliance 的 evidenceRoot 是否覆盖全部 Reviewer/Tester/P0 原始证据与完整 dispatch？生成后添加/删除/替换 artifact、篡改 dispatch、改 Git HEAD 是否 fail-closed？人工签名是否绑定 final Commit + compliance SHA + evidenceRoot？时序/并发/回滚/孤儿有何缺口？
5. **R7-003 nonce**：consumed_approvals 复合键、事务、`_nonce_sha256` 是否真正防跨任务/跨 Gate/恢复重放？回滚后是否可复用？旧状态是否静默迁移？
6. **Paseo SDK**：`PaseoAgentRuntime.open` 是否拒绝缺少 `/ws`/非本地/带 userinfo/搜索参数；`listAllAgents` 是否 `includeBackground:true` 且解包 `entry.agent`；`findExistingAgent` 是否用 `refresh()`；是否会自动重派？
7. **正常流程/回归**：Gate A/B 10 轮、双审一成一败、Tester 命令证据、P0 两物理席、Compliance 停线、Gate 5.9 是否有真实签名合成路径？测试 mock 与生产路径是否一致？

最后给出 `CODE_VERDICT: PASS / FAIL / INCONCLUSIVE`，并单列 `EXECUTION_ATTESTATION_STATUS`。不超过 1800 字。明确区分代码契约与真实签发端部署。