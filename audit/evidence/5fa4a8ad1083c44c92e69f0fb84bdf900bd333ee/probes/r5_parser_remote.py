import json, importlib.util, pathlib, sys
spec=importlib.util.spec_from_file_location('p0r', r'C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r4/offline-copy/remote/p0_runner.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
F={'verdict':'FAIL','summary':'real blocker','findings':['BLOCKER: breaks gate']}
P={'verdict':'PASS','summary':'example pass','findings':[]}
tick='`'*3
results=[]
def rec(name,result,detail=''):
    results.append({'name':name,'result':result,'detail':detail}); print(result,name,detail)
def expect(name,fn,ok):
    try:
        v=fn(); passed=ok(v); rec(name,'CONFIRMED' if passed else 'NOT_CONFIRMED',repr(v)[:180])
    except Exception as e:
        rec(name,'NOT_CONFIRMED',f'{type(e).__name__}: {e}')

expect('R4-005 remote final_json FAIL then PASS returns None', lambda: m.final_json('## audit\n'+json.dumps(F)+'\n'+json.dumps(P)), lambda v: v is None)
expect('R4-005 remote final_json PASS then FAIL returns None', lambda: m.final_json('## audit\n'+json.dumps(P)+'\n'+json.dumps(F)), lambda v: v is None)
expect('R4-005 remote final_json two fenced verdicts returns None', lambda: m.final_json('Example:\n'+tick+'json\n'+json.dumps(P)+'\n'+tick+'\n'+tick+'json\n'+json.dumps(F)+'\n'+tick), lambda v: v is None)
expect('R4-005 remote final_json single bare FAIL accepted', lambda: m.final_json('## audit\n'+json.dumps(F)), lambda v: v and v.get('verdict')=='FAIL')
expect('R4-005 remote final_json single fenced FAIL accepted', lambda: m.final_json('## audit\n'+tick+'json\n'+json.dumps(F)+'\n'+tick), lambda v: v and v.get('verdict')=='FAIL')
expect('R4-005 remote final_json trailing prose returns None', lambda: m.final_json('## audit\n'+json.dumps(F)+'\nTrailing instructions'), lambda v: v is None)
expect('R4-005 remote final_json truncated returns None', lambda: m.final_json('## audit\n'+json.dumps(F)[:-4]), lambda v: v is None)

def jsonl(texts):
    return '\n'.join(json.dumps({'type':'text','part':{'text':t}},ensure_ascii=False) for t in texts)
expect('R4-005 remote parse_output JSONL FAIL then PASS -> QUESTION (not PASS)', lambda: m.parse_output(jsonl(['## audit\n'+json.dumps(F)+'\n'+json.dumps(P)])), lambda v: v.get('verdict')=='QUESTION')
expect('R4-005 remote parse_output two JSONL parts FAIL/PASS -> QUESTION', lambda: m.parse_output(jsonl(['## audit\n'+json.dumps(F),json.dumps(P)])), lambda v: v.get('verdict')=='QUESTION')
expect('R4-005 remote parse_output JSONL single fenced FAIL -> FAIL', lambda: m.parse_output(jsonl(['## audit\n'+tick+'json\n'+json.dumps(F)+'\n'+tick])), lambda v: v.get('verdict')=='FAIL')
expect('R4-005 remote parse_output JSONL indented/pretty FAIL -> FAIL', lambda: m.parse_output(jsonl(['## audit\n  '+json.dumps(F,indent=2).replace('\n','\n  ')])), lambda v: v.get('verdict')=='FAIL')
expect('R4-005 remote parse_output JSONL trailing prose -> QUESTION', lambda: m.parse_output(jsonl(['## audit\n'+json.dumps(F)+'\nTrailing instructions'])), lambda v: v.get('verdict')=='QUESTION')
expect('R4-005 remote parse_output JSONL truncated -> QUESTION', lambda: m.parse_output(jsonl(['## audit\n'+json.dumps(F)[:-4]])), lambda v: v.get('verdict')=='QUESTION')
expect('R4-005 remote parse_output PASS+BLOCKER -> FAIL', lambda: m.parse_output(jsonl([json.dumps({'verdict':'PASS','summary':'x','findings':['BLOCKER: x']})])), lambda v: v.get('verdict')=='FAIL')
expect('R4-005 remote parse_output APPROVE_WITH_COMMENTS+LOW accepted', lambda: m.parse_output(jsonl([json.dumps({'verdict':'APPROVE_WITH_COMMENTS','summary':'x','findings':['LOW: nit']})])), lambda v: v.get('verdict')=='APPROVE_WITH_COMMENTS')
expect('R4-005 remote parse_output APPROVE_WITH_COMMENTS+HIGH -> FAIL', lambda: m.parse_output(jsonl([json.dumps({'verdict':'APPROVE_WITH_COMMENTS','summary':'x','findings':['HIGH: x']})])), lambda v: v.get('verdict')=='FAIL')
pathlib.Path(r'C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r4/logs/probe-r5-parser-remote.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print('TOTAL',len(results),'CONFIRMED',sum(1 for x in results if x['result']=='CONFIRMED'))