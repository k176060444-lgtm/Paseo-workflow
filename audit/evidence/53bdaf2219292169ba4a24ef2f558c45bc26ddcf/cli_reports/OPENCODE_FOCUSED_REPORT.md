## 审计结论（4 问）

---

### Q1：未校验账本的写入口能否 re-anchor 被篡改的任务状态？

**CONFIRMED** — `src/store.mjs:70-79`：`event()` 方法是**公开的**写路径，内部**不调用 `verify()`**。它在计算 `_state_sha256` 时直接对当前 `tasks` 表快照求哈希并写入事件链。若在此期间任务状态被外部篡改（如 aRound 10→0），新事件的 `_state_sha256` 会匹配被篡改状态，且 `previous→digest` 链依旧连续，后续 `verify()` 将通过。直接调用点：`src/controller.mjs:20`（`CONFIG_FROZEN` 事件，紧跟 init/artifact 之后）、`src/p0.mjs:72`（`P0_OPTIONAL_NOT_DISPATCHED`，在长达数分钟的 P0 异步轮询循环内，中间无 verify）。`save()`/`artifact()`/`recordIntent`/`recordAck`/`recordTerminal` 均先调 `verify()`，故常态流程中 verify 保护尚在，但 `event()` 自身是裸写口。

---

### Q2：文件名前导空格能否绕过敏感路径检查并被提交？

**CONFIRMED** — `src/git.mjs:54` 正则 `(^|[\\/])(\.env...)([\\/]|$)/i` 要求 `.env` 等敏感名必须紧跟在行首或路径分隔符之后。文件名 ` .env`（前导空格）会使 `^` 位置后第一个字符为空格，不匹配；空格也不是 `[\\/]`，故 `SENSITIVE_PATH.test(" .env")` 为 `false`。`porcelainPaths()`（`git.mjs:58-71`）正确解析 `git status -z` 中的前导空格路径，`safeChange()`（`git.mjs:74`）的断言被绕过。`validateStaged()`（`git.mjs:79`）再次调用 `safeChange`，同样被绕过。最终 `commitWorktree`（`git.mjs:90`）会正常提交该文件。

---

### Q3：所有子进程是否使用最小环境白名单？

**NOT_CONFIRMED** — 存在两处继承完整环境的子进程：

- **`src/git.mjs:20`**：`execArgv` 内的 `killTree()` 中 `spawn('taskkill', [...])` 未传 `env`，继承控制器完整环境（含可能的网关凭证）。
- **`remote/p0_runner.py:304`**：`subprocess.Popen([sys.executable, ...], start_new_session=True)` 同样未传 `env`，继承远端节点完整环境。文件顶部 `ENV_ALLOW` 白名单仅用于 `run()` 函数和 Harness（`p0_runner.py:243` 传了 `env=env`），但 `Popen` 启动的异步执行进程绕过了此限制。

其余：`git.mjs` 的 `execArgv`→`childEnv()`、`p0_runner.py` 的 `run()`→`child_env()` 和 Harness 子进程均正确使用白名单。

---

### Q4：双 Reviewer 一成一败时，成功席证据是否完整保留？失败席是否自动重复派发？

**CONFIRMED** — `src/controller.mjs:80-113`：`invokePair` 使用 `Promise.allSettled` 并发执行两个席位。成功席在 for 循环中**先**通过 `store.artifact()`（行96）和 `store.save()`（行98）持久化证据与历史，**然后**才检测 `errors.length || successful.size!==2`（行101）。失败时函数 throw，`step()` 的 catch（`controller.mjs:272-283`）将任务置为 `NEEDS_RECONCILIATION`，**不会**自动重试该失败席。`REVIEW_PAIR_UNCERTAIN` 事件（行104）中 `completed` 字段记录了已完成角色名，历史数组中保留了完整 agentId/verdict/evidenceSha256。唯一风险：`completed` 仅存角色名而非证据哈希，但 artifact 文件和历史记录已独立留存，可交叉验证。

---

## 总判定

**`CODE_VERDICT: FAIL`**

理由：Q1（裸 `event()` 可 re-anchor 篡改状态）和 Q2（前导空格绕过敏感路径检查）均为可导致安全边界失效的确认缺陷；Q3（taskkill 和 Popen 继承完整环境）违反最小权限原则。Q4 设计正确但独善其身不足以弥补前三项。
