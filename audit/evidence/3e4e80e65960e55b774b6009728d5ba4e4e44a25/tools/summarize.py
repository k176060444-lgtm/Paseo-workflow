import json,re,datetime
from pathlib import Path
B=Path(r'C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r7');L=B/'logs';E=B/'evidence';E.mkdir(exist_ok=True)
rows=[]
def node(tag,log,exitf,argv,kind,note=''):
 t=(L/log).read_text(encoding='utf-8',errors='replace')
 def n(k):
  m=re.search(r'^\u2139 '+k+r' (\d+)$',t,re.M);return int(m.group(1)) if m else 0
 rows.append({'tag':tag,'kind':kind,'argv':argv,'cwd':'repo','tests':n('tests'),'passed':n('pass'),'failed':n('fail'),'errors':0,'skipped':n('skipped'),'exit_code':int((L/exitf).read_text().strip()),'log':'logs/'+log,'note':note})
def probe(tag,jsonfile,argv,note=''):
 d=json.loads((L/jsonfile).read_text(encoding='utf-8'));n=len(d);p=sum(1 for x in d if x.get('result')=='CONFIRMED')
 rows.append({'tag':tag,'kind':'audit-probe','argv':argv,'cwd':'repo','tests':n,'passed':p,'failed':n-p,'errors':0,'skipped':0,'exit_code':0,'log':'logs/'+jsonfile,'note':note})
rows.append({'tag':'npm-check','kind':'product-syntax','argv':'npm run check','cwd':'repo','tests':0,'passed':0,'failed':0,'errors':0,'skipped':0,'exit_code':int((L/'npm-check.exit.txt').read_text().strip()),'log':'logs/npm-check.stdout.log','note':''})
node('npm-test','npm-test.stdout.log','npm-test.exit.txt','npm test (node --test)','product-original-node')
pt=(L/'python-full.stderr.log').read_text(encoding='utf-8',errors='replace');m=re.search(r'Ran (\d+) tests',pt);ok=pt.rstrip().endswith('OK')
rows.append({'tag':'python-full','kind':'product-original-python','argv':"python -B -m unittest discover -s remote/tests -p 'test*.py' -v",'cwd':'repo','tests':int(m.group(1)) if m else 0,'passed':int(m.group(1)) if m and ok else 0,'failed':0 if ok else 1,'errors':0 if ok else 1,'skipped':0,'exit_code':int((L/'python-full.exit.txt').read_text().strip()),'log':'logs/python-full.stderr.log','note':''})
probe('probe-r7-attestation','probe-r7-attestation.json','node probes/r7_attestation_probe.mjs','R7-001 signed/forged execution attestation matrix; 1 NOT_CONFIRMED is cross-commit seat accepted into history (cannot pass current gate).')
probe('probe-r7-tester','probe-r7-tester.json','node probes/r7_tester_probe.mjs','Production git.testRun emits no attestation; synthetic signed receipt passes.')
probe('probe-r7-runtime','probe-r7-runtime.json','node probes/r7_runtime_probe.mjs','PaseoAgentRuntime result without attestation rejected.')
probe('probe-r7-root','probe-r7-root.json','node probes/r7_root_probe.mjs','evidenceRoot add/delete/tamper/dispatch/Git root matrix.')
probe('probe-r7-nonce','probe-r7-nonce.json','node probes/r7_nonce_probe2.mjs','Nonce rollback/cross-gate/recovery matrix.')
probe('probe-r7-approval-orphan','probe-r7-approval-orphan.json','node probes/r7_approval_orphan_probe.mjs','Failed approval artifact/retry wedge reproduced.')
probe('probe-r6-p0','probe-r6-p0.json','node probes/r6_p0_verify.mjs','P0 HMAC/job/commit/physicalId/model/dispatch regression.')
probe('probe-r5-parser-local','probe-r5-parser-local.json','node probes/r5_parser.mjs','Parser regression.')
probe('probe-r5-parser-remote','probe-r5-parser-remote.json','python probes/r5_parser_remote.py','Remote JSONL parser regression.')
probe('probe-r5-git-paths','probe-r5-git-paths.json','node probes/r5_git_paths.mjs','Path/Unicode/index regression.')
node('regress-r2-009','regress-r2_009_paths.stdout.log','regress-r2_009_paths.exit.txt','node --test probes/r2_009_paths.test.mjs','regression-probe')
node('regress-r3-004-005','regress-r3_004_005_env.stdout.log','regress-r3_004_005_env.exit.txt','node --test probes/r3_004_005_env.test.mjs','regression-probe')
node('regress-r2-006-soul','regress-r2_006_parser_soul.stdout.log','regress-r2_006_parser_soul.exit.txt','node --test probes/r2_006_parser_soul.test.mjs','regression-probe')
tot=sum(r['tests'] for r in rows);pas=sum(r['passed'] for r in rows);fail=sum(r['failed'] for r in rows);err=sum(r['errors'] for r in rows);skip=sum(r['skipped'] for r in rows)
summary={'schema':'paseo-s0-r7-test-summary/v1','generated_at':datetime.datetime.now().astimezone().isoformat(),'audited_commit':'3e4e80e65960e55b774b6009728d5ba4e4e44a25','baseline_commit':'20989c60226562a51886d5a979e773fecc7e4ddb','parent_commit':'1e237028ab4029b38f6c48058a54a7520887c17f','tree':'5743312c2e9f3595bee3fecc4819e935d0fcc73c','environment':{'os':'Windows 10 (21bao)','node':'v26.6.0','npm':'11.18.0','python':'3.11.15','git':'2.54.0.windows.1','codex':'0.166.0','opencode':'1.19.3','paseo_app':'0.15.3','paseo_daemon':'0.15.3','paseo_cli':'0.15.3','sdk_declared':'0.15.2','sdk_bundled':'0.15.3'},'note':'Probe CONFIRMED means the assertion held. For defect-reproduction probes, CONFIRMED means the defect was observed, not product acceptance. Product Node suite has 1 Linux-independent Windows symlink SKIP. No real remote P0 was contacted.','totals':{'tests':tot,'passed':pas,'failed':fail,'errors':err,'skipped':skip},'batches':rows}
(E/'TEST_SUMMARY.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
lines=['Paseo-workflow S0-R7 第八轮独立审计 — 测试结果','被审 Commit: 3e4e80e65960e55b774b6009728d5ba4e4e44a25','基线 Commit: 20989c60226562a51886d5a979e773fecc7e4ddb','实际父提交: 1e237028ab4029b38f6c48058a54a7520887c17f','Tree: 5743312c2e9f3595bee3fecc4819e935d0fcc73c','','环境: Windows 10 (21bao); Node v26.6.0; npm 11.18.0; Python 3.11.15; Git 2.54.0.windows.1; Codex 0.166.0; OpenCode 1.19.3; Paseo App/Daemon/CLI 0.15.3; SDK 0.15.2','注意: 探针 CONFIRMED 表示断言成立；缺陷复现探针的 CONFIRMED 不代表产品通过。','','{:<32}{:>6}{:>6}{:>6}{:>5}{:>6}{:>6}'.format('批次','用例','PASS','FAIL','ERR','SKIP','exit')]
for r in rows: lines.append('{:<32}{:>6}{:>6}{:>6}{:>5}{:>6}{:>6}'.format(r['tag'],r['tests'],r['passed'],r['failed'],r['errors'],r['skipped'],r['exit_code']))
lines.append('{:<32}{:>6}{:>6}{:>6}{:>5}{:>6}'.format('合计',tot,pas,fail,err,skip))
lines+=['','说明：npm-test 为 77 项（76 PASS / 1 SKIP）；唯一 SKIP 是真实 Windows symlink EPERM。Python 11/11。','','逐批命令、cwd、日志：']
for r in rows: lines.append(f"- {r['tag']}: {r['argv']} | cwd={r['cwd']} | exit={r['exit_code']} | log={r['log']} | {r['note']}")
lines+=['','Python 原始套件 stderr（完整）：',pt.strip()]
(E/'TEST_RESULTS.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('TOTAL',tot,pas,fail,err,skip)
for r in rows: print(r['tag'],r['tests'],r['passed'],r['failed'],r['skipped'],r['exit_code'])