# S0-R4 独立复审候选｜持久状态约束与最终判决信任边界

固定父提交：`fa157e1ce53374d539f4b5b5aa1129eccad7cb3b`；对应独立审计证据 Commit：`a37ed859ba57a46407d911c42c027595e2138e3a`。  
新代码分支：`fix/s0-r4-store-contracts-20261108`。  
**代码候选不等于审计通过；正式 P1 LIVE INTEGRATION 继续 BLOCKED。**

## 修复映射

| 审计问题 | 本轮行为 |
|---|---|
| **R4-001 BLOCKER** | `Store.save()` 在 `BEGIN IMMEDIATE` 内先 verify 可信旧状态，再对新状态执行严格迁移约束：冻结 config 不可变；A/B 轮次整数 0–10、单次最多 +1、不得递减，只能从对应 ROUND_START 事件递增；TASK_SPEC+SHA 必须同时存在/不存在，只能由 `TASK_SPEC_CANDIDATE` 首次建立并随后不可修改；history 保留完整前缀；baseSha/currentSha 只允许特定冻结事件变更。违反即回滚，不追加可信事件。 |
| **R4-003 BLOCKER** | `Store.artifact()` 写入、fsync、manifest INSERT 和 ledger append 都处在同一立即事务中。写盘前 verify，写盘后核对 state/dispatch/manifest/事件 head 均未发生变更；即便同连接同步回调在 fsync 中修改数据库也拒绝并回滚。若文件留下未登记孤儿，`verify()` fail-closed，**不自动清理证据**。 |
| **R4-002 HIGH** | Store 同时校验冻结 snapshot 不可替换、TASK_SPEC pair/hash 必须完整、首次冻结后不能变更；Controller 恢复入口重复校验 pair。只有摘要自洽不再足以通过 `save` 更新已存在的任务。 |
| **R4-005 HIGH** | 本地与远端逐个识别独立行起始的 JSON verdict 对象，**仅接受唯一一个、且是终止对象**；FAIL 后 PASS、多个 verdict 围栏一律人工对账而不是默认最后一个 PASS。 |
| R4-004 LOW | 多 verdict 围栏保守拒绝，视为**有意的 fail-closed 契约**，不擅自根据「示例」标签选择胜出的判决。仅无重复 verdict 的最终 JSON 围栏可解析。 |
| R4-006 MEDIUM | Git 文件路径检查新增 `Cc`、`Cf`、`Default_Ignorable_Code_Point` 类别以及 Braille/Hangul 空白字符过滤；保留 NFKC 检查和按组件前后空白校验，中文常规文件名不需要全部禁止。 |
| R4-007 LOW | `validateStaged` 扫描**完整 Git index**，拒绝继承的 120000 symlink / 160000 gitlink，审查所有 index 路径；在 `prepare` 及 `commitWorktree`（包括无修改的工作区）验证。 |

## 审计侧重点

- 测试原件：`npm run check`、`npm test`、`python3 -m unittest discover -s remote/tests -v`。
- 新增 `tests/r4_regression.test.mjs` 和 `remote/tests/test_r4_parser.py`。注意之前测试曾依赖「公开 Store.save() 可篡改冻结状态」的行为；本轮已将其改为断言必须拒绝。旧并发 readSnapshot 夹具改为真实 `GATE_A_ROUND_START` 事件。
- 对抗测试需包含 **tamper→save→verify、tamper during fsync→artifact、TASK_SPEC pair/重算摘要、FAIL→PASS 双对象、多围栏、Unicode 类别、基线 symlink/gitlink**。
- 文件系统与 SQLite 不是一个事务：注册失败后留孤儿文件，系统必须保持 BLOCKED 等待人工查证，不允许声称文件写入完全原子。
- **安全边界声明：** 代码层守卫不构成同进程任意恶意代码的密码学隔离。拥有完整数据库和事件表写权限的攻击者可以重算无密钥哈希链；还需 OS 级只写账户约束、外部不可变锚、审批身份验证与原始文件证据。
- **F5/F6 没有借此放行：** Soul V2.1 迁移及法定报告映射、Windows SID/ACL/Job Object/TEST_ONLY、Paseo SDK/Daemon 真实连接、远端 OpenCode、双物理机独立盲审/取消与 600 秒窗口仍 NOT_VERIFIED/BLOCKED。
- 21bao 上独立运行的 Paseo Windows App 不由本次工作接管、不更改其任何配置、不调用模型。

请独立审核固定 Commit 的全部差异；原始 Node/Python 离线结果不能替代 21bao Windows 本机测试与后续真实集成。不要合并 Draft PR，不要解除部署门禁。