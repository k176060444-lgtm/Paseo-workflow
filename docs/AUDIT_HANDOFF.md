# 本地 Agent 独立审计与分阶段部署验证清单

## 初始限制

本仓库是用户授权的 V2.1 实施候选，GitHub 只做代码交付。请本地 Agent 保持独立结论，不把提交者的 12+1 离线测试说成真实联调通过。

现状（由用户提供）：21bao 为 Windows 且已有 OpenCode+Codex，但没有 Paseo；5bao、9bao 为 Debian，已有 OpenCode、没有 Paseo；rusty 是华为云远端，已具备自己的 Harness，可选、不强制。

## 阶段 S0 — 只读审计（立即可做）

- 针对固定 Commit 读取完整代码、Soul 迁移来源及 P1 V2.1 规则。
- 重点审计阶段/预算/Commit 绑定、不可重派、并行审查真正独立、B 测试独立、P0 多节点认证、恢复绕过、文件权限、子进程生命周期、Git 作业副作用。
- `npm test`、`npm run check`、`python3 -m unittest discover -s remote/tests -v`。报告实际 collected/pass/fail/skip 以及操作系统和路径。
- 所有发现按 BLOCKER/HIGH/MEDIUM/LOW 分类，附文件行号、复现过程或实际测试证据。
- **S0 不安装软件，不修改全局配置，不运行任何真实付费 Agent，不 push 生产分支。**

## 阶段 S1 — 在用户授权后准备本机（逐项批准）

- 备份现有 Codex、OpenCode、Hermes 的配置与版本及 hash，保证不覆盖原设置。
- 以独立服务/计划任务准备 Controller（不得成为 Hermes 网关子进程），Node 22+，建议 24 LTS；安装与测试 Paseo 本机 daemon+SDK。
- 检查 Paseo 实际识别到 Codex/OpenCode 的 Provider/model ID、版本、使用模式、model auth；不要盲填示例 `codex/gpt-5.5`。
- 验证权限映射、Soul 注入、实际模型与凭据路径、任务中断与终态；优先在 disposable repo 进行单次低风险只读探针，必须单独得到用户批准。
- 核验 Windows `git worktree`、文件 ACL、Node 进程树停止、SQLite WAL/SHM 生命周期、路径长度。

## 阶段 S2 — P0 远端（用户授权后）

- 5bao/9bao **只装远端 `p0_runner.py` 与密钥/配置**，不需要 Paseo；检查原有 OpenCode 的实际二进制与模型选择。
- 远端 `repo` 必须已经拥有本轮确切 Commit，不能把动态 HEAD 当作盲审对象。
- 每台节点生成各自至少 32 字节随机 HMAC key，仅线下/SSH 安全复制到对应节点和 21bao 本地受限目录；永不提交 GitHub。
- 固定 SSH known_hosts、主机身份、不同物理机清单。确认两份报告来自不同主机，验证错误密钥、旧 Commit、重复 Job、第三席 600 秒条件、失联停线。
- rusty 只在用户后续选择启用时，适配它现有 Harness 的命令+JSON 契约。不能因 rusty 不可达而阻止 5bao+9bao 双机有效结果。

## 阶段 S3 — 完整模拟与受控真实调用（必须另行获批）

- 验证 Gate 0.1/0.2/5.9、10+10 预算、无整改跳过、裁决条件、最终 Commit 重新 P0、异常重启先对账。
- 验证 Reviewer/Tester 的角色独立、写限制、真实测试收据和原生 CLI 事件。
- 使用固定 Commit 和权限限制构造失败注入，禁止自动重派、不允许凭模型自报 PASS 放行。
- 任何结论不确定 → BLOCKED/NOT_VERIFIED，提交用户裁定，不自动进入真实生产流水线。

## 输出报告格式

必须输出：审查 Commit SHA、环境和版本、S0~S3 每项的 VERIFIED/NOT_VERIFIED/BLOCKED、实际测试数量、可定位的证据、严重缺陷和可复现步骤、是否建议允许进入下一阶段（明确不等同生产部署许可）。如发生任何真实修改，先列文件差异并交用户批准；没有授权不得推送或部署。
