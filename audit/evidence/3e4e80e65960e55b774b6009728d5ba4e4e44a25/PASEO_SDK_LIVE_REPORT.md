# S0-R7 Paseo Windows 本机 SDK 只读验证

**PASEO_SDK_STATUS: PARTIAL**
**模式：** 只读；未新建付费 Agent、未修改 Paseo HOME/Daemon/配置/已有会话、未重启服务。

## 实测环境

| 项 | 值 |
|---|---|
| Paseo App | `D:\Paseo\Paseo.exe`，**0.15.3** |
| Daemon | **0.15.3**，PID **9844**，监听 `127.0.0.1:6767`（`/ws`）与 `56170` |
| CLI | **0.15.3** |
| HOME | `D:\Paseo-data\home` |
| 项目声明 SDK | `@getpaseo/client@0.15.2` |
| App 内置 SDK | 0.15.3 |
| 已有 agents | codex `ec3595a0-3442-48d9-b430-2b5c4e08edf5`；opencode `d715c192-9cb4-483e-a9c0-6443f8cff442` |

## R7 SDK 适配核验

| 项 | 实测/静态结论 |
|---|---|
| `PaseoAgentRuntime.open()` 拒绝缺失 `/ws` | **CONFIRMED**（官方 `R7 Paseo loopback /ws endpoint validation` 通过；非法 URL 在任何网络连接前失败） |
| 拒绝非本地地址 | **CONFIRMED**（`127.0.0.1`/`localhost`/`[::1]` 之外拒绝） |
| 拒绝 userinfo/search/hash | **CONFIRMED**（官方测试覆盖 userinfo；代码条件覆盖 query/hash） |
| `listAllAgents()` 使用 `includeBackground:true` | **CONFIRMED（代码 + 官方 mock）**；实际同版本 SDK `agents.list({includeBackground:true})` 返回 2 条 background Agent，entries 形如 `{agent:{...}}`，适配器 `x?.agent??x` 正确解包 |
| `findExistingAgent()` 使用 `refresh()` | **CONFIRMED**；实际 `agents.ref(id).refresh()` 返回 `{agent}`，`current()` 首次为 null，适配器解包正确 |
| 自动重派 | **未发现自动重派**；适配器只提供查询/对账方法，没有创建/重派副作用 |
| `waitForFinish` 终止状态 | 既有两个 Agent 只读查询：`refresh.status=closed`，`waitForFinish` 返回 `idle`；原始 `lastMessage` 保留，不重跑 |
| 精确 `providerOptions` live create | **NOT_VERIFIED**；本轮未新建模型调用（避免新增付费），沿用上一轮已记录的真实 create 成功事实 |
| 断线/取消/重启对账 | **NOT_VERIFIED**；未重启 Daemon、未制造断线或取消 |

## 真实只读观察

- `agents.list({includeBackground:true})` 返回 2 条（codex/opencode），status 均为 **closed**；默认 list 对此类 background agents 为空（上一轮已实证，本轮代码已改为 includeBackground）。
- 两个 Agent 的 `ref(id).refresh()` 均返回准确 Agent ID、provider、model、status、persistence；`current()` 首次为 null，符合设计。
- `waitForFinish(1500)` 对已结束 Agent 返回 `status=idle` 和原始 JSON `lastMessage`；不产生新模型调用。
- 精确 `providerOptions` 未在本轮再次实测；上一轮真实 create 不含 options 已成功，不能据此声称 options 已验证。

## 与 `src/agents.mjs` 的差异/残余

1. **URL 校验已修复**：无 `/ws`、远程 host、userinfo 均 fail-fast；无连接超时/断线重连实测。
2. **background 对账已修复**：`includeBackground:true` + `entry.agent` 解包；实际 SDK 0.15.2 条目形状一致。
3. **`findExistingAgent` 已修复**：使用 refresh 而非 current；实际 refresh 可用。
4. **未验证项**：精确 providerOptions、运行中超时、取消/断线、Daemon 重启对账、真实 Paseo 见证签发。
5. **EXECUTION_ATTESTATION_STATUS 独立**：SDK 查询通过不代表真实执行见证；本轮没有真实签发端，且 `PaseoAgentRuntime.execute` 不产出 attestation（见审计报告 R8-001）。

## 证据

- `logs/paseo-session-readonly.log`
- `logs/paseo-sdk-readonly-summary.json`
- `logs/paseo-session-probe.log`（沿用上一轮同一 SDK/Agent 的原始只读记录）
- `PASEO_SDK_LIVE_REPORT.md`（本文件）

**PASEO_SDK_STATUS: PARTIAL** — 连接/查询/后台列表/ID refresh 已验证；真实执行见证、providerOptions、取消/断线/重启未验证。不能据此把任务 A 放行。