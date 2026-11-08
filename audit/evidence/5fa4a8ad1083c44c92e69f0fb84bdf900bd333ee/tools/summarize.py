import json, re, datetime
from pathlib import Path

BASE=Path(r'C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r4')
L=BASE/'logs'; E=BASE/'evidence'; E.mkdir(exist_ok=True)
rows=[]

def node(tag,log,exitf,argv,kind,expected=False,note=''):
    t=(L/log).read_text(encoding='utf-8',errors='replace')
    def n(k):
        m=re.search(r'^\u2139 '+k+r' (\d+)$',t,re.M);return int(m.group(1)) if m else 0
    rows.append({'tag':tag,'kind':kind,'argv':argv,'cwd':'offline-copy','tests':n('tests'),'passed':n('pass'),'failed':n('fail'),'errors':0,'skipped':n('skipped'),'exit_code':int((L/exitf).read_text().strip()),'log':'logs/'+log,'expected_failure':expected,'note':note})

def probe(tag,jsonfile,argv,note=''):
    d=json.loads((L/jsonfile).read_text(encoding='utf-8'))
    rows.append({'tag':tag,'kind':'audit-probe','argv':argv,'cwd':'offline-copy','tests':len(d),'passed':sum(1 for x in d if x['result']=='CONFIRMED'),'failed':sum(1 for x in d if x['result']!='CONFIRMED'),'errors':0,'skipped':0,'exit_code':int((L/jsonfile.replace('.json','.exit.txt')).read_text().strip()) if (L/jsonfile.replace('.json','.exit.txt')).exists() else 0,'log':'logs/'+jsonfile,'expected_failure':False,'note':note})

rows.append({'tag':'npm-check','kind':'product-syntax','argv':'npm run check','cwd':'offline-copy','tests':0,'passed':0,'failed':0,'errors':0,'skipped':0,'exit_code':int((L/'npm-check.exit.txt').read_text().strip()),'log':'logs/npm-check.stdout.log','expected_failure':False,'note':''})
node('npm-test','npm-test.stdout.log','npm-test.exit.txt','npm test (node --test tests/*.test.mjs)','product-original-node')
pt=(L/'python-full.stderr.log').read_text(encoding='utf-8',errors='replace');m=re.search(r'Ran (\d+) tests',pt);ok=pt.rstrip().endswith('OK')
rows.append({'tag':'python-full','kind':'product-original-python','argv':"python -B -m unittest discover -s remote/tests -p 'test*.py' -v",'cwd':'offline-copy','tests':int(m.group(1)) if m else 0,'passed':int(m.group(1)) if m and ok else 0,'failed':0 if ok else 1,'errors':0 if ok else 1,'skipped':0,'exit_code':int((L/'python-full.exit.txt').read_text().strip()),'log':'logs/python-full.stderr.log','expected_failure':False,'note':''})

node('regress-r2-009','regress-r2_009_paths.stdout.log','regress-r2_009_paths.exit.txt','node --test probes/r2_009_paths.test.mjs','regression-probe')
node('regress-r3-004-005','regress-r3_004_005_env.stdout.log','regress-r3_004_005_env.exit.txt','node --test probes/r3_004_005_env.test.mjs','regression-probe')
node('regress-r3-007','regress-r3_007_p0.stdout.log','regress-r3_007_p0.exit.txt','node --test probes/r3_007_p0.test.mjs','regression-probe')
node('regress-f1-f10','regress-f_regression.stdout.log','regress-f_regression.exit.txt','node --test probes/f_regression.test.mjs','regression-probe')
node('regress-r2-002-003-004','regress-r2_002_003_004.stdout.log','regress-r2_002_003_004.exit.txt','node --test probes/r2_002_003_004.test.mjs','regression-probe',note='readSnapshot concurrent-writer fixture adapted from illegal aRound decrease to legal GATE_A_ROUND_START 3->4; R2-003 behavior verified.')
node('regress-r2-006-soul','regress-r2_006_parser_soul.stdout.log','regress-r2_006_parser_soul.exit.txt','node --test probes/r2_006_parser_soul.test.mjs','regression-probe')
node('regress-r2-010','regress-r2_010_pair.stdout.log','regress-r2_010_pair.exit.txt','node --test probes/r2_010_pair.test.mjs','regression-probe',expected=True,note='One failure is the prior-round defect-reproduction probe expecting NEEDS_RECONCILIATION to be overwritten to BLOCKED; actual is NEEDS_RECONCILIATION (R3-003 fixed). Positive result.')

probe('probe-r5-stage','probe-r5-stage.json','node probes/r5_stage_bypass.mjs','Stage/status/approval/P0 forgery probes; CONFIRMED means defect observed.')
probe('probe-r5-rounds','probe-r5-rounds.json','node probes/r5_store_rounds.mjs','Round/frozen/history/baseSha/currentSha/replay matrix.')
probe('probe-r5-artifact','probe-r5-artifact.json','node probes/r5_artifact.mjs','artifact fsync/second-connection/orphan/duplicate matrix.')
probe('probe-r5-trust','probe-r5-trust.json','node probes/r5_trust.mjs','init trust-root and recovery basis matrix.')
probe('probe-r5-parser-local','probe-r5-parser-local.json','node probes/r5_parser.mjs','Local FAIL/PASS/dual-fence/indent/truncate/severity matrix.')
probe('probe-r5-parser-remote','probe-r5-parser-remote.json','python probes/r5_parser_remote.py','Remote final_json/JSONL matrix.')
probe('probe-r5-git','probe-r5-git.json','node probes/r5_git_paths.mjs','Unicode paths + full index symlink/gitlink/sensitive path matrix.')

tot=sum(r['tests'] for r in rows);pas=sum(r['passed'] for r in rows);fail=sum(r['failed'] for r in rows);err=sum(r['errors'] for r in rows);skip=sum(r['skipped'] for r in rows)
summary={'schema':'paseo-s0-r4-test-summary/v1','generated_at':datetime.datetime.now().astimezone().isoformat(),'audited_commit':'5fa4a8ad1083c44c92e69f0fb84bdf900bd333ee','baseline_commit':'fa157e1ce53374d539f4b5b5aa1129eccad7cb3b','parent_commit':'e4c93d3ee6ed9be7081e06596ce96411a2708bdf','tree':'518032cba06467be3cf5e6b218b9ea0ce654ac06','environment':{'os':'Windows 10 (21bao)','node':'v26.6.0','npm':'11.18.0','python':'3.11.15','git':'2.54.0.windows.1','codex':'0.166.0','opencode':'1.19.3'},'note':'Probe PASS/CONFIRMED means the assertion held. Several probes are defect-reproduction probes; CONFIRMED means the defect was observed, NOT product acceptance. The single FAIL in regress-r2-010 is an expected old-defect probe: actual NEEDS_RECONCILIATION proves R3-003 fixed.','totals':{'tests':tot,'passed':pas,'failed':fail,'errors':err,'skipped':skip},'batches':rows}
(E/'TEST_SUMMARY.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
lines=['Paseo-workflow S0-R4 第五轮独立审计 — 测试结果','被审 Commit: 5fa4a8ad1083c44c92e69f0fb84bdf900bd333ee','基线 Commit: fa157e1ce53374d539f4b5b5aa1129eccad7cb3b','实际父提交: e4c93d3ee6ed9be7081e06596ce96411a2708bdf','Tree: 518032cba06467be3cf5e6b218b9ea0ce654ac06','',
 '环境: Windows 10 (21bao); Node v26.6.0; npm 11.18.0; Python 3.11.15; Git 2.54.0.windows.1; Codex 0.166.0; OpenCode 1.19.3',
 '注意: 探针 PASS/CONFIRMED 表示断言成立；缺陷复现探针的 CONFIRMED 不代表产品通过。','',
 '{:<30}{:>6}{:>6}{:>6}{:>5}{:>6}{:>6}'.format('批次','用例','PASS','FAIL','ERR','SKIP','exit')]
for r in rows:
    lines.append('{:<30}{:>6}{:>6}{:>6}{:>5}{:>6}{:>6}'.format(r['tag'],r['tests'],r['passed'],r['failed'],r['errors'],r['skipped'],r['exit_code']))
lines.append('{:<30}{:>6}{:>6}{:>6}{:>5}{:>6}'.format('合计',tot,pas,fail,err,skip))
lines+=['','说明：regress-r2-010 的 1 个失败是上一轮缺陷复现探针，期望“对账状态被覆盖为 BLOCKED”；实际保持 NEEDS_RECONCILIATION，说明 R3-003 已修复。该失败不是产品失败。',
 'Node 原始套件的 1 个 skip 是 R4-007 真实 Windows symlink 创建因 EPERM 跳过；索引级 120000 已单独验证。','','逐批命令、cwd、日志：']
for r in rows: lines.append(f"- {r['tag']}: {r['argv']} | cwd={r['cwd']} | exit={r['exit_code']} | log={r['log']} | expected_failure={r['expected_failure']}")
lines+=['','Python 原始套件 stderr（完整）：',pt.strip()]
(E/'TEST_RESULTS.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('TOTALS',tot,pas,fail,err,skip)
for r in rows: print(r['tag'],r['tests'],r['passed'],r['failed'],r['skipped'],r['exit_code'])