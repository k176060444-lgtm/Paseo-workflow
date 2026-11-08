import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {parseAgentOutput,sha256,canonical,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../src/policy.mjs';
import {commitWorktree} from '../src/git.mjs';
import {SshP0Adapter} from '../src/p0.mjs';

function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r3-'));
  const store=new Store(path.join(dir,'state')),id='TASKR300';
  const frozen={intent:'R3 synthetic task for offline safety checks',schema:1,
    policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  frozen.digest=sha256(frozen);
  store.init({id,stage:'BLOCKED',status:'BLOCKED',frozen,
    aRound:10,bRound:9,currentSha:null,taskSpecSha:null,
    pendingHuman:'previous incident',inflight:null,history:[]});
  return {dir,store,id,close(){store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function git(dir,...args){return execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();}
function tempRepo(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r3-git-'));
  git(dir,'init','-q');
  fs.writeFileSync(path.join(dir,'normal.txt'),'synthetic baseline');
  git(dir,'add','.');
  git(dir,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','init');
  return {dir,close(){fs.rmSync(dir,{recursive:true,force:true});}};
}
test('R3-001: public Store.event cannot reanchor tampered A/B budget',()=>{
  const w=fixture();
  try {
    const before=w.store.verify(w.id);
    const tampered=w.store.get(w.id);tampered.aRound=0;tampered.bRound=0;
    w.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(tampered),w.id);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    assert.throws(()=>w.store.event(w.id,'P0_OPTIONAL_NOT_DISPATCHED',{nodeId:'rusty'}),/state differs/);
    assert.throws(()=>w.store.event(w.id,'CONFIG_FROZEN',{sha256:'fake'}),/state differs/);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    assert.equal(w.store.db.prepare('SELECT count(*) AS n FROM events WHERE task_id=?').get(w.id).n,before.events);
    assert.equal(w.store.get(w.id).aRound,0); // remains UNTRUSTED, not legitimized
  } finally {w.close();}
});
test('R3-001: healthy standalone event and verified transaction append still work',()=>{
  const w=fixture();
  try {
    const old=w.store.verify(w.id).events;
    w.store.event(w.id,'P0_OPTIONAL_NOT_DISPATCHED',{nodeId:'rusty'});
    const t=w.store.get(w.id);t.pendingHuman='new audit note';
    w.store.save(t,'AUDIT_NOTE',{nodeId:'rusty'});
    assert.equal(w.store.verify(w.id).events,old+2);
    assert.equal(w.store.get(w.id).bRound,9);
  } finally {w.close();}
});
test('R3-002: valid ledger containing tampered frozen config cannot be used as recovery basis',()=>{
  const w=fixture();
  try {
    const t=w.store.get(w.id),basis=t.frozen.digest;
    t.frozen.intent='MALICIOUS CHANGE';
    assert.throws(()=>w.store.save(t,'CHANGED_FROZEN'),/frozen config is immutable/);
    w.store.verify(w.id);
    // Even direct SQL tampering cannot become a valid recovery basis.
    w.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),w.id);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'reviewer',
      receipt:'Approved recovery with a deliberately forged configuration',
      expectedBasis:basis}),/state differs/);
    assert.equal(w.store.get(w.id).stage,'BLOCKED');
  } finally {w.close();}
});
test('R3-003: run cannot replace NEEDS_RECONCILIATION with ordinary BLOCKED',async()=>{
  const w=fixture();
  const previous=process.env.P1_LIVE_ALLOWED;
  delete process.env.P1_LIVE_ALLOWED;
  try {
    const t=w.store.get(w.id);
    t.stage='A_REVIEW';t.status='NEEDS_RECONCILIATION';
    t.pendingHuman='Reviewer ACK uncertain';t.inflight={role:'quality_reviewer',phase:'A1-review'};
    w.store.save(t,'REVIEW_PAIR_UNCERTAIN');
    const baseline=w.store.verify(w.id);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    await assert.rejects(()=>c.run(w.id),/reconcile before dispatch/);
    const now=w.store.get(w.id);
    assert.equal(now.stage,'A_REVIEW');
    assert.equal(now.status,'NEEDS_RECONCILIATION');
    assert.equal(now.pendingHuman,'Reviewer ACK uncertain');
    assert.deepEqual(now.inflight,t.inflight);
    assert.equal(w.store.verify(w.id).events,baseline.events);
  } finally {if(previous===undefined)delete process.env.P1_LIVE_ALLOWED;else process.env.P1_LIVE_ALLOWED=previous;w.close();}
});
test('R3-006: CLI help renders two separate recover commands',()=>{
  const stdout=execFileSync(process.execPath,['src/cli.mjs','help'],{encoding:'utf8'});
  assert(stdout.includes('EXACT_COMMIT\n  recover --id'));
  assert(!stdout.includes('EXACT_COMMIT\\n  recover --id'));
});
test('R2-009: leading-space .env is rejected before Git commit',async()=>{
  const w=tempRepo();
  try {
    fs.writeFileSync(path.join(w.dir,' .env'),'fake token, no real secret');
    await assert.rejects(()=>commitWorktree(w.dir,'attempt'),/ambiguous whitespace/);
    assert.equal(git(w.dir,'rev-list','--count','HEAD'),'1');
  }finally{w.close();}
});
test('R2-009: nested leading-space .env and invisible-prefix paths are rejected',async()=>{
  const w=tempRepo();
  try {
    fs.mkdirSync(path.join(w.dir,'sub'));
    fs.writeFileSync(path.join(w.dir,'sub',' .env'),'synthetic only');
    await assert.rejects(()=>commitWorktree(w.dir,'nested attempt'),/ambiguous whitespace/);
    fs.rmSync(path.join(w.dir,'sub',' .env'));
    fs.writeFileSync(path.join(w.dir,'\u200b.env'),'synthetic only');
    await assert.rejects(()=>commitWorktree(w.dir,'format attempt'),/control\/format/);
  }finally{w.close();}
});
test('R2-009: legitimate file names remain committable',async()=>{
  const w=tempRepo();
  try {
    fs.writeFileSync(path.join(w.dir,'normal.txt'),'updated synthetic file');
    const commit=await commitWorktree(w.dir,'normal');
    assert.equal(git(w.dir,'rev-parse','HEAD'),commit);
    assert.equal(git(w.dir,'rev-list','--count','HEAD'),'2');
  }finally{w.close();}
});
test('R3-008: indented terminal bare and fenced JSON are accepted, trailing text rejected',()=>{
  const payload={verdict:'APPROVE',summary:'independently reviewed',findings:[]};
  assert.equal(parseAgentOutput('## Findings\n\n  '+JSON.stringify(payload),'spec_reviewer').verdict,'PASS');
  assert.equal(parseAgentOutput('## Findings\n\n  '+JSON.stringify(payload,null,2),'spec_reviewer').verdict,'PASS');
  const tick=String.fromCharCode(96).repeat(3);
  assert.equal(parseAgentOutput('## Findings\n'+tick+'json\n'+JSON.stringify(payload)+'\n'+tick,'spec_reviewer').verdict,'PASS');
  assert.throws(()=>parseAgentOutput('## Findings\n  '+JSON.stringify(payload)+'\nnot finalized','spec_reviewer'),/final JSON/);
});
test('R3-007: signed P0 APPROVE_WITH_COMMENTS preserves low comments but blocks high',()=>{
  const w=fixture();
  try {
    const key=path.join(w.dir,'p0.key');
    fs.writeFileSync(key,Buffer.alloc(40,0x42));
    const node={id:'5bao',physicalId:'physical-5bao',model:'opencode/test',harness:'opencode',hmacKeyPath:key,enabled:true};
    const adapter=new SshP0Adapter([node]);
    function sign(verdict,findings){
      const body={jobId:'a'.repeat(40),nodeId:'5bao',physicalId:'physical-5bao',
        commit:'b'.repeat(40),model:'opencode/test',harness:'opencode',exitCode:0,
        clean:true,stdoutSha256:'c'.repeat(64),verdict,summary:'Synthetic signed report',findings};
      return {body,mac:createHmac('sha256',fs.readFileSync(key)).update(canonical(body)).digest('hex')};
    }
    assert.equal(adapter.verify(node,sign('APPROVE_WITH_COMMENTS',['LOW: nit']), 'a'.repeat(40),'b'.repeat(40)).verdict,'APPROVE_WITH_COMMENTS');
    assert.throws(()=>adapter.verify(node,sign('APPROVE_WITH_COMMENTS',['HIGH: unsafe']), 'a'.repeat(40),'b'.repeat(40)),/comments have blocking/);
    assert.throws(()=>adapter.verify(node,sign('PASS',['LOW: contradictory']), 'a'.repeat(40),'b'.repeat(40)),/contradictory PASS/);
  }finally{w.close();}
});
