# S1 · 21bao Paseo 隔离安装计划（PROPOSED，未安装、未启动）

本文件是待 KK 审阅的操作草案，尚未授权安装、启用、改配置、创建账户、改 ACL、启动 daemon 或调用真实工作流。S0 当前 FAIL/BLOCKED。审阅本计划不等于批准解除 S0 阻断；审计侧 Codex/OpenCode 模型会话的授权也不扩展到 Paseo Agent。

## 1. 可核实基线与版本决策

- 本次实测宿主：21bao / KK-PC-Server，Windows 10 build 19044，Node v26.6.0、Git 2.54.0.windows.1、Python 3.14.7。详见 `../ENVIRONMENT.json`、`../logs/OFFLINE_RESULTS.json`。
- 被审 Controller 仅指 `6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4`；不从 Draft PR 或可变 HEAD 直接安装后续代码。
- 已检索官方 `getpaseo/paseo` 固定源码 `6c1b48d2962ec6a48d5a553e312dfcc1f94e2e7a`，CLI / Client 均为 0.15.2；CLI 的 Client/Protocol/Server 依赖恰为 0.15.2。下载与 Git blob 核对见 `../s1-reference/SOURCES.json`。
- 本次读取的官方最新正式 release 是 v0.15.3，发布于 2026-11-06T16:02:49Z；tag 解引用 Commit 为 `d91ae138cb931447635e94296023414a58bedcc5`。这不代表 0.15.3 已通过本项目兼容性验收。

| 待选项 | 已有证据 | 尚需完成 |
|---|---|---|
| CLI + Client 精确 0.15.2 | 与原审计 API 基线相同；官方固定源码已取证 | npm 分发包完整性、Windows 依赖与实际 SDK/daemon 验证 |
| CLI + Client 精确 0.15.3 | 官方新正式 release | 相对 0.15.2 全量接口/依赖/权限差异复审；目标 Controller 再验 |

版本、目录和 S1 子阶段由 KK 定；不得把 semver 范围 `^0.15.2` 当作获准自动升级。版本确定后必须固定顶层和传递依赖、生成 package-lock 及 integrity 清单，禁用自动更新。

## 2. 批准前置条件

1. **源码门**：先处理主审确认的状态重新封存/恢复预算缺陷，关闭影响正式执行的 F5/F7/F8/F9/F10 残留并以新固定 Commit 复审。若 KK 单独批准只做静态包准备，可先进行 S1-A；这种准备不能启动 Controller、daemon 或真实 Agent。
2. **权限门**：明确选择 S1-A（静态安装，不运行 daemon）或随后另批 S1-B（本机无模型 daemon 验收）。Windows OS 级文件/网络/凭据隔离和 Job Object 仍是 BLOCKED，不得用目录分开、权限 JSON 或 `P1_HOST_ISOLATION_ATTESTED=YES` 代替。
3. **依赖门**：只读检查 npm 分发包的 `engines`、平台/CPU、可选和原生依赖、安装脚本及完整依赖树。禁止安装时顺带下载新 Codex/OpenCode、provider、模型或语音组件。需要执行 lifecycle script、VC runtime 或新增系统组件时先停下，列出具体项重新报批。
4. **兼容门**：先记录 Windows 原生 `cmd.exe` 的 `where.exe` 解析顺序，以及现有 Codex/OpenCode 的绝对入口、二进制哈希、`--version` / `--help`。不能拿 Git-Bash 下的入口代表 Windows daemon 的解析。特别核验 Codex app-server、OpenCode 进程启动/JSONL 和 wrapper 的 Windows 调用方式；失败即 BLOCKED，不通过修改全局 PATH 修补。
5. **配置门**：对现有 Codex、OpenCode、ling Hermes 配置及 CLI wrapper 做原始哈希基线与安全本地备份；认证文件、API key 内容不读出、不复制给 Paseo、不交给第三方。凭据使用另行获批；需要登录时由 KK 本人完成。
6. **网络门**：复用现有模型、provider 和代理路径。只读确认当前实际解析值，禁止修改 Magpie、mihomo、系统代理、注册表、NO_PROXY、`.env`、全局环境变量或任何 Hermes profile。不得为了 Paseo 改动现有 CLI 默认模型。
7. **资源门**：只读确认 E 盘容量/ACL、候选 loopback 端口及新路径不存在。端口 6799 仅为本计划的候选，尚未声明空闲。安装目录、npm cache、临时目录、日志和 worktrees 全收敛在新树内。

## 3. 隔离布局与不变量

候选布局（仅方案，尚未创建）：

```text
E:/paseo-isolated/S1-<精确版本>-<批准批次>/
  runtime/                   # 独立 npm prefix；package.json、lock、node_modules
    workflow/                # 固定 Controller 39 文件，逐 blob 校验后只读保存
  home/                      # 显式 --home / PASEO_HOME，绝不落到 ~/.paseo
  state/                     # 全新临时 Controller DB；禁止导入生产/旧格式状态库
  worktrees/                 # 独立测试工作区
  cache/npm/                 # 仅本次 npm cache
  tmp/                       # 仅本次进程 TMP/TEMP/TMPDIR
  logs/                      # daemon 与验收日志
  evidence/                  # 命令、PID/创建时间、哈希、版本、依赖和回滚凭证
  baseline/                  # 本地安全备份与哈希，不进入 GitHub/聊天附件
  launch/                    # 显式绝对入口的临时启动脚本
```

把 `workflow/` 放在独立 prefix 的子目录，使 ESM 从上层 `runtime/node_modules` 解析 SDK，不向固定源码快照写 `node_modules` 或修改它的 package.json。静态归档与执行副本分开标注。

不变量：不执行全局 `npm install -g`，不执行 `npm config set prefix`；不改 PATH、npm prefix、现有 CLI wrapper、provider/model、代理和 Hermes 配置；不创建计划任务/服务；不让 npm/npx 自动选择 latest；不接触远端节点，不分发 HMAC/SSH key。目录隔离本身不构成 OS 安全边界。

## 4. 分阶段执行清单（全部待后续授权）

### S1-A：仅静态安装与能力检查

- 前置完成上表的版本/目录选择、分发包与安装脚本审查、既有环境基线；新目录若已有内容就另选批次，禁止覆盖。
- 只在新的 prefix 中安装精确 `@getpaseo/cli@<批准版本>` 和 `@getpaseo/client@<同版本>`；依赖审查通过前保持 `--ignore-scripts`。示意命令如下，**本次未执行**：

```powershell
# 仅示意；$PaseoRoot 和 $ApprovedVersion 均须以批准批次的实际值替换。
npm install --prefix "$PaseoRoot/runtime" --cache "$PaseoRoot/cache/npm" --ignore-scripts --no-audit --no-fund --save-exact "@getpaseo/cli@$ApprovedVersion" "@getpaseo/client@$ApprovedVersion"
& "$PaseoRoot/runtime/node_modules/.bin/paseo.cmd" --version
& "$PaseoRoot/runtime/node_modules/.bin/paseo.cmd" daemon --help
```

- npm 缓存、日志和临时路径只通过本次启动器的进程级参数/环境注入；不得持久化到用户或系统设置。若只读能力检查仍需要下载组件或启动 Agent，就停下记录，不继续。
- 固定 lockfile、依赖树、包 integrity、CLI/SDK 实际版本和入口哈希。仅载入 SDK 模块及反射方法签名，记录 `waitForFinish(number)` 形态；不调用 `agents.create`、不连接生产 daemon、不解锁 P1。
- 前后重复现有 CLI 的版本/help、`cmd.exe` 解析顺序和配置哈希，验证零回归。保持 `P1_LIVE_ALLOWED` / `P1_HOST_ISOLATION_ATTESTED` 未设置。
- S1-A 验收后状态最多是“已安装”；不宣称“已配置/已跑通”，不宣称 OS 隔离生效。

### S1-B：另批本机 daemon 无模型验收

本节命令及配置键依据0.15.2固定源码；若KK选择0.15.3，须先在该版本重新核实，不能沿用为已验结论。已取证的 `packages/server/src/server/persisted-config.ts:244-289,358-365` 定义了 `daemon.listen`、`daemon.mcp.enabled`、`daemon.relay.enabled` 和 `features.webUi`；仅源码字段存在，不代表本机已配置或跑通。

- 启动前必须先证明 provider 自动发现、metadata/语音/插件/relay 等启动行为不会发模型请求或修改现有 CLI 配置。字段以所选版本 schema 和源码核对；无法证明就不启动。
- 所有设置只写新的 `home/config.json`。按官方文档显式设置 loopback listen、`daemon.relay.enabled: false`、`daemon.mcp.enabled: false`、`features.webUi.enabled: false`；其他禁用字段须逐项核实后才加入，不能猜键名。
- `--home` 每条命令显式传递；不注册服务、不配移动端、不启 Hub/relay、不开放 LAN/Tailscale。候选地址 `127.0.0.1:6799` 必须先查占用。
- 只允许另行批准的新实例启动。官方当前 API 为 `paseo daemon run --home <隔离目录>`（前台）或 `daemon start --home`（后台），**不能使用已移除的 `start --foreground` / `--port` / `--no-relay`**。前台便于关联自有 PID，但不代表已纳入 Job Object。
- 采集自有 supervisor/worker PID、创建时间、绝对程序路径、home 和实际监听地址；只验证无模型 health/status 及空载停止。启动超时并不意味着进程已退出，必须核对自有 PID；不准悄悄重复启动。
- 若启认证，由 KK 自行设置并批准保存位置；本计划不写入任何用户 API key，不收集密码。认证能否由 Controller SDK 使用仍需单独验证，不能用关闭认证绕过。

### S1-C：真实 SDK/Harness 单次只读验收，另立授权

S0 复审通过、Windows 身份/ACL/网络/进程隔离、TEST_ONLY 新增及归并、Soul 输出映射和费用/模型审批完成后，才能设计单次本地真实 SDK + Harness 探针。当前不执行，不把审计侧双 CLI 的成功报告当作 Paseo 的 SDK/Harness 验收。

远端 P0 是后续 S2。用户如要求其他 agent 自主作业，走 A2A；不得未经单独明确 SSH 指示及二次确认用 SSH 代劳。本计划不联系任何远端 agent。

## 5. 具体回滚步骤

| 触发点 | 回滚动作（执行也需在后续授权范围内） | 验证 |
|---|---|---|
| 静态包安装/校验失败，未启动 daemon | 保存 npm 错误、依赖和 integrity 清单；停止后续步骤；将本次新树标记 QUARANTINED 并留存。此时无需改回原软件 | 原 CLI 的绝对入口、版本、cmd 解析顺序、配置/wrapper 哈希与基线一致 |
| 新 daemon 启动失败或启动超时 | 查本次 home 的实例信息、PID/创建时间和日志；只对已证明属于本次新树的实例请求 `paseo daemon stop --home <该 home>`，禁止按进程名批量终止 | 自有 supervisor/worker 均退出、候选端口释放；若不能证明，标 NEEDS_RECONCILIATION，不复启/不清理 |
| 优雅停止失败 | 保留日志和进程归属；向 KK 报具体 PID、路径、创建时间、依赖及未退出子树，请求针对性强停授权；不得自动加 `--force` 或 `taskkill` | 经授权后验证整个自有进程树退出；Windows Job Object 能力仍需真实验收 |
| 本次安装树需要撤销 | 确认无自有进程/句柄后，移到带批次号的隔离留存目录；不自动执行 uninstall/delete，不碰原有 Codex/OpenCode/Hermes | 现有软件 smoke/help、版本、哈希与代理/模型解析保持基线；无新启动入口 |
| 发现原有配置或 wrapper 与基线不同 | 先读 diff 和时间戳，确认是否本任务造成或并发合法修改；只报告，不用旧备份覆盖未知的新改动。仅对经确认属于本任务且获批的精确差异恢复 | 逐字节/哈希验证恢复对象，保留差异证据；不重启现有服务 |
| DB/证据要留存 | 先停止已批准的新实例并确认无写者，再复制本次 DB 及 WAL/SHM 的一致集合与证据目录、做哈希清单；不把旧状态原地升级，也不修改本次 S0 证据 | 文件清单、大小、摘要与读取验证结果齐全；有未知作业则继续封存 |

当前未改变现有入口，因此不存在切回旧 PATH/模型/代理的问题。卸载、删除、停服务、强杀进程或 ACL/用户/密码/防火墙变更均不得从“同意看计划”推定获批。

## 6. 官方依据

固定源码中的 `public-docs/configuration.md:13-27,73-79,103-115,183-238` 规定 home、前后台配置优先级、worktrees 和认证；`public-docs/cli.md:375-426` 规定 daemon 生命周期、已移除参数与 home/host 选择；`public-docs/codex.md:9-17,51-74` 说明使用已有 CLI 与认证且正常计费/额度仍适用；`packages/cli/src/commands/daemon/start.ts:37-55` 是 foreground API 源码。原文均随本次 `s1-reference/` 留存。

本计划不预先把任何选型或风险接受写成 KK 已批准。版本、S1-A 是否先做、S1-B 是否允许启动、OS 隔离方案及目录，均由 KK 审阅后定。
