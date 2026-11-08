# S0-R7 独立 CLI 复审与交叉验证

## 1. 执行状态

| CLI | 命令/模型 | 退出码 | 输出 | 结论 |
|---|---|---|---|---|
| Codex 0.166.0 | `codex exec -s read-only --skip-git-repo-check --ephemeral` | **1** | 无报告；`429 Too Many Requests`；tokens **48,920** | **NOT_AVAILABLE**；未无限重试 |
| OpenCode 1.19.3 | `opencode run --agent p1-audit --model magpie/group/deepseek-v4-pro`，只读 | **0** | `OPENCODE_REPORT.md`，**6,509 bytes** | **COMPLETED**；`CODE_VERDICT: FAIL`；`EXECUTION_ATTESTATION_STATUS: NOT_DEPLOYED` |

两边均先独立读取源码；主审未回喂探针结果。

---

## 2. OpenCode 关键意见与主审核对

| 争点 | OpenCode | 主审核对 |
|---|---|---|
| R7-001 字段绑定/错误签发者/篡改/跨域 | CONFIRMED，`auth.mjs:85-86`、`81`、`78` | 一致；主审补测正确测试签名双席、跨 Commit、同钥、旧时效 |
| 真实签发端 | NOT_CONFIRMED：`agents.mjs:54`、`git.mjs:134` 无 attestation；仅测试 fixture | **一致，且升级为 R8-001 BLOCKER**：正常生产路径在首个 `ROLE_TERMINAL`/Tester 停线 |
| human/execution 同钥 | NOT_CONFIRMED：不检查 Map 交集 | **一致，R8-002 HIGH**；主审实证同一 PEM 双域被接受 |
| execution 旧签名 | NOT_CONFIRMED：无 issuedAt 下界 | **一致，R8-003 MEDIUM**；主审用 24 小时前签名实证接受 |
| R7-002 evidenceRoot | CONFIRMED；late artifact 拒绝；无竞态窗口 | **基本一致**；主审 9/9 另测添加/删除/raw 篡改/dispatch；但发现 **R8-005** 失败审批 artifact wedge，OpenCode 未覆盖 |
| R7-003 nonce | CONFIRMED；复合键/回滚/`_nonce_sha256` | **一致**；主审 6/6 补测跨 Gate/恢复/强制失败回滚；旧账本迁移 NOT_VERIFIED |
| Paseo SDK URL/list/refresh | CONFIRMED | **一致**；主审补实际只读 2 个 background Agent、status=closed、wait=idle |
| 正常流程/回归 | NOT_CONFIRMED（mock 与生产断裂） | **一致**：77 项测试用测试 witness；生产 `git.testRun` 无 attestation；R8-001 |

---

## 3. 关键分歧/裁定

1. **OpenCode 的 R7-002 “无竞态窗口”不覆盖失败审批 artifact。** 其分析聚焦 compliance 生成后 late artifact，未检查 `Controller.approve` 先写 `approval-*.json` 再 `save` 的失败路径。主审独立探针 5/5 复现：非 nonce 失败/后续 save 失败留下已登记 approval 文件，重试 EEXIST。因此 R7-002 **PARTIAL**，不是完全 FIXED。
2. **OpenCode 的 R7-003 “非 task_id 绑定是设计选择”** 与主审一致：复合键全局防重放，不构成漏洞；但旧账本迁移仍未验证。
3. **OpenCode 与主审均确认 R8-001**：代码契约正确但生产适配器不产出 attestation，测试 mock 与生产路径断裂。独立模型意见不能替代真实测试，但此处与主审实测一致。
4. **OpenCode 未发现 R8-002 的严重性定级**：它只列“不检查交集”，主审将其定为 HIGH，因为 human 与 execution 共用密钥直接破坏用途隔离。
5. **OpenCode 未发现 R8-004**：跨 Commit reviewer seat 可追加 history；主审探针显示不能通过当前 Gate，故定 LOW。

---

## 4. 结论

- **Codex：NOT_AVAILABLE**（48,920 tokens，429，无报告）。
- **OpenCode：COMPLETED**（exit 0，6,509 bytes；FAIL/NOT_DEPLOYED；技术发现与主审大体一致）。
- **主审最终：CODE_VERDICT FAIL；EXECUTION_ATTESTATION_STATUS NOT_VERIFIED/BLOCKED；PASEO_SDK_STATUS PARTIAL；LIVE_INTEGRATION_STATUS BLOCKED。**

`OPENCODE_REPORT.md` 原文作为证据上传；模型结论不替代真实测试。