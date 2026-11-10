import {seedSyntheticTask,resealSyntheticState,syntheticHumanAuthority} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {parseAgentOutput,sha256,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../src/policy.mjs';
import {commitWorktree,porcelainPaths,assertTestWorkspace} from '../src/git.mjs';

function sandbox(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r2-'));
  const id='TASK7777',authority=syntheticHumanAuthority(dir,id);
  const store=new Store(path.join(dir,'state'));
  const frozen={schema:1,intent:'Synthetic offline fixture',
    policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  frozen.digest=sha256(frozen);
  seedSyntheticTask(store,{id,stage:'BLOCKED',status:'BLOCKED',frozen,
    aRound:0,bRound:9,currentSha:null,taskSpecSha:null,history:[],inflight:null});
  return {dir,store,id,proof:authority.proof,attest:authority.attest,dispose(){store.close();authority.restore();fs.rmSync(dir,{recursive:true,force:true});}};
}
function git(dir,...args){return execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function repo(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-git-r2-'));
  git(dir,'init','-q');
  fs.writeFileSync(path.join(dir,'ordinary.txt'),'baseline');
  git(dir,'add','.');
  git(dir,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','baseline');
  return {dir,dispose(){fs.rmSync(dir,{recursive:true,force:true});}};
}
test('R2-001 tampered budget never re-anchored by run or recovery', async()=>{
  const w=sandbox();
  try {
    const t=w.store.get(w.id);t.bRound=0;
    w.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),w.id);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    await assert.rejects(()=>c.run(w.id),/state differs/);
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit audited recovery approval.',expectedBasis:w.store.get(w.id).frozen.digest}),/state differs/);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    assert.equal(w.store.get(w.id).bRound,0); // still corrupt, NOT trusted
  } finally {w.dispose();}
});
test('R2-002 orphan artifacts fail verification instead of silently accepting',()=>{
  const w=sandbox();
  try {
    const original=w.store.event.bind(w.store);
    w.store.event=(id,type,payload)=>{if(type==='ARTIFACT_REGISTERED')throw Error('injected event failure');return original(id,type,payload);};
    assert.throws(()=>w.store.artifact(w.id,'orphan.json',{proof:'demo'}),/injected/);
    w.store.event=original;
    assert.throws(()=>w.store.verify(w.id),/unregistered evidence/);
    assert.throws(()=>w.store.artifact(w.id,'orphan.json',{proof:'retry'}),/unregistered evidence/);
  }finally{w.dispose();}
});
test('R2-003 readSnapshot uses one SQLite version despite concurrent writer',()=>{
  const w=sandbox();
  const other=new Store(path.join(w.dir,'state'));
  try{
    w.store.readSnapshot(()=>{
      const before=w.store.get(w.id);
      const updated=other.get(w.id);updated.aRound=1;resealSyntheticState(other,{...updated,stage:'A_WORKER',status:'READY'});
      assert.equal(w.store.get(w.id).aRound,before.aRound);
      w.store.verify(w.id);
    });
    assert.equal(w.store.get(w.id).aRound,1);
    w.store.verify(w.id);
  }finally{other.close();w.dispose();}
});
test('R2-006 final Markdown plus bare/fenced JSON and alias',()=>{
  const raw='## Reviewer report\nEvidence checked\n'+JSON.stringify({verdict:'APPROVE',summary:'ok',findings:[]});
  assert.equal(parseAgentOutput(raw,'quality_reviewer').verdict,'PASS');
  const fence=String.fromCharCode(96).repeat(3);
  const fenced='## findings\n'+fence+'json\n'+JSON.stringify({verdict:'REQUEST_CHANGES',summary:'fail',findings:['BLOCKER: bug']})+'\n'+fence;
  assert.equal(parseAgentOutput(fenced,'spec_reviewer').verdict,'FAIL');
  assert.throws(()=>parseAgentOutput('## report without final envelope','spec_reviewer'),/final JSON/);
});
test('R2-008 early blocked task recovers only on matching frozen basis',()=>{
  const w=sandbox();
  try{
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit local approval to recover.',expectedBasis:'0'.repeat(64)}),/basis/);
    const message='Explicit local approval to recover.',basis=w.store.get(w.id).frozen.digest;
    const r=c.authorizeRecovery({id:w.id,actor:'human',receipt:message,
      expectedBasis:basis,proof:w.proof('recovery',basis,'human',message)});
    assert.equal(r.stage,'PLANNER');
    assert.equal(w.store.get(w.id).bRound,9);
    w.store.verify(w.id);
  }finally{w.dispose();}
});
test('R2-009 raw porcelain preserves leading status space and rename original',()=>{
  assert.deepEqual(porcelainPaths(' M .env\0'),['.env']);
  assert.deepEqual(porcelainPaths('R  .env.production\0ordinary.txt\0'),['.env.production','ordinary.txt']);
  assert.throws(()=>porcelainPaths('R  new.txt\0'),/missing rename/);
});
test('R2-009 tracked .env edit cannot be committed',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,'.env'),'synthetic-only');
    git(r.dir,'add','.env');
    git(r.dir,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','synthetic env baseline');
    fs.writeFileSync(path.join(r.dir,'.env'),'synthetic-updated');
    await assert.rejects(()=>commitWorktree(r.dir,'attack'),/sensitive-looking/);
  }finally{r.dispose();}
});
test('R2-009 staged rename to .env.production cannot be committed',async()=>{
  const r=repo();
  try{
    git(r.dir,'mv','ordinary.txt','.env.production');
    await assert.rejects(()=>commitWorktree(r.dir,'attack'),/sensitive-looking/);
  }finally{r.dispose();}
});
test('R2-010 successful reviewer report survives peer failure',async()=>{
  const w=sandbox();
  try{
    const c=new WorkflowController({store:w.store,runtime:{execute:async ({role,phase,store})=>{
      if(role==='quality_reviewer')throw Error('simulated provider loss');
      const agentId='spec-agent-id',dispatchId='signed-spec-dispatch';
      store.recordIntent(w.id,phase,dispatchId);
      store.recordAck(dispatchId,agentId);
      store.recordTerminal(dispatchId);
      const base={role,phase,agentId,dispatchId,verdict:'PASS',
        findings:[],summary:'Independently signed synthetic seat',taskSpec:null};
      return {...base,attestation:w.attest(role,phase,'a'.repeat(40),
        agentId,dispatchId,base)};
    }},p0:null,gitOps:{assertUnchanged:async()=>{}}});
    // Narrow reviewer fault-injection fixture: process audit behavior has separate tests.
    c.auditRole=async()=>({auditSessionId:'11111111-2222-3333-4444-555555555555'});
    const t=w.store.get(w.id);t.stage='A_REVIEW';t.status='READY';
    t.worktree=w.dir;t.currentSha='a'.repeat(40);t.aRound=1;
    resealSyntheticState(w.store,t);
    await assert.rejects(()=>c.invokePair(t,'A1-review','a'.repeat(40)),/reconcile/);
    const after=w.store.get(w.id);
    assert.equal(after.status,'NEEDS_RECONCILIATION');
    assert.equal(after.history.filter(h=>h.role==='spec_reviewer').length,1);
    const items=w.store.db.prepare('SELECT name FROM artifacts WHERE task_id=?').all(w.id);
    assert(items.some(x=>x.name.includes('spec_reviewer')));
    w.store.verify(w.id);
  }finally{w.dispose();}
});

test('Worker cannot rewrite existing test cases or the test runner configuration',async()=>{
 const w=repo();
 try{
  fs.mkdirSync(path.join(w.dir,'tests'));
  fs.writeFileSync(path.join(w.dir,'tests','existing.test.mjs'),'assert.equal(1,1);');
  fs.writeFileSync(path.join(w.dir,'package.json'),'{"scripts":{"test":"node --test"}}');
  git(w.dir,'add','.');
  git(w.dir,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','protected-test-baseline');
  fs.writeFileSync(path.join(w.dir,'tests','existing.test.mjs'),'assert.equal(1,2);');
  await assert.rejects(()=>commitWorktree(w.dir,'bad-test-change'),/existing tests/);
  git(w.dir,'restore','tests/existing.test.mjs');
  fs.writeFileSync(path.join(w.dir,'package.json'),'{"scripts":{"test":"true"}}');
  await assert.rejects(()=>commitWorktree(w.dir,'bad-test-script'),/test scripts\/configuration/);
 }finally{w.dispose();}
});
test('Worker may add a separate test case but cannot replace the baseline',async()=>{
 const w=repo();try{
  fs.mkdirSync(path.join(w.dir,'tests'));
  fs.writeFileSync(path.join(w.dir,'tests','new.test.mjs'),'import test from "node:test"; test("safe",()=>{});');
  const old=git(w.dir,'rev-parse','HEAD');
  const now=await commitWorktree(w.dir,'additive-test');
  assert.notEqual(now,old);
  assert.equal(fs.readFileSync(path.join(w.dir,'tests','new.test.mjs'),'utf8').includes('safe'),true);
 }finally{w.dispose();}
});

test('TEST_ONLY disposable checkout allows only additive test cases and detects original file changes',async()=>{
 const w=repo();try{
  const exact=git(w.dir,'rev-parse','HEAD');
  fs.mkdirSync(path.join(w.dir,'tests'));
  fs.writeFileSync(path.join(w.dir,'tests','new.test.mjs'),'import test from "node:test"; test("new",()=>{});');
  const exam=await assertTestWorkspace(w.dir,exact);
  assert.equal(exam.length,1);
  assert.equal(exam[0].path,'tests/new.test.mjs');
  fs.writeFileSync(path.join(w.dir,'ordinary.txt'),'tampered original');
  await assert.rejects(()=>assertTestWorkspace(w.dir,exact),/TEST_ONLY violation/);
 }finally{w.dispose();}
});

test('registered evidence exact-byte retry is idempotent without a new ledger event',()=>{
 const w=sandbox();try{
  const content={hello:'same digest',pass:false};
  const a=w.store.artifact(w.id,'stable-proof.json',content);
  const previous=w.store.verify(w.id),before=w.store.evidenceRoot(w.id);
  const b=w.store.artifact(w.id,'stable-proof.json',content);
  assert.equal(a.sha256,b.sha256);
  assert.equal(b.reused,true);
  assert.equal(w.store.verify(w.id).events,previous.events);
  assert.equal(w.store.evidenceRoot(w.id),before);
  assert.throws(()=>w.store.artifact(w.id,'stable-proof.json',{hello:'tampered'}),
   /registered evidence conflict/);
  w.store.verify(w.id);
 }finally{w.dispose();}
});

test('signed human recovery cannot re-run an apparently TERMINAL Agent whose original attested result was never registered',()=>{
  const w=sandbox();
  try{
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    w.store.recordIntent(w.id,'A1-worker','unrecorded-dispatch');
    w.store.recordAck('unrecorded-dispatch','worker-original-agent');
    w.store.recordTerminal('unrecorded-dispatch');
    const msg='Human explicitly approves recovery after independent incident review.';
    const basis=w.store.get(w.id).frozen.digest;
    const proof=w.proof('recovery',basis,'human',msg);
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',
      receipt:msg,expectedBasis:basis,proof}),
      /TERMINAL dispatch has no unique registered original signed execution/);
    assert.equal(w.store.get(w.id).stage,'BLOCKED');
    assert.equal(w.store.dispatches(w.id)[0].state,'TERMINAL');
    w.store.verify(w.id);
  }finally{w.dispose();}
});
