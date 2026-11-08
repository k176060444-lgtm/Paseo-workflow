# S0-R6 独立 CLI 复审与交叉验证

## 1. 执行状态

| CLI | 命令/模型 | 退出码 | 输出 | 结论 |
|---|---|---|---|---|
| Codex CLI 0.166.0 | `codex exec -s read-only --skip-git-repo-check --ephemeral`；`gpt-5.1-codex` 默认 | **1** | **无报告**；`ERROR: exceeded retry limit, last status: 429 Too Many Requests`；tokens used **113,788** | **NOT_AVAILABLE**（配额/限流；未自动重试） |
| OpenCode 1.19.3 | `opencode run --agent p1-audit --model magpie/group/deepseek-v4-pro`，只读 permission | **0** | `OPENCODE_REPORT.md`，**3,254 bytes**；原始 stderr 含 `→ Read ...` | **COMPLETED**；`CODE_VERDICT: PASS`（与其自身 NOT_CONFIRMED 矛盾，见下） |

两侧均未预喂主审结论；OpenCode 独立读取 `src/`、`tests/` 后形成报告。Codex 无有效报告，不能作为独立席。

---

## 2. OpenCode 对 R6 的逐项意见

| 项 | OpenCode 意见 | 主审核对 |
|---|---|---|
| R6-001 认证 Gate | **CONFIRMED**：`auth.mjs:31-58` 绑定 keyId/taskId/gate/digest/actor/receipt/evidenceSha256/nonce/issuedAt；`loadTrustRoots` fail-closed；Store.save 在事务内二次验证 | **一致**。但“认证 Gate”只覆盖人工审批，不覆盖 Reviewer/Tester/P0 执行（R7-001/R7-002）。 |
| R6-002 双审 | **NOT_CONFIRMED（独立来源）**：reviewer artifact/dispatch 全为 Controller 自录，无 HMAC/Ed25519；持 Store 句柄可伪造两席 | **与主审一致**，且主审用 4/4 探针实证；升级为 **R7-001 BLOCKER**，不是“仅架构限制”。 |
| R6-003 重放/过期 | **NOT_CONFIRMED（仅恢复消费 nonce）**：Gate 0.1/0.2/5.9 无 nonce 去重；防重放靠单次不可逆状态+绑定；30min/2min 窗口有效 | **一致**；主审实测同一 envelope 两次通过 `verifyHumanApproval`。正常状态机不可重放，但任务明确要求 nonce 测试；记 **R7-003 MEDIUM**。 |
| R6-004 Git/P0 | **CONFIRMED**：`store.mjs:176` → `verifyCommitEvidenceSync`；`p0.mjs:41-62` 校验 HMAC/job/commit/physicalId/model/harness/stdoutSha256；`store.mjs:211-214` TERMINAL、两物理席位 | **一致**；主审另做 P0 15/15 正反探针；真实远端 NOT_VERIFIED。 |
| R6-005 verifier | **CONFIRMED**：构造器 assert 拒绝；无 `this.gitVerifier` 属性读取；事务回滚 | **一致**；官方测试通过。 |
| Gate 5.9 证据来源 | **CONFIRMED（描述属实）**：final-compliance 仅绑定人工签名；Reviewer/Tester 原始证据 Controller 自录；P0 有 HMAC 节点签认；人工签名不证明执行真实性 | **一致**，对应 **R7-002 HIGH**。 |
| 回归 | **CONFIRMED**：测试覆盖 happy path、10 轮、一成一败、P0 冲突、错误审批、受控恢复；无嵌套事务/锁 | **部分一致**；官方 70/69+1 SKIP、Python 11/11，独立探针 155 项全过；OpenCode 未运行测试，其“回归 CONFIRMED”仅是静态阅读，**不能替代实测**。 |

---

## 3. 关键分歧与裁定

### 3.1 OpenCode 的 `CODE_VERDICT: PASS` 被拒绝

OpenCode 在同一报告内明确：

- R6-002 **NOT_CONFIRMED（独立来源）**；
- R6-003 **NOT_CONFIRMED（门级 nonce 未持久消费）**。

其给出的 `CODE_VERDICT: PASS` 解释是“架构性/信任域内限制，未构成对未授信 agent 的 fail-open”。主审不接受该裁定：

1. 任务书要求“同 Commit 双 Reviewer + Tester A”是**业务规则**，不是仅防未授信 agent；Controller 自录 dispatch/artifact 可伪造双审，直接违反规则。
2. 任务书要求“不能将 artifact 自洽当成来源认证”；R6-002 正是 artifact 自洽。
3. 任务书要求 nonce 重放测试；R6-003 未实现 Gate 级 nonce 消费，虽正常状态机难以重放，但仍属未覆盖项。
4. 模型输出 PASS 不能替代真实测试与主审证据；且该 PASS 与其自身 NOT_CONFIRMED 矛盾，按证据优先。

**裁定：OpenCode 的 PASS 仅作“模型意见”，不作为产品 PASS；最终 CODE_VERDICT 维持 FAIL。**

### 3.2 OpenCode 对 R6-001 的 CONFIRMED 与主审 PARTIAL 不矛盾

OpenCode 的 CONFIRMED 只覆盖“认证 Gate”实现本身；主审的 PARTIAL 覆盖“认证 Gate + 伪造 Reviewer/Tester/P0 仍可闭环”的整体 R6-001 目标。两者在“签名实现正确”上一致；在“无独立可信凭据不能 CLOSED”上，OpenCode 也承认 R6-002 可伪造，因此整体不能 PASS。

### 3.3 回归“CONFIRMED”仅静态

OpenCode 未运行测试（其报告自述“未运行测试”）；其对回归的 CONFIRMED 来自读取 `tests/`。主审以 Windows 实测 238 项（237 PASS/1 SKIP）为准。OpenCode 的“无嵌套事务/锁”与主审运行结果一致，可作辅助意见。

---

## 4. 主审独立证据与 CLI 对照

| 争点 | 主审实测 | OpenCode 静态意见 | 交叉结论 |
|---|---|---|---|
| 无签名 Gate | 拒绝（15/15 中） | 拒绝 | 一致 |
| 伪造双审 | **4/4 成功** | **NOT_CONFIRMED** | 一致（OpenCode 未运行） |
| 签名 nonce 重放 | 同一 envelope 两次通过 verify | **NOT_CONFIRMED（无 Gate nonce 表）** | 一致 |
| Gate 5.9 final-compliance SHA | 替换后拒绝 | 绑定正确 | 一致 |
| Git/P0 | P0 15/15 + 官方 R6-004 | 代码路径正确 | 一致 |
| verifier 注入 | 官方 R6-005 | assert 拒绝 | 一致 |
| 正常路径 | 官方 70/69+1 SKIP、Python 11/11 | 静态覆盖 | 一致 |

---

## 5. 结论

- **Codex：NOT_AVAILABLE**（429，113,788 tokens，无报告；未重试）。
- **OpenCode：COMPLETED**（exit 0，3,254 bytes；技术事实与主审基本一致；`CODE_VERDICT: PASS` 因与其自身 NOT_CONFIRMED 矛盾且不符合任务规则，**不采纳**）。
- **最终：CODE_VERDICT FAIL**；R7-001 BLOCKER、R7-002 HIGH、R7-003 MEDIUM 维持；PASEO_SDK_STATUS PARTIAL；LIVE_INTEGRATION_STATUS BLOCKED。

**独立性声明：** 两侧 CLI 均先独立读取源码并输出报告；主审在收到 OpenCode 报告后仅做逐条核对，未向其回喂主审探针结果。OpenCode 报告原文作为 `OPENCODE_REPORT.md` 一并上传。