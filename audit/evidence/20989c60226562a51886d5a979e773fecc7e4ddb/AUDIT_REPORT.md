# Paseo-workflow S0-R6 第七轮独立审计报告

**AUDIT_STATUS: COMPLETE**
**CODE_VERDICT: FAIL**
**PASEO_SDK_STATUS: PARTIAL**
**LIVE_INTEGRATION_STATUS: BLOCKED**

- 被审固定 Commit：`20989c60226562a51886d5a979e773fecc7e4ddb`
- 基线 Commit：`be0bc89dc4813cf1152399128a3caa34a12f4d70`
- 实际父提交：`b20e113c595f4dacc4ce042d76c226d714396c60`（中间修复 Commit；merge-base `be0bc89…`）
- Tree：`5475fe904e2e5d6a71e45db8b8663215e7c7a372`
- 整改说明：`docs/R6_AUTHENTICATED_EVIDENCE_20261108.md`
- 上一轮证据 Commit：`1d799a3108553c29958f2f00a30b8aa77d99778e`
- 环境：21bao / Windows 10 19044；Node v26.6.0、Python 3.11.15、Git 2.54.0.windows.1、Codex 0.166.0、OpenCode 1.19.3、Paseo App/Daemon/CLI **0.15.3**、项目 SDK 声明 **0.15.2**（App 内置 0.15.3）
- 范围：R6 源码静态审查、本机 Windows 离线 Node/Python 原始套件、独立对抗探针、Codex/OpenCode 独立复审、Paseo 本机真实 SDK/Agent 受控实测、证据上传。**未部署、未合并、未执行完整 P1、未访问远端 P0、未修改 Paseo/Hermes 配置。**

`FIXED` 仅指被列出的离线代码级子项；不等于真实身份、外部锚、真实 OS 隔离或生产验收。

---

## 1. 决定性结论

### 1.1 R6-001（BLOCKER）— **PARTIAL**

- **已修**：无 trust root/签名不能通过 Gate 0.1；Ed25519 签名绑定 keyId/taskId/gate/digest/actor/receipt/nonce/issuedAt；Gate 5.9 必须绑定 `final-compliance.json` SHA-256；trust-root manifest SHA 不匹配在 Store 构造时拒绝；Store.save 在事务内二次验证。
- **仍开放**：有效人工签名只证明“人批准了 final-compliance.json”，并不证明 Reviewer/Tester/P0 的原始执行。公开 `recordIntent/recordAck/recordTerminal + artifact + save` 可伪造双审、Tester、P0 证据；R7-001/R7-002。

### 1.2 R6-002（HIGH）— **PARTIAL；R7-001 BLOCKER**

- 代码现要求 A/B_REVIEW_PASS 有两席、同 Commit、同 phase、不同 agentId、原始 artifact、终止 dispatch/ACK；无证据时拒绝（官方测试通过）。
- 但独立探针用公开 API 伪造两席 dispatch/ACK/TERMINAL + reviewer artifact + REVIEW_SEAT_RECORDED，**A_REVIEW_PASS 与 B_REVIEW_PASS 均成功**（4/4）。这是 Controller 内部记录，不是 Paseo 服务器签名/独立执行证明。

### 1.3 R6-003（HIGH）— **PARTIAL；R7-003 MEDIUM**

- **已修**：Ed25519 正反 15/15：错误 task/gate/digest/actor/receipt、篡改签名、40 分钟过期、5 分钟未来、trust-root SHA 不匹配全部拒绝；Gate 5.9 的 evidenceSha256 绑定/替换 5.9 均正确。
- **仍开放**：`verifyHumanApproval` 只检查 nonce 格式，不消费 nonce；同一签名 envelope 可重复通过验证。Gate 0.1/0.2/5.9 的重放仅靠状态机阻止（recovery 有显式 nonce 事件检查）。真实操作者身份仍依赖部署侧私钥保护，**NOT_VERIFIED**。

### 1.4 R6-004（HIGH）— **FIXED**

- Store 的 `#validateFinalGate` 直接调用 `verifyCommitEvidenceSync`，检查 base/final 对象、commit 类型、祖先、worktree HEAD；官方 `R6-004 direct Store final close independently checks real worktree HEAD` 通过。
- P0 直接 15/15：HMAC、jobId、commit、physicalId、model/harness、exitCode/clean、stdout SHA、PASS+findings、APPROVE_WITH_COMMENTS HIGH、重复 physicalId/key 内容均正确拒绝；真实远端 5bao/9bao/rusty 未访问，**NOT_VERIFIED**。

### 1.5 R6-005（MEDIUM）— **FIXED**

- `new Store(...,{gitVerifier:...})` 直接拒绝；Store 使用导入的 `verifyCommitEvidenceSync`，运行中覆盖属性无效；官方 R6-005 测试通过。

### 1.6 R7-001（BLOCKER，新发现）— 伪造 dispatch/Reviewer 记录仍可通过双审

- 位置：`src/store.mjs:219-245`、`:368-369`、`:537-570`。
- 复现：A_REVIEW 阶段用 `recordIntent('A1-review-spec_reviewer')`、`recordAck(job,'fake-agent-spec')`、`recordTerminal(job)`；注册 raw reviewer artifact；追加 `REVIEW_SEAT_RECORDED`；quality_reviewer 同理但不同 agentId；`save('A_REVIEW_PASS')` 成功。B_REVIEW_PASS 同样成功。
- 影响：独立双审仍可被 Controller 内部记录伪造；R6-002 的“不能跳双审”只对“未填记录”的攻击有效，对“自造记录”无效。

### 1.7 R7-002（HIGH，新发现）— Gate 5.9 签名不绑定 Reviewer/Tester/P0 原始证据

- 人工签名只绑定 `final-compliance.json` 的 SHA；final-compliance 由 Controller 字段/artifact 生成。Reviewer/Tester/P0 的 raw 报告只是本地哈希，不进入人工签名，也不由独立服务签名。
- 影响：合法人工最终批准可“祝福”伪造的评审/测试/P0 证据；签名真实性 ≠ 执行真实性。

### 1.8 R7-003（MEDIUM，新发现）— nonce 未持久消费

- `verifyHumanApproval` 对同一 nonce 的签名验证两次都成功；Gate 0.1/0.2/5.9 没有 nonce 消费表。正常状态机阻止同一 Gate 二次迁移，但数据库恢复/重放下不构成密码学防重放。Recovery 有显式 `recoveryNonce` 事件检查。

---

## 2. R6-001～R6-005 结论

| ID | 严重度 | 结论 | 说明 |
|---|---|---|---|
| R6-001 | BLOCKER | **PARTIAL** | 无签名/错误签名/trust-root 不匹配已挡住；有效签名 + 伪造 Reviewer/Tester/P0 仍可自洽（R7-001/R7-002）。 |
| R6-002 | HIGH | **PARTIAL** | 两席/agentId/artifact/dispatch 检查已加；公开 dispatch/artifact 可伪造（R7-001）。 |
| R6-003 | HIGH | **PARTIAL** | Ed25519/时间/5.9 evidence 绑定已修；nonce 不消费、真实身份未认证（R7-003）。 |
| R6-004 | HIGH | **FIXED** | Store Gate 5.9 Git 复核 + P0 HMAC/job/commit/physicalId/model/dispatch 正反 15/15；真实远端 P0 NOT_VERIFIED。 |
| R6-005 | MEDIUM | **FIXED** | 构造器拒绝 verifier 注入，属性覆盖无效。 |

**R6 统计：FIXED 2、PARTIAL 3、NOT_FIXED 0、NOT_VERIFIED 0。**

**新发现：R7-001 BLOCKER、R7-002 HIGH、R7-003 MEDIUM。**

---

## 3. R5-001～R5-003

| ID | 结论 | 说明 |
|---|---|---|
| R5-001 | **PARTIAL** | 无签名 Gate 已阻断；伪造 Reviewer/Tester/P0 仍可（R7-001/R7-002）。 |
| R5-002 | **FIXED** | init 强制 Gate 0.1/零预算/无预置；fixtures 仅测试引用。 |
| R5-003 | **FIXED** | Git 对象/祖先/HEAD 与 Store Gate 5.9 复核；构造器拒绝注入。 |

**R5 统计：FIXED 1、PARTIAL 2。**

---

## 4. R4-001～R4-007

| ID | 结论 |
|---|---|
| R4-001 | **PARTIAL**（R7-001/R7-002） |
| R4-002 | **PARTIAL**（TASK_SPEC/审批 artifact 可伪造） |
| R4-003 | **FIXED** |
| R4-004 | **FIXED** |
| R4-005 | **FIXED** |
| R4-006 | **FIXED** |
| R4-007 | **FIXED**（真实 OS symlink NOT_VERIFIED；索引级 120000 已验证） |

**R4 统计：FIXED 5、PARTIAL 2。**

---

## 5. F1–F10

| ID | 结论 |
|---|---|
| F1 | **FIXED** |
| F2 | **MITIGATED_FAIL_CLOSED**（真实双机/600s 未验证） |
| F3 | **MITIGATED_FAIL_CLOSED**（真实物理身份未验证） |
| F4 | **FIXED**（真实 Paseo wait 已在 LIVE 报告验证 idle/lastMessage） |
| F5 | **NOT_FIXED**（Soul V2.1/交付物映射） |
| F6 | **NOT_VERIFIED** |
| F7 | **PARTIAL** |
| F8 | **PARTIAL** |
| F9 | **PARTIAL** |
| F10 | **MITIGATED_FAIL_CLOSED** |

**F 统计：FIXED 2、PARTIAL 3、MITIGATED_FAIL_CLOSED 3、NOT_FIXED 1、NOT_VERIFIED 1。**

---

## 6. R2/R3

| R2 | 结论 |
|---|---|
| R2-001 | **PARTIAL** |
| R2-002 | **FIXED** |
| R2-003 | **FIXED** |
| R2-004 | **FIXED** |
| R2-005 | **FIXED** |
| R2-006 | **PARTIAL** |
| R2-007 | **FIXED** |
| R2-008 | **PARTIAL** |
| R2-009 | **FIXED**（OS symlink NOT_VERIFIED） |
| R2-010 | **FIXED** |

**R2 统计：FIXED 7、PARTIAL 3。**

| R3 | 结论 |
|---|---|
| R3-001 | **PARTIAL**（R7-001） |
| R3-002 | **PARTIAL** |
| R3-003 | **FIXED** |
| R3-004 | **FIXED** |
| R3-005 | **FIXED** |
| R3-006 | **FIXED** |
| R3-007 | **FIXED** |
| R3-008 | **FIXED** |

**R3 统计：FIXED 6、PARTIAL 2。**

---

## 7. 本机测试与独立审查

完整命令、cwd、退出码、原始 stdout/stderr 见 `TEST_RESULTS.txt`、`TEST_SUMMARY.json`。

- **238 项：237 PASS / 0 FAIL / 0 ERROR / 1 SKIP**（含 2 次真实 Paseo live smoke）。
- 产品套件：**Node 70（69 PASS / 1 SKIP）、Python 11/11 PASS**；`npm run check` exit 0。
- 唯一 SKIP：官方 R4-007 真实 Windows symlink（EPERM）；索引级 120000 已独立验证。
- 独立探针：
  - R6-002 伪造双审 4/4（1 个无证据拒绝 + 2 个伪造通过 + 1 个重复 agentId 拒绝）；
  - R6-003 签名 15/15（含 nonce 重放观察）；
  - R6-004 P0/HMAC 15/15；
  - R4-005 本地 11/11、远端 16/16；R4-006/007 25/25；R2-009 50/50；R3-004/005 5/5；R2-006 14/14。
- **Codex：NOT_AVAILABLE**，实际 113,788 tokens 后 429/重试上限，无报告。
- **OpenCode 1.19.3：COMPLETED**（exit 0，3,254 bytes，`magpie/group/deepseek-v4-pro`）；技术事实与主审基本一致，但其 `CODE_VERDICT: PASS` 与自身 R6-002/R6-003 `NOT_CONFIRMED` 矛盾，**不采纳**，详见 `CROSS_REVIEW_VALIDATION.md` 与 `OPENCODE_REPORT.md`。
- Paseo 本机：**PASEO_SDK_STATUS PARTIAL**；codex/opencode 各一次短 Prompt 成功，详见 `PASEO_SDK_LIVE_REPORT.md`。

---

## 8. Paseo 本机 SDK 摘要

- App/Daemon/CLI **0.15.3**；项目声明 **0.15.2**；App 内置 **0.15.3**。
- Daemon PID 9844，监听 `127.0.0.1:6767`（`/ws`）和 `56170`；HOME `D:\Paseo-data\home`。
- 0.15.2 与 0.15.3 均可连接 `/ws`；`ws://127.0.0.1:6767`（无 `/ws`）挂起 >20s。
- codex `group/qwen-3.8-flash`：agentId `ec3595a0…`，status idle，lastMessage 预期 JSON，6.3s，input 15,973/output 42。
- opencode `magpie/opencode-zen-free/deepseek-v4.1-flash-free`：agentId `d715c192…`，status idle，lastMessage 预期 JSON，10.9s，input 10,816/output 76。
- `agents.list({})` 默认看不到 background agents；`includeBackground:true` 可见，entries 形状 `{agent:{...}}`；`ref(id).refresh()` 可按 ID 对账；`current()` 首次 null。
- `waitForFinish` 返回 `status/lastMessage`；`usage` 为 null，`refresh().lastUsage` 有 token。
- CLI `daemon status` 1500ms `DAEMON_REQUEST_TIMEOUT`，但 daemon reachable；健康检查不能只看该命令。
- `src/agents.mjs` 精确 `providerOptions` live 未执行（避免每 provider 第二次付费调用），**NOT_VERIFIED**。

**Paseo 成功仅证明 SDK/Agent 接口可用，不等于真实 P1 双审/Tester/双机 P0/隔离/部署放行。**

---

## 9. 四层边界

| 层 | 状态 |
|---|---|
| A. 代码级字段/事件完整性 | **部分实现**：哈希链、artifact digest、状态机、Ed25519 人工 Gate、Git/P0 校验；但 Reviewer/Tester/P0 原始证据仍 Controller 自造。 |
| B. 真实人工身份认证 | **代码级 Ed25519 已实现；部署私钥/操作者身份 NOT_VERIFIED** |
| C. 外部不可变证据锚 | **NOT_VERIFIED**（仅本地 SQLite/文件） |
| D. 真实 P0 身份/HMAC | **代码级 HMAC/物理 ID 校验通过；真实远端两机 NOT_VERIFIED** |

---

## 10. 必须保持 BLOCKED / NOT_VERIFIED

1. **R7-001 BLOCKER**：伪造 dispatch/Reviewer 记录可通过双审。
2. **R7-002 HIGH**：Gate 5.9 人工签名不绑定 Reviewer/Tester/P0 原始证据。
3. **R7-003 MEDIUM**：Gate approval nonce 未持久消费。
4. **R6-001/R6-002/R6-003 PARTIAL**；R6-004/005 FIXED but real P0 not verified.
5. Windows SID/ACL/Job Object、TEST_ONLY、Soul V2.1/交付物映射未验收。
6. 真实 Paseo SDK providerOptions 精确 payload、运行中超时/断线/取消、重启对账未验收。
7. 真实 5bao/9bao/rusty 双物理 P0、第三席 600 秒、Linux 进程组取消未验收。
8. 外部不可变锚、独立审批客户端/私钥托管未部署。

---

## 11. 只读边界与环境完整性

- 未修改被审仓库源码；未修改 main、PR #1～#6、修复分支或历史证据；仅向新建 `audit/s0-20989c6-evidence` 新增 `audit/evidence/`。
- 未启动/停止/重启/配置/接管 Paseo App/Daemon；只读探测 PID 9844/4076/2372。
- 未访问远端 5bao/9bao/rusty；未执行远端 P0/SSH；未执行完整 P1。
- 未修改 Hermes/Codex/OpenCode/Paseo 配置或凭据；仅临时目录安装 SDK 0.15.2/0.15.3 并运行短 Agent。
- 完成 2 次真实本机 Agent 调用（codex/opencode 各 1 次），无自动重试；cwd 为临时目录。

### 环境完整性（本审计前后）

| 文件 | 审计前 SHA-256 | 审计后 SHA-256 | 结论 |
|---|---|---|---|
| `C:\Users\KK\.codex\config.toml` | `3ee33c0ad9633ea41ce90bea5b5e3be1b02a8b576d0fed7a73f2656e78a836aa` | 同左 | 未变 |
| `C:\Users\KK\.config\opencode\opencode.jsonc` | `1652e9626f1dbee1c505fb539a96b6145bf59173f879e0fed174e5678c3a40ea` | 同左 | 未变 |
| `C:\Users\KK\AppData\Local\hermes\config.yaml` | `21dea749e82a00ff9750c279f2dbeff3e64dbe745ad9d5640823fb7bf6b99bba` | 同左 | 未变 |
| `D:\Paseo-data\home\config.json` | `f5042763cce3540cd99bda70718fe407e3d4b83c437a975cd7a3c0318d6f4e17` | 同左 | 未变 |

---

## 12. 交付物

- 被审固定 Commit：https://github.com/k176060444-lgtm/Paseo-workflow/commit/20989c60226562a51886d5a979e773fecc7e4ddb
- 证据分支：`audit/s0-20989c6-evidence`
- 证据根目录：`audit/evidence/20989c60226562a51886d5a979e773fecc7e4ddb/`
- `AUDIT_REPORT.md`、`FINDINGS.json`、`TEST_RESULTS.txt`、`TEST_SUMMARY.json`、`CROSS_REVIEW_VALIDATION.md`、`PASEO_SDK_LIVE_REPORT.md`、`ENVIRONMENT.json`、`EVIDENCE_MANIFEST.json`、`OPENCODE_REPORT.md`、`CODEX_REPORT.md`、`Paseo-S0-R6-20989c6-Review.zip`

**最终判定：** 代码 **FAIL**；Paseo SDK **PARTIAL**；真实集成 **BLOCKED**。R7-001/R7-002/R7-003 及第 10 节各项关闭前，不得进入 S1/S2 或真实工作流。等待用户下一步授权。