Let me also check `policy.mjs` for key shared primitives:
Now let me read the `policy.mjs` shared primitives to complete the picture on canonical/assert/PASS:
# Paseo-Workflow R7 审计报告

## R7-001 执行见证 — CONFIRMED

**`verifyExecutionAttestation` 绑定全部字段** — `auth.mjs:85-86` 逐字段比对 `taskId/role/phase/commit/agentId/dispatchId/rawSha256`。错误签发者→`auth.mjs:81` 拒绝（key 不在 `roots.execution` 中）；篡改 raw→`auth.mjs:86` 字段不匹配；替换 agentId/dispatchId→同上；跨 task/commit/role/phase 重放→同上拒绝。

**无见证签名时 fail-closed** — `store.mjs:271-301` (`#verifyHistoryExecution`) 从 artifact JSON 解构 `{attestation,...bare}`，若无 `attestation` 字段则 `proof=undefined`，传入 `verifyExecutionAttestation` 在 `auth.mjs:78` (`envelope?.schema===1`) 立即断言失败。A/B_REVIEW_PASS 通过 `store.mjs:426`→`#verifyReviewerPair`→`#verifyHistoryExecution` 触发，公开 `recordIntent/recordAck/recordTerminal + artifact + save` 无法绕过。`r7_security.test.mjs:22-44` 证实无见证签名时 history 无法写入、stage 不变。

**issuedAt 无下界检查** — `auth.mjs:91-92` 仅检查 `issued <= Date.now()+120000`，无最小时间窗口（对比人类审批 `auth.mjs:60-61` 有 30 分钟下界）。旧执行见证可无限重放 → **缺口**。

## 真实签发端 — NOT_CONFIRMED

**仓库内无真实隔离签发实现** — `agents.mjs:35-55` `PaseoAgentRuntime.execute` 返回 `{role,phase,agentId,dispatchId,verdict,...}` **不含 `attestation` 字段**。`git.mjs:124-135` `testRun` 返回 `{pass,receipts}` **同样不含 `attestation`**。仅测试 fixture（`tests/controller.test.mjs:33-38`、`tests/fixtures.mjs:55-62`）使用一次性本地私钥模拟签发。文档 `docs/R7_EXECUTION_PROVENANCE_20261108.md:23` 明确声明「可信见证签发端还未部署」。生产 Controller 会在首次 `invoke`（Planner）触发 `ROLE_TERMINAL` 时因缺少 attestation 直接抛异常停线。

## 用途隔离/时效 — NOT_CONFIRMED

**human 与 execution 公钥未强制不同** — `auth.mjs:20-26` 加载 `manifest.human`，`auth.mjs:29-35` 加载 `manifest.execution`，各自存入独立 Map。**代码不检查两集合是否有交集**。同一公钥同时放入两域会被接受。

**execute attestation 无 stale 检查** — `auth.mjs:91-92` 仅限未来时间上限，**无下界**。旧签名可无限重放。人类签名有 30min 窗口（`auth.mjs:61`），执行见证缺失对称检查。

## R7-002 evidenceRoot — CONFIRMED

**覆盖全部证据** — `store.mjs:48-53` 对 `artifacts`（排除 `final-compliance.json` 与 `approval-5-9.json`）和全部 `dispatches` 做规范化 SHA-256。包含所有 Reviewer/Tester/P0 原始 artifact 与完整 dispatch 记录。
**防篡改 fail-closed** — `store.mjs:202` Gate 5.9 重新计算 `this.evidenceRoot(t.id)` 并与 `final-compliance.json` 中冻结值比对，不匹配即拒绝。`controller.test.mjs:271-288` 验证：compliance 生成后添加 artifact 导致 evidenceRoot 变化，Gate 5.9 审批失败。
**人工签名绑定** — `auth.mjs:49-54` Gate 5.9 验证 `evidenceSha256`（final-compliance SHA）与 `evidenceRoot`，两者均被 Ed25519 签名覆盖。
**缺口** — 证据根不是外部不可变锚；拥有信任根私钥 + DB 全量写入权的攻击者可重写。文档 `R7:31` 明确此为已知限制。时序/并发：`final-compliance.json` 在 READY_FINAL 时刻冻结，之后 artifact 变化会被 Gate 5.9 重算检测，不存在竞态窗口。

## R7-003 nonce — CONFIRMED

**复合键防跨任务/跨 Gate 重放** — `store.mjs:34` 主键 `(key_id,nonce)`。`store.mjs:58` 消费前检查已存在性。`consumed_approvals` 表不按 `task_id` 分区，同一 `(key_id,nonce)` 跨任务拒绝（`r7_security.test.mjs:59-105` 证实）。事务性：`store.mjs:66-70` (`BEGIN IMMEDIATE`) 确保消费与状态迁移原子。
**非 `task_id` 绑定的语义缺口** — 虽主键全局唯一防重放，但 nonce 未绑定原始 taskId，合法用户无法直接用同一 nonce 跨任务签名（属设计选择，非漏洞）。
**`_nonce_sha256` 事件链** — `store.mjs:592` 将 `_nonce_sha256` 写入事件负载，`store.mjs:640` 验证时比对，篡改 consumed_approvals 导致哈希链断裂。
**回滚后复用** — `ROLLBACK` 会回滚 nonce 消费，但这是原子事务的正确语义；外部快照回滚需外部持久锚（文档 `R7:37` 声明此限制）。

## Paseo SDK — CONFIRMED

`agents.mjs:11-14` 强制拒绝非 `ws://`/`wss://`、path 非 `/ws`、含 userinfo（username/password）、search/hash、非本地地址。`listAllAgents`（`agents.mjs:30`）`includeBackground:true`，`agents.mjs:32` 解包 `x?.agent??x`。`findExistingAgent`（`agents.mjs:24`）使用 `refresh()`。**无自动重派逻辑**（无 retry/redispatch 代码路径）。

## 正常流程/回归 — NOT_CONFIRMED (路径断裂)

测试 mock（`controller.test.mjs:33-38, 81-83, 107-113`）使用本地一次性 witness 私钥签发 attestation，与生产路径**不一致**。生产 `PaseoAgentRuntime.execute` 和 `git.testRun` 均不产出 attestation。Gate A/B 10 轮、双审、Tester 命令证据、P0 两物理席、Compliance 停线、Gate 5.9 的流程逻辑在 mock 中均正确执行，但**真实签名合成路径在生产代码中不存在**，会在首个 `invoke` 停线。

---

## CODE_VERDICT: FAIL

**理由**：代码契约完整——`verifyExecutionAttestation` 绑定正确、见证缺失时 fail-closed、evidenceRoot 覆盖全面、nonce 消费原子。但**生产 `PaseoAgentRuntime.execute` 与 `git.testRun` 均不产出 execution attestation**，独立签发服务未部署。代码在首次 Agent 调用即 fail-closed 停线，功能上不可运行。测试 mock 路径与生产路径断裂。

## EXECUTION_ATTESTATION_STATUS

`NOT_DEPLOYED` — `src/agents.mjs:54` (`PaseoAgentRuntime.execute` 返回值无 `attestation`)、`src/git.mjs:134` (`testRun` 返回值无 `attestation`)。仅 `tests/controller.test.mjs:33-38`（一次性本地私钥）与 `tests/fixtures.mjs:55-62`（synthetic witness）模拟。文档 `docs/R7_EXECUTION_PROVENANCE_20261108.md:23` 确认签发端未部署。代码旁注 `auth.mjs:71-74` 声明「本模块仅验证，无签名能力」。**独立 Ed25519 签发服务、Paseo session 对账、Provider/Commit/Role 查询均在仓库外，属部署级依赖。**
