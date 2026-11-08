import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../offline-copy/src/store.mjs';
import {WorkflowController} from '../offline-copy/src/controller.mjs';
import {PaseoAgentRuntime} from '../offline-copy/src/agents.mjs';
import {ROLE_PERMISSIONS, MAX_A, MAX_B, sha256} from '../offline-copy/src/policy.mjs';

function baseFrozen(){
  const f={schema:1,intent:'Synthetic R3 recovery task with sufficient length.',
    roles:{planner:{harness:'codex',model:'codex/synthetic'},spec_reviewer:{harness:'codex',model:'codex/synthetic'},quality_reviewer:{harness:'codex',model:'codex/synthetic'}},
    souls:{planner:{text:'synthetic planner soul',sha256:'c'.repeat(64)},spec_reviewer:{text:'synthetic spec soul',sha256:'a'.repeat(64)},quality_reviewer:{text:'synthetic quality soul',sha256:'b'.repeat(64)}},
    project:{repo:'C:/nonexistent-repo',baseRef:'HEAD'},tests:{commands:[]},
    policy:{maxA:MAX_A,maxB:MAX_B,permissions:JSON.parse(JSON.stringify(ROLE_PERMISSIONS))}};
  f.digest=sha256(f);return f;
}
function mk({stage='BLOCKED',status='BLOCKED',aRound=10,bRound=9,currentSha=null,baseSha=null,taskSpec=null,taskSpecSha=null,p0Initial=null,inflight=null,worktree=null}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r3rec-'));
  const store=new Store(path.join(dir,'state'));
  const id='TASKR3002';
  store.init({id,frozen:baseFrozen(),stage,status,aRound,bRound,currentSha,baseSha,taskSpec,taskSpecSha,
    p0Initial,p0Final:null,history:[],inflight,pendingHuman:'synthetic prior incident',worktree});
  return {dir,store,id,dispose(){try{store.close()}catch{}for(let i=0;i<8;i++){try{fs.rmSync(dir,{recursive:true,force:true});return;}catch{}}}};
}
function saveMutated(w,fn){
  const t=w.store.get(w.id);fn(t);w.store.save(t,'SYNTHETIC_MUTATION');
}

// R3-002: frozen integrity
test('R3-002: frozen content with the OLD digest is rejected by authorizeRecovery',()=>{
  const w=mk();
  try{
    const basis=w.store.get(w.id).frozen.digest;
    saveMutated(w,t=>{t.frozen.intent='FORGED BUT OLD DIGEST';});
    w.store.verify(w.id);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:basis}),/frozen config digest mismatch/);
    assert.equal(w.store.get(w.id).stage,'BLOCKED');
  }finally{w.dispose();}
});

test('R3-002: TASK_SPEC content with the OLD sha is rejected by authorizeRecovery',()=>{
  const w=mk({baseSha:'c'.repeat(40),taskSpec:'original spec',taskSpecSha:sha256('original spec')});
  try{
    const basis=w.store.get(w.id).taskSpecSha;
    saveMutated(w,t=>{t.taskSpec='FORGED SPEC WITH OLD SHA';});
    w.store.verify(w.id);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:basis}),/TASK_SPEC immutable digest mismatch/);
    assert.equal(w.store.get(w.id).stage,'BLOCKED');
  }finally{w.dispose();}
});

test('R3-002: unresolved dispatch blocks recovery',()=>{
  const w=mk({taskSpec:'synthetic spec',taskSpecSha:sha256('synthetic spec')});
  try{
    w.store.recordIntent(w.id,'P0:test','d'.repeat(40));
    w.store.recordAck('d'.repeat(40),'agent-x');
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:w.store.get(w.id).taskSpecSha}),/outstanding dispatch/);
  }finally{w.dispose();}
});

test('R3-002: over-budget and modified policy are rejected by compliance',()=>{
  const w=mk({aRound:11});
  try{
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:w.store.get(w.id).frozen.digest}),/round budget exceeded/);
  }finally{w.dispose();}
  const w2=mk();
  try{
    saveMutated(w2,t=>{t.frozen.policy.maxA=11;const {digest,...snap}=t.frozen;t.frozen.digest=sha256(snap);});
    w2.store.verify(w2.id);
    const c=new WorkflowController({store:w2.store,runtime:null,p0:null});
    assert.throws(()=>c.authorizeRecovery({id:w2.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:w2.store.get(w2.id).frozen.digest}),/budget policy mismatch/);
  }finally{w2.dispose();}
});

test('R3-002: non-BLOCKED and wrong basis still rejected',()=>{
  const w=mk({stage:'A_WORKER',status:'READY',taskSpec:'synthetic spec',taskSpecSha:sha256('synthetic spec'),baseSha:'c'.repeat(40)});
  try{
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:sha256('synthetic spec')}),/definitely blocked/);
  }finally{w.dispose();}
  const w2=mk({taskSpec:null,taskSpecSha:null});
  try{
    const c=new WorkflowController({store:w2.store,runtime:null,p0:null});
    assert.throws(()=>c.authorizeRecovery({id:w2.id,actor:'human',receipt:'Explicit synthetic recovery receipt.',expectedBasis:'0'.repeat(64)}),/basis/);
  }finally{w2.dispose();}
});

// R3-003: run state protection
test('R3-003: NEEDS_RECONCILIATION is untouched when P1_LIVE_ALLOWED is unset',async()=>{
  const w=mk({stage:'A_REVIEW',status:'NEEDS_RECONCILIATION',inflight:{role:'review_pair',phase:'A1-review'},taskSpec:'spec',taskSpecSha:sha256('spec')});
  delete process.env.P1_LIVE_ALLOWED;delete process.env.P1_HOST_ISOLATION_ATTESTED;
  try{
    const before=w.store.verify(w.id);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    await assert.rejects(()=>c.run(w.id),/reconcile before dispatch/);
    const now=w.store.get(w.id);
    assert.equal(now.stage,'A_REVIEW');
    assert.equal(now.status,'NEEDS_RECONCILIATION');
    assert.equal(now.pendingHuman,'synthetic prior incident');
    assert.deepEqual(now.inflight,{role:'review_pair',phase:'A1-review'});
    assert.equal(w.store.verify(w.id).events,before.events);
  }finally{w.dispose();}
});

test('R3-003: inflight with READY is untouched and not dispatched',async()=>{
  const w=mk({stage:'A_REVIEW',status:'READY',inflight:{role:'quality_reviewer',phase:'A1-review'},taskSpec:'spec',taskSpecSha:sha256('spec')});
  try{
    const before=w.store.verify(w.id);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    await assert.rejects(()=>c.run(w.id),/reconcile before dispatch/);
    const now=w.store.get(w.id);
    assert.equal(now.status,'READY');assert.deepEqual(now.inflight,{role:'quality_reviewer',phase:'A1-review'});
    assert.equal(w.store.verify(w.id).events,before.events);
  }finally{w.dispose();}
});

test('R3-003: BLOCKED is not re-saved by a failed preflight',async()=>{
  const w=mk();
  delete process.env.P1_LIVE_ALLOWED;delete process.env.P1_HOST_ISOLATION_ATTESTED;
  try{
    const before=w.store.verify(w.id);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    await assert.rejects(()=>c.run(w.id),/live dispatch disabled/);
    const now=w.store.get(w.id);
    assert.equal(now.stage,'BLOCKED');assert.equal(now.status,'BLOCKED');
    assert.equal(now.pendingHuman,'synthetic prior incident');
    assert.equal(w.store.verify(w.id).events,before.events);
  }finally{w.dispose();}
});

test('R3-003: READY task still becomes BLOCKED on a failed preflight',async()=>{
  const w=mk({stage:'A_WORKER',status:'READY',taskSpec:'spec',taskSpecSha:sha256('spec'),baseSha:'c'.repeat(40)});
  delete process.env.P1_LIVE_ALLOWED;delete process.env.P1_HOST_ISOLATION_ATTESTED;
  try{
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    await assert.rejects(()=>c.run(w.id),/live dispatch disabled/);
    const now=w.store.get(w.id);
    assert.equal(now.stage,'BLOCKED');assert.equal(now.status,'BLOCKED');
    assert.match(now.pendingHuman,/Preflight failed/);
  }finally{w.dispose();}
});

test('R3-003: corrupt ledger is rejected before any preflight sealing',async()=>{
  const w=mk();
  try{
    const t=w.store.get(w.id);t.aRound=0;
    w.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),w.id);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    await assert.rejects(()=>c.run(w.id),/state differs/);
    assert.equal(w.store.get(w.id).aRound,0);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
  }finally{w.dispose();}
});

test('R3-003: real reviewer pair one success + one failure stays reconcilable and is not redispatch',async()=>{
  const w=mk({stage:'A_REVIEW',status:'READY',taskSpec:'spec',taskSpecSha:sha256('spec'),worktree:null});
  try{
    const runtime=new PaseoAgentRuntime('ws://synthetic');
    const calls=[];
    runtime.client={agents:{create:async ({title})=>{
      const role=title.split(':').pop();calls.push(role);
      if(role==='quality_reviewer')
        return {id:'q-agent',waitForFinish:async()=>{throw new Error('simulated provider loss');}};
      return {id:'s-agent',waitForFinish:async()=>({status:'idle',lastMessage:JSON.stringify({verdict:'PASS',summary:'ok',findings:[]})})};
    }}};
    const c=new WorkflowController({store:w.store,runtime,p0:null,gitOps:{assertUnchanged:async()=>{}}});
    const t=w.store.get(w.id);
    await assert.rejects(()=>c.invokePair(t,'A1-review','a'.repeat(40)),/saved finished seats/);
    const after=w.store.get(w.id);
    assert.equal(after.status,'NEEDS_RECONCILIATION');
    assert(after.inflight,'invokePair leaves inflight set for reconciliation');
    const beforeCalls=calls.length;
    await assert.rejects(()=>c.run(w.id),/reconcile before dispatch/);
    assert.equal(calls.length,beforeCalls,'no redispatch');
    assert.equal(w.store.get(w.id).status,'NEEDS_RECONCILIATION');
  }finally{w.dispose();}
});

test('R3-003: execute failure after intent leaves NEEDS_RECONCILIATION and no retry',async()=>{
  const w=mk({stage:'PLANNER',status:'READY',taskSpec:null,taskSpecSha:null});
  try{
    let calls=0;
    const runtime=new PaseoAgentRuntime('ws://synthetic');
    runtime.client={agents:{create:async ()=>{calls++;throw new Error('provider lost after request');}}};
    const c=new WorkflowController({store:w.store,runtime,p0:null,gitOps:{head:async()=>null,assertUnchanged:async()=>{}}});
    const t=w.store.get(w.id);
    await assert.rejects(()=>c.step(t),/provider lost/);
    const after=w.store.get(w.id);
    assert.equal(after.status,'NEEDS_RECONCILIATION');
    assert.equal(w.store.dispatches(w.id).filter(d=>d.state!=='TERMINAL').length,1,'intent remains outstanding');
    await assert.rejects(()=>c.run(w.id),/reconcile before dispatch/);
    assert.equal(calls,1,'no second dispatch');
  }finally{w.dispose();}
});