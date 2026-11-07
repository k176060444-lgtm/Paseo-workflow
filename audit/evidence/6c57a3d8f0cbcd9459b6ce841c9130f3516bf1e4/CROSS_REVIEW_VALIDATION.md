# 双 CLI 原始意见与主审交叉复核

两份独立报告均保留原文字节。下列结论属于主审证据复核，不是修改模型原报告，也不是冒充独立技术仲裁或流程Pro-Audit。`FINDINGS.json`和`AUDIT_REPORT.md`记录最终汇总。

| 独立意见 | 复核结果 | 证据及适用边界 |
|---|---|---|
| Codex F2-a称cancel时迟到第三席FAIL可能漏裁决 | REFUTED（该路径） | `cross-validation-node.stdout.log#X-F2`，实际SshP0Adapter加合成签名回执：cancel返回第三份FINISHED+FAIL时reports=3，passed=false，dispute=true，HIGH finding保留。原报告该段也承认最终基于所有reports汇总，不能仍把其标题当已证BLOCKER。真实时序/600秒未验证。 |
| Codex F8-a称NEEDS_RECONCILIATION在预检失败时被改为BLOCKED | REFUTED | `controller.mjs:247`检查TERMINAL；`cross-validation-node.stdout.log#X-F8`证实原stage/status及事件数不变。不能引用这项误读作为最终阻断理由。 |
| Codex F7关于本地链可被特权者整体重算 | SOURCE_CONFIRMED_TRUST_LIMIT | 项目SECURITY已声明无外部锚定；不是原F7事务/空事件/摘要检查仍未修复的证据。原F7指定子问题FIXED；重新封存、孤儿文件和快照交错分别用R2-001/002/003记录。 |
| Codex F7-b：artifact落盘先于SQL登记 | CONFIRMED / R2-002 | 注入ARTIFACT_REGISTERED事件失败后，文件仍存在，注册行0，verify接受，同名重试EEXIST。是确定性事务故障注入，未做真实断电。 |
| Codex F10：inspect多SELECT没有一致快照 | CONFIRMED / R2-003 | 两个真实SQLite连接、确定性写入交错，返回aRound=1但校验的是aRound=2的账本。未做并发压力基准。 |
| OpenCode D1：不确定任务不能直接recover | FAIL_CLOSED + OPERATIONAL_LIMIT | 未决派发必须先核实，直接拒绝恢复符合要求。缺少受控reconcile入口是运维闭环限制，不等于应直接放行未知作业。没有手工改库来使产品通过。 |
| OpenCode D1：早期BLOCKED且currentSha=null的公开CLI无法恢复 | CONFIRMED / R2-008 | `post-review-node.stdout.log#POST-R2-008`：不传sha退出1(required --sha)，非空sha退出1(Git SHA not the approved recovery basis)。不声称直接JS API也不能传null。 |
| OpenCode D2 / Codex F2-b：submit/status失败后先前作业未全部取消 | CONFIRMED_FAIL_CLOSED_BOUNDARY | `supplemental-node.stdout.log#R-F2-lost-ACK`保留ACKNOWLEDGED/ACKNOWLEDGED/DISPATCH_INTENT，状态NEEDS_RECONCILIATION；第二次run不重派。台账存在，不能说任务完全不被追踪；本次也不能证明远端作业已经停下。真实取消及人工逐席对账仍需后续验收。 |
| OpenCode D3：重命名porcelain路径被截断 | CONFIRMED / R2-009 | `POST-R2-009a`实测普通目标名及敏感源名产生路径ordinary.txt与v；合成内容实际形成临时本地commit，无remote。另`POST-R2-009b`发现must().trim()去首空格，将tracked .env判成env，同样漏检。 |
| OpenCode D4：崩溃遗留锁缺少受控解锁 | SOURCE_CONFIRMED_OPERATIONAL_LIMIT | store:124-132源码及注释确认需人工对账。未强杀真实进程来复现，不标成已实测的新增控制绕过；原F8残余记录该限制。 |
| OpenCode D5：双审成功席证据在另一席失败时遗漏 | CONFIRMED / R2-010 | 实际PaseoAgentRuntime.execute配进程内假SDK：dispatch一TERMINAL一ACKNOWLEDGED；Controller artifact=0、history=0，verify仍接受。未知席未获准放行；真实daemon外部transcript未检查。 |
| OpenCode D6：无争议路径缺少明确仲裁未触发记录 | SOURCE_CONFIRMED_CONTRACT_RESIDUAL | 归入F5/Soul迁移及法定交付物映射；不自行更改已冻结的仲裁触发条件，也不把其作为安全绕过。 |
| OpenCode F6文字称本机测试仍继承整个环境 | REFUTED_FOR_NODE_PATH | git:8-17的execArgv使用childEnv；`supplemental-node.stdout.log#R-F9`真实Node子进程排除合成哨兵。实际遗漏在Python remote.run，见R2-005，不能把修好的Node路径重新写成继承全部环境。 |
| 两席关于原Python ERROR无法从清理异常确定根因 | INITIAL_EVIDENCE_LIMIT_RESOLVED_IN_PART | 诊断重复保留目录并捕获status子进程stderr，记录WinError87；信号mock探针定位到Windows os.kill(pid,0)路径。保持原测试ERROR，不把辅助诊断当新增通过测试，也不推断Linux部署失败。 |

两席最初均只收到固定源码、原S0报告及原离线日志，未收到另一席本轮结论，也未收到主审后续缺陷清单。OpenCode有效轮的输入范围为15份核心文件；无附件截断，无流错误，exit0；较早截断及失败轮次不充当第二份有效报告。

主审额外独立确认R2-001和R2-005等，因此最终FAIL不依赖上述被反驳的模型推断。所有合成key、sentinel和假SDK均为一次性夹具；没有读取用户真实凭据，没有真实SSH/远端/SDK/模型工作流操作。
