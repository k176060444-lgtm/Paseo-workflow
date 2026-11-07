# Paseo-workflow S0 整改复审汇总

AUDIT_STATUS: COMPLETE（本轮固定 Commit 的源码复审、离线测试及双 CLI 报告收集已完成；真实集成验收仍受阻）

**代码结论：FAIL。真实工作流、远端调用和部署：BLOCKED。**

审计对象：`k176060444-lgtm/Paseo-workflow`，固定修复 Commit `6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4`，tree `31084b689af34414dafd4c5c3f136f96e6f29d43`，parent `79ca81009d16043e8f6905c22f062a22d19003d4`。对照基线 `8fe13211271dabc4de7a7ba02b9853f3d6196979`，tree `0e24ec541ee4b880396b22f35a79041f84096cbb`。结论只适用于这些不可变对象；Draft PR #1 的移动状态不作为源码依据。

## 1. 决定性结论

存在已实测的 **BLOCKER R2-001**：`run()` 的预检识别到状态被篡改后，异常处理又把该状态写入新的合法事件；随后人工恢复保留被降低的预算。一次性 SQLite 夹具中观察到：`bRound=9 → 直接改状态行为0 → verify拒绝 → run预检拒绝但保存BLOCKED → verify反而接受 → 带模拟人工收据恢复 → B_ENTER后为1`。真实模型调用数为0。这不是已证明的远程未认证攻击；它要求状态行先被损坏/外部改写，且预算恢复步骤需要显式恢复调用。但检测到的损坏被重新当成可信状态，是阻断级的证据及恢复缺陷。

对应源码：`src/controller.mjs:243-252,278-295`、`src/store.mjs:62-76`。证据：`../logs/confirmed-defects-node.stdout.log` 的 `DEFECT-R2-001`，工装 `../probes/confirmed_defects.test.mjs`。最小整改是先校验再进行任何状态写入，把损坏状态隔离封存；恢复只能重建到最后可信版本，必须保留已经消耗的预算，并同样保护 approve/recover 入口。

另有敏感路径检查绕过、远端 Git 环境继承、输出契约及证据闭环问题，不能以 Node 测试通过抵消。Windows 原始 Python 套件确为 ERROR，不能引用 GitHub CI 成功替代本机结果。

## 2. 原 S0 的 F1–F10 逐项结论

沿用 `../original/S0-local-static-report.md` 的原始编号。下表是主审依据源码与本机复现作出的最终汇总；两份独立模型报告原文另存，意见不采用多数票。

| 原 ID | 原严重度 | 本轮结论 | 已核实的整改与剩余边界 |
|---|---|---|---|
| F1 | BLOCKER | FIXED | 解析器拒绝矛盾 PASS，实际 `step()` 在 PASS+BLOCKER 下返回 A_WORKER，不进入 A_TEST。自由文本与真实输出契约另见 F5。 |
| F2 | BLOCKER | MITIGATED_FAIL_CLOSED | 三种双席组合、第三席预检失败、取消成功/不确定、丢 ACK 均做离线复现。丢 ACK 保留台账并进入 NEEDS_RECONCILIATION，无静默重派。真实双机、600秒及进程组取消未验收，不能宣称所有远端作业已停止。 |
| F3 | BLOCKER | MITIGATED_FAIL_CLOSED | 不同路径相同合成密钥字节在派发前拒绝；签名 physicalId 不匹配拒绝；中英混合/转义字符的 JS/Python canonical 对照及单字节篡改阳性对照成立。物理身份仍未验证。 |
| F4 | HIGH | FIXED（原参数类型缺陷） | 实际适配器向 SDK 形状的替身传数字3600000。真实 SDK、daemon认证、断连与生命周期仍 NOT_VERIFIED。 |
| F5 | HIGH | NOT_FIXED | 本机旧判决别名兼容了，但 Markdown后接JSON仍被拒绝，远端 APPROVE 被归一为 QUESTION；Soul迁移及法定交付物映射仍待批准。 |
| F6 | BLOCKER | NOT_VERIFIED / BLOCKED | 未用模拟解除 Windows SID/ACL/网络隔离、TEST_ONLY新增/审查/归并、真实SDK或真实远端Harness阻断。 |
| F7 | HIGH | FIXED（原事务和简单漂移检测） | init/intent/ACK/terminal事件故障注入会回滚对应SQL变更；事件改写、派发行删除、证据修改/缺失、空事件表能检测。新出现的重新封存、孤儿证据与查询快照问题单列R2；本地无密钥哈希链不等于WORM。 |
| F8 | HIGH | NOT_FIXED | 普通违规能停线，真实耗尽预算不会被常规恢复清零，未决派发会拒绝恢复。但R2-001重新封存及R2-008早期无SHA恢复死路未解决。 |
| F9 | HIGH | NOT_FIXED | 本机Node子进程及远端Harness子进程能排除合成哨兵；远端Git helper仍真实继承哨兵变量。日志ACL与真实凭据兼容仍未验收。 |
| F10 | MEDIUM | MITIGATED_FAIL_CLOSED | 缺失状态查询不创建目录/库；现有WAL库查询会创建伴生文件，且inspect可混合两个状态版本。Windows原Python套件ERROR，真实进程树终止仍未验证。 |

机器汇总：FIXED 3、MITIGATED_FAIL_CLOSED 3、NOT_FIXED 3、NOT_VERIFIED 1，共10项。这里的整体状态不掩盖已经修好的子问题；例如F3的重复密钥缺陷已关闭，但物理身份子条件没有关闭。

## 3. 本轮新增/细化问题

详细前提、证据ID、源码行号、影响和最小修复均在 `FINDINGS.json`。

| ID | 严重度 / 类别 | 实测或源码结论 | 主要位置 |
|---|---|---|---|
| R2-001 | BLOCKER / code_defect | 已检测的篡改被预检catch重新写成可信状态；人工恢复保留降低后的预算 | controller:243-252,278-295；store:62-76 |
| R2-002 | MEDIUM / code_defect | 证据文件先落盘，登记事务失败后留下verify接受的孤儿文件；同名重试EEXIST | store:33-48,117-120 |
| R2-003 | MEDIUM / code_defect | 两个真实SQLite连接的确定性交错让inspect返回旧任务行及新版本的成功校验 | controller:274-276；store:104-122 |
| R2-004 | LOW / hardening | 现有WAL库的只读status退出0后留下-wal/-shm；主DB字节不变 | store:10-14；cli:32-36 |
| R2-005 | HIGH / code_defect | 远端Git helper在真实本地子进程中继承不相关环境哨兵 | remote/p0_runner.py:107-108,152-158,193-194 |
| R2-006 | HIGH / integration_gap | Markdown/JSON、旧远端verdict和已批准Soul迁移仍无一致契约 | controller:7；policy:92-109；remote/p0_runner.py:113-133 |
| R2-007 | MEDIUM / integration_gap | 原Python测试在Windows为ERROR；诊断重复捕获status exit1/WinError87，不能推断Linux也失败 | remote/tests/test_runner.py:40-45；remote/p0_runner.py:264-270 |
| R2-008 | MEDIUM / code_defect | 早期BLOCKED任务currentSha=null，公开recover CLI缺SHA拒绝、有SHA又不匹配 | cli:18-19,44；controller:278-295 |
| R2-009 | HIGH / code_defect | porcelain重命名解析及trim丢首空格使敏感名检查漏检，真实一次性仓库中实际产生本地commit | git:35-38,54-65 |
| R2-010 | MEDIUM / code_defect | 双审一成一败时，成功席raw/report没有存入Controller artifact/history；门禁仍阻断 | controller:80-95；agents:27-32 |

机器汇总：BLOCKER 1、HIGH 3、MEDIUM 5、LOW 1，共10项；其中代码缺陷7、集成缺口2、加固说明1。R2编号是本轮问题清单，部分是原F项的残留机制细化，不能额外声称为10种互不相关的原始问题。

R2-009仅使用合成`.env`内容和未配置remote的一次性Git仓库；没有真实密钥进入commit，也没有GitHub写操作。R2-010使用真实适配器加进程内假SDK，证明Controller自身证据缺口，未检查真实daemon是否另存transcript。

## 4. 本机离线测试及证据口径

运行环境：21bao / KK-PC-Server，Windows 10 build19044；Node v26.6.0、Git 2.54.0.windows.1、Python 3.14.7。完整命令、绝对可执行文件、cwd、开始时间、耗时、退出码、原始stdout/stderr、JUnit及唯一用例列表见 `TEST_RESULTS.txt` 和 `TEST_SUMMARY.json`。

| 批次 | 用例 | PASS | ERROR | exit |
|---|---:|---:|---:|---:|
| 原始Node全套，未改测试 | 25 | 25 | 0 | 0 |
| 原始Python全套，未改测试 | 1 | 0 | 1 | 1 |
| supplemental-node | 24 | 24 | 0 | 0 |
| confirmed-defects-node | 3 | 3 | 0 | 0 |
| cross-validation-node | 4 | 4 | 0 | 0 |
| post-review-node | 4 | 4 | 0 | 0 |
| supplemental-python | 6 | 6 | 0 | 0 |

另有7个JS语法检查通过；它们不计为测试用例。补充/确认/反证批次合计41个条目，包含同一机制的交叉确认；**DEFECT探针PASS表示缺陷被复现，绝不表示产品通过**。原Python的诊断重复不再计为新增用例，保留原测试ID，并披露保留临时目录、捕获原始subprocess stderr的工装调整；没有改掉原失败断言。

原Python失败是`test_native_harness_durable_job_and_hmac`的ERROR。原日志含status非零及清理时WinError32/5；诊断重复进一步记录status exit1、WinError87。不能把清理异常当作唯一根因，也不据此断言Linux Runner失败。合成信号探针没有额外发送真实OS信号。

GitHub CI run `42357793457`显示25项Node、1项Python成功，只作为外部参考。本机的1项Python ERROR保留。真实SSH/P0和SDK调用均未发生；第三席计时使用离线短窗口，未实测600秒。

## 5. 两份独立报告、作废轮次及交叉复核

- `CODEX_REPORT.md`：Codex CLI报告原文字节副本，exit0，thread `01a1b552-1ad6-7d21-8b7e-ee0438d405f4`，17:23:38至17:26:32。输入含完整固定源码、基线差异和原离线日志，未喂入OpenCode本轮意见。
- `OPENCODE_REPORT.md`：OpenCode attempt-04-compact原文字节副本，exit0，无流错误，session `ses_e4a9126feffeAu0DB62kXxNVqf`，17:55:01至17:58:39。完整stdin为130750字节，包含7个src模块、Python Runner、3份关键文档、4份Soul，共15份完整目标文件及原S0/离线日志。该轮没有读取全仓39份文件；不能声称两席都逐文件通读了39份。未喂入Codex本轮意见。
- 两席均执行静态推理，明确没有亲自复跑测试；实际运行的离线验证由主审另行完成。不是工作流的Arbitrator或Pro-Audit报告，也不构成Gate5.9批准。
- OpenCode attempt-01未产报告；attempt-02的附件内容被截断，报告作废；attempt-03最终exit1，流错误为上游`empty reply / whole output spent on reasoning`，无报告。attempt-04采用压缩后的完整stdin，保留同一模型/provider/proxy。以上失败及作废收据一并保留。
- 有效调用前后的5个既有配置/wrapper哈希一致（17:23至18:31审计完成时5/5全部与基线一致：`C:\Users\KK\.codex\config.toml`=`28ef0965...`、`C:\Users\KK\AppData\Local\hermes\profiles\ling\config.yaml`=`c4001d4b...`）。其后打包重读时检测到两项非本任务并发改动：`C:\Users\KK\.codex\config.toml`（mtime `2026-11-07T18:48:28+08:00`，新哈希 `0f360f805b2879e7d45a5dee1db41d1dca53ca0791ec874bdb76f33dd14b1f8b`，外部会话改动）与 `C:\Users\KK\AppData\Local\hermes\profiles\ling\config.yaml`（mtime `2026-11-07T18:58:03+08:00`，新哈希 `615f258742f87af5d02e4461f9e044bc4ab9d66247f5c23fd6fbdf113caa2313`，KK 切换本会话模型所致）；其余3项（`opencode.jsonc`、`D:\codex\codex`、`D:\opencode\opencode`）始终未变。详情见 `FINAL_VERIFICATION.json`；不把API key、auth文件或真实密钥收入证据包。

独立报告含错误推断，故原文保留，修正写入 `CROSS_REVIEW_VALIDATION.md`。例如Codex声称NEEDS_RECONCILIATION会被预检覆盖，已被真实反证推翻；迟到第三席在cancel时返回有效FAIL的路径会汇总第三份报告并阻断。相反，OpenCode提出的早期无SHA恢复、Git路径解析和双审成功结果遗漏均另写探针实测确认。没有用提交者自述或模型自述判PASS。

## 6. 必须继续保持的BLOCKER / NOT_VERIFIED

1. R2-001状态可信性及恢复预算缺陷仍未修复；本轮未修改被审源码。
2. Windows不同进程身份/SID、文件ACL、网络与凭据边界未真实验收；环境变量和权限JSON不能替代。
3. TEST_ONLY新增测试、独立审查及归并到最终Commit的完整闭环未完成。
4. 真实Paseo SDK/daemon认证、超时/断连、Agent生命周期及真实远端OpenCode JSONL/权限/作业生命周期未验收。
5. 两台不同物理P0主机及可信主机/密钥映射未验收；配置physicalId、SSH alias及HMAC持有证明不足以完成此验收。
6. 真实第三席600秒行为、Linux进程组和Windows Job Object/整个进程树取消未验收。

另有OS崩溃/断电、多进程压力、外部不可变锚定和审批主体认证未测。这些事项不由模拟解除，也不在本轮扩权执行。

## 7. S1计划与回滚

完整文件为 `S1_INSTALL_PLAN.md`，仅PROPOSED。列出0.15.2/0.15.3的证据与待验条件，由KK决定版本；精确锁定CLI/Client和依赖。候选新树在E盘，独立prefix、home、state、cache、tmp、logs、worktrees；保留现有Codex/OpenCode/Hermes配置、模型及代理路径，避免全局安装、PATH/prefix变更和自动升级。

计划明确分开：S1-A静态包准备；S1-B另批无模型daemon验收；S1-C另批真实SDK/Harness。现阶段没有安装或启动任何Paseo实例。回滚按触发点记录：安装失败封存新树；新实例失败仅处理确认归属的PID/home；优雅停止失败提交具体PID及证据申请针对性处理；发现既有配置并发变更先读diff，不能用旧备份覆盖；保留DB/WAL/SHM及证据一致副本。删除、卸载或强停没有从计划审阅中推定获批。

本轮没有自动merge、push、评论PR、部署、启动真实工作流、修改服务、分发密钥或配置远端节点。交付后等待KK审阅及下一步授权。

## 8. 固定版本源码与远端证据包链接

- 仓库主页：https://github.com/k176060444-lgtm/Paseo-workflow
- 本轮被审固定修复 Commit：https://github.com/k176060444-lgtm/Paseo-workflow/commit/6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4
- 原审计基线 Commit：https://github.com/k176060444-lgtm/Paseo-workflow/commit/8fe13211271dabc4de7a7ba02b9853f3d6196979
- Draft PR #1（仅只读参考）：https://github.com/k176060444-lgtm/Paseo-workflow/pull/1
- 原 S0 证据包（基线 `8fe132`）：https://github.com/k176060444-lgtm/Paseo-workflow/blob/audit/s0-8fe132-evidence/audit/evidence/8fe13211271dabc4de7a7ba02b9853f3d6196979/Paseo-S0-8fe132-evidence.zip
- 本轮 S0 整改复审证据包（ZIP）：https://github.com/k176060444-lgtm/Paseo-workflow/blob/audit/s0-6c57a3d8-evidence/audit/evidence/6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4/Paseo-S0-6c57a3d8-Review.zip
- 本轮汇总审计报告：https://github.com/k176060444-lgtm/Paseo-workflow/blob/audit/s0-6c57a3d8-evidence/audit/evidence/6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4/AUDIT_REPORT.md
- Codex 独立审计报告：https://github.com/k176060444-lgtm/Paseo-workflow/blob/audit/s0-6c57a3d8-evidence/audit/evidence/6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4/CODEX_REPORT.md
- OpenCode 独立审计报告：https://github.com/k176060444-lgtm/Paseo-workflow/blob/audit/s0-6c57a3d8-evidence/audit/evidence/6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4/OPENCODE_REPORT.md
- 双审交叉验证记录：https://github.com/k176060444-lgtm/Paseo-workflow/blob/audit/s0-6c57a3d8-evidence/audit/evidence/6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4/CROSS_REVIEW_VALIDATION.md
- 机器可读发现清单：https://github.com/k176060444-lgtm/Paseo-workflow/blob/audit/s0-6c57a3d8-evidence/audit/evidence/6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4/FINDINGS.json
- 本机测试结果详情：https://github.com/k176060444-lgtm/Paseo-workflow/blob/audit/s0-6c57a3d8-evidence/audit/evidence/6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4/TEST_RESULTS.txt
- S1 隔离安装与回滚计划：https://github.com/k176060444-lgtm/Paseo-workflow/blob/audit/s0-6c57a3d8-evidence/audit/evidence/6c57a3d8f0cbcd9459b6ce841c9130f3516bf1e4/S1_INSTALL_PLAN.md

