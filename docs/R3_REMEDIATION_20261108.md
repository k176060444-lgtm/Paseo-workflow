# S0-R3 修复说明（独立复审候选，不表示已通过验收）

**审计输入**：固定代码 Commit `53bdaf2219292169ba4a24ef2f558c45bc26ddcf`，审计证据 Commit `f38604e7cc25f97802ff3b511cc26c48a3c666e3`，`FINDINGS.json` / `AUDIT_REPORT.md`。  
**分支**：`fix/s0-r3-ledger-boundaries-20261108`。  
**约束**：main、旧修复 Commit 和全部旧审计证据不修改；无生产部署、无 Paseo/Harness/远端 P0 调用。

## 修复与验证索引

| 发现 | 修复位置 | 验收重点 |
|---|---|---|
| **R3-001 BLOCKER** | `src/store.mjs` | `event()` 独立调用先开启立即事务并校验全部账本；仅 Store 内部已经校验、已修改行的同步写入可经私有标志追加事件。P0 probe-skip、CONFIG_FROZEN 等外部调用同样受保护，事件不可 re-anchor 篡改预算。 |
| **R2-009 HIGH** | `src/git.mjs` | 在原始 Git porcelain -z 与 staged index 检查中，按组件拒绝前后空白、尾点及危险格式字符；同时对 NFKC 规范化后的 basename 执行敏感路径匹配。覆盖 `" .env"`、`"sub/ .env"`、隐形前缀及正常文件正例。 |
| **R3-002 MEDIUM** | `src/controller.mjs` | 人工恢复入口在允许任何 artifact 或状态事件前重算冻结配置和 TASK_SPEC 的摘要，并执行程序化合规校验。 |
| **R3-003 MEDIUM** | `src/controller.mjs` | `run()` 最先校验持久账本，保留 `NEEDS_RECONCILIATION` 和所有 inflight 状态、原因、调度收据；不再因 live 预检开关缺失覆盖状态。 |
| R3-004 / R3-005 | `src/git.mjs` / `remote/p0_runner.py` | Windows `taskkill`、远端 `Popen` 均传最小 child env。 |
| R3-006 | `src/cli.mjs` | CLI usage 恢复命令显示真实换行。 |
| R3-007 | `src/p0.mjs`、`remote/p0_runner.py` | APPROVE_WITH_COMMENTS 携带明确 LOW/MEDIUM/INFO/ADVISORY 归一判决；P0 有未决 findings 时**依旧不得判 passed**，不因此降低业务 Gate。HIGH/无标记 findings 继续拒绝或 FAIL。 |
| R3-008 | `src/policy.mjs`、`remote/p0_runner.py` | 接受终止于 JSON 对象的缩进/多行/代码围栏输出，不接受后接文字、不对任意 Markdown 冒认 PASS。 |

## 保留的安全与业务边界

1. **仍不能进行真实 P1 Agent 调用或部署。** S0 回归通过不等于 Paseo SDK、Windows Job Object、SID/NTFS ACL、网络隔离、TEST_ONLY、远端 OpenCode、双物理主机、第三席 600 秒和 cancel 生命周期已通过。
2. **F5 Soul V2.1 迁移未擅自改写。** 历史 Soul、输出文件契约和 Approval/Pro-Audit 文本需要用户另行审核批准，不能靠解析兼容掩盖。
3. SQLite hash 链本地摘要**不能抵抗能直接重算整库事件链的入侵者**；真实安全部署仍需要外部不可变证据锚定与最小 OS 权限。
4. P0 报告含非阻断性意见时，解析器可保留 APPROVE_WITH_COMMENTS，但最终 P0 `passed` 仍要求所有席位正确 Commit、无未解决 findings、无失败。这个保守约束不自动放松。
5. 21bao 可**独立**准备 Paseo Windows App。App 基础安装不改变 S0 FAIL / LIVE BLOCKED，也不自动接入本 Controller。本分支不修改任何本地运行配置。

## 只读代码与离线测试

```sh
npm run check
npm test
python3 -m unittest discover -s remote/tests -v
```

新增 `tests/r3_regression.test.mjs`、`remote/tests/test_r3_runner.py`；保留旧 R2/原始测试并调整旧人工恢复模拟 fixture，使其使用带真实自校验摘要的合法冻结配置。

审计人须独立复查 Git 原始字节路径、所有事件调用路径、并发事务、恢复条件与前后环境完整性。**探针 PASS 可表示成功复现一个缺陷，不能直接作为产品 PASS。**

本次代码改动不授权合并 Draft PR、不修改审核证据分支、不安装或调用付费模型。