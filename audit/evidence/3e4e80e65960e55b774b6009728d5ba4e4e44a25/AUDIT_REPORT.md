# Paseo-workflow S0-R7 第八轮独立审计报告

**AUDIT_STATUS: COMPLETE**
**CODE_VERDICT: FAIL**
**EXECUTION_ATTESTATION_STATUS: NOT_VERIFIED/BLOCKED**
**PASEO_SDK_STATUS: PARTIAL**
**LIVE_INTEGRATION_STATUS: BLOCKED**

- 被审固定 Commit：`3e4e80e65960e55b774b6009728d5ba4e4e44a25`
- 基线 Commit：`20989c60226562a51886d5a979e773fecc7e4ddb`
- 实际父提交：`1e237028ab4029b38f6c48058a54a7520887c17f`
- Tree：`5743312c2e9f3595bee3fecc4819e935d0fcc73c`
- 整改说明：`docs/R7_EXECUTION_PROVENANCE_20261108.md`
- 上轮证据：`db6d0fe730d757bf02c313b4f4e5b62cdf7ce61b`
- 环境：21bao / Windows 10 19044；Node v26.6.0、Python 3.11.15、Git 2.54.0.windows.1、Codex 0.166.0、OpenCode 1.19.3、Paseo App/Daemon/CLI **0.15.3**、项目 SDK **0.15.2**（App 内置 0.15.3）
- 范围：固定源码审查、Windows 原始 Node/Python 套件、独立攻击探针、Codex/OpenCode 独立复审、Paseo 只读 SDK 验证、证据上传。**未部署、未合并、未执行完整 P1、未访问远端 P0/SSH、未修改 Paseo/Hermes 配置、未重启 Daemon。**

`FIXED` 仅指被验证的离线代码子项；不等于真实签发者、外部不可变锚、真实 OS 隔离或生产验收。

---

## 1. 决定性结论

### 1.1 R7-001 — **PARTIAL**

代码级执行见证已能挡住上一轮的公开 Store 伪造双审：

- 无 attestation 的 A/B Reviewer 席位 → 拒绝；
- 错误签发者、篡改 raw、替换 agentId/dispatchId、跨 Task/role/phase、错误签名、重复 agentId、单席 → 拒绝；
- 用一次性测试私钥签名的两席 A_REVIEW/B_REVIEW → 通过；
- 一成一败保留两席历史，但当前 Gate 不通过；
- 跨 Commit 的席位可被追加到 append-only history，但**不能通过当前 Commit 的 A_REVIEW_PASS**（R8-004 LOW）。

**但 R7-001 仍为 PARTIAL / BLOCKED：**

1. **R8-001 BLOCKER：生产适配器不产出 attestation。** `PaseoAgentRuntime.execute` 返回结果无 attestation（`src/agents.mjs:54`）；`git.testRun` 返回 tests 无 attestation（`src/git.mjs:134`）；而 Store 对 `ROLE_TERMINAL`/`REVIEW_SEAT_RECORDED`/`TEST_RECEIPTS` 强制要求（`src/store.mjs:558-559`）。真实 Controller 会在**首次 Agent 收据/Tester 收据**处停线；77 项测试使用的是测试 fixture 私钥加 mock `testRun`，CI 绿不代表生产路径可执行。
2. **没有真实、隔离的签发端。** 文档明确“外部见证签发端还未部署”；仓库无 Paseo/OS 见证服务，只有测试临时私钥。无法确认签发者确实查询了 Paseo session、provider、commit、role 和原始结果，而不是签 Controller 自述。
3. **R8-002 HIGH：human 与 execution 共用一个公钥被接受。** `loadTrustRoots` 没有跨域公钥指纹去重；同一 PEM 同时放入 human/execution 后，`verifyExecutionAttestation` 接受该 key 签的 execution statement。用途隔离只是命名约定。
4. **R8-003 MEDIUM：execution attestation 无 issuedAt 下界。** 24 小时前的签名被接受；nonce 只校验格式，不消费。

### 1.2 R7-002 — **PARTIAL**

- `final-compliance.json` 写入 `evidenceRoot`：规范化排序的 artifacts（name,digest）+ dispatches（id,phase,agent_id,state,created）；排除 final-compliance 和 approval-5-9。
- 独立探针 9/9：添加/删除 artifact、artifact raw 篡改、dispatch tamper、late artifact 均改变/破坏根，`verify` 或 Gate 失败。
- 人工 Gate 5.9 签名绑定 final Commit + compliance SHA + evidenceRoot；官方 late-evidence 测试通过。
- **R8-005 MEDIUM：失败审批留下已登记 approval 文件。** `Controller.approve` 先 `artifact()` 注册 `approval-*.json`，再 `save`；若 save 因 nonce replay/后续断言失败，文件保留，重试同一文件名 `EEXIST`，任务被 wedge，需人工清理。独立探针 5/5 复现。
- **外部不可变锚 NOT_VERIFIED**；并发快照/回滚未做独立并发测试；evidenceRoot 不是外部锚。

### 1.3 R7-003 — **PARTIAL**

- `consumed_approvals(key_id,nonce)` 复合主键；Gate 0.1/0.2/5.9/recovery 在 `BEGIN IMMEDIATE` 内消费；`_nonce_sha256` 进入事件链。
- 独立探针 6/6：消费后强制失败回滚、nonce 行回滚、重试可复用、跨 Gate 拒绝、跨任务 official、恢复 nonce 拒绝。
- **旧状态兼容 NOT_VERIFIED/BLOCKED**：新增表和 `_nonce_sha256` 不是旧账本自动迁移；文档要求人工迁移。旧生产状态不得直接运行此候选。

### 1.4 R8 新发现汇总

| ID | 严重度 | 结论 | 核心问题 |
|---|---|---|---|
| **R8-001** | **BLOCKER** | NOT_FIXED | 生产 `PaseoAgentRuntime`/`git.testRun` 无执行见证；正常任务在首个 Agent/Tester 收据停线 |
| **R8-002** | **HIGH** | NOT_FIXED | human/execution 允许同一 Ed25519 公钥；用途隔离未强制 |
| **R8-003** | **MEDIUM** | NOT_FIXED | execution attestation 无时效下界、nonce 不消费 |
| **R8-004** | **LOW** | NOT_FIXED | 跨 Commit reviewer 席位可追加 history（不能通过当前 Gate） |
| **R8-005** | **MEDIUM** | NOT_FIXED | 失败审批保留已登记 approval 文件，重试 EEXIST |

---

## 2. R7-001～R7-003 结论

| ID | 严重度 | 结论 | 说明 |
|---|---|---|---|
| R7-001 | BLOCKER | **PARTIAL** | 无签名伪造双审被挡住；正确测试签名双席通过；生产无签发端/适配、同钥、旧见证（R8-001～003） |
| R7-002 | HIGH | **PARTIAL** | evidenceRoot/5.9 绑定通过；失败审批孤儿/wedge、外部锚/并发未验证（R8-005） |
| R7-003 | MEDIUM | **PARTIAL** | 新账本 nonce 消费/回滚通过；旧账本迁移未验证 |

**R7 统计：FIXED 0、PARTIAL 3、NOT_FIXED 0、NOT_VERIFIED 0。**

---

## 3. 回归

| 组 | 结论 |
|---|---|
| R6-001 | **PARTIAL**（执行见证生产缺失） |
| R6-002 | **PARTIAL**（无签名伪造已挡；生产 attestor/同钥残余） |
| R6-003 | **PARTIAL**（新账本签名/nonce；旧迁移未验证） |
| R6-004 | **FIXED**（Store Gate 5.9 Git；P0 HMAC 15/15；真实远端 P0 NOT_VERIFIED） |
| R6-005 | **FIXED** |
| R5-001 | **PARTIAL**（R8-001） |
| R5-002 / R5-003 | **FIXED** |
| R4-001 / R4-002 | **PARTIAL**（R8-001/R8-002） |
| R4-003～R4-007 | **FIXED** |
| F1 | FIXED |
| F2 / F3 / F10 | MITIGATED_FAIL_CLOSED |
| F5 | NOT_FIXED（Soul V2.1/交付物） |
| F6 | NOT_VERIFIED（Windows 隔离/TEST_ONLY） |
| F7 / F8 / F9 | PARTIAL |
| R2 | FIXED 7 / PARTIAL 3（R2-001/006/008） |
| R3 | FIXED 6 / PARTIAL 2（R3-001/002） |

---

## 4. Windows 测试

**总计：268 项，266 PASS / 1 FAIL / 0 ERROR / 1 SKIP。**
其中 `FAIL` 是审计探针 `R7-001 cross-commit seat record`（缺陷观察，不是产品套件失败）；`SKIP` 是真实 Windows OS symlink（EPERM）。

| 批次 | 用例 | PASS | FAIL | SKIP | exit |
|---|---:|---:|---:|---:|---:|
| npm test | 77 | 76 | 0 | 1 | 0 |
| Python unittest | 11 | 11 | 0 | 0 | 0 |
| R7 attestation probe | 19 | 18 | **1** | 0 | 0 |
| R7 Tester production probe | 3 | 3 | 0 | 0 | 0 |
| R7 runtime production probe | 2 | 2 | 0 | 0 | 0 |
| R7 evidenceRoot probe | 9 | 9 | 0 | 0 | 0 |
| R7 nonce probe | 6 | 6 | 0 | 0 | 0 |
| R7 approval-orphan probe | 5 | 5 | 0 | 0 | 0 |
| R6 P0/HMAC regression | 15 | 15 | 0 | 0 | 0 |
| R4 parser local / remote | 11 / 16 | 11 / 16 | 0 | 0 | 0 |
| R4 Git paths | 25 | 25 | 0 | 0 | 0 |
| R2-009 paths | 50 | 50 | 0 | 0 | 0 |
| R3-004/005 env | 5 | 5 | 0 | 0 | 0 |
| R2-006/Soul | 14 | 14 | 0 | 0 | 0 |

- `npm run check` exit **0**。
- 官方 `npm test`：**77 项，76 PASS / 1 SKIP**，不是 CI 的 77/77；Linux CI 仅供对照。
- **R7-001 关键失败：** 跨 Commit reviewer 席位可追加 history；不能通过当前 Gate，但暴露 seat 写入未绑定当前 Commit 的缺陷。
- **R7-001 正常签名双席：** A/B 均通过；一成一败保留两席、Gate 拒绝。
- **R7-001 生产路径：** `PaseoAgentRuntime` 结果无 attestation → 拒绝；`git.testRun` 无 attestation → 拒绝；测试 witness 签名后才通过。
- **R7-002：** evidenceRoot 9/9；late evidence 官方测试通过；失败审批 wedge 5/5。
- **R7-003：** 6/6；official cross-task nonce 通过。

### CLI 独立审查

- **Codex 0.166.0：NOT_AVAILABLE** — 实际 48,920 tokens 后 `429 Too Many Requests`，exit 1，无有效报告；未无限重试。
- **OpenCode 1.19.3：COMPLETED** — exit 0，**6,509 bytes**，`CODE_VERDICT: FAIL`、`EXECUTION_ATTESTATION_STATUS: NOT_DEPLOYED`；技术意见与主审大体一致，未发现 R8-005，详见 `CROSS_REVIEW_VALIDATION.md` 与 `OPENCODE_REPORT.md`。模型结论不替代真实测试。

---

## 5. Paseo Windows 只读 SDK 验证

- App/Daemon/CLI **0.15.3**；项目声明 SDK **0.15.2**；App 内置 0.15.3。
- Daemon PID 9844，监听 `127.0.0.1:6767`（`/ws`）与 `56170`；HOME `D:\Paseo-data\home`。
- 既有 codex/opencode agents 只读查询：`includeBackground:true` 返回 2 条；默认 list 为空；entries 形如 `{agent:{...}}`，适配器正确解包。
- `ref(id).refresh()` 返回准确 Agent；`current()` 首次 null；`waitForFinish` 返回 idle 和原始 lastMessage；本轮**未新建付费 Agent**、未重跑模型。
- `PaseoAgentRuntime.open` 已拒绝缺失 `/ws`、非本地、userinfo/search/hash；官方测试通过。
- `listAllAgents` 使用 `includeBackground:true`，解包 `entry.agent`；`findExistingAgent` 使用 `refresh()`；未发现自动重派。
- **未验证：** 精确 `providerOptions`、取消/断线、Daemon 重启对账、真实执行见证；`PASEO_SDK_STATUS PARTIAL`。

---

## 6. 四层边界

| 层 | 状态 |
|---|---|
| A. 代码级字段/事件完整性 | **部分实现**：evidenceRoot、nonce、execution attestation 验证、Git/P0 校验；但生产适配器不产出 attestation（R8-001） |
| B. 真实人工/执行身份认证 | **代码级 Ed25519；真实签发端 NOT_VERIFIED/BLOCKED** |
| C. 外部不可变证据锚 | **NOT_VERIFIED**（仅本地 SQLite/文件） |
| D. 真实 P0 身份/HMAC | **代码级 15/15；真实远端两物理席 NOT_VERIFIED** |

---

## 7. 必须保持 BLOCKED / NOT_VERIFIED

1. **R8-001 BLOCKER**：生产 Paseo/Test 适配器无见证，正常 Controller 停线。
2. **R8-002 HIGH**：human/execution 同一公钥被接受。
3. **R8-003 MEDIUM**：execution attestation 无下界/nonce 不消费。
4. **R8-004 LOW**：跨 Commit reviewer history 污染。
5. **R8-005 MEDIUM**：失败审批 artifact wedge。
6. 真实独立签发端、Paseo session 查询、私钥托管、外部锚 **NOT_VERIFIED**。
7. 真实 5bao/9bao/rusty 双物理 P0、第三席 600 秒、Linux 进程组取消 **NOT_VERIFIED**。
8. Windows SID/ACL/Job Object/TEST_ONLY、Soul V2.1/交付物映射 **NOT_VERIFIED**。
9. 旧账本迁移、精确 providerOptions、取消/断线/重启对账 **NOT_VERIFIED**。

---

## 8. 只读边界与环境完整性

- 未修改被审源码或生产状态；未修改 main、PR #1～#7、修复分支或历史证据；仅将在新分支新增 `audit/evidence/`。
- 未启动/停止/重启/配置/接管 Paseo App/Daemon；仅只读探测 PID 9844/4076/2372。
- 未访问远端 5bao/9bao/rusty；未执行远端 SSH/P0；未执行完整 P1。
- 未修改 Hermes/Codex/OpenCode/Paseo 配置或凭据；未安装新 SDK；本轮 Paseo 只读查询既有 Agent，无新模型调用。
- 测试仅在独立临时目录构建一次性仓库/任务；未写生产项目文件。
- 环境哈希（审计前后一致）：Codex `3ee33c0a…`、OpenCode `1652e962…`、Hermes `21dea749…`、Paseo `f5042763…`；详见 `ENVIRONMENT.json`。

---

## 9. 交付物

- 固定 Commit：https://github.com/k176060444-lgtm/Paseo-workflow/commit/3e4e80e65960e55b774b6009728d5ba4e4e44a25
- 证据分支：`audit/s0-3e4e80e-evidence`
- 证据目录：`audit/evidence/3e4e80e65960e55b774b6009728d5ba4e4e44a25/`
- `AUDIT_REPORT.md`、`FINDINGS.json`、`TEST_RESULTS.txt`、`TEST_SUMMARY.json`、`CROSS_REVIEW_VALIDATION.md`、`PASEO_SDK_LIVE_REPORT.md`、`ENVIRONMENT.json`、`EVIDENCE_MANIFEST.json`、`OPENCODE_REPORT.md`、`CODEX_REPORT.md`、`Paseo-S0-R7-3e4e80e-Review.zip`

**最终判定：** `CODE_VERDICT: FAIL`；`EXECUTION_ATTESTATION_STATUS: NOT_VERIFIED/BLOCKED`；`PASEO_SDK_STATUS: PARTIAL`；`LIVE_INTEGRATION_STATUS: BLOCKED`。R8-001/R8-002 等未关闭前，不得进入 S1/S2 或真实工作流。完成后停止，等待用户下一步授权。