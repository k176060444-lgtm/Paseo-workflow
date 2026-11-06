# P1 V2.1 运行流程与接口契约

## 流程顺序（以 Controller 为准）

```
QQBot → Hermes
             ↳ Workflow Controller (独立本地进程 + SQLite)
                  Gate 0.1: 用户批准 intent + Role Matrix SHA
                  Planner (Paseo Codex/OpenCode) → TASK_SPEC
                  Gate 0.2: 用户批准 TASK_SPEC SHA
                  Prepare: git worktree --detach <approved base SHA>
                  ┌ Gate A (最多10轮，含第一轮) ─────────────┐
                  │ Worker TDD → 固定 Commit              │
                  │ [Spec Reviewer || Quality Reviewer]   │
                  │ Tester A + 独立真实测试收据 → Gate A   │
                  └───────────────────────────────────────┘
                  P0 Initial: 5bao/9bao (rusty optional), ≥2 distinct verified physical nodes
                  ┌ Gate B (最多10轮，含无整改时的首次验证) ┐
                  │ 无必须整改事项 → SKIP Worker Remediation│
                  │ 否则 Remediation → new Commit → 双审   │
                  │ Tester B + 独立真实测试收据            │
                  │ new Commit ? 再执行 P0(≥2节点) : 已覆盖│
                  │ 争议 ? 按需 Arbitrator : 不调用        │
                  │ FAIL ? 余下预算内再次整改 : PASS      │
                  └───────────────────────────────────────┘
                  Final Compliance Gate（确定性程序）
                  Gate 5.9 WAITING HUMAN → CLOSED (no deployment)
```

## 状态与计数不变量

- Gate A 由 `aRound` 计数，`A_WORKER` 进入时 +1；第10轮失败后 `STOPPED_BUDGET`。
- Gate B 由 `bRound` 计数，`B_ENTER` 进入时 +1；首次即使无整改仍计为第1轮。产生新 Commit 或再次远端 P0 均不重置。
- `RUNNING` 和 `INFLIGHT` 不等于成功。启动前写账本、收到 ACK 后保存 Agent/Job ID；Controller 异常退出后原任务可能仍在进行。
- 阶段转移前校验账本哈希、预算、角色权限；最终必须通过 commit=P0.commit=TesterB.commit 三方一致性。
- 遇到 `QUESTION`、`NEEDS_SPECIALIST`、权限或身份不明，不能由大模型自行批准 Gate。
- 合规问题不能作为普通技术失败自动吃掉下一轮预算。`BLOCKED` 只允许凭人工收据受控恢复；`NEEDS_RECONCILIATION` 本项目不自动清理或重派。
- 审查两席必须绑定相同 Commit，并有不同 Agent ID；是否是实际独立推理和隔离环境仍须本地证据验收。

## Paseo Client Adapter

使用 `client.agents.create({ config:{provider,systemPrompt,options}, cwd, prompt, outputSchema, background:true, labels })`，然后等待 `waitForFinish()`。`idle` 只意味着 Agent 轮次结束，不意味着任务通过；仅当最终 JSON 通过结构校验、随后满足 Git/测试/P0/Compliance Gate 时才能放行。

`@getpaseo/client` 调用依据：
- https://github.com/getpaseo/paseo/blob/6c1b48d2962ec6a48d5a553e312dfcc1f94e2e7a/public-docs/sdk/reference.md
- https://github.com/getpaseo/paseo/blob/6c1b48d2962ec6a48d5a553e312dfcc1f94e2e7a/public-docs/sdk/provider-options.md

**版本锁定说明：** 固定使用所研究源码包的 0.15.2，不代表用户本机当前已安装此版本。真实调用需要先验收安装与版本兼容。

## P0 Transport

通过 `ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes <alias> python3 /path/p0_runner.py <submit|status> --config /path/config` 通信；SSH 已知主机密钥需要在本机预先可信固定。`submit` 的输入 JSON 从 stdin 传送，不拼接 Shell 命令字符串；远端命令名和路径做单引号转义。

远端收到任务后以 `jobId` 创建持久 `spec.json`，异步运行 native OpenCode 或可选 rusty harness；重复 Job ID 且内容相同返回 EXISTS，内容不同则拒绝；`status` 回传 HMAC-SHA256 签名的报告。

必须验证报告的 `jobId/nodeId/commit/harness/model/exitCode/clean/findings`，且使用不同物理 ID 及独立节点密钥。**密钥签名不证明真实物理机器，不证明实际模型或完全只读**：这些仍由可信 SSH 身份、机器清单、远端测试与人工审计建立。

P0 第三席额外等待只在两席有效之后开始，最多 600 秒；只有一席有效永远不能 PASS。所有有效报告必须纳入判断，不能忽略有冲突的第三份报告。

## 恢复与审批

`init` 冻结 manifest；`approve --gate 0.1 --digest <manifest>` 后才允许 Planner；`approve --gate 0.2 --digest <TASK_SPEC>` 后才允许 Worker；`approve --gate 5.9 --digest <finalSHA>` 仅标记 CLOSED，不部署。

`recover` 仅允许已明确 BLOCKED、非 INFLIGHT 的任务，并保留人工批准收据。此恢复接口不支持自动跳过任一 Gate，且不能把一次 FAIL 改写成历史 PASS。需要重放的下游验证必须重新执行。

**历史入库证据为本地哈希链，非不可篡改的外部公证。** 特权本机攻击者可以重写数据库及整条链，部署方必须另行建立独立证据存储或签名锚定。
