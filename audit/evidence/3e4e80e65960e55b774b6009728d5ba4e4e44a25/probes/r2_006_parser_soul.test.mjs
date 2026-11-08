import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseAgentOutput, hasBlockingFinding, finalJsonEnvelope} from '../repo/src/policy.mjs';

const REPO=path.resolve('../repo');

test('R2-006 local Markdown plus bare JSON is accepted',()=>{
  const raw='## Reviewer report\nEvidence checked\n'+JSON.stringify({verdict:'APPROVE',summary:'ok',findings:[]});
  assert.equal(parseAgentOutput(raw,'quality_reviewer').verdict,'PASS');
});

test('R2-006 local fenced JSON is accepted',()=>{
  const fence='`'.repeat(3);
  const raw='## findings\n'+fence+'json\n'+JSON.stringify({verdict:'REQUEST_CHANGES',summary:'fail',findings:['BLOCKER: bug']})+'\n'+fence;
  assert.equal(parseAgentOutput(raw,'spec_reviewer').verdict,'FAIL');
});

test('R2-006 local report without a final envelope is rejected',()=>{
  assert.throws(()=>parseAgentOutput('## report without final envelope','spec_reviewer'),/final JSON/);
});

test('R2-006 local legacy verdict aliases normalize',()=>{
  assert.equal(parseAgentOutput(JSON.stringify({verdict:'APPROVE',summary:'ok',findings:[]}),'spec_reviewer').verdict,'PASS');
  assert.equal(parseAgentOutput(JSON.stringify({verdict:'REQUEST_CHANGES',summary:'no',findings:['BLOCKER: x']}),'spec_reviewer').verdict,'FAIL');
});

test('R2-006 local PASS with any finding is rejected',()=>{
  assert.throws(()=>parseAgentOutput(JSON.stringify({verdict:'PASS',summary:'bad',findings:['BLOCKER: x']}),'spec_reviewer'),/inconsistent PASS/);
  assert.throws(()=>parseAgentOutput(JSON.stringify({verdict:'PASS',summary:'bad',findings:['LOW: nit']}),'spec_reviewer'),/inconsistent PASS/);
});

test('R2-006 local APPROVE_WITH_COMMENTS severity gate',()=>{
  assert.equal(parseAgentOutput(JSON.stringify({verdict:'APPROVE_WITH_COMMENTS',summary:'ok',findings:['[LOW]: nit']}),'quality_reviewer').verdict,'APPROVE_WITH_COMMENTS');
  assert.throws(()=>parseAgentOutput(JSON.stringify({verdict:'APPROVE_WITH_COMMENTS',summary:'bad',findings:['[HIGH]: flaw']}),'quality_reviewer'),/inconsistent PASS/);
});

test('R2-006 local invalid verdict/summary/findings are rejected',()=>{
  assert.throws(()=>parseAgentOutput(JSON.stringify({verdict:'LGTM',summary:'ok',findings:[]}),'spec_reviewer'),/invalid verdict/);
  assert.throws(()=>parseAgentOutput(JSON.stringify({verdict:'PASS',summary:'',findings:[]}),'spec_reviewer'),/missing summary/);
  assert.throws(()=>parseAgentOutput(JSON.stringify({verdict:'PASS',summary:'ok',findings:'none'}),'spec_reviewer'),/findings must be strings/);
});

test('R2-006 local JSON indentation after Markdown is recorded as a parser edge',()=>{
  const raw='## report\n  '+JSON.stringify({verdict:'PASS',summary:'ok',findings:[]});
  let actual='ACCEPTED';
  try{parseAgentOutput(raw,'spec_reviewer');}catch(e){actual='REJECTED: '+e.message;}
  console.log('LOCAL-INDENTED='+actual);
});

test('R2-006 local trailing prose after JSON is recorded as a parser edge',()=>{
  const raw='## report\n'+JSON.stringify({verdict:'PASS',summary:'ok',findings:[]})+'\nend of report';
  let actual='ACCEPTED';
  try{parseAgentOutput(raw,'spec_reviewer');}catch(e){actual='REJECTED: '+e.message;}
  console.log('LOCAL-TRAILING='+actual);
});

test('R2-006 local CRLF Markdown plus JSON is accepted',()=>{
  const raw='## report\r\nEvidence\r\n'+JSON.stringify({verdict:'PASS',summary:'ok',findings:[]});
  assert.equal(parseAgentOutput(raw,'spec_reviewer').verdict,'PASS');
});

test('R2-006 blocking-finding detector only matches line-leading severity markers',()=>{
  assert(hasBlockingFinding(['BLOCKER: x']));
  assert(hasBlockingFinding(['- [HIGH]: x']));
  assert(hasBlockingFinding(['severity: CRITICAL']));
  assert(!hasBlockingFinding(['This sentence mentions a BLOCKER but is not a finding marker.']));
});

test('R2-006 Soul files remain byte-identical to provenance claims and unmodified',()=>{
  const provenance=fs.readFileSync(path.join(REPO,'docs/SOUL_PROVENANCE.md'),'utf8');
  const rows=[...provenance.matchAll(/\| `souls\/([^`]+)` \|[^|]+\| `([0-9a-f]{40})` \| `([0-9a-f]{40})` \|/g)];
  assert(rows.length>=11,'expected 11 Soul provenance rows');
  for(const [,name,commit,blob] of rows){
    const actual=execFileSync('git',['hash-object',path.join(REPO,'souls',name)],{cwd:REPO,encoding:'utf8'}).trim();
    assert.equal(actual,blob,`Soul blob mismatch for ${name}`);
  }
  console.log('SOUL-PROVENANCE-ROWS='+rows.length);
});

test('R2-006 historical Soul migration gap is still explicitly pending',()=>{
  const pending=fs.readFileSync(path.join(REPO,'docs/SOUL_V21_MIGRATION_PENDING.md'),'utf8');
  assert(/未经正式批准|BLOCKED|正式链路 BLOCKED/.test(pending));
  const soulTexts=fs.readdirSync(path.join(REPO,'souls')).map(f=>[f,fs.readFileSync(path.join(REPO,'souls',f),'utf8')]);
  const legacy=soulTexts.filter(([,t])=>/APPROVE|REQUEST_CHANGES|Pro-Audit|pro_audit/i.test(t)).map(([f])=>f);
  console.log('SOUL-LEGACY-TOKENS='+JSON.stringify(legacy));
  assert(legacy.length>0,'legacy Soul text must still be present, hence migration remains pending');
});

test('R2-006 no Markdown legal-deliverable mapping exists in Controller output',()=>{
  const controller=fs.readFileSync(path.join(REPO,'src/controller.mjs'),'utf8');
  assert(!/legal.*deliverable|markdown.*deliverable|deliverable_mapping/i.test(controller));
  const policy=fs.readFileSync(path.join(REPO,'src/policy.mjs'),'utf8');
  // The only structured contract is verdict/summary/findings/taskSpec.
  assert(!/task_id|role:|phase:|soul_sha|soulSha/i.test(policy));
  console.log('R2-006-DELIVERABLE-MAPPING=ABSENT');
});
