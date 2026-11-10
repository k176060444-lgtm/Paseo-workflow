> **HISTORICAL ONLY (superseded 2026-11-10).** This document describes pre-remediation S0–R8 decisions and must not be used as current deployment instructions. 21bao/5bao/9bao now have Paseo installed; 5bao/9bao were reached by authenticated native SDK direct connections, not SSH. Current policy: no SSH in Coding, Planner detail only after Gate 0.2, process-only Pro-Audit PRE/POST every role, mandatory final Arbitrator, rusty native Hermes A2A only. See [current README](../README.md) and [remediation status](REMEDIATION_20261110.md).

# 21bao Paseo 安装/联调的分阶段建议（仅计划；未授权执行）

## 现在是否需要安装

建议在完成 S0 代码整改独立复审、准备进入 S1 时，仅在 21bao 安装 Paseo，利用本机现有 Codex/OpenCode 进行集成验证。无需先在 5bao/9bao 安装 Paseo；其 P0 使用独立 SSH Runner + 原生 OpenCode。rusty 可选、不强制。

## 安装之前

1. 使用独立测试目录、受限本机账户以及非生产代码库；固定本修复候选 Commit。
2. 只读采集 Windows 10 LTSC、Node、Codex、OpenCode、Hermes 和代理配置版本及对应 SHA。记录 `codex` 实际 exe/cmd 与模型供应商链路，禁止打印凭据。
3. 向用户单独申请软件安装、服务/计划任务、监听端口、ACL、SSH known_hosts 与实际模型调用授权；不要一次性获批所有高风险操作。
4. 本机先使用 Paseo daemon 的 loopback/direct 连接，不开放公网端口、不启用未经批准的云端 Relay。不要覆盖现有 Codex/OpenCode 全局 Agent、模型、代理与凭据设置。

## S1 验证顺序

1. `paseo --version`、daemon 状态、Provider/model 枚举（不运行模型）。
2. 新建隔离测试目录，用 SDK 在审计允许后创建**单次只读探针**，检查 `systemPrompt`、权限映射、实际模型及完整事件收据；每一次付费调用必须单独获批。
3. 在 disposable 仓库验证 Reviewer/Tester 只读的 OS 权限、网络和进程树；不以 provider sandbox mode 冒充 OS 级证明。
4. 复测本分支 `Paseo.waitForFinish(3600000)` 的真实超时、断连和恢复行为；检查 Node 22+ 与 SDK 0.15.2 实际兼容性。
5. 在以上通过前，不启用完整 `run`，不修改 Hermes Gateway 生产配置。

## S2 验证顺序

5bao/9bao 只部署专用 Runner、已批准的本地独立密钥和独立远端工作区，利用现有 OpenCode；先模拟后真实。每台节点的 SSH 主机指纹、物理设备清单、Linux 进程组及日志 ACL 都要由本地 Agent 独立检查。rusty 仅按后续授权选择。
