import json, re, datetime
from pathlib import Path

BASE = Path(r'C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r3')
logs = BASE / 'logs'
ev = BASE / 'evidence'
ev.mkdir(exist_ok=True)
batches = []

def node_counts(txt):
    def n(k):
        m = re.search(r'^\u2139 ' + k + r' (\d+)$', txt, re.M)
        return int(m.group(1)) if m else None
    return n('tests'), n('pass'), n('fail'), n('skipped')

def add_node(tag, log, exitf, argv, kind, expected_failure=False, note=''):
    txt = (logs/log).read_text(encoding='utf-8', errors='replace')
    t,p,f,s = node_counts(txt)
    rc = int((logs/exitf).read_text().strip())
    batches.append({'tag':tag,'kind':kind,'argv':argv,'cwd':'offline-copy',
                    'tests':t,'passed':p,'failed':f,'errors':0,'skipped':s,
                    'exit_code':rc,'log':'logs/'+log,
                    'expected_failure':expected_failure,'note':note})

batches.append({'tag':'npm-check','kind':'product-syntax','argv':'npm run check','cwd':'offline-copy',
                'exit_code':int((logs/'npm-check.exit.txt').read_text().strip()),
                'tests':None,'passed':None,'failed':None,'errors':None,'skipped':None,
                'log':'logs/npm-check.stdout.log','expected_failure':False,'note':''})
add_node('npm-test','npm-test.stdout.log','npm-test.exit.txt','npm test (node --test tests/*.test.mjs)','product-original-node')

ptxt = (logs/'python-full.stderr.log').read_text(encoding='utf-8', errors='replace')
m = re.search(r'Ran (\d+) tests', ptxt); ok = ptxt.rstrip().endswith('OK')
batches.append({'tag':'python-full','kind':'product-original-python',
                'argv':"python -B -m unittest discover -s remote/tests -p 'test*.py' -v",
                'cwd':'offline-copy','exit_code':int((logs/'python-full.exit.txt').read_text().strip()),
                'tests':int(m.group(1)) if m else None,'passed':int(m.group(1)) if m and ok else 0,
                'failed':0 if ok else 1,'errors':0 if ok else 1,'skipped':0,
                'log':'logs/python-full.stderr.log','expected_failure':False,'note':''})

add_node('probe-r4-write-paths','probe-r4-write-paths.stdout.log','probe-r4-write-paths.exit.txt',
         'node --test --test-reporter=spec probes/r4_write_paths.test.mjs','audit-probe')
add_node('probe-r3-002-003','probe-r3-002-003.stdout.log','probe-r3-002-003.exit.txt',
         'node --test --test-reporter=spec probes/r3_002_003.test.mjs','audit-probe')
add_node('probe-r2-009','probe-r2-009.stdout.log','probe-r2-009.exit.txt',
         'node --test --test-reporter=spec probes/r2_009_paths.test.mjs','audit-probe')
add_node('probe-r3-004-005-env','probe-r3-004-005-env.stdout.log','probe-r3-004-005-env.exit.txt',
         'node --test --test-reporter=spec probes/r3_004_005_env.test.mjs','audit-probe')
add_node('probe-r3-007-p0','probe-r3-007-p0.stdout.log','probe-r3-007-p0.exit.txt',
         'node --test --test-reporter=spec probes/r3_007_p0.test.mjs','audit-probe')
add_node('probe-r3-006-008-local','probe-r3-006-008-local.stdout.log','probe-r3-006-008-local.exit.txt',
         'node --test --test-reporter=spec probes/r3_006_008_local.test.mjs','audit-probe')

ptxt2 = (logs/'probe-r3-005-007-008-python.stderr.log').read_text(encoding='utf-8', errors='replace')
m2 = re.search(r'Ran (\d+) tests', ptxt2); ok2 = ptxt2.rstrip().endswith('OK')
batches.append({'tag':'probe-r3-005-007-008-python','kind':'audit-probe',
                'argv':'python -B probes/r3_005_007_008_remote.py','cwd':'offline-copy',
                'exit_code':int((logs/'probe-r3-005-007-008-python.exit.txt').read_text().strip()),
                'tests':int(m2.group(1)) if m2 else None,'passed':int(m2.group(1)) if m2 and ok2 else 0,
                'failed':0 if ok2 else 1,'errors':0 if ok2 else 1,'skipped':0,
                'log':'logs/probe-r3-005-007-008-python.stderr.log','expected_failure':False,'note':''})

add_node('regress-r2-002-003-004','regress-r2_002_003_004.stdout.log','regress-r2_002_003_004.exit.txt',
         'node --test --test-reporter=spec probes/r2_002_003_004.test.mjs','regression-probe')
add_node('regress-r2-006-soul','regress-r2_006_parser_soul.stdout.log','regress-r2_006_parser_soul.exit.txt',
         'node --test --test-reporter=spec probes/r2_006_parser_soul.test.mjs','regression-probe')
add_node('regress-r2-010-pair','regress-r2_010_pair.stdout.log','regress-r2_010_pair.exit.txt',
         'node --test --test-reporter=spec probes/r2_010_pair.test.mjs','regression-probe',
         expected_failure=True,
         note='The one failing case is the prior-round defect-reproduction probe: it expected NEEDS_RECONCILIATION to be overwritten to BLOCKED. Actual is NEEDS_RECONCILIATION, i.e. R3-003 is fixed. The failure is a positive result.')
add_node('regress-f1-f10','regress-f_regression.stdout.log','regress-f_regression.exit.txt',
         'node --test --test-reporter=spec probes/f_regression.test.mjs','regression-probe')

summary = {
 'generated_at': datetime.datetime.now().astimezone().isoformat(),
 'audited_commit':'fa157e1ce53374d539f4b5b5aa1129eccad7cb3b',
 'parent_commit':'53bdaf2219292169ba4a24ef2f558c45bc26ddcf',
 'tree':'63603935af671cd68d0013641fe15f07ab4013da',
 'environment':{'os':'Windows 10 (21bao)','node':'v26.6.0','npm':'11.18.0','python':'3.11.15',
                'git':'2.54.0.windows.1','codex':'0.166.0','opencode':'1.19.3'},
 'note':'Probe PASS means the probe assertion held; several probes are defect-reproduction probes and do NOT indicate product acceptance. The R2-010 regression case marked expected_failure is a positive result: the previous defect no longer reproduces.',
 'batches':batches,
}
(ev/'TEST_SUMMARY.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

lines = []
lines.append('Paseo-workflow S0-R3 第四轮独立审计 — 测试结果')
lines.append('被审 Commit: fa157e1ce53374d539f4b5b5aa1129eccad7cb3b')
lines.append('父 Commit: 53bdaf2219292169ba4a24ef2f558c45bc26ddcf')
lines.append('')
lines.append('环境: Windows 10 (21bao); Node v26.6.0; npm 11.18.0; Python 3.11.15; Git 2.54.0.windows.1; Codex 0.166.0; OpenCode 1.19.3')
lines.append('注意: 探针 PASS 表示断言成立；缺陷复现探针的 PASS 不代表产品通过。')
lines.append('')
lines.append('{:<30}{:>6}{:>6}{:>6}{:>5}{:>6}{:>6}'.format('批次','用例','PASS','FAIL','ERR','SKIP','exit'))
tot=pas=fail=err=skip=0
for b in batches:
    t=b.get('tests')
    if t is None:
        lines.append('{:<30}{:>6}{:>6}{:>6}{:>5}{:>6}{:>6}'.format(b['tag'],'-','-','-','-','-',b['exit_code']));continue
    tot+=t;pas+=b.get('passed') or 0;fail+=b.get('failed') or 0;err+=b.get('errors') or 0;skip+=b.get('skipped') or 0
    lines.append('{:<30}{:>6}{:>6}{:>6}{:>5}{:>6}{:>6}'.format(b['tag'],t,b.get('passed') or 0,b.get('failed') or 0,b.get('errors') or 0,b.get('skipped') or 0,b['exit_code']))
lines.append('{:<30}{:>6}{:>6}{:>6}{:>5}{:>6}'.format('合计',tot,pas,fail,err,skip))
lines.append('')
lines.append('说明：regress-r2-010-pair 的 1 个失败是上一轮缺陷复现探针，期望“对账状态被覆盖为 BLOCKED”；实际保持 NEEDS_RECONCILIATION，说明 R3-003 已修复。该失败不是产品失败。')
lines.append('')
lines.append('逐批命令、cwd、日志：')
for b in batches:
    lines.append('- {}: {} | cwd={} | exit={} | log={} | expected_failure={}'.format(
        b['tag'],b.get('argv'),b.get('cwd'),b.get('exit_code'),b.get('log'),b.get('expected_failure',False)))
lines.append('')
lines.append('Python 原始套件 stderr（完整）：')
lines.append(ptxt.strip())
(ev/'TEST_RESULTS.txt').write_text('\n'.join(lines)+'\n', encoding='utf-8')
print('\n'.join(lines[:30]))