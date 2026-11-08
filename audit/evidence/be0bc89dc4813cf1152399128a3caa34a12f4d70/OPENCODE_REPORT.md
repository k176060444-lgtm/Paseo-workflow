# Paseo-workflow 固定提交 `be0bc89` 静态审计结论

**1. R5-001 阶段/审批 — CONFIRMED（漏洞成立）**
- 白名单完整：`src/store.mjs:163-241` 的 `moves/same/特殊分支` 覆盖全部 stage/status 迁移，未知 type 抛错 `:240`，无遗漏。
- 审批 artifact 只是自洽文件：`store.mjs:113-129` 仅校验 `receipt.gate/digest/actor/receipt` 字符串自洽，`Store.artifact`（`:45`）公开可写，`actor/receipt` 无签名、无身份绑定，可伪造。
- `A_REVIEW_PASS/B_REVIEW_PASS`（`:171,182`）只做 stage 迁移，无任何 Reviewer 证据校验。
- 可只用公开 `artifact()+save()` 伪造完整链并 CLOSED：伪造 TEST_RECEIPTS/P0_COMPLETE 历史（需先登记任意 digest artifact）、伪造 lastA/lastB/p0/final-compliance，逐事件过 `#validateFinalGate`（`:130-161`）。唯一真实绑定是 git（`:364-372`），但仓库为运营方可控，造真实 commit 即可。

**2. R5-002 init — CONFIRMED**
`#validateCreation`（`:79-105`）强制 WAIT_GATE_01/WAITING_HUMAN、A/B=0、taskSpec/SHA/lastA/lastB/p0 全空、history/bFindings 空、frozen/Soul/intent digest 自洽、policy==MAX_A/MAX_B/ROLE_PERMISSIONS（`:97-101`）。伪造 frozen/Soul/权限矩阵无法通过 digest 与常量断言。`tests/fixtures.mjs` 仅被 `tests/*.test.mjs` 导入，`src/`、`remote/` 无生产引用（grep 已证）。

**3. R5-003 Git — CONFIRMED（含一处缺口）**
`verifyCommitEvidenceSync`（`git.mjs:152-176`）检查对象存在、是 commit、base 为 final 祖先、previousSha 祖先、worktree HEAD 精确匹配。PREPARE/A/B 冻结在 `store.mjs:364-372` 调用；`authorizeRecovery` 在 `controller.mjs:335-340` 调用。缺口：`GATE_5.9_APPROVED` 的 store 保存路径（`#checkGateReceipt`/`#validateFinalGate`）不重验 git，仅 `controller.approve`（`:30-32`）验证，故绕过 approve 直接 `save` 可跳过 worktree HEAD 漂移检查。缺失验证器 fail-closed：构造器 `store.mjs:18` 断言存在；但可注入 `gitVerifier:()=>true` 关闭。

**4. Gate 5.9 证据 — CONFIRMED**
`#validateFinalGate`（`:130-161`）只查 DB 字段与已登记 artifact 自洽（lastA/lastB/p0/final-compliance/history），无 Reviewer/Tester/P0 身份、无 HMAC 复验、无外部不可变锚。手工 artifact 可满足。

**5. 事件边界 — CONFIRMED**
`Store.event`（`:406-415`）公开仅允许 `CONFIG_FROZEN/P0_OPTIONAL_NOT_DISPATCHED`，trusted 写入由 `#trustedEventWrite` 私有标志（`:10-16`）保护，公开路径无法置位。`save` 的 history 追加（`:380-393`）仅允许 `ROLE_TERMINAL/REVIEW_SEAT_RECORDED/TEST_RECEIPTS/P0_COMPLETE` 且要求已登记 artifact digest。

**6. 回归 — CONFIRMED**
正常链 0.1→Planner→0.2→A→P0→B→5.9 各迁移与证据字段匹配；预算耗尽（`GATE_A/B_EXHAUSTED`→STOPPED_BUDGET）、双审一成一败（A/B_REVIEW_FAIL→A_WORKER/B_ENTER）、P0 冲突（→ARBITRATOR→READY_FINAL）、B 期 commit 变化（NEED_FINAL_COMMIT_P0→P0_FINAL）均有合法路径。`transaction()` 用 `BEGIN IMMEDIATE` 且内部不嵌套（`:33-38`），未见嵌套事务/锁问题。

**7. 四层边界**
- 代码级字段完整性：已实现（哈希链 `verify` `:456-486`、artifact digest）。
- 真实人工身份认证：NOT_VERIFIED（actor/receipt 仅为字符串）。
- 外部不可变锚：NOT_VERIFIED（账本仅本地，无时间戳/公证/链上锚）。
- 真实 P0 身份/HMAC：采集层已实现（`p0.mjs:41-62` + `p0_runner.py:260-265` HMAC/timingSafeEqual），但 Gate 5.9 不复验 HMAC，伪造 DB 可绕过。

**CODE_VERDICT: FAIL**
核心结论：init 与 git 层严格，但 R5-001 的“公开 save+artifact 不可伪造审批/评审/测试/P0/合规”这一安全主张不成立——所有证据仅本地自洽、无身份认证与外部锚，攻击者可用公开 API 伪造完整 CLOSED。
