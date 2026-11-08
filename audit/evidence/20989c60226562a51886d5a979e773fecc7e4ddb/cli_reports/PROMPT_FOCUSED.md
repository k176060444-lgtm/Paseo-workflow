你是独立只读代码审计员。只做静态审查，不修改文件、不运行命令、不联网。

对象：Paseo-workflow 固定提交 `20989c60226562a51886d5a979e773fecc7e4ddb`（基线 `be0bc89dc4813cf1152399128a3caa34a12f4d70`，实际父 `b20e113c595f4dacc4ce042d76c226d714396c60`），源码 `C:\Users\KK\AppData\Local\Temp\opencode\paseo-audit-s0-r6\offline-copy`。

只读：`src/auth.mjs`、`src/store.mjs`、`src/controller.mjs`、`src/p0.mjs`、`src/git.mjs`、`src/agents.mjs`、`tests/fixtures.mjs`。

回答以下 7 个问题，每条 **CONFIRMED / NOT_CONFIRMED / UNCERTAIN** + `文件:行号` + 一句话理由：

1. **R6-001 认证 Gate**：`loadTrustRoots`/`verifyHumanApproval` 是否真正绑定 keyId、taskId、gate、digest、actor、receipt、nonce、issuedAt、Gate 5.9 evidenceSha256？无签名/错误签名/错误 trust-root SHA 是否 fail-closed？`Store.save` 是否在事务内二次验证，而不是只信 Controller？
2. **R6-002 双审**：`#verifyReviewerPair` 是否要求两席同 Commit/同 phase、不同 agentId、原始 artifact、终止 dispatch/ACK？公开 `recordIntent/recordAck/recordTerminal + artifact + save` 能否伪造两席并通过 A/B_REVIEW_PASS？这属于 Controller 内部记录还是独立来源？
3. **R6-003 重放/过期**：nonce 是否被持久消费？同一签名 envelope 能否重复通过 verify？Gate 0.1/0.2/5.9 与 recovery 是否都有 nonce 防重放？30 分钟/2 分钟窗口是否有效？
4. **R6-004 Git/P0**：Store 直接 `GATE_5.9_APPROVED` 是否重验 Git 对象/祖先/HEAD？P0 是否校验 HMAC、jobId、commit、physicalId、model/harness、stdout hash、终止 dispatch、两物理席位？
5. **R6-005 verifier**：构造器是否拒绝 `gitVerifier` 注入？运行中覆盖属性是否无效？失败是否 fail-closed？
6. **Gate 5.9 证据来源**：`final-compliance.json` 是否只绑定人工签名，而 Reviewer/Tester/P0 原始证据仍是 Controller 自造？人工签名是否证明执行真实性？
7. **回归**：0.1→Planner→0.2→A→P0→B→5.9 正常合成签名链、10 轮、Reviewer 一成一败、P0 冲突、错误审批、受控恢复是否有合法路径？是否引入嵌套事务/锁问题？

最后 `CODE_VERDICT: PASS / FAIL / INCONCLUSIVE`。不超过 1500 字。不要声称运行了测试。