# Paseo-workflow S0-R4 第五轮独立审计报告

**AUDIT_STATUS: COMPLETE**
**CODE_VERDICT: FAIL**
**LIVE_INTEGRATION_STATUS: BLOCKED**

- 被审固定 Commit：`5fa4a8ad1083c44c92e69f0fb84bdf900bd333ee`
- 本轮代码基线 Commit：`fa157e1ce53374d539f4b5b5aa1129eccad7cb3b`
- 实际父提交：`e4c93d3ee6ed9be7081e06596ce96411a2708bdf`（中间修复 Commit；merge-base 为 `fa157e1…`）
- Tree：`518032cba06467be3cf5e6b218b9ea0ce654ac06`
- 整改说明：`docs/R4_REMEDIATION_20261108.md`
- 上一轮证据 Commit：`a37ed859ba57a46407d911c42c027595e2138e3a`
- 环境：21bao / Windows 10 19044；Node v26.6.0、npm 11.18.0、Python 3.11.15、Git 2.54.0.windows.1、Codex 0.166.0、OpenCode 1.19.3
- Paseo 只读探测：**Paseo.exe 正在运行（PID 7540 / 1172 / 13240，Session Services）**；不在 PATH；updater installer 存在（145,569,446 bytes，2026-11-08 07:59）。本轮**未启动、停止、更新、配置或接管**任何 Paseo App/Daemon；所有测试使用 fake runtime/一次性仓库。
- 范围：固定 Commit 静态审查、本机 Windows 离线 Node/Python 原始套件、独立对抗探针、Codex/OpenCode 独立复审、证据上传。**未部署、未合并、未做真实 P1/SDK/SSH/P0 调用、未修改生产配置。**

`FIXED` 仅指被列出的离线子项，不代表真实 SDK、Windows OS 隔离、真实远端 P0 或生产验收通过。

---

## 1. 决定性结论

### 1.1 R5-001（BLOCKER，新发现）— `Store.save()` 仍可任意改 stage/status/审批/P0/tester 证据

- 位置：`src/store.mjs:88-145`、`src/controller.mjs:23-37`、`src/controller.mjs:59-73`。
- 本轮 `#validateTaskTransition` 确实修好了：
  - `aRound/bRound` 不得回退、不得跳轮、不得超过 10、只能在 `GATE_A/B_ROUND_START` +1；
  - `frozen` 不可替换（即使重算 digest）；
  - `history` 不可截断；
  - `baseSha` 不可替换、`currentSha` 只能在特定冻结事件变更。
- **但没有校验 `stage`、`status`、`pendingHuman`、`lastB`、`p0Initial/p0Final`、`reviewers`、`history` 内容。** 实测：
  1. `save(t,'GATE_0.1_APPROVED')` 把 `WAIT_GATE_01` 直接改成 `PLANNER/READY`，绕过 Gate 0.1。
  2. `save(t,'A_COMMIT_FROZEN')` 把 `currentSha` 设为 `'d'*40`、`stage` 设为 `WAIT_GATE_59`，随后 `Controller.approve({gate:'5.9',digest:'d'*40})` 直接 **CLOSED**，没有 Tester、没有 P0、没有真实 Commit。
  3. `save` 伪造 `lastB={tests:{pass:true},commit:sha}`、`p0Initial={passed:true,commit:sha,reports:[fake-A,fake-B]}`、`bFindings=[]` 后，`Controller.compliance(t)` 返回 `true`。
  4. `save(t,'GATE_A_ROUND_START')` 可在 `WAIT_GATE_01` 把 `aRound` 从 0 加到 1，没有真实轮次。
  5. 任意伪造 `history` 中的 reviewer/tester/P0 记录可通过 `verify()`。
- 影响：这是任务明确要求检查的“阶段跃迁或审批绕过”。轮次不下降并不等于 Store 安全；任何有 Store 访问权的调用者可以伪造完整 Gate 5.9 并通过 `verify()`。**R4-001 不能判 FIXED。**

### 1.2 R5-002（BLOCKER，新发现）— `Store.init()` 可创建终态任务/伪造初始可信根

- 位置：`src/store.mjs:76-83`。
- 实测：
  - `init({stage:'WAIT_GATE_59',status:'READY',currentSha:'e'*40,aRound:10,bRound:10,frozen:forged})` → `verify()` 通过 → `approve({gate:'5.9',digest:'e'*40})` → **CLOSED**。
  - `init` 带预置 `TASK_SPEC`+SHA、没有 `TASK_SPEC_CANDIDATE` → `verify()` 通过 → `authorizeRecovery(expectedBasis=sha)` → **PREPARE**。
  - `init` 只给 `taskSpec` 不给 `taskSpecSha` → `verify()` 通过；只有后续 `assertFrozenIntegrity` 才拒绝。
  - `init` 带伪造 `frozen`（重算 digest）→ `authorizeRecovery` 接受并进入 PLANNER。
- 影响：初始信任根完全由调用方提供；新任务可以从终态开始并获批准。Gate 0.1/0.2 的根信任没有建立。

### 1.3 R5-003（HIGH，新发现）— `baseSha/currentSha` 是任意字符串，无 Git 对象/祖先校验

- 位置：`src/store.mjs:121-129`、`src/controller.mjs:322`。
- 实测：`save(t,'WORKTREE_PREPARED')` 设 `baseSha='1'*40`；`save(t,'A_COMMIT_FROZEN')` 设 `currentSha='2'*40`；`verify()` 通过。`init(currentSha='7'*40)` 后 `authorizeRecovery(expectedSha='7'*40)` 接受。
- 影响：伪造的 Commit SHA 可以成为恢复 basis 或最终 Commit，不要求存在于仓库、不要求从冻结 baseRef 派生。最终 Commit/P0 绑定被削弱。

### 1.4 R4-003（BLOCKER）— 已修（artifact 事务/孤儿边界 fail-closed）

- 位置：`src/store.mjs:42-75`、`:194-224`。
- 实测 5/5：
  - 同连接 `fs.writeFileSync` 回调篡改 `aRound/bRound` → 抛 `task state changed during evidence fsync`，DB 回滚，aRound/bRound 仍 10/9，manifest 0 行；遗留文件触发 `verify()` 的 `unregistered evidence`。
  - 第二 SQLite 连接在 fsync 期间写 → 被 `BEGIN IMMEDIATE` 阻塞（locked/busy），artifact 正常提交，状态不变。
  - `store.event` 注册失败 → 事务回滚、文件留孤儿、`verify()` 拒绝。
  - 预置孤儿文件 → artifact 在写入前被 `verify()` 拒绝。
  - 同名已注册 artifact 重试 → `EEXIST`，只保留一行 manifest。
- 结论：SQLite 事务与文件系统不是同一事务；注册失败后保留孤儿等待人工查证，是正确的 fail-closed，不应声称“文件写入原子”。

### 1.5 R4-005（HIGH）— 已修（本地/远端唯一终止 verdict）

- 本地 11/11、远端 16/16：
  - `FAIL` 后 `PASS`、`PASS` 后 `FAIL`、双 JSON 围栏、多 verdict JSONL → 拒绝/QUESTION，**不会**变成 PASS。
  - 单终止 bare/fenced/缩进/pretty/CRLF JSON → 正常解析。
  - 截断、尾随文字 → 拒绝。
  - `PASS`+BLOCKER finding → 拒绝；`APPROVE_WITH_COMMENTS`+LOW 接受，+HIGH 拒绝。
  - 多 verdict 被拒绝属于安全保守行为，已按 R4-004 的契约记录。

### 1.6 R4-006/R4-007（MEDIUM/LOW）— 已修（未测项如实记录）

- R4-006：U+00AD、U+034F、U+180E、U+3164、U+2800、U+200B、U+200D、U+2060、U+202E、U+FFA0 前缀全部拒绝；U+FEFF 以歧义空白拒绝；全角 `.env`、前导空格 `.env` 拒绝；中文 `中文.txt`、`中文目录/说明.md`、`环境.env`、ASCII 正常名接受；U+2215 是普通文件名而非分隔符。
- R4-007：`prepare()` 拒绝 base index 中的 120000 symlink、160000 gitlink、敏感 `.env`；`commitWorktree()` 拒绝 clean worktree 中继承的 symlink。官方 Windows 测试因 EPERM skip 真实 OS symlink；独立探针用索引级 120000 覆盖了该路径。**真实 Windows OS symlink 创建仍 NOT_VERIFIED。**

### 1.7 R4-002（HIGH）— PARTIAL

- 已修：`frozen` 不可替换；TASK_SPEC 必须成对、匹配；已批准 TASK_SPEC 不可替换；`assertFrozenIntegrity` 拒绝不完整 pair。
- 未修：`init` 接受伪造 frozen/预置 spec/任意 currentSha；首次 `TASK_SPEC_CANDIDATE` 可在 BLOCKED/WAIT_GATE_01 调用，无 Planner 阶段/角色绑定；`baseSha/currentSha` 无 Git 校验。

---

## 2. R4-001～R4-007 结论

| ID | 严重度 | 结论 | 说明 |
|---|---|---|---|
| R4-001 | BLOCKER | **NOT_FIXED** | 轮次/冻结/历史约束已修；`save` 仍可任意改 stage/status/审批/P0/tester。R5-001。 |
| R4-002 | HIGH | **PARTIAL** | frozen/pair/type 已修；`init` 初始信任根、首次 Planner 绑定、SHA Git 校验未修。R5-002/R5-003。 |
| R4-003 | BLOCKER | **FIXED** | 5/5 事务/并发/孤儿/重名 fail-closed；文件系统非原子性如实保留。 |
| R4-004 | LOW | **FIXED** | 多 verdict 围栏保守拒绝，属有意的 fail-closed 契约。 |
| R4-005 | HIGH | **FIXED** | 本地 11/11、远端 16/16；FAIL 后 PASS 不会变成 PASS。 |
| R4-006 | MEDIUM | **FIXED** | 11 个不可见/视觉混淆前缀拒绝；中文/正常名接受。 |
| R4-007 | LOW | **FIXED** | 完整 index 的 120000/160000/敏感 `.env` 拒绝；真实 OS symlink NOT_VERIFIED。 |

**R4 统计：FIXED 5（R4-003/004/005/006/007）、PARTIAL 1（R4-002）、NOT_FIXED 1（R4-001）。**

---

## 3. 旧 F1–F10 回归

| ID | 结论 | 说明 |
|---|---|---|
| F1 | **FIXED** | PASS+findings、BLOCKER/HIGH 仍拒绝。 |
| F2 | **MITIGATED_FAIL_CLOSED** | 两席/第三席/丢 ACK 离线通过；真实双机/600s/Linux 进程组 NOT_VERIFIED。 |
| F3 | **MITIGATED_FAIL_CLOSED** | 重复 key/物理 ID 拒绝；真实物理身份 NOT_VERIFIED。 |
| F4 | **FIXED** | 数字 timeout；真实 SDK 未验证。 |
| F5 | **NOT_FIXED** | 11 Soul blob 与 provenance 一致；6 个仍含 legacy APPROVE/REQUEST_CHANGES/Pro-Audit；无法定交付物映射。 |
| F6 | **NOT_VERIFIED** | Windows SID/ACL/网络/Job Object、TEST_ONLY 未验收。 |
| F7 | **PARTIAL** | 事务/哈希链保持；R5-001/R5-002/R5-003 开放。 |
| F8 | **PARTIAL** | 停线/R3-003 对账保护成立；R5-001/R5-002/R5-003 开放。 |
| F9 | **PARTIAL** | 全部子进程 env 已修；raw log 未脱敏、ACL 未验证。 |
| F10 | **MITIGATED_FAIL_CLOSED** | 只读/WAL/inspect 已修；真实进程树未验证。 |

**F 统计：FIXED 2、PARTIAL 3、MITIGATED_FAIL_CLOSED 3、NOT_FIXED 1、NOT_VERIFIED 1。**

---

## 4. R2-001～R2-010 回归

| ID | 结论 | 说明 |
|---|---|---|
| R2-001 | **PARTIAL** | preflight 入口拒绝直接篡改；R5-001 阶段/审批路径仍开放。 |
| R2-002 | **FIXED** | 孤儿/注册失败/目录异常/缺失/篡改证据 fail-closed。 |
| R2-003 | **FIXED** | 两连接交错下 readSnapshot 单快照；旧探针夹具已改为合法 round-start 3→4。 |
| R2-004 | **FIXED** | 只读 WAL 伴生文件记录；主库哈希不变。 |
| R2-005 | **FIXED** | Node/Git/Harness/taskkill/Popen 最小环境；raw log/ACL 另计。 |
| R2-006 | **PARTIAL** | 解析器已修；F5 Soul 迁移/交付物映射仍缺。 |
| R2-007 | **FIXED** | Windows Python 11/11 PASS；Linux/远端未验证。 |
| R2-008 | **PARTIAL** | --basis 恢复成立；R4-002/R5-002/R5-003 残余。 |
| R2-009 | **FIXED** | 前导空格/NFKC/rename/copy/index/120000/160000/敏感 `.env` 均拒绝；真实 OS symlink NOT_VERIFIED。 |
| R2-010 | **FIXED** | 成功席证据/history 保留；失败席 ACKNOWLEDGED；不重派；旧缺陷探针按预期失败。 |

**R2 统计：FIXED 7、PARTIAL 3。**

---

## 5. R3-001～R3-008 回归

| ID | 结论 | 说明 |
|---|---|---|
| R3-001 | **NOT_FIXED** | `event()` 边界已修；公开 `save` 仍可阶段/审批绕过（R5-001/R5-002）。 |
| R3-002 | **PARTIAL** | frozen/pair 已修；init 信任根/首次 Planner 绑定开放（R4-002/R5-002）。 |
| R3-003 | **FIXED** | NEEDS_RECONCILIATION/inflight 保留；不重派；旧缺陷探针按预期失败。 |
| R3-004 | **FIXED** | taskkill childEnv。 |
| R3-005 | **FIXED** | Popen child_env。 |
| R3-006 | **FIXED** | CLI 真实换行。 |
| R3-007 | **FIXED** | APPROVE_WITH_COMMENTS 本地/远端严重度一致。 |
| R3-008 | **FIXED** | 唯一终止 verdict；FAIL 后 PASS 拒绝；多 verdict 保守。 |

**R3 统计：FIXED 6、PARTIAL 1、NOT_FIXED 1。**

---

## 6. 新发现汇总

| ID | 严重度 | 标题 | 关键位置 |
|---|---|---|---|
| **R5-001** | **BLOCKER** | `save()` 任意改 stage/status/审批/P0/tester/history | `src/store.mjs:88-145`、`src/controller.mjs:23-37` |
| **R5-002** | **BLOCKER** | `init()` 可创建终态/伪造 frozen/spec/currentSha | `src/store.mjs:76-83` |
| **R5-003** | **HIGH** | `baseSha/currentSha` 任意字符串，无 Git 对象/祖先校验 | `src/store.mjs:121-129`、`src/controller.mjs:322` |

---

## 7. 本机离线测试

完整命令、cwd、退出码、原始 stdout/stderr 见 `TEST_RESULTS.txt` 与 `TEST_SUMMARY.json`。

| 批次 | 用例 | PASS | FAIL | ERR | SKIP | exit |
|---|---:|---:|---:|---:|---:|---:|
| `npm run check` | — | — | — | — | — | 0 |
| 原始 Node 全套 | 53 | 52 | 0 | 0 | 1 | 0 |
| 原始 Python 全套 | 11 | 11 | 0 | 0 | 0 | 0 |
| 旧 R2 回归 | 50+5+6+10+14 | 85 | 0 | 0 | 0 | 0 |
| 旧 F1–F10 | 12 | 12 | 0 | 0 | 0 | 0 |
| 旧 R2-010 | 4 | 3 | 1 | 0 | 0 | 1 |
| R5 阶段/审批 | 8 | 8 | 0 | 0 | 0 | 0 |
| R5 轮次/冻结/历史 | 15 | 15 | 0 | 0 | 0 | 0 |
| R5 artifact 边界 | 5 | 5 | 0 | 0 | 0 | 0 |
| R5 初始信任/恢复 | 7 | 7 | 0 | 0 | 0 | 0 |
| R5 本地解析 | 11 | 11 | 0 | 0 | 0 | 0 |
| R5 远端解析/JSONL | 16 | 16 | 0 | 0 | 0 | 0 |
| R5 Git 路径/index | 25 | 25 | 0 | 0 | 0 | 0 |
| **合计** | **252** | **250** | **1** | **0** | **1** | — |

**口径：**

- 探针 `CONFIRMED` 表示断言成立；R5-001/R5-002/R5-003 等缺陷复现探针的 CONFIRMED **表示缺陷被确认，不代表产品通过**。
- 唯一 FAIL 是旧 R2-010 缺陷探针：期望 NEEDS_RECONCILIATION 被覆盖为 BLOCKED，实际保持 NEEDS_RECONCILIATION（R3-003 已修），是正向结果。
- 唯一 SKIP 是官方 R4-007 真实 Windows symlink（EPERM）；索引级 120000 由独立探针覆盖。
- GitHub CI 42436134505 的 Node 53/53、Python 11/11 仅作 Linux 参考，不能替代本机结果。

---

## 8. 独立 CLI 审查

### 8.1 Codex

- 命令：`codex exec -s read-only --skip-git-repo-check --ephemeral -C offline-copy -o CODEX_REPORT.md -`
- 结果：**NOT_AVAILABLE**，exit 1；账户配额至 2026-11-10 15:58；未生成报告；原文见 `CODEX_STDERR.log`。

### 8.2 OpenCode

- 命令：`opencode run --dir offline-copy --agent p1-audit --model magpie/group/deepseek-v4-pro --format default`
- 输入：`CLI_PROMPT_FOCUSED.md`（只读 5 个核心文件，7 个定点问题）
- 结果：**VALID**，exit 0，4478 bytes；原始输出 `OPENCODE_REPORT.md`，stderr 轨迹 `OPENCODE_STDERR.log`。OpenCode 独立确认 R5-001/R5-002、R4-003/R4-005/R4-006/R4-007，并指出 Git 祖先校验缺失（R5-003）；其 Q7 明确说明正常流程未被破坏。
- 主审先独立完成静态审查、252 项测试/探针并冻结结论，再读取 CLI 报告；未向 OpenCode 提供主审 FINDINGS 或探针结果。

详细逐条交叉验证见 `CROSS_REVIEW_VALIDATION.md`。

---

## 9. 必须保持 BLOCKED / NOT_VERIFIED

1. **R5-001/R5-002 两个 BLOCKER**：阶段/审批/P0 伪造与 init 终态/伪造信任根未关闭；R4-001 不能判 FIXED。
2. **R5-003 HIGH**：baseSha/currentSha 无 Git 对象/祖先校验。
3. **R4-002 PARTIAL**：首次 TASK_SPEC 未绑定 Planner，init 信任根未绑定审批。
4. Windows 不同进程身份/SID、文件 ACL、网络、Job Object 未真实验收。
5. TEST_ONLY 新增测试、独立审查及归并最终 Commit 未完成。
6. 真实 Paseo SDK/daemon、远端 OpenCode JSONL/权限/作业生命周期未验收。
7. 两台真实物理 P0 主机、可信主机/密钥映射、真实第三席 600 秒、Linux 进程组取消未验收。
8. 真实 Windows OS symlink 创建 EPERM NOT_VERIFIED；索引级 120000 已验证。
9. OS 崩溃/断电、多进程压力、外部不可变锚定、审批主体认证、Soul V2.1 迁移与法定交付物映射未完成。

**处理原则：上述任一项未满足，真实执行必须 fail-closed；不得以离线测试 PASS、CI PASS 或模型意见解除。**

---

## 10. 只读边界与环境完整性

### 已确认未执行

- 未修改被审仓库源码；未修改 main、PR #1/#2/#3/#4、修复分支或历史证据分支；仅向新建 `audit/s0-5fa4a8a-evidence` 分支新增 `audit/evidence/`。
- 未启动、停止、更新、配置、接管 Paseo App/Daemon；只读探测到 3 个 Paseo.exe 进程及 updater installer。
- 未 SSH 到 5bao/9bao/rusty；未做远端 P0/A2A；未分发密钥。
- 未调用真实 Paseo SDK/Harness 联调；OpenCode 仅作只读静态审查（模型/命令/退出码保留），Codex 因配额失败。
- 未修改 Hermes、Codex、OpenCode、Magpie/代理、系统 PATH、服务或用户工作目录；未读写真实密钥值。
- 未部署、未合并、未自动清理生产状态。

### 已执行

- `git clone/fetch/rev-parse/cat-file/diff/ls-tree/hash-object` 只读；`git archive` 固定 Commit 到 `offline-copy`。
- `npm run check`、`npm test`、`python -B -m unittest ...`、自写 Node/Python 对抗探针；一次性本地 Git 仓库、临时 SQLite、fake SDK/P0。
- 本机 Codex/OpenCode 只读审查（read-only sandbox / 只读 agent）。
- 证据仅写入本机临时工作区和新建 `audit/evidence/5fa4a8a.../`。

### 环境完整性（本审计前后）

| 文件 | 审计前 SHA-256 | 审计后 SHA-256 | 结论 |
|---|---|---|---|
| `C:\Users\KK\.codex\config.toml` | `0f360f805b2879e7d45a5dee1db41d1dca53ca0791ec874bdb76f33dd14b1f8b` | 同左 | 本审计前后未变 |
| `C:\Users\KK\.config\opencode\opencode.jsonc` | `1652e9626f1dbee1c505fb539a96b6145bf59173f879e0fed174e5678c3a40ea` | 同左 | 本审计前后未变 |
| `C:\Users\KK\AppData\Local\hermes\config.yaml` | `21dea749e82a00ff9750c279f2dbeff3e64dbe745ad9d5640823fb7bf6b99bba` | 同左 | 本审计前后未变 |

- Paseo：`Paseo.exe` PID 7540/1172/13240；updater installer 145,569,446 bytes；不在 PATH；未发现 Programs/Roaming 安装目录。未做任何启动/停止/更新/配置动作。

---

## 11. 交付物与固定链接

- 仓库：https://github.com/k176060444-lgtm/Paseo-workflow
- 被审固定 Commit：https://github.com/k176060444-lgtm/Paseo-workflow/commit/5fa4a8ad1083c44c92e69f0fb84bdf900bd333ee
- 证据分支：`audit/s0-5fa4a8a-evidence`（以 `5fa4a8a` 为基线，仅新增 `audit/evidence/`）
- 证据根目录：`audit/evidence/5fa4a8ad1083c44c92e69f0fb84bdf900bd333ee/`
- 报告：`.../AUDIT_REPORT.md`
- 机器可读发现：`.../FINDINGS.json`
- 测试结果：`.../TEST_RESULTS.txt`、`.../TEST_SUMMARY.json`
- 交叉验证：`.../CROSS_REVIEW_VALIDATION.md`
- 环境完整性：`.../ENVIRONMENT.json`
- 证据清单：`.../EVIDENCE_MANIFEST.json`
- 独立报告：`.../OPENCODE_REPORT.md`、`.../CODEX_REPORT.md`（配额失败记录）
- 完整 ZIP：`.../Paseo-S0-R4-5fa4a8a-Review.zip`

**最终判定：** 代码 **FAIL**；离线测试全过不等于产品验收；真实集成 **BLOCKED**。在 R5-001、R5-002、R5-003 以及第 9 节各项关闭前，不得进入 S1/S2 或真实工作流执行。等待用户下一步授权。