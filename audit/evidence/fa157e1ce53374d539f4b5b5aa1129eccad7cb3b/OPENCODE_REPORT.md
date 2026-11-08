# Paseo 审计结论（fa157e1）

**1. 写入口 re-anchor — CONFIRMED**
`src/store.mjs:72-78`：`save()` 只对“更新前”持久化行做 `verify(t.id)`，随后无条件 `UPDATE tasks SET data=canonical(t)`；`:91` 在新 `t` 上算 `_state_sha256=sha256(get(id))`，故 `aRound=0/bRound=0` 会被 `verify()`(`:137`) 当作可信链头（无预算单调性校验）。`#trustedEventWrite`(`:9-15`) 确为私有且被 `save()`(`:76`)/`artifact()`(`:56`) 使用，但不阻止公开方法写入调用方自造的 `t`。

**2. artifact 并发窗口 — CONFIRMED**
`src/store.mjs:44` 在文件写入前 `verify`，`:51-52` 的 `fs.openSync/writeFileSync/fsyncSync` 在事务**外**；`:54-57` 事务仅 INSERT+append 且不再 verify。调用链：`artifact():44 verify` → `:51-52 fsync`（并发 `save()` 篡改 aRound/bRound）→ `:54-57 transaction` → `:56 #appendVerifiedMutation` → `event()(trusted)` → `:91-94` 将篡改态写入 `_state_sha256`，即 re-anchor。

**3. R3-002 完整性 — CONFIRMED**
`src/controller.mjs:40-46` 仅做 `digest===sha256(去digest的frozen)` 自洽；`taskSpec/taskSpecSha` 只在两者均存在时校验(`:44-45`)，只有一个即跳过。`authorizeRecovery()`(`:307-334`) 经 `store.verify`+`compliance`（只查 policy maxA/maxB/permissions）即接受重算过的 frozen digest，且不与 `frozen-manifest.json` 交叉核对。

**4. R3-003 对账保护 — CONFIRMED**
`src/controller.mjs:266-267` 对 `NEEDS_RECONCILIATION/inflight` 提前抛错、不写库；`livePreflight`(`:48`) 在 step 循环前抛错故不重派；catch 守卫 `:273` 只对非终态+READY+非 inflight 置 BLOCKED，从不删事件或清 pendingHuman。

**5. R2-009 路径 — NOT_CONFIRMED（仍有绕过）**
`src/git.mjs:72-90` `safeChange` 的不可见字符黑名单(`:82`)遗漏 U+00AD(soft hyphen)、U+034F、U+180E、U+3164(Hangul filler)、U+2800 等；NFKC(`:85`) 只用于 SENSITIVE_PATH 探测，同形/全角名仍可进入 Commit；`validateStaged`(`:98-99`) 仅拒绝“出现在 `diff --cached` 中”的 symlink/gitlink，baseRef 中已存在的 symlink/gitlink 不会被重新校验；Windows 大小写别名未处理。

**6. R3-004/005/007/008**
- (a) 最小环境 **CONFIRMED**：`git.mjs:8-14/17/20`（taskkill、execArgv 均 `childEnv`）；`p0_runner.py:29-36/109/244/305-306`（run、Popen、Harness 均 `child_env`）。注：HOME/USERPROFILE 仍在白名单。
- (b) 严重级一致性 **CONFIRMED**：`policy.mjs:126-127/134-135`、`p0.mjs:57-59`、`p0_runner.py:183-185` 三处一致——LOW/MEDIUM/INFO/ADVISORY 为咨询级，HIGH/BLOCKER/CRITICAL/P0/P1 为阻断级。
- (c) FAIL→PASS 误读路径 **NOT_CONFIRMED（存在）**：`policy.mjs:94-113` 与 `p0_runner.py:140-161` 均“信任末尾围栏/最后一个裸 JSON”，末尾的 PASS（示例/参考）可覆盖前文真实 FAIL；`parse_output`(`:179`) 返回首个合格拼接候选。无解析时回落 QUESTION/抛错是安全的，但优先级启发式可被构造为 FAIL→PASS。

`CODE_VERDICT: FAIL`
