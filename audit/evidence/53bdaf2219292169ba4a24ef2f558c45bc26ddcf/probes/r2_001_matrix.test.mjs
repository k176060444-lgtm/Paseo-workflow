import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../offline-copy/src/store.mjs';
import {WorkflowController} from '../offline-copy/src/controller.mjs';
import {ROLE_PERMISSIONS, MAX_A, MAX_B, sha256} from '../offline-copy/src/policy.mjs';

function baseFrozen(){
  const f={schema:1,intent:'Synthetic audit intent with sufficient length.',intentSha256:sha256('Synthetic audit intent with sufficient length.'),
    roles:{},souls:{},tests:{commands:[['node','--test']]},project:{repo:'C:/nonexistent-repo',baseRef:'HEAD'},
    p0:{},policy:{maxA:MAX_A,maxB:MAX_B,permissions:JSON.parse(JSON.stringify(ROLE_PERMISSIONS))},
    runtime:{paseoUrl:'ws://127.0.0.1:6767/ws'},source:{configFile:'synthetic'}};
  f.digest=sha256(f);
  return f;
}
function mk({stage='BLOCKED',status='BLOCKED',aRound=10,bRound=9,currentSha=null,taskSpecSha=null,worktree=null,history=[],inflight=null,baseSha=null,p0Initial=null}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r2001-'));
  const store=new Store(path.join(dir,'state'));
  const id='TASK9001';
  const t={id,frozen:baseFrozen(),stage,status,aRound,bRound,baseSha,currentSha,taskSpec:taskSpecSha?'synthetic task spec':null,
    taskSpecSha,lastA:null,lastB:null,p0Initial,p0Final:null,changesInB:false,bFindings:[],pendingHuman:null,history,
    created:new Date().toISOString(),worktree,inflight};
  store.init(t);
  return {dir,store,id,dispose(){try{store.close()}catch{}fs.rmSync(dir,{recursive:true,force:true});}};
}
function rawTamper(store,id,fn){
  const t=store.get(id);fn(t);
  store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),id);
}
function withEnv(){process.env.P1_LIVE_ALLOWED='YES';process.env.P1_HOST_ISOLATION_ATTESTED='YES';}
function clearEnv(){delete process.env.P1_LIVE_ALLOWED;delete process.env.P1_HOST_ISOLATION_ATTESTED;}

const TAMPERS=[
  ['aRound 10->0',t=>{t.aRound=0;}],
  ['bRound 9->0',t=>{t.bRound=0;}],
  ['status BLOCKED->READY',t=>{t.status='READY';}],
  ['stage BLOCKED->CLOSED',t=>{t.stage='CLOSED';}],
  ['history appended',t=>{t.history=[{role:'worker',phase:'x',agentId:'forged',verdict:'PASS',evidenceSha256:'0'.repeat(64),at:'now'}];}],
  ['frozen policy maxA->1',t=>{t.frozen.policy.maxA=1;}],
];

for(const [label,tamper] of TAMPERS){
  test(`R2-001 run refuses tampered state: ${label}`,async()=>{
    const w=mk({stage:'WAIT_GATE_01',status:'WAITING_HUMAN'});
    withEnv();
    try{
      rawTamper(w.store,w.id,tamper);
      assert.throws(()=>w.store.verify(w.id),/state differs|ledger|mismatch|budget|permissions/);
      const c=new WorkflowController({store:w.store,runtime:null,p0:null});
      await assert.rejects(()=>c.run(w.id),/state differs|frozen config|budget|permissions/);
      assert.throws(()=>w.store.verify(w.id),/state differs|ledger|mismatch/,'corrupt state must remain detected after run');
    }finally{clearEnv();w.dispose();}
  });
}

test('R2-001 approve refuses tampered state and does not write approval',async()=>{
  const w=mk({stage:'WAIT_GATE_01',status:'WAITING_HUMAN'});
  try{
    const digest=w.store.get(w.id).frozen.digest;
    rawTamper(w.store,w.id,t=>{t.aRound=0;});
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    assert.throws(()=>c.approve({id:w.id,gate:'0.1',digest,actor:'human',receipt:'Explicit synthetic approval receipt.'}),/state differs/);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    const names=w.store.db.prepare('SELECT name FROM artifacts WHERE task_id=?').all(w.id).map(x=>x.name);
    assert(!names.some(n=>n.startsWith('approval-')),'no approval artifact may be written');
  }finally{w.dispose();}
});

test('R2-001 recover refuses tampered state',()=>{
  const w=mk();
  try{
    rawTamper(w.store,w.id,t=>{t.bRound=0;});
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:'0'.repeat(64)}),/state differs/);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
  }finally{w.dispose();}
});

test('R2-001 artifact refuses tampered state and writes no file',()=>{
  const w=mk();
  try{
    rawTamper(w.store,w.id,t=>{t.aRound=0;});
    assert.throws(()=>w.store.artifact(w.id,'probe.json',{x:1}),/state differs/);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    assert(!fs.existsSync(path.join(w.store.dir(w.id),'evidence','probe.json')));
  }finally{w.dispose();}
});

test('R2-001 dispatch intent/ack/terminal refuse tampered state',()=>{
  const w=mk();
  try{
    const did='d'.repeat(39)+'1';
    w.store.recordIntent(w.id,'P0:test',did);
    w.store.recordAck(did,'agent-1');
    rawTamper(w.store,w.id,t=>{t.aRound=0;});
    assert.throws(()=>w.store.recordIntent(w.id,'P0:test2','d'.repeat(39)+'2'),/state differs/);
    assert.throws(()=>w.store.recordAck(did,'agent-2'),/state differs/);
    assert.throws(()=>w.store.recordTerminal(did),/state differs/);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
  }finally{w.dispose();}
});

test('R2-001 event tamper is detected on all entry points',async()=>{
  const w=mk({stage:'WAIT_GATE_01',status:'WAITING_HUMAN'});
  withEnv();
  try{
    const last=w.store.db.prepare('SELECT seq,payload FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(w.id);
    const p=JSON.parse(last.payload);p._state_sha256='0'.repeat(64);
    w.store.db.prepare('UPDATE events SET payload=? WHERE seq=?').run(JSON.stringify(p),last.seq);
    assert.throws(()=>w.store.verify(w.id),/event ledger hash mismatch/);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    await assert.rejects(()=>c.run(w.id),/event ledger hash mismatch|state differs/);
    assert.throws(()=>w.store.verify(w.id),/event ledger|state differs/);
  }finally{clearEnv();w.dispose();}
});

test('R2-001 deleted last event is detected',()=>{
  const w=mk();
  try{
    const last=w.store.db.prepare('SELECT seq FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(w.id);
    w.store.db.prepare('DELETE FROM events WHERE seq=?').run(last.seq);
    assert.throws(()=>w.store.verify(w.id),/task missing audit events|state differs|previous digest/);
  }finally{w.dispose();}
});

test('R2-001 dispatch row tamper is detected',()=>{
  const w=mk();
  try{
    const did='e'.repeat(40);
    w.store.recordIntent(w.id,'P0:test',did);
    w.store.recordAck(did,'agent-1');
    w.store.db.prepare('UPDATE dispatches SET agent_id=? WHERE id=?').run('impostor',did);
    assert.throws(()=>w.store.verify(w.id),/dispatch ledger mismatch/);
  }finally{w.dispose();}
});

test('R2-001 artifact manifest tamper is detected',()=>{
  const w=mk();
  try{
    w.store.artifact(w.id,'a.json',{x:1});
    w.store.db.prepare('UPDATE artifacts SET digest=? WHERE task_id=? AND name=?').run('0'.repeat(64),w.id,'a.json');
    assert.throws(()=>w.store.verify(w.id),/artifact manifest mismatch/);
  }finally{w.dispose();}
});

test('R2-001 exhausted A budget is preserved after controlled recovery',async()=>{
  const w=mk({stage:'BLOCKED',status:'BLOCKED',aRound:MAX_A,bRound:0,taskSpecSha:'a'.repeat(64),baseSha:'c'.repeat(40)});
  withEnv();
  try{
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    const rec=c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:'a'.repeat(64)});
    assert.equal(rec.stage,'A_WORKER');
    assert.equal(w.store.get(w.id).aRound,MAX_A,'budget must remain consumed');
    const r=await c.run(w.id);
    assert.equal(r.stage,'STOPPED_BUDGET');
    assert.equal(w.store.get(w.id).aRound,MAX_A);
  }finally{clearEnv();w.dispose();}
});

test('R2-001 exhausted B budget is preserved after controlled recovery',async()=>{
  const w=mk({stage:'BLOCKED',status:'BLOCKED',aRound:1,bRound:MAX_B,currentSha:'b'.repeat(40),taskSpecSha:'a'.repeat(64),worktree:'x',p0Initial:{commit:'b'.repeat(40),passed:true,reports:[],findings:[]}});
  withEnv();
  try{
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    const rec=c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedSha:'b'.repeat(40)});
    assert.equal(rec.stage,'B_ENTER');
    assert.equal(w.store.get(w.id).bRound,MAX_B);
    const r=await c.run(w.id);
    assert.equal(r.stage,'STOPPED_BUDGET');
    assert.equal(w.store.get(w.id).bRound,MAX_B);
  }finally{clearEnv();w.dispose();}
});

test('R2-001 RESIDUAL: Store.event() re-anchors a tampered budget without verify',()=>{
  const w=mk({stage:'BLOCKED',status:'BLOCKED',aRound:10,bRound:9});
  try{
    rawTamper(w.store,w.id,t=>{t.aRound=0;t.bRound=0;});
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    w.store.event(w.id,'P0_OPTIONAL_NOT_DISPATCHED',{cycle:'initial',nodeId:'5bao'});
    w.store.verify(w.id);
    const after=w.store.get(w.id);
    assert.equal(after.aRound,0);
    assert.equal(after.bRound,0);
    console.log('R2-001-RESIDUAL CONFIRMED: event() re-anchored aRound=0 bRound=0 and verify() accepts it');
  }finally{w.dispose();}
});
