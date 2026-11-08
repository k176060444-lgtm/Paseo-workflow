import json,re,datetime
from pathlib import Path
B=Path(r'C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r5');L=B/'logs';E=B/'evidence';E.mkdir(exist_ok=True)
rows=[]
def node(tag,log,exitf,argv,kind,expected=False,note=''):
    t=(L/log).read_text(encoding='utf-8',errors='replace')
    def n(k):
        m=re.search(r'^\u2139 '+k+r' (\d+)$',t,re.M);return int(m.group(1)) if m else 0
    rows.append({'tag':tag,'kind':kind,'argv':argv,'cwd':'offline-copy','tests':n('tests'),'passed':n('pass'),'failed':n('fail'),'errors':0,'skipped':n('skipped'),'exit_code':int((L/exitf).read_text().strip()),'log':'logs/'+log,'expected_failure':expected,'note':note})
def probe(tag,jsonfile,argv,note='',tests=None,passed=None):
    d=json.loads((L/jsonfile).read_text(encoding='utf-8'))
    n=len(d) if tests is None else tests
    p=sum(1 for x in d if x.get('result')=='CONFIRMED') if passed is None else passed
    rows.append({'tag':tag,'kind':'audit-probe','argv':argv,'cwd':'offline-copy','tests':n,'passed':p,'failed':n-p,'errors':0,'skipped':0,'exit_code':0,'log':'logs/'+jsonfile,'expected_failure':False,'note':note})
rows.append({'tag':'npm-check','kind':'product-syntax','argv':'npm run check','cwd':'offline-copy','tests':0,'passed':0,'failed':0,'errors':0,'skipped':0,'exit_code':int((L/'npm-check.exit.txt').read_text().strip()),'log':'logs/npm-check.stdout.log','expected_failure':False,'note':''})
node('npm-test','npm-test.stdout.log','npm-test.exit.txt','npm test (node --test tests/*.test.mjs)','product-original-node')
pt=(L/'python-full.stderr.log').read_text(encoding='utf-8',errors='replace');m=re.search(r'Ran (\d+) tests',pt);ok=pt.rstrip().endswith('OK')
rows.append({'tag':'python-full','kind':'product-original-python','argv':"python -B -m unittest discover -s remote/tests -p 'test*.py' -v",'cwd':'offline-copy','tests':int(m.group(1)) if m else 0,'passed':int(m.group(1)) if m and ok else 0,'failed':0 if ok else 1,'errors':0 if ok else 1,'skipped':0,'exit_code':int((L/'python-full.exit.txt').read_text().strip()),'log':'logs/python-full.stderr.log','expected_failure':False,'note':''})

probe('probe-r5-forged-flow','probe-r5-forged-flow.json','node probes/r5_forged_flow.mjs','18-step public save+artifact forgery reaches CLOSED; CONFIRMED means defect observed.',tests=18,passed=18)
probe('probe-r5-init-event','probe-r5-init-event.json','node probes/r5_init_event.mjs','init/event creation guard matrix.')
probe('probe-r5-git-verify','probe-r5-git-verify.json','node probes/r5_git_verify.mjs','Git object/ancestry/HEAD + Store freeze/recovery matrix.')
probe('probe-r5-parser-local','probe-r5-parser-local.json','node probes/r5_parser.mjs','Local parser matrix.')
probe('probe-r5-parser-remote','probe-r5-parser-remote.json','python probes/r5_parser_remote.py','Remote parser/JSONL matrix.')
probe('probe-r5-git-paths','probe-r5-git-paths.json','node probes/r5_git_paths.mjs','Unicode/full-index Git path matrix.')
probe('probe-r5-verifier-stub','probe-r5-verifier-stub.json','node probes/r5_verifier_stub.mjs','gitVerifier stub can disable Git trust (R6-005).')
node('regress-r2-009','regress-r2_009_paths.stdout.log','regress-r2_009_paths.exit.txt','node --test probes/r2_009_paths.test.mjs','regression-probe')
node('regress-r3-004-005','regress-r3_004_005_env.stdout.log','regress-r3_004_005_env.exit.txt','node --test probes/r3_004_005_env.test.mjs','regression-probe')
node('regress-r2-006-soul','regress-r2_006_parser_soul.stdout.log','regress-r2_006_parser_soul.exit.txt','node --test probes/r2_006_parser_soul.test.mjs','regression-probe')
node('legacy-r3-007-incompatible','regress-r3_007_p0.stdout.log','regress-r3_007_p0.exit.txt','node --test probes/r3_007_p0.test.mjs','legacy-probe-incompatible',expected=True,note='Old probe seeds non-Gate-0.1 states directly through Store.init; R5-002 now rejects them. Official updated P0 tests pass in npm-test.')
node('legacy-f-regression-incompatible','regress-f_regression.stdout.log','regress-f_regression.exit.txt','node --test probes/f_regression.test.mjs','legacy-probe-incompatible',expected=True,note='Old probe seeds non-Gate-0.1 states directly through Store.init; R5-002 now rejects them. Official updated F2/F3/F7 tests pass in npm-test.')

tot=sum(r['tests'] for r in rows);pas=sum(r['passed'] for r in rows);fail=sum(r['failed'] for r in rows);err=sum(r['errors'] for r in rows);skip=sum(r['skipped'] for r in rows)
eff=[r for r in rows if not r['expected_failure']]
et=sum(r['tests'] for r in eff);ep=sum(r['passed'] for r in eff);ef=sum(r['failed'] for r in eff);ee=sum(r['errors'] for r in eff);es=sum(r['skipped'] for r in eff)
summary={'schema':'paseo-s0-r5-test-summary/v1','generated_at':datetime.datetime.now().astimezone().isoformat(),'audited_commit':'be0bc89dc4813cf1152399128a3caa34a12f4d70','baseline_commit':'5fa4a8ad1083c44c92e69f0fb84bdf900bd333ee','parent_commit':'88a7af38c7c2472a8c67ef674e2395143b9c30ed','tree':'91cf608442690fee0e5694aa6d068d3c416ea3e0','environment':{'os':'Windows 10 (21bao)','node':'v26.6.0','npm':'11.18.0','python':'3.11.15','git':'2.54.0.windows.1','codex':'0.166.0','opencode':'1.19.3'},'note':'Probe CONFIRMED means the assertion held. R5-001/R6-001 probes are defect-reproduction probes; CONFIRMED means the defect was observed, NOT product acceptance. Two legacy-probe batches are expected fixture incompatibility: they seed non-Gate-0.1 states through Store.init, which R5-002 now rejects; updated official tests pass in npm-test.','totals_all':{'tests':tot,'passed':pas,'failed':fail,'errors':err,'skipped':skip},'totals_effective':{'tests':et,'passed':ep,'failed':ef,'errors':ee,'skipped':es},'batches':rows}
(E/'TEST_SUMMARY.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
lines=['Paseo-workflow S0-R5 第六轮独立审计 — 测试结果','被审 Commit: be0bc89dc4813cf1152399128a3caa34a12f4d70','基线 Commit: 5fa4a8ad1083c44c92e69f0fb84bdf900bd333ee','实际父提交: 88a7af38c7c2472a8c67ef674e2395143b9c30ed','Tree: 91cf608442690fee0e5694aa6d068d3c416ea3e0','','环境: Windows 10 (21bao); Node v26.6.0; npm 11.18.0; Python 3.11.15; Git 2.54.0.windows.1; Codex 0.166.0; OpenCode 1.19.3','注意: 探针 CONFIRMED 表示断言成立；缺陷复现探针的 CONFIRMED 不代表产品通过。','','全量批次：','{:<32}{:>6}{:>6}{:>6}{:>5}{:>6}{:>6}'.format('批次','用例','PASS','FAIL','ERR','SKIP','exit')]
for r in rows: lines.append('{:<32}{:>6}{:>6}{:>6}{:>5}{:>6}{:>6}'.format(r['tag'],r['tests'],r['passed'],r['failed'],r['errors'],r['skipped'],r['exit_code']))
lines.append('{:<32}{:>6}{:>6}{:>6}{:>5}{:>6}'.format('全量合计',tot,pas,fail,err,skip))
lines+=['','有效产品/独立探针（排除旧夹具不兼容批次）：','{:<32}{:>6}{:>6}{:>6}{:>5}{:>6}'.format('有效合计',et,ep,ef,ee,es),'','说明：legacy-r3-007-incompatible 与 legacy-f-regression-incompatible 的失败，是旧探针直接用 Store.init 构造非 Gate 0.1 状态；R5-002 现在拒绝该类初始化。更新后的官方 P0/F2/F3/F7 测试在 npm-test 中通过，因此这些失败不是产品回归。','','逐批命令、cwd、日志：']
for r in rows: lines.append(f"- {r['tag']}: {r['argv']} | cwd={r['cwd']} | exit={r['exit_code']} | log={r['log']} | expected_failure={r['expected_failure']}")
lines+=['','Python 原始套件 stderr（完整）：',pt.strip()]
(E/'TEST_RESULTS.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('ALL',tot,pas,fail,err,skip);print('EFFECTIVE',et,ep,ef,ee,es)
for r in rows: print(r['tag'],r['tests'],r['passed'],r['failed'],r['skipped'],r['exit_code'])