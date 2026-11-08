# Paseo-workflow S0-R5 第六轮独立审计报告

**AUDIT_STATUS: COMPLETE**
**CODE_VERDICT: FAIL**
**LIVE_INTEGRATION_STATUS: BLOCKED**

- 被审固定 Commit：`be0bc89dc4813cf1152399128a3caa34a12f4d70`
- 基线 Commit：`5fa4a8ad1083c44c92e69f0fb84bdf900bd333ee`
- 实际父提交：`88a7af38c7c2472a8c67ef674e2395143b9c30ed`（中间修复 Commit；merge-base 为 `5fa4a8a…`）
- Tree：`91cf608442690fee0e5694aa6d068d3c416ea3e0`
- 整改说明：`docs/R5_REMEDIATION_20261108.md`
- 上一轮证据 Commit：`4b508c6173f6286ed6001a7ffbe98c42cae4cc91`
- 环境：21bao / Windows 10 19044；Node v26.6.0、npm 11.18.0、Python 3.11.15、Git 2.54.0.windows.1、Codex 0.166.0、OpenCode 1.19.3
- Paseo 只读探测：**Paseo.exe 正在运行（PID 4076 / 9844 / 2372，Session Services）**；不在 PATH；updater installer 存在（145,569,446 bytes）。本轮**未启动、停止、更新、配置或接管**任何 Paseo App/Daemon；所有测试使用 fake runtime/一次性仓库。
- 范围：固定 Commit 静态审查、本机 Windows 离线 Node/Python 原始套件、独立对抗探针、Codex/OpenCode 独立复审、证据上传。**未部署、未合并、未做真实 P1/SDK/SSH/P0 调用、未修改生产配置。**

`FIXED` 仅指被列出的离线代码级子项，不代表真实身份、外部锚、真实 P0 或生产验收通过。

---

## 1. 决定性结论

### 1.1 R6-001（BLOCKER，新发现）— 公开 `Store.save + Store.artifact` 可伪造完整流程并 CLOSED

- 位置：`src/store.mjs:76-330`、`src/controller.mjs:23-40`、`src/git.mjs:140-176`。
- 独立探针 `probes/r5_forged_flow.mjs` 只用公开 API，不使用 `tests/fixtures.mjs`、不直接改 SQLite，18/18 步成功：
  1. `Store.artifact('approval-0-1.json', {gate:'0.1',digest,actor:'fake-human',receipt})` → `save(GATE_0.1_APPROVED)`。
  2. `Store.artifact('TASK_SPEC.md', spec)` → `save(TASK_SPEC_CANDIDATE)`。
  3. 伪造 `approval-0-2.json` → `save(GATE_0.2_APPROVED)`。
  4. 真实一次性 Git repo 的 base/child → `WORKTREE_PREPARED`/`A_COMMIT_FROZEN`（Git 验证通过）。
  5. **`A_REVIEW_PASS` 无任何 Reviewer artifact/history** → `A_TEST`。
  6. 伪造 `tester-a.json` + `TEST_RECEIPTS` + `GATE_A_PASS`。
  7. 伪造 `p0-evidence.json` + `P0_COMPLETE` + `P0_INITIAL_COLLECTED`（两条 fake physicalId）。
  8. `B_REMEDIATION_SKIPPED` → `B_TEST`；伪造 `tester-b.json` + `TEST_RECEIPTS` + `GATE_B_TEST_PASS`。
  9. 伪造 `final-compliance.json` → `WAITING_HUMAN_GATE_5_9`。
  10. 伪造 `approval-5-9.json` → `GATE_5.9_APPROVED` → **CLOSED / APPROVED_FOR_SEPARATE_RELEASE_REVIEW**。
- 结果：`verify()` 通过；`aRound=1,bRound=1`；最终仅有一个真实的、但未经任何评审/测试的 Git child；没有真实 Planner/Worker/Reviewer/Tester/P0/人工审批。
- 影响：**Gate 5.9 仍然只靠 DB 字段 + 已登记 artifact 的自洽关闭**，直接违反任务“Gate 5.9 不会仅凭字段自洽而 CLOSED”的要求。R5-001 不能判 FIXED。

### 1.2 R5-001（BLOCKER）— NOT_FIXED

- 已修子项：直接改 `stage/status` 超出白名单被拒；`GATE_0.1` 无 artifact 被拒；公开 `Store.event` 仅允许 `CONFIG_FROZEN/P0_OPTIONAL_NOT_DISPATCHED`；history 追加需要已登记 artifact 与允许事件；round-start 只能 +1 且在正确阶段。
- 未修子项：
  - `Store.artifact` 可伪造任何审批/Tester/P0/final-compliance 文件；
  - `A_REVIEW_PASS`/`B_REVIEW_PASS` 无 Reviewer 证据校验；
  - `#validateFinalGate` 只查字段/artifact 自洽；
  - 完整 18 步伪造链可 CLOSED。

### 1.3 R6-002（HIGH，新发现）— Reviewer 关卡可跳过

- 位置：`src/store.mjs` 的 `moves` 表（`A_REVIEW_PASS`/`B_REVIEW_PASS`）。
- 实测：`A_REVIEW/READY` 直接 `save(t,'A_REVIEW_PASS')` → `A_TEST/READY`，没有 spec_reviewer/quality_reviewer artifact、agentId、history 或 findings。伪造流第 8 步即使用该路径。
- 影响：同 Commit 独立双审可被完全跳过；后续 Tester/P0 只检查自己的 fake artifact。

### 1.4 R6-003（HIGH，新发现）— 人工审批只绑定自造 artifact 与字符串，不是身份认证

- 位置：`src/store.mjs:105-150`、`src/controller.mjs:23-40`。
- `#checkGateReceipt` 只检查 `receipt.gate/digest/actor/receipt` 字符串与已登记 artifact 的 digest；`actor`/`receipt` 无签名、无 OS 账户/SSH/HMAC 绑定。任何调用者可创建 `approval-0-1/0-2/5-9.json` 并填写 `fake-human`。
- 影响：代码级字段完整性 ≠ 真实人工授权。真实人工身份 **NOT_VERIFIED**。

### 1.5 R5-002（BLOCKER）— FIXED

- `Store.init()` 10/10 伪造拒绝：`WAIT_GATE_59`、`READY`、非零预算、预置 `TASK_SPEC`、`currentSha`、`lastB/P0`、非空 history、伪造 frozen digest、放大 policy、坏 Soul digest。
- 合法任务只从 `WAIT_GATE_01/WAITING_HUMAN`、零预算、无 spec/SHA/P0/Tester/历史开始。
- `tests/fixtures.mjs` 仅被 `tests/*.test.mjs` 引用；`src/`、`remote/` 无生产导入。它是显式测试 SQLite 重封装，不是生产后门。
- 残余：自洽伪造 frozen 仍可创建，Gate 0.1 需真实身份/外部锚（R6-003）。

### 1.6 R5-003（HIGH）— PARTIAL

- **已修**：`verifyCommitEvidenceSync` 检查对象存在、是 commit、base 是 final 祖先、previousSha 祖先、worktree HEAD 精确匹配。13/13 探针通过：真实 base→child 接受；缺失 SHA/tree/blob/错误祖先/HEAD 不匹配/缺失目录/previousSha 非祖先全部拒绝；Store `WORKTREE_PREPARED/A_COMMIT_FROZEN/B_COMMIT_FROZEN` 拒绝假 SHA；`Controller.approve` Gate 5.9 与 `authorizeRecovery` 拒绝假 SHA。
- **缺口 1（R6-004 HIGH）**：`Store.save(t,'GATE_5.9_APPROVED')` 不调用 `gitVerifier`；伪造流末步把 `store.gitVerifier` 换成抛错函数仍成功 CLOSED。只有 `Controller.approve` 路径验证 Git。
- **缺口 2（R6-005 MEDIUM）**：`new Store(root,{gitVerifier:()=>true})` 可用 stub 接受假 SHA 的 `WORKTREE_PREPARED`。构造器只断言“是函数”，不能证明是生产验证器；测试注入需要，但生产缺少不可关闭/身份证明。

---

## 2. R5-001～R5-003 结论

| ID | 严重度 | 结论 | 说明 |
|---|---|---|---|
| R5-001 | BLOCKER | **NOT_FIXED** | 白名单/事件边界/history 已修；公开 artifact 伪造 + 18 步链仍 CLOSED（R6-001）。 |
| R5-002 | BLOCKER | **FIXED** | init 严格 Gate 0.1/零预算/无预置；fixtures 仅测试引用。 |
| R5-003 | HIGH | **PARTIAL** | Git 对象/祖先/HEAD 与 Store 冻结/approve/recovery 已修；Store Gate 5.9 路径不重验 + 可注入 stub（R6-004/R6-005）。 |

**R5 统计：FIXED 1、PARTIAL 1、NOT_FIXED 1。**

---

## 3. 新发现

| ID | 严重度 | 标题 | 关键位置 |
|---|---|---|---|
| **R6-001** | **BLOCKER** | 公开 save+artifact 伪造完整流程并 CLOSED | `src/store.mjs:76-330` |
| **R6-002** | **HIGH** | A/B_REVIEW_PASS 无 Reviewer 证据 | `src/store.mjs` moves 表 |
| **R6-003** | **HIGH** | 审批只绑自造 artifact/字符串，无真实身份/外部锚 | `src/store.mjs:105-150`、`src/controller.mjs:23-40` |
| **R6-004** | **HIGH** | Store GATE_5.9 路径不重验 Git，worktree HEAD 漂移可不查 | `src/store.mjs:130-161,310-330` |
| **R6-005** | **MEDIUM** | 构造器可注入 `gitVerifier:()=>true` 关闭 Git 信任 | `src/store.mjs:17-20` |

**R6 统计：BLOCKER 1、HIGH 3、MEDIUM 1。**

---

## 4. R4-001～R4-007 回归

| ID | 结论 | 说明 |
|---|---|---|
| R4-001 | **NOT_FIXED** | 新的状态白名单挡住简单篡改，但 artifact 伪造链仍可 CLOSED（R6-001）。 |
| R4-002 | **PARTIAL** | frozen/pair/init 已修；TASK_SPEC/approval artifact 可伪造，Planner 无真实身份绑定。 |
| R4-003 | **FIXED** | artifact 事务/孤儿边界未回归；官方 R4-003 测试通过，文件/SQLite 非原子性仍按 fail-closed 记录。 |
| R4-004 | **FIXED** | 多 verdict 围栏保守拒绝。 |
| R4-005 | **FIXED** | 本地 11/11、远端 16/16；FAIL→PASS 不再发生。 |
| R4-006 | **FIXED** | 不可见前缀/NFKC/前导空格拒绝；中文正常名接受。 |
| R4-007 | **FIXED** | 完整 index 120000/160000/base `.env` 拒绝；真实 Windows OS symlink NOT_VERIFIED（索引级已验证）。 |

**R4 统计：FIXED 5、PARTIAL 1、NOT_FIXED 1。**

---

## 5. 旧 F1–F10

| ID | 结论 | 说明 |
|---|---|---|
| F1 | **FIXED** | PASS+findings/BLOCKER 仍拒绝。 |
| F2 | **MITIGATED_FAIL_CLOSED** | 代码侧两席/第三席/丢 ACK 通过；真实双机/600s/Linux 进程组 NOT_VERIFIED。 |
| F3 | **MITIGATED_FAIL_CLOSED** | 重复 key/物理 ID 拒绝；真实物理身份 NOT_VERIFIED。 |
| F4 | **FIXED** | 数字 timeout；真实 SDK 未验证。 |
| F5 | **NOT_FIXED** | 11 Soul blob 与 provenance 一致；6 个 legacy Souls 与法定交付物映射仍缺。 |
| F6 | **NOT_VERIFIED** | Windows SID/ACL/网络/Job Object、TEST_ONLY 未验收。 |
| F7 | **PARTIAL** | 事务/哈希链保持；R6-001/R6-003 开放。 |
| F8 | **PARTIAL** | 停线/R3-003 对账保护成立；R6-001/R6-003 开放。 |
| F9 | **PARTIAL** | 子进程 env 已修；raw log 未脱敏、ACL 未验证。 |
| F10 | **MITIGATED_FAIL_CLOSED** | 只读/WAL/inspect 已修；真实进程树未验证。 |

**F 统计：FIXED 2、PARTIAL 3、MITIGATED_FAIL_CLOSED 3、NOT_FIXED 1、NOT_VERIFIED 1。**

---

## 6. R2-001～R2-010

| ID | 结论 |
|---|---|
| R2-001 | **PARTIAL** |
| R2-002 | **FIXED** |
| R2-003 | **FIXED** |
| R2-004 | **FIXED** |
| R2-005 | **FIXED**（raw log/ACL 另计） |
| R2-006 | **PARTIAL**（F5 仍缺） |
| R2-007 | **FIXED**（Linux/远端未验证） |
| R2-008 | **PARTIAL**（R6-003） |
| R2-009 | **FIXED**（真实 OS symlink NOT_VERIFIED） |
| R2-010 | **FIXED** |

**R2 统计：FIXED 7、PARTIAL 3。**

---

## 7. R3-001～R3-008

| ID | 结论 | 说明 |
|---|---|---|
| R3-001 | **PARTIAL** | 公开 event 边界已修；save+artifact 伪造链仍开放（R6-001）。 |
| R3-002 | **PARTIAL** | frozen/pair 已修；Planner/TASK_SPEC 可伪造，恢复 basis 无身份。 |
| R3-003 | **FIXED** | NEEDS_RECONCILIATION 保留，不重派。 |
| R3-004 | **FIXED** | taskkill childEnv。 |
| R3-005 | **FIXED** | Popen child_env。 |
| R3-006 | **FIXED** | CLI 换行。 |
| R3-007 | **FIXED** | APPROVE_WITH_COMMENTS 严重度一致。 |
| R3-008 | **FIXED** | 唯一终止 verdict。 |

**R3 统计：FIXED 6、PARTIAL 2。**

---

## 8. 测试结果

完整命令、cwd、退出码、原始 stdout/stderr 见 `TEST_RESULTS.txt`、`TEST_SUMMARY.json`。

- **全量 257 项：241 PASS / 15 FAIL / 0 ERROR / 1 SKIP。**
- **有效产品 + 独立探针（排除旧夹具不兼容）：239 项：238 PASS / 0 FAIL / 1 SKIP。**
- 唯一 SKIP：官方 R4-007 真实 Windows symlink（EPERM）；索引级 120000 已独立验证。
- 15 个 FAIL 全部来自两个**旧探针夹具不兼容**批次：旧探针直接用 `Store.init` 造非 Gate 0.1 状态，R5-002 现在拒绝；更新后的官方 P0/F2/F3/F7 测试在 `npm test` 中通过。不是产品回归。
- 关键新探针：
  - 18 步公开 `save+artifact` 伪造链 → CLOSED（R6-001）；
  - init/event 13/13 拒绝伪造（R5-002）；
  - Git 13/13 拒绝假 SHA/非 commit/错误祖先/HEAD 不匹配/替换目录（R5-003）；
  - `r5_verifier_stub` 1/1 确认可注入 verifier（R6-005）；
  - R4-005 本地 11/11、远端 16/16；R4-006/007 25/25。

---

## 9. 独立 CLI 审查

### 9.1 Codex

- 命令：`codex exec -s read-only --skip-git-repo-check --ephemeral -C offline-copy -o CODEX_REPORT.md -`
- 结果：**NOT_AVAILABLE**，exit 1；实际运行 39,541 tokens 后 `429 Too Many Requests`；无报告；原文见 `CODEX_STDERR.log`。

### 9.2 OpenCode

- 命令：`opencode run --dir offline-copy --agent p1-audit --model magpie/group/deepseek-v4-pro --format default`
- 结果：**VALID**，exit 0，3897 bytes；`CODE_VERDICT: FAIL`。
- 独立确认：R5-001 伪造链、R5-002 init、R5-003 Git（含 Store Gate 5.9 缺口/可注入 verifier）、R6-003 四层边界；并确认正常流程无回归。
- 主审先完成 257 项测试并冻结结论，再读取报告；未提供 FINDINGS/探针结果。

详见 `CROSS_REVIEW_VALIDATION.md`。

---

## 10. 四层边界（严格区分）

| 层 | 状态 | 说明 |
|---|---|---|
| A. 代码级事件/字段完整性 | **部分实现** | 哈希链、artifact digest、状态白名单、Git 对象/祖先/HEAD；但 artifact 可自造，Gate 5.9 仍自洽。 |
| B. 真实人工身份认证 | **NOT_VERIFIED** | actor/receipt 仅字符串；无 OS 账户/SSH 签名/HMAC 主体。 |
| C. 外部不可变证据锚定 | **NOT_VERIFIED** | 仅本地 SQLite/文件；无时间戳/公证/外部锚。 |
| D. 真实 P0 身份/HMAC | **采集层部分实现，Gate 5.9 不复验** | P0 HMAC/物理 ID 测试存在；但伪造 DB 可在 Gate 5.9 绕过；真实多机未验证。 |

**不能把数据库自洽、模型输出 PASS 或伪造测试收据等同于真实业务证据。**

---

## 11. 必须保持 BLOCKED / NOT_VERIFIED

1. **R6-001 BLOCKER**：公开 `save+artifact` 可伪造完整流程并 CLOSED；R5-001/R4-001 不能判 FIXED。
2. **R6-002 HIGH**：Reviewer 关卡可跳过。
3. **R6-003 HIGH**：人工审批无真实身份/外部锚。
4. **R6-004 HIGH**：Store Gate 5.9 路径不重验 Git。
5. **R6-005 MEDIUM**：可注入 `gitVerifier` 关闭信任。
6. R5-003 PARTIAL、R4-002 PARTIAL、R3-001/R3-002 PARTIAL。
7. Windows SID/ACL/网络/Job Object、TEST_ONLY 未验收。
8. 真实 Paseo SDK/daemon、远端 OpenCode、双物理机 P0、第三席 600 秒、Linux 进程组取消未验收。
9. 真实 Windows OS symlink、Soul V2.1 迁移、法定交付物映射未完成。

**处理原则：上述任一项未满足，真实执行必须 fail-closed；不得以离线测试 PASS、CI PASS 或模型意见解除。**

---

## 12. 只读边界与环境完整性

### 已确认未执行

- 未修改被审仓库源码；未修改 main、PR #1～#5、修复分支或历史证据分支；仅向新建 `audit/s0-be0bc89-evidence` 分支新增 `audit/evidence/`。
- 未启动、停止、更新、配置、接管 Paseo App/Daemon；只读探测到 3 个 Paseo.exe 进程及 updater installer。
- 未 SSH 到 5bao/9bao/rusty；未做远端 P0/A2A；未分发密钥。
- 未调用真实 Paseo SDK/Harness 联调；OpenCode 仅只读静态审查，Codex 429 失败。
- 未修改 Hermes、Codex、OpenCode、Magpie/代理、系统 PATH、服务或用户工作目录；未读写真实密钥值。
- 未部署、未合并、未自动清理生产状态。

### 环境完整性（本审计前后）

| 文件 | 审计前 SHA-256 | 审计后 SHA-256 | 结论 |
|---|---|---|---|
| `C:\Users\KK\.codex\config.toml` | `3ee33c0ad9633ea41ce90bea5b5e3be1b02a8b576d0fed7a73f2656e78a836aa` | 同左 | 本审计前后未变 |
| `C:\Users\KK\.config\opencode\opencode.jsonc` | `1652e9626f1dbee1c505fb539a96b6145bf59173f879e0fed174e5678c3a40ea` | 同左 | 本审计前后未变 |
| `C:\Users\KK\AppData\Local\hermes\config.yaml` | `21dea749e82a00ff9750c279f2dbeff3e64dbe745ad9d5640823fb7bf6b99bba` | 同左 | 本审计前后未变 |

- Paseo：`Paseo.exe` PID 4076/9844/2372；updater installer 145,569,446 bytes；不在 PATH；未做任何启动/停止/更新/配置动作。

---

## 13. 交付物

- 仓库：https://github.com/k176060444-lgtm/Paseo-workflow
- 被审固定 Commit：https://github.com/k176060444-lgtm/Paseo-workflow/commit/be0bc89dc4813cf1152399128a3caa34a12f4d70
- 证据分支：`audit/s0-be0bc89-evidence`（以 `be0bc89` 为基线，仅新增 `audit/evidence/`）
- 证据根目录：`audit/evidence/be0bc89dc4813cf1152399128a3caa34a12f4d70/`
- 报告：`.../AUDIT_REPORT.md`
- 机器可读发现：`.../FINDINGS.json`
- 测试结果：`.../TEST_RESULTS.txt`、`.../TEST_SUMMARY.json`
- 交叉验证：`.../CROSS_REVIEW_VALIDATION.md`
- 环境完整性：`.../ENVIRONMENT.json`
- 证据清单：`.../EVIDENCE_MANIFEST.json`
- 独立报告：`.../OPENCODE_REPORT.md`、`.../CODEX_REPORT.md`（429 失败记录）
- 完整 ZIP：`.../Paseo-S0-R5-be0bc89-Review.zip`

**最终判定：** 代码 **FAIL**；离线测试全过不等于产品验收；真实集成 **BLOCKED**。在 R6-001、R6-002、R6-003、R6-004、R6-005 及第 11 节各项关闭前，不得进入 S1/S2 或真实工作流执行。等待用户下一步授权。