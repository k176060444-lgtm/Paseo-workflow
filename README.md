# Paseo-workflow — Hermes P1 Coding Pipeline V2.1

> **代码交付 / 待本地独立审计 / 默认禁止真实执行**。本仓库不是一键可投入生产的系统：尚未在用户的 Windows 21bao、Debian 5bao/9bao 或华为云 rusty 上联调；不得将离线测试 PASS 写成真实模型、OS 隔离或 P0 物理身份验收通过。

[Workflow 设计](docs/ARCHITECTURE.md) · [安全边界与未验证项目](docs/SECURITY.md) · [本地审计清单](docs/AUDIT_HANDOFF.md)

## V2.1 确认的业务规则

- QQBot/Hermes 是人机入口，独立 Controller 是**唯一正式工作流调度方**，Paseo 是本机 Codex/OpenCode Agent 执行层。
- Role Matrix 只决定模型、Harness、Soul；角色权限与 Gate 规则固定在代码，单个任务启动时快照+SHA256 冻结。
- Gate 0.1 人工批准目标/角色配置；Planner 输出 TASK_SPEC；Gate 0.2 人工批准精确 SHA；Worker、Spec/Quality 双审、Tester A 构成 **Gate A 最多 10 轮（含首轮）**。
- P0 至少 **2 台不同物理节点**有效盲审（5bao、9bao、rusty 三个候选；rusty 可不启用）；第三席在两份有效结果后最多再等 600 秒；每份报告必须绑定确切 Commit。
- P0 无需整改时跳过 Worker Remediation；仍需 Tester B。否则 Worker Remediation → 重新审查改动 → Tester B → **修改后的最终 Commit 必须重新 P0 盲审**；构成 **Gate B 最多 10 轮**，重审不刷新预算。
- Arbitrator 只在实质技术冲突时触发；不能替代真实测试或覆盖不合规的 P0 报告。
- Compliance Gate 在关键阶段转换及最终汇总检查状态、身份、版本、证据。真实违规**停线 + 人工批准后的受控恢复**；不保留自动 2 次合规回溯。
- 对账不清楚 **不自动重派**；Gate 5.9 等待人工批准，绝不自动 merge/push/deploy/restart/cleanup。

## 运行环境与技术选择

- Controller：Node.js **22+**（建议 24 LTS，Node 22 内置 `node:sqlite` 仍可能显示实验性警告）、SQLite 持久状态账本、原生 `git` 命令、Paseo TypeScript/JS SDK `@getpaseo/client@0.15.2`。
- 21bao：已安装 Codex 与 OpenCode，但**尚未安装 Paseo**。本项目不自动安装、修改原有 Harness、切换模型或调用收费 Provider。
- 5bao/9bao：已安装 OpenCode，**无需安装 Paseo**。提供独立 `remote/p0_runner.py`，通过已有 SSH 连接进行持久 Job 执行与查询。
- rusty：可选候选；远端执行器允许通过 `command`（argv + stdin JSON 请求/JSON 输出约定）运行 rusty 本身的 Native Harness，不强制 rusty 参加。未验证的命令不能填入后直接启用。
- 角色 Soul：`souls/*.md` 取自用户现有 [Hermes-Coding-Role-Souls](https://github.com/k176060444-lgtm/Hermes-Coding-Role-Souls) 和原 P1 Blind 文件。版本来源见 [SOUL_PROVENANCE](docs/SOUL_PROVENANCE.md)，旧 Soul 对 Pro-Audit/常驻 Arbitrator 的历史用语，必须在独立审计时与 V2.1 优先规则协调。

## 本地离线验收（不调用模型，不需要安装 Paseo）

```bash
node --version
npm test
python3 -m unittest discover -s remote/tests -v
npm run check
```

预期：Node 状态机/权限/P0 模拟测试及 Python 远端原生 Harness 模拟测试均应 PASS；这只能证明离线行为。

## 操作入口（**只读或初始化，不调用模型**）

先备份本地配置，再把 `config/role-matrix.example.json` 复制为不入库的 `config/role-matrix.json`；将 `project.repo` 改为**真实的本地目标代码仓库**，替换所有模型为本机**实际发现且已获批准的 Provider/Model ID**，明确 Gate 0.1 需要批准的测试命令。`config/intent.example.md` 也只是示例。

```bash
node src/cli.mjs help
node src/cli.mjs init --id TASK1234 --matrix config/role-matrix.json --intent config/intent.md
node src/cli.mjs status --id TASK1234
node src/cli.mjs verify --id TASK1234
```

`init` 会创建本地 `.p1-state/`；不调用任何模型。查看它输出的冻结配置 SHA。

正式 `approve` 需要人工可审的完整审批收据文件、`--actor` 和**一致的 SHA**。没有用户确认禁止由 Hermes/Agent 模拟用户审批。

**`run` 默认硬阻断**：只有完成独立本地审计、OS 隔离与角色权限验收、Paseo/模型真实联调、P0 身份和双机验收，并且人为提供 `P1_LIVE_ALLOWED=YES` 与 `P1_HOST_ISOLATION_ATTESTED=YES` 后才可能启动。环境变量仅是操作员确认，不是安全沙箱本身。不要为了使测试通过而打开它们。

## 文件导航

| 路径 | 用途 |
|---|---|
| `src/controller.mjs` | Gate 0.1/0.2/5.9、10+10 状态机、合规阻断、受控恢复 |
| `src/policy.mjs` | 固定角色权限、模型/Soul 冻结、Agent 输出契约 |
| `src/agents.mjs` | Paseo SDK 适配器，Agent ID/派发日志/Soul 注入 |
| `src/p0.mjs` | SSH/P0 Job Adapter、双节点认证、两席优先+第三席 600s |
| `remote/p0_runner.py` | OpenCode 或 rusty 原生 Harness 的远端持久 Job |
| `src/store.mjs` | SQLite 全事务阶段状态、哈希链、不可覆盖的证据文件 |
| `src/git.mjs` | 安全 Git worktree、候选 Commit、独立测试命令与原始日志 |
| `tests/`, `remote/tests/` | 完全离线、无付费 Provider 调用的自动化验证 |
| `config/*.example.json` | **未批准**的配置示例，不含凭据 |

## 出口边界

`Gate 5.9` 用户批准只会把工作流标记为 `CLOSED`，**不会自动执行生产发布**。本项目没有 Deploy/Merge/Push 生产环境命令。

本仓库在 Github 上可能公开；不要提交 Secret、HMAC 私钥、模型 API key、SSH 私钥或包含隐私的任务记录。P0 每台节点都需要独立的强随机本地密钥，5bao/9bao 的物理身份必须由部署人员独立核实。
