import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parseAgentOutput} from '../offline-copy/src/policy.mjs';

const tick='`'.repeat(3);

test('R3-006: CLI help renders a real newline between recover commands',()=>{
  const out=execFileSync(process.execPath,['src/cli.mjs','help'],{encoding:'utf8'});
  assert(out.includes('EXACT_COMMIT\n  recover --id'));
  assert(!out.includes('EXACT_COMMIT\\n  recover --id'));
});

test('R3-008: indented bare and pretty JSON after Markdown are accepted',()=>{
  const o={verdict:'APPROVE',summary:'checked',findings:[]};
  assert.equal(parseAgentOutput('## r\n  '+JSON.stringify(o),'spec_reviewer').verdict,'PASS');
  assert.equal(parseAgentOutput('## r\n  '+JSON.stringify(o,null,2),'spec_reviewer').verdict,'PASS');
  assert.equal(parseAgentOutput('## r\r\n  '+JSON.stringify(o),'spec_reviewer').verdict,'PASS');
});

test('R3-008: terminal fenced JSON is accepted',()=>{
  const o={verdict:'REQUEST_CHANGES',summary:'bug',findings:['BLOCKER: x']};
  assert.equal(parseAgentOutput('## r\n'+tick+'json\n'+JSON.stringify(o)+'\n'+tick,'spec_reviewer').verdict,'FAIL');
  assert.equal(parseAgentOutput('## r\n  '+tick+'\n'+JSON.stringify(o)+'\n  '+tick,'spec_reviewer').verdict,'FAIL');
});

test('R3-008: trailing prose, truncated JSON and non-terminal fences are rejected',()=>{
  const o={verdict:'APPROVE',summary:'checked',findings:[]};
  assert.throws(()=>parseAgentOutput('## r\n'+JSON.stringify(o)+'\ntrailing','spec_reviewer'),/final JSON/);
  assert.throws(()=>parseAgentOutput('## r\n'+JSON.stringify(o).slice(0,-5),'spec_reviewer'),/final JSON/);
  assert.throws(()=>parseAgentOutput('## r\n'+tick+'json\n'+JSON.stringify(o)+'\n'+tick+'\ntrailing','spec_reviewer'),/final JSON/);
});

test('R3-008: nested/example objects cannot override a real failing envelope',()=>{
  const outer={verdict:'FAIL',summary:'outer',findings:['BLOCKER: x'],nested:{verdict:'PASS',summary:'inner',findings:[]}};
  assert.throws(()=>parseAgentOutput('## r\n'+JSON.stringify(outer,null,2)+'\ntrailing','spec_reviewer'),/final JSON/);
  const example='## r\n'+JSON.stringify({verdict:'PASS',summary:'example',findings:[]})+'\nActual: '+JSON.stringify({verdict:'FAIL',summary:'real',findings:['BLOCKER: x']})+'\ntrailing';
  assert.throws(()=>parseAgentOutput(example,'spec_reviewer'),/final JSON/);
  const two='## r\n'+JSON.stringify({verdict:'PASS',summary:'first',findings:[]})+'\n'+JSON.stringify({verdict:'FAIL',summary:'second',findings:['BLOCKER: x']});
  assert.equal(parseAgentOutput(two,'spec_reviewer').verdict,'FAIL','the last standalone object is authoritative');
  const fenced='## r\n'+tick+'json\n'+JSON.stringify({verdict:'PASS',summary:'example',findings:[]})+'\n'+tick+'\n'+tick+'json\n'+JSON.stringify({verdict:'FAIL',summary:'real',findings:['BLOCKER: x']})+'\n'+tick;
  // R4-005 LOW: an earlier example fence plus a terminal verdict fence is
  // rejected as a whole (conservative fail-closed, not a PASS bypass).
  assert.throws(()=>parseAgentOutput(fenced,'spec_reviewer'),/final JSON/);
  console.log('R4-005 MULTI_FENCE=REJECTED_CONSERVATIVELY');
});

test('R3-007: local PASS with any finding is rejected',()=>{
  for(const f of (['LOW: nit'],['MEDIUM: issue'],['HIGH: x'],['unclassified'])){
    assert.throws(()=>parseAgentOutput(JSON.stringify({verdict:'PASS',summary:'x',findings:[f]}),'spec_reviewer'),/inconsistent PASS/);
  }
});

test('R3-007: local APPROVE_WITH_COMMENTS severity gate',()=>{
  for(const f of (['LOW: nit'],['MEDIUM: issue'],['INFO: note'],['ADVISORY: note'])){
    assert.equal(parseAgentOutput(JSON.stringify({verdict:'APPROVE_WITH_COMMENTS',summary:'x',findings:[f]}),'spec_reviewer').verdict,'APPROVE_WITH_COMMENTS');
  }
  for(const f of (['HIGH: x'],['BLOCKER: x'],['unclassified'])){
    assert.throws(()=>parseAgentOutput(JSON.stringify({verdict:'APPROVE_WITH_COMMENTS',summary:'x',findings:[f]}),'spec_reviewer'),/inconsistent PASS/);
  }
});

test('R3-007: legacy aliases still normalize locally',()=>{
  assert.equal(parseAgentOutput(JSON.stringify({verdict:'APPROVE',summary:'x',findings:[]}),'spec_reviewer').verdict,'PASS');
  assert.equal(parseAgentOutput(JSON.stringify({verdict:'REQUEST_CHANGES',summary:'x',findings:['BLOCKER: x']}),'spec_reviewer').verdict,'FAIL');
});