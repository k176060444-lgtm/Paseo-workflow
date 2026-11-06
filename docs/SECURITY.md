# 安全模型、已知风险与验收硬闸

本项目仅在离线模拟环境运行过。生产/付费模型/真实远端调用一律标记 NOT_VERIFIED。`P1_LIVE_ALLOWED` 和 `P1_HOST_ISOLATION_ATTESTED` 是**人工操作开关**，不是安全证明。未经本地 Agent 验收，不得启用。

## 不可放宽的规则

1. 禁止把 API key、SSH 私钥、HMAC 密钥、凭据性日志上传到 GitHub 或其他云服务；文件中的 key path 不是密钥。用户不接受云端密钥保管。
2. `READ_ONLY`、`WORKSPACE_WRITE`、`TEST_ONLY` 固定于 `src/policy.mjs`。未支持的 Harness/权限必须失败关闭；`TEST_ONLY` 在 Agent 侧实际使用更严格的 READ_ONLY，由 Controller 在独立临时测试工作树运行已批准命令。
3. 执行测试命令仍可能通过脚本触碰工作区之外的路径、网络或系统进程。Git worktree 不是安全沙箱；真实运行前必须验证 Windows 受限账户、进程树终止、网络和文件系统边界，必要时使用独立 VM/container。
4. Paseo SDK 权限属于 Provider 原生机制，并不是 OS 级隔离证明；OpenCode `edit:deny` 若不禁止 `bash` 仍可能写入。模板禁用审查角色的 `bash`，最终隔离仍须测试。
5. Gate A/B 的 Agent 返回 `PASS` 不能替代原始测试退出码。Controller 的 `testRun()` 按配置冻结的 argv 实际执行，保留 stdout/stderr/退出码；测试集合充分性及测试文件增量如何合入正式 Commit，仍应由本地审计判断。
6. 远端报告以**每节点不同的 HMAC key**和 SSH 主机密钥校验，作用是阻止无密钥伪造与错误节点混用；不能证明物理身份，也不能证明上报的模型一定是实际计费模型。两台机器身份须人工核验，建议跨机器保留原始 SSH/模型调用记录并核验。
7. 若重连、超时、SSH Ack 丢失、进程崩溃，进入 `NEEDS_RECONCILIATION`。不能简单在 while 循环里再次提交相同模型/远端任务。
8. P0 submit 请求的 Job ID 确定性生成且入账；状态未知时不自动重派。远端异步执行器的真实后台进程行为在 5bao/9bao 尚未经验证。
9. `recover` 不是无条件继续执行按钮，必须独立核对可信阶段、有效批准、原有 SHA 与预算并重新验证下游。请在实机部署前特别审计该路径。
10. SQLite 哈希链只能发现简单篡改或非故意漂移；控制主机高级权限者可重写全部数据库。正式审计证据应额外做离机/独立锚定。

## 本次未验证的高优先级事项（不得声称已通过）

- **BLOCKER：** Node / Paseo 0.15.2 在 21bao Windows 10 LTSC 的启动、认证、SDK `systemPrompt` 注入、OpenCode 自定义 Provider 模型解析、实际模型身份和成本收据未实测。
- **BLOCKER：** 5bao/9bao P0 Runner + OpenCode JSONL 最终 JSON 的真实事件格式、权限和环境的适配未实测；远端 `OPENCODE_CONFIG_CONTENT` 应核验有效优先级及 Bash 禁令。
- **BLOCKER：** Windows 真正的 OS 级只读、TEST_ONLY 写权限、Git/test 子进程树 kill 与测试副作用边界未做独立验证。
- **BLOCKER：** 现有角色 Soul 有历史 Pro-Audit 和每轮 Arbitrator 表述；整体 V2.1 策略与 Soul 尚待人工合并/签准，不可把旧版本视为已获 V2.1 批准。
- **BLOCKER：** 任务冻结配置会包含用户意图及 Soul，SQLite 与 evidence 目录应受本机 ACL 保护；Windows ACL 和创建路径未实测。
- **BLOCKER：** Tester 原有 Soul 允许添加测试文件，而当前 Controller 为最小权限使用独立只读 Agent + 执行冻结测试命令；**完整 TEST_ONLY 新增测试文件、复核后合入 Commit 的实现尚未完成**。不得声称与旧 TDD 测试文件契约完全对齐。
- **BLOCKER：** 角色 Agent 最终 JSON 与原 Soul 要求的 Markdown 法定交付物尚未做完整字段映射与证据充分性自动验证。`outputSchema` 是 API 输入约束，不是推理真实性证明。
- **BLOCKER：** 部分异常/恢复路径仍需对具体任务历史版本进行安全恢复演练，不得仅以离线状态机测试替代生产恢复证明。

## 本次可以声明的事实

- Node.js 的模拟运行不依赖 `@getpaseo/client` 连接，不调用模型。
- `npm test` / Python `unittest` 使用了假 Agent、假 P0、假 Git 或短命本地测试仓库。
- `Gate 5.9` 只关闭 P1 工作流，不触发发布操作。
