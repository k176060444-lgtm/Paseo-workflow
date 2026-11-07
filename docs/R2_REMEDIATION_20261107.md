# S0 / R2 代码整改说明（待独立复审）

- 原始审计基线：`6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4`
- 原始证据：`audit/s0-6c57a3d8-evidence` 分支，`FINDINGS.json`
- 本轮修复分支：`fix/s0-r2-hardening-20261107`
- **状态：候选整改，必须由 21bao 独立审计；真实 Paseo/SSH/模型调用/部署继续 BLOCKED。**

## 实现内容（提交不代表已验收）
| 审计 ID | 改动 | 限制 / 验证要求 |
|---|---|---|
| R2-001 BLOCKER | `Store.save` 在更新持久状态前校验完整账本；Controller 预检 catch 不得重新封存已损坏任务；恢复入口显式校验账本。 | 无可信备份/外部锚定时，不允许把被篡改数据库视为已修复；校验错误保持阻断，不自动恢复预算。 |
| R2-002 MEDIUM | `verify()` 对证据目录与 manifest 进行集合比对，检测登记失败/崩溃残留的孤儿文件，并拒绝后续自动写入。 | 当前属于**fail-closed 缓解**，尚未实现受控孤儿自动修复协议。保留原件，人工对账，不允许静默删除。 |
| R2-003 MEDIUM | `inspect()` 在同一 SQLite 读事务内读取任务、调度、事件和证据哈希。 | SQLite WAL 的 status 仍可能产生 `-wal/-shm` 辅助文件（R2-004）；主库字节未因此表示业务数据写入。 |
| R2-004 LOW | 本说明公开现有 SQLite WAL 只读语义和副作用。 | 不采用 `immutable=1` 在活跃 WAL 上隐藏副作用。 |
| R2-005 HIGH | 远端 Git helpers 和 Harness 统一使用最小允许环境。 | 真实 SSH、OpenCode 安全边界和密钥保管仍未验证。 |
| R2-006 HIGH | 本地和远端适配器接受以 JSON envelope 结尾的 Markdown/fenced 输出，并归一 legacy verdict。 | **只是解析兼容**；历史 Soul 的 V2.1 语义修订、输出产物映射、准确性和真实 Provider 输出仍未批准/验证。不能以此解除 F5。 |
| R2-007 MEDIUM | Windows runner 状态检查使用 Win32 进程查询而非 `os.kill(pid,0)`。 | Windows 查询只确认存活，不证明归属；Linux 进程组取消仍要实测。 |
| R2-008 MEDIUM | 早期无 Commit 的恢复要求 `--basis` 精确绑定冻结 TASK_SPEC/config digest，既有 Commit 保持 `--sha`。 | 恢复仍必须具备真实人工收据、无未决调度及完整账本。 |
| R2-009 HIGH | Git porcelain -z 原样解析，保留前导状态空格，分别验证 rename/copy 两端路径；add 之后复核 index、拒绝受保护路径及 symlink/gitlink。 | 本实现是路径/索引检查，**不能取代 Git hook、独立权限与提交后的完整凭据扫描**。需用独立测试复核不同 Git 版本/Windows NTFS 路径。 |
| R2-010 MEDIUM | 并行双审分席保留已完成角色的原始结果、Agent ID、证据摘要，再记录失败席并停线。 | 失败席仍是未决调度，不允许自动重派。 |

## 运行与审查

仅离线源码审查和一次性临时目录测试：

```bash
npm test
python -m unittest discover -s remote/tests -p 'test*.py' -v
```

- 新增 `tests/r2_regression.test.mjs` 和 `remote/tests/test_r2_runner.py`（合成数据与临时目录）。
- 必须保留原始 stdout/stderr、退出码、实际 OS/运行时版本和测试计数，不要引用模型自报 PASS。
- 本轮没有调用真实 Paseo、OpenCode、Codex、P0 或线上服务，也没有批准安装。

## 不可解除的阻断

1. Windows 21bao 的真实 Paseo 版本、认证、SDK/Daemon 和断连恢复。
2. Windows SID/ACL、Job Object、隔离账户与 TEST_ONLY 测试文件审查/归并。
3. 5bao/9bao 物理主机清单、SSH host key 及 HMAC 唯一性、真实 OpenCode JSONL。
4. P0 第三席真实 600 秒等待、Linux 进程组取消/零残留。
5. V2.1 Soul 修订及批准、报告 Markdown/JSON/测试收据完整映射。
6. 数据库 hash 链仍是本地**无密钥**摘要，不能声称能防止拥有全部数据库修改权的攻击者重新计算整个账本。
7. Git 提交敏感信息防护仍需系统级凭据扫描、审计和默认不推送生产分支。

**处理原则：若任一阻断项不满足，真实执行仍须 fail-closed。**