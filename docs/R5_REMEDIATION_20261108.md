# S0-R5 状态机、审批与 Git 信任边界整改

固定代码基线：`5fa4a8ad1083c44c92e69f0fb84bdf900bd333ee`  
独立 R5 审计证据：`4b508c6173f6286ed6001a7ffbe98c42cae4cc91`  
本轮分支：`fix/s0-r5-state-gates-20261108`

**本提交是审计候选。真实 P1/S1/S2、Paseo SDK、SSH/P0 和模型调用仍 BLOCKED。**

## 主要变更

1. **R5-002 BLOCKER：** Store.init 强制 WAIT_GATE_01 / WAITING_HUMAN，A/B 轮次零、未创建 TASK_SPEC、未设置 Git SHA、无 Tester/P0/历史/未决执行；检查冻结内容 SHA、意图 SHA、Soul SHA 与固定权限矩阵。任何伪造终态直接拒绝。此前离线测试直接使用不合法初始状态，现改为 **仅位于 tests/fixtures.mjs** 的合成数据库重封装，不向运行时代码开放。
2. **R5-001 BLOCKER：** Store.save 强制显式事件与前后阶段白名单、status 一致性、历史和证据摘要关联、Reviewer/Tester/P0 专属事件及已登记 artifact；Gate 0.1/0.2/5.9 必须存在对应人工审批 artifact，5.9 必须已有独立 Tester A/B、同 Commit 的两物理席 P0、final-compliance.json 和对应历史证据。Controller.approve 在写人工批准收据前重复执行程序化合规验证。
3. **R5-003 HIGH：** Git 真实对象验证函数 `verifyCommitEvidenceSync` 检验 base/final 均为存在的 commit、base 是 final 的祖先、工作树 HEAD 精确对应 final SHA。用于最终 Gate 5.9 及带 Commit 的受控恢复；禁用验证器时 fail-closed。
4. Store.event 公开入口仅允许受控普通事件类型；内部事务已有的类型通过私有可信追加通道，不允许公共调用模拟 TEST/P0/审批事件。
5. Gate A/B 的 round-start 仅在正确阶段消耗预算，用户不能以任意事件随意增加轮次。引入针对伪造初始化、直接写入阶段、伪造证据、假的 Git SHA 的新增 R5 离线探针。

## 审计须重点继续检查

- 直接 Store.save 是否还能通过一个被允许的事件类型伪造阶段/status；尤其是 Gate 0.1、0.2、5.9、A/B 检查与 P0 回写。
- 测试代码的 SQLite 合成状态辅助工具 **只用于本地测试**；不可作为生产测试后门。
- 本轮锁定原有同步 Controller.approve 签名；Git 验证在现有用户账户下使用最小环境及 15 秒超时，不联系网络。
- Controller 的 P0 汇总来源于经 P0 adapter 校验的报告。Store 对同进程恶意调用、假造 artifact 或 DB+events 全权重算**没有密码学保障**，还需要可信执行身份、HMAC/SSH 实机校验与不可变外部证据锚。
- 尚未完成 Soul V2.1、Windows SID/ACL/Job Object、TEST_ONLY 隔离、实机 Paseo SDK、5bao/9bao 真实多机盲审、第三席 600 秒与 cancel 进程组。

## 离线回归

```sh
npm run check
npm test
python3 -m unittest discover -s remote/tests -v
```

历史检验与新 R5 反例测试可能出现差异；必须独立审计正常全流程和失败拒绝路径，分别标记 PASS、FAIL、NOT_VERIFIED。未获人工授权不安装/操作已运行的 21bao Paseo Windows App，不修改 main、旧证据和其他 PR。