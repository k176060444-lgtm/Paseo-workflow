import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../offline-copy/src/store.mjs';
import {WorkflowController} from '../offline-copy/src/controller.mjs';
import {ROLE_PERMISSIONS, MAX_A, MAX_B, sha256} from '../offline-copy/src/policy.mjs';

function frozen(){
  const f={schema:1,intent:'Synthetic R3 audit task with sufficient length.',
    policy:{maxA:MAX_A,maxB:MAX_B,permissions:JSON.parse(JSON.stringify(ROLE_PERMISSIONS))}};
  f.digest=sha256(f);return f;
}
function mk({aRound=10,bRound=9,stage='BLOCKED',status='BLOCKED',taskSpec=null,taskSpecSha=null,currentSha=null,baseSha=null,p0Initial=null,inflight=null}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r4write-'));
  const store=new Store(path.join(dir,'state'));
  const id='TASKR4001';
  store.init({id,frozen:frozen(),stage,status,aRound,bRound,currentSha,baseSha,taskSpec,taskSpecSha,
    p0Initial,p0Final:null,history:[],inflight,pendingHuman:'synthetic incident'});
  return {dir,store,id,dispose(){try{store.close()}catch{}for(let i=0;i<8;i++){try{fs.rmSync(dir,{recursive:true,force:true});return;}catch{}}}};
}
function tamperRow(store,id,fn){
  const t=store.get(id);fn(t);
  store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),id);
}

test('R4-001 BLOCKER: Store.save accepts a tampered task and resets aRound/bRound',()=>{
  const w=mk();
  try{
    const t=w.store.get(w.id);t.aRound=0;t.bRound=0;
    w.store.save(t,'BUDGET_RESET'); // verifies the OLD row, then writes the new object
    assert.equal(w.store.get(w.id).aRound,0);
    assert.equal(w.store.get(w.id).bRound,0);
    w.store.verify(w.id); // new chain head is self-consistent -> accepted
    console.log('R4-001 CONFIRMED: save() re-anchored aRound=0 bRound=0 and verify() accepts it');
  }finally{w.dispose();}
});

test('R4-001: save accepts arbitrary status/stage/history replacement',()=>{
  const w=mk();
  try{
    const t=w.store.get(w.id);
    t.status='READY';t.stage='A_WORKER';
    t.history=[{role:'forged',phase:'x',agentId:'forged',verdict:'PASS',evidenceSha256:'0'.repeat(64),at:'now'}];
    w.store.save(t,'FORGED_STATE');
    const now=w.store.get(w.id);
    assert.equal(now.status,'READY');assert.equal(now.stage,'A_WORKER');
    assert.equal(now.history.length,1);
    w.store.verify(w.id);
    console.log('R4-001 CONFIRMED: save() accepts arbitrary status/stage/history');
  }finally{w.dispose();}
});

test('R4-001: save accepts a forged frozen config with a recomputed digest',()=>{
  const w=mk();
  try{
    const t=w.store.get(w.id);
    t.frozen.intent='FORGED INTENT AUTHORIZED BY NOBODY';
    const {digest,...snap}=t.frozen;t.frozen.digest=sha256(snap);
    w.store.save(t,'FORGED_FROZEN');
    w.store.verify(w.id);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    const r=c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:t.frozen.digest});
    assert.equal(r.stage,'PLANNER');
    console.log('R4-001 CONFIRMED: forged frozen with matching digest was accepted as recovery basis');
  }finally{w.dispose();}
});

test('R4-001: save accepts a forged TASK_SPEC with a recomputed sha',()=>{
  const w=mk({baseSha:'c'.repeat(40)});
  try{
    const t=w.store.get(w.id);
    t.taskSpec='FORGED TASK_SPEC APPROVED BY NOBODY';t.taskSpecSha=sha256(t.taskSpec);
    w.store.save(t,'FORGED_SPEC');
    w.store.verify(w.id);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    const r=c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:t.taskSpecSha});
    assert.equal(r.stage,'A_WORKER');
    console.log('R4-001 CONFIRMED: forged TASK_SPEC with matching sha was accepted');
  }finally{w.dispose();}
});

test('R4-002: incomplete TASK_SPEC pair is not rejected by assertFrozenIntegrity',()=>{
  const w=mk({taskSpec:'synthetic spec',taskSpecSha:null});
  try{
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    const r=c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:w.store.get(w.id).frozen.digest});
    assert.equal(r.stage,'PLANNER');
    console.log('R4-002 CONFIRMED: taskSpec without taskSpecSha was accepted; recovery moved to PLANNER');
  }finally{w.dispose();}
});

test('R4-002: missing taskSpec with a taskSpecSha is not rejected',()=>{
  const w=mk({taskSpec:null,taskSpecSha:'a'.repeat(64)});
  try{
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    const r=c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:'a'.repeat(64)});
    assert.equal(r.stage,'PREPARE');
    console.log('R4-002 CONFIRMED: missing taskSpec with taskSpecSha was accepted; recovery moved to PREPARE');
  }finally{w.dispose();}
});

test('R3-001: standalone Store.event still rejects tampered state and does not append',()=>{
  const w=mk();
  try{
    const before=w.store.verify(w.id).events;
    tamperRow(w.store,w.id,t=>{t.aRound=0;t.bRound=0;});
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    assert.throws(()=>w.store.event(w.id,'P0_OPTIONAL_NOT_DISPATCHED',{nodeId:'rusty'}),/state differs/);
    assert.throws(()=>w.store.event(w.id,'CONFIG_FROZEN',{sha256:'fake'}),/state differs/);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    assert.equal(w.store.db.prepare('SELECT count(*) AS n FROM events WHERE task_id=?').get(w.id).n,before);
    assert.equal(w.store.get(w.id).aRound,0);
  }finally{w.dispose();}
});

test('R3-001: artifact rejects tampered state at entry and writes no file',()=>{
  const w=mk();
  try{
    tamperRow(w.store,w.id,t=>{t.aRound=0;});
    assert.throws(()=>w.store.artifact(w.id,'probe.json',{x:1}),/state differs/);
    assert(!fs.existsSync(path.join(w.store.dir(w.id),'evidence','probe.json')));
    assert.throws(()=>w.store.verify(w.id),/state differs/);
  }finally{w.dispose();}
});

test('R4-003 BLOCKER: artifact() verify-before-transaction window re-anchors a concurrent tamper',()=>{
  const w=mk();
  const original=fs.writeFileSync;
  let triggered=false;
  try{
    fs.writeFileSync=(fd,data,...args)=>{
      if(!triggered&&String(data).includes('ARTIFACT_CONCURRENT_PROBE')){
        triggered=true;
        tamperRow(w.store,w.id,t=>{t.aRound=0;t.bRound=0;});
      }
      return original(fd,data,...args);
    };
    w.store.artifact(w.id,'concurrent-probe.json',{marker:'ARTIFACT_CONCURRENT_PROBE'});
    fs.writeFileSync=original;
    assert(triggered);
    w.store.verify(w.id); // if this passes, the tamper was re-anchored
    assert.equal(w.store.get(w.id).aRound,0);
    console.log('R4-003 CONFIRMED: artifact fsync window re-anchored aRound=0 bRound=0');
  }finally{fs.writeFileSync=original;w.dispose();}
});

test('R3-001: recordIntent/recordAck/recordTerminal reject tampered state',()=>{
  const w=mk();
  try{
    const did='d'.repeat(40);
    w.store.recordIntent(w.id,'P0:test',did);
    w.store.recordAck(did,'agent-1');
    tamperRow(w.store,w.id,t=>{t.aRound=0;});
    assert.throws(()=>w.store.recordIntent(w.id,'P0:test2','d'.repeat(39)+'2'),/state differs/);
    assert.throws(()=>w.store.recordAck(did,'agent-2'),/state differs/);
    assert.throws(()=>w.store.recordTerminal(did),/state differs/);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
  }finally{w.dispose();}
});

test('R3-001: init cannot re-anchor an existing task',()=>{
  const w=mk();
  try{
    assert.throws(()=>w.store.init({id:w.id,frozen:frozen(),stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,history:[],inflight:null}),/task already exists/);
  }finally{w.dispose();}
});

test('R3-001: healthy save and standalone event still work',()=>{
  const w=mk();
  try{
    const before=w.store.verify(w.id).events;
    w.store.event(w.id,'P0_OPTIONAL_NOT_DISPATCHED',{nodeId:'rusty'});
    const t=w.store.get(w.id);t.aRound=1;t.pendingHuman='audit note';
    w.store.save(t,'AUDIT_NOTE');
    assert.equal(w.store.verify(w.id).events,before+2);
    assert.equal(w.store.get(w.id).aRound,1);
  }finally{w.dispose();}
});