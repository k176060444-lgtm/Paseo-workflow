# S0 三节点 P0 整改：审计复审材料与证据交付

这里是实施者交付材料，不是独立审计报告，不代表 S0 PASS、P0 放行或生产部署批准。

固定代码复审对象：

```text
Commit ff80df8e9771225dbe4bfc37011403a47c104668
Tree   4b30348bca7b1bb3a766a345e77ec0a525fe2789
Parent b4bcfe93fde5a2538d87659c084881b6b25cf5b0
Branch fix/s0-three-node-p0-20261112t021428z
```

代码提交保留此前已冻结的 Tree。后续交付提交只增加本目录的压缩包、摘要和说明；独立技术复审必须以以上代码 Commit 为准。

## 下载与逐项材料

| 材料 | 链接 | 内容 |
|---|---|---|
| 审计复审材料包 | [Paseo-S0-review-ff80df8e9771.zip](Paseo-S0-review-ff80df8e9771.zip?raw=true) | 固定提交身份、源码包、完整代码 Diff、文件清单、R1–R7 对应表、原始任务、独立复审任务书 |
| 原始证据包 | [Paseo-S0-evidence-ff80df8e9771.zip](Paseo-S0-evidence-ff80df8e9771.zip?raw=true) | 25 个冻结证据文件及固定代码身份；包含全部已保留测试轮次、原脏树冻结、SDK 声明与来源记录 |
| 上一轮原候选包 | [Paseo-S0-candidate-4b30348bca-v2.zip](Paseo-S0-candidate-4b30348bca-v2.zip?raw=true) | 原样保存；其内部待提交状态属于历史记录，当前身份以 GIT_IDENTITY.json 为准 |
| 固定代码身份 | [GIT_IDENTITY.json](GIT_IDENTITY.json) | Commit/Tree/Parent、测试绑定与证据指纹 |
| 完整代码 Diff | [CODE_CHANGE.patch](CODE_CHANGE.patch) | 固定 Parent 到固定代码 Commit 的完整 binary-capable Git Diff |
| 完整修改文件清单 | [CODE_CHANGE_FILES.json](CODE_CHANGE_FILES.json) | 43 个路径及工作树/Git blob 摘要，其中 18 个源码/配置示例/测试/文档文件、25 个证据文件 |
| 独立复审任务书 | [REVIEW_INSTRUCTIONS.md](REVIEW_INSTRUCTIONS.md) | 固定 SHA 审查范围、硬门禁、禁止动作与输出要求 |
| 包与文件摘要 | [SHA256SUMS](SHA256SUMS) | 下载后的 SHA-256 校验 |
| 发布授权 | [PUBLISH_AUTHORIZATION.md](PUBLISH_AUTHORIZATION.md) | 本轮用户明确要求 push 的原话与范围 |
| R1–R7 对应表及残余风险 | [整改报告](../../../docs/S0_THREE_NODE_P0_REMEDIATION.md) | 修复、用例、来源、5bao+9bao 模拟结论、rusty 缺口及后续门禁 |

原始证据也可直接在 [上级目录](../) 查看：

- [最终 Node 全套日志](../13-final-complete-node.txt)：211 tests，210 PASS / 0 FAIL / 1 SKIP / 0 CANCELLED，exit 0。
- [最终 Python 离线日志](../14-final-existing-python.txt)：11 PASS / 0 FAIL / 0 SKIP，exit 0。
- [16 项静态检查](../15-static-checks.txt)：exit 0。
- [Q1 修复前](../01-q1-negative-before-fix.txt)：同 3 个负向用例失败，exit 1。
- [Q1 修复后](../02-q1-negative-after-fix.txt)：同 3 个负向用例通过，exit 0。
- [原脏树来源与摘要](../ORIGINAL_FREEZE.json)、[各轮证据来源及取代关系](../PROVENANCE.json)。

唯一跳过项是既有 `R4-007` 符号链接测试，原因为 Windows symlink 权限不足；不能计为 PASS。全部新 SDK/Witness 夹具使用模拟接口与临时测试密钥。测试日志是先前源码整改轮次的原件，本次仅发布固定对象及材料，没有重新运行测试或创建真实 Paseo Agent。

## 仍待验收

- rusty 仍为 P0_INELIGIBLE：独立会话、权限适配、OS 隔离、原生 Task 身份与 Witness 未闭合；认证专项通过不等于这些条件通过。
- 真实主节点的 Preflight V2、签名原始结果、可靠终止见证和实际 SDK/Daemon 对接未在本轮验收。
- deadline 不证明远端操作没有生效；未知创建/取消仍必须保留原 Job ID 和对账状态，禁止自动重派。
- 5bao+9bao 的源码接线与离线模拟已验证，真实双盲审没有执行。
- 后续独立固定 SHA 技术复审、Arbitrator、Pro-Audit 与 Gate 5.9 人工批准仍是独立门禁。没有发布独立审计 PASS，没有部署、合并或进入 S1–S6。
