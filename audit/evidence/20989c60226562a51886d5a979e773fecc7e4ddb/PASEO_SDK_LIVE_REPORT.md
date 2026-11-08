# Paseo Windows 本机 SDK / Agent 受控实测报告

**PASEO_SDK_STATUS: PARTIAL**
**测试性质：** 本机真实 Paseo Daemon + 真实 `@getpaseo/client@0.15.2`，隔离临时 cwd；仅做连接/查询/一次极短 codex 与一次极短 opencode 合成 Prompt。**未执行完整 P1 流程、未访问远端 P0、未修改 Paseo/Hermes 配置、未重启 Daemon。**

---

## 1. 本机实际环境（只读）

| 项 | 实测值 |
|---|---|
| Paseo App | `D:\Paseo\Paseo.exe`，FileVersion/ProductVersion **0.15.3** |
| Paseo CLI | `C:\Users\KK\.local\bin\paseo.cmd` → `D:\Paseo\resources\bin\paseo.cmd`，`paseo --version` = **0.15.3** |
| Daemon | **0.15.3**（`daemon status` details: `daemonVersion=0.15.3`, `connectedDaemon=reachable`） |
| 监听 | `127.0.0.1:6767`（WebSocket `/ws`）与 `127.0.0.1:56170`，PID **9844** |
| 进程 | Paseo.exe PID 9844 / 4076 / 2372，启动时间 2026-11-08 10:25 |
| HOME | `D:\Paseo-data\home`（`config.json`、`daemon-keypair.json`、`creations/`、`projects/`） |
| userData | `D:\Paseo-data\userData` |
| 已有 workspace | `D:\Paseo-data\test-workspace`（非 git directory） |
| 项目声明 SDK | `@getpaseo/client` **0.15.2**（`package.json`） |
| App 内置 SDK | **0.15.3**（`D:\Paseo\resources\app.asar` → `node_modules/@getpaseo/client/package.json`） |
| 可用 providers | `codex=true`, `opencode=true`；claude/copilot/pi/antigravity/muse=false |

**版本结论：** 项目声明的 0.15.2 与本机 App/Daemon 0.15.3 存在 **patch 版本偏差**；0.15.2 在 `ws://127.0.0.1:6767/ws` 上可完成连接、provider 查询、create、waitForFinish、close，基本兼容。0.15.3（App 内置/临时安装）同样可连接。未升级项目依赖。

> README 中“21bao 尚未安装 Paseo”已被本轮实测推翻：本机 App 0.15.3 正在运行。

---

## 2. SDK 连接 / 断开 / 查询

命令：`node sdk_smoke.mjs` / `node mini_ws.mjs` / `node query.mjs` / `node list_probe*.mjs` / `node session_probe.mjs`（均位于 `paseo/sdk`，依赖临时安装的 0.15.2）。

| 测试 | 结果 |
|---|---|
| `ws://127.0.0.1:6767`（无 `/ws`） | **connect 挂起 >20s，无错误返回**（最终进程级超时） |
| `ws://127.0.0.1:6767/ws`（0.15.2） | **connected**；`providers.listAvailable` 返回 codex/opencode 可用 |
| `ws://127.0.0.1:6767/ws`（0.15.3） | **connected**；同样 provider 结果 |
| `client.close()` | 成功，状态 disposed |
| `agents.list({})` | 0 entries（默认排除 background） |
| `agents.list({includeBackground:true})` | 2 entries，形状为 `{agent:{id,provider,status,title,...}}` |
| `agents.ref(id).current()` | 连接后首次为 `null` |
| `agents.ref(id).refresh()` | 返回 `{agent:{...}}`，含 status/idle、lastUsage、persistence、labels |
| `agents.ref(id).waitForFinish(1500)` | 已 idle 时立即返回 `{status:'idle', lastMessage:'...'}` |
| CLI `paseo --host 127.0.0.1:6767 ls --json` | `[]`（与 SDK 默认 list 一致，background agents 不显示） |
| CLI `daemon status --json` | `DAEMON_REQUEST_TIMEOUT`（1500ms）但 details 显示 `daemonVersion=0.15.3`、`connectedDaemon=reachable` |

**关键语义差异：**

1. **URL 必须含 `/ws`。** `PaseoAgentRuntime.open()` 把 `task.frozen.runtime.paseoUrl` 原样传给 `createPaseoClient({url})`；`ws://127.0.0.1:6767` 会挂起而不是 fail-fast。默认配置/示例已写 `/ws`，但操作员填 `host:port` 时会静默挂起。建议校验/规范化 URL，或设置明确的 `connectTimeoutMs` 与错误。
2. **`agents.list` 默认排除 background。** `src/agents.mjs` 创建时固定 `background:true`；默认 `agents.list({})` 与 CLI `ls` 都看不到这些 Agent。做重启/断线对账时必须传 `{includeBackground:true}`，并解包 `entry.agent`，否则会把已存在 Agent 当成“不存在”而重派。**当前 `src/agents.mjs` 没有 list/对账实现**，这是对账语义缺口，不是本次实机 create 失败。
3. **`current()` 首次为 null，`refresh()` 才有快照。** 使用 handle 做状态判断前必须 `refresh()`；`src/agents.mjs` 只用 create 返回的 handle + `waitForFinish`，未受影响。
4. **`waitForFinish` 的 `usage` 为 null；`lastUsage` 在 refresh/final agent 上。** 成本核算需读 `lastUsage`，不能依赖 create/wait 返回的 `usage`。
5. **`daemon status` CLI 1500ms 超时**，但连接和业务 RPC 正常；健康检查不应只看该命令。

---

## 3. 真实 Agent 调用（每 provider 仅 1 次，无重试）

临时 cwd：`C:\Users\KK\AppData\Local\Temp\opencode\paseo-audit-s0-r6\paseo\agent-cwd`，仅含 `README.txt`，未接触项目文件。

| Provider | 模型 | Agent ID | 终止状态 | 原始 lastMessage | 耗时 | Token |
|---|---|---|---|---|---|---|
| codex | `codex/group/qwen-3.8-flash` | `ec3595a0-3442-48d9-b430-2b5c4e08edf5` | **idle** | `{"verdict": "PASS", "summary": "sdk smoke ok", "findings": []}` | 6,324 ms | input 15,973 / output 42 |
| opencode | `opencode/magpie/opencode-zen-free/deepseek-v4.1-flash-free` | `d715c192-9cb4-483e-a9c0-6443f8cff442` | **idle** | `{"verdict":"PASS","summary":"sdk smoke ok","findings":[]}` | 10,873 ms | input 10,816 / cached 1,792 / output 76 |

- `agents.create` 返回 handle 与 `agent.id`；`recordAck` 可使用该 ID（真实 UUID）。
- `agent.waitForFinish(180000)` 返回 `status='idle'`、`lastMessage` 字符串；与 `src/agents.mjs` 的 `result.status==='idle'` / `parseAgentOutput(result.lastMessage)` 假设一致。
- `agents.ref(id).refresh()` 可重新取得两个 Agent；`persistence.sessionId` 分别为 codex thread `01a1b9b9-8f57-7ab3-9511-70c554ff112e`、opencode `ses_e46464ee9ffetKGzruvOgNA9Lf`。
- `requiresAttention=true`、`attentionReason='finished'`；`src/agents` 未使用该字段。

**成本/额度：** codex 使用 qwen-flash 路由，约 16k input tokens；opencode 使用 free 模型，约 12.7k input tokens。未自动重试，未产生额外调用。

---

## 4. 与 `src/agents.mjs` 逐项对照

| 代码假设 | 实机观察 | 结论 |
|---|---|---|
| `createPaseoClient({url}); connect()` | `/ws` 下成功；无 `/ws` 挂起 | **部分一致**；需 URL 规范化 |
| `client.agents.create({config:{provider,systemPrompt,options},cwd,title,prompt,outputSchema,labels,background:true})` | 无 `options` 的 create 成功；1 次 codex + 1 次 opencode | **基本一致**；`providerOptions` 精确 payload 未做第二次付费调用，**NOT_VERIFIED** |
| 返回 `agent.id` 作为 ACK | 返回真实 UUID | **一致** |
| `agent.waitForFinish(60*60*1000)` | 真实返回 `status:'idle'`、`lastMessage` | **一致** |
| `parseAgentOutput(result.lastMessage,role)` | 两个 lastMessage 均为严格单 JSON | **一致** |
| `store.recordAck/ recordTerminal` | Agent ID 可用于记录 | **一致** |
| `client.close()` | 成功 | **一致** |
| 会话对账（隐含） | 默认 list 看不到 background Agent；ref/refresh 可见 | **缺口**；需 `includeBackground:true` + `entry.agent` |
| 成本/usage | wait.usage=null；refresh.lastUsage 有 token | **缺口**；需读 lastUsage |
| 超时/异常 | 未制造运行中超时；无 `/ws` 为挂起 | **NOT_VERIFIED** |

---

## 5. 结论与建议

**PASEO_SDK_STATUS: PARTIAL。** 真实 `@getpaseo/client@0.15.2` 能在本机 Daemon 0.15.3 上完成连接、provider 查询、create、agentId ACK、waitForFinish(idle)、lastMessage 读取、按 ID refresh、close；codex/opencode 各一次短 Prompt 成功。以下仍未验收：

1. `providerOptions` 精确 payload（codex `sandbox_mode/approval_policy/sandbox_workspace_write`、opencode `permission` map）在真实 create 中的接受性——未做第二次调用，**NOT_VERIFIED**。
2. 运行中 `waitForFinish` 超时、断线重连、取消/中断、Agent 失败状态的真实语义——**NOT_VERIFIED**。
3. 默认 `agents.list`/CLI `ls` 看不到 background Agent；Controller 目前没有对账实现；重启后按默认 list 会误判不存在。**建议**：对账使用 `includeBackground:true`，解包 `entry.agent`，并以 `persistence.sessionId`/labels 对账。
4. URL 无 `/ws` 会挂起；**建议**：在 `PaseoAgentRuntime.open()` 前校验 URL 包含 `/ws`，或使用 SDK 的 daemon target 解析器；设置有限 `connectTimeoutMs`。
5. `daemon status` CLI 1500ms 超时；健康检查改用连接状态/provider snapshot，并保留超时日志。
6. 本机 App 0.15.3 vs 项目 0.15.2 为 patch 偏差；基本 API 兼容，但生产应固定匹配版本或做兼容性测试矩阵，不得自动升级。
7. 以上成功仅证明 SDK/Agent 接口可用；**不等于**真实 P1 双审、Tester、双物理 P0、600 秒第三席、Windows 隔离或部署放行。

---

## 6. 证据文件

- `logs/paseo-sdk-smoke.log`、`logs/paseo-sdk-query.log`
- `logs/paseo-list-probe.log`、`logs/paseo-list-probe2.log`、`logs/paseo-list-probe3.log`
- `logs/paseo-live-smoke.log`、`logs/paseo-session-probe.log`
- `logs/npm-sdk-install.log`、`logs/npm-sdk153-install.log`
- `paseo/query.json`、`paseo/live_smoke.json`、`paseo/session_probe.json`
- `paseo/sdk/`（临时 0.15.2）、`paseo/sdk153/`（临时 0.15.3 对照）

**未执行：** 重启/停止 Daemon、修改 Paseo/Hermes 配置、真实项目文件写入、远端 SSH/P0、完整 P1 流程、自动重试。