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
  const f={schema:1,intent:'Synthetic audit intent with sufficient length.',intentSha256:sha256('Synthetic audit intent with sufficient length.'),
    roles:{spec_reviewer:{harness:'codex',model:'codex/synthetic'},quality_reviewer:{harness:'codex',model:'codex/synthetic'}},
    souls:{spec_reviewer:{text:'synthetic spec soul',sha256:'a'.repeat(64)},quality_reviewer:{text:'synthetic quality soul',sha256:'b'.repeat(64)}},
    tests:{commands:[['node','--test']]},project:{repo:'C:/nonexistent-repo',baseRef:'HEAD'},
    p0:{},policy:{maxA:MAX_A,maxB:MAX_B,permissions:JSON.parse(JSON.stringify(ROLE_PERMISSIONS))},
    runtime:{paseoUrl:'ws://127.0.0.1:6767/ws'},source:{configFile:'synthetic'}};
  f.digest=sha256(f);return f;
}
function mk(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r2010-'));
  const store=new Store(path.join(dir,'state'));
  const id='TASK9010';
  store.init({id,frozen:baseFrozen(),stage:'A_REVIEW',status:'READY',aRound:1,bRound:0,currentSha:'a'.repeat(40),
    taskSpec:'Synthetic task spec with enough detail.',taskSpecSha:sha256('Synthetic task spec with enough detail.'),
    history:[],inflight:null,worktree:dir});
  return {dir,store,id,dispose(){try{store.close()}catch{}for(let i=0;i<8;i++){try{fs.rmSync(dir,{recursive:true,force:true});return;}catch{}}}};
}
function fakeRuntime(store,{qualityFails=true,sameAgent=false}={}){
  const runtime=new PaseoAgentRuntime('ws://synthetic');
  const calls=[];
  runtime.client={agents:{create:async ({title})=>{
    const role=title.split(':').pop();
    calls.push(role);
    const id=sameAgent?'same-agent':`${role}-agent`;
    if(role==='quality_reviewer'&&qualityFails){
      return {id,waitForFinish:async()=>{throw new Error('simulated provider loss');}};
    }
    return {id,waitForFinish:async()=>({status:'idle',lastMessage:JSON.stringify({verdict:'PASS',summary:`verified by ${role}`,findings:[]})})};
  }}};
  return {runtime,calls};
}

test('R2-010 one success + one failure preserves the successful seat raw evidence',async()=>{
  const w=mk();
  try{
    const {runtime,calls}=fakeRuntime(w.store,{qualityFails:true});
    const c=new WorkflowController({store:w.store,runtime,p0:null,gitOps:{assertUnchanged:async()=>{}}});
    const t=w.store.get(w.id);
    await assert.rejects(()=>c.invokePair(t,'A1-review','a'.repeat(40)),/saved finished seats; reconcile/);
    const after=w.store.get(w.id);
    assert.equal(after.status,'NEEDS_RECONCILIATION');
    assert.equal(after.history.filter(h=>h.role==='spec_reviewer').length,1);
    assert.equal(after.history.filter(h=>h.role==='quality_reviewer').length,0);
    const arts=w.store.db.prepare('SELECT name,digest FROM artifacts WHERE task_id=?').all(w.id);
    const specArt=arts.find(x=>x.name.includes('spec_reviewer'));
    assert(specArt,'successful seat artifact must exist');
    const content=JSON.parse(fs.readFileSync(path.join(w.store.dir(w.id),'evidence',specArt.name),'utf8'));
    assert.equal(content.role,'spec_reviewer');
    assert.equal(content.agentId,'spec_reviewer-agent');
    assert.equal(content.verdict,'PASS');
    assert.equal(content.summary,'verified by spec_reviewer');
    assert(Array.isArray(content.findings));
    assert.equal(content.raw,JSON.stringify({verdict:'PASS',summary:'verified by spec_reviewer',findings:[]}));
    const hist=after.history.find(h=>h.role==='spec_reviewer');
    assert.equal(hist.agentId,'spec_reviewer-agent');
    assert.equal(hist.verdict,'PASS');
    assert.equal(hist.evidenceSha256,specArt.digest);
    const disp=w.store.dispatches(w.id);
    const terminal=disp.filter(d=>d.state==='TERMINAL');
    const ack=disp.filter(d=>d.state==='ACKNOWLEDGED');
    assert.equal(terminal.length,1,'successful dispatch must be terminal');
    assert.equal(ack.length,1,'failed dispatch must remain acknowledged for reconciliation');
    assert.equal(calls.filter(x=>x==='quality_reviewer').length,1);
    w.store.verify(w.id);
    // A second run must not redispatch either seat.
    const before=calls.length;
    await assert.rejects(()=>c.run(w.id),/live dispatch disabled|reconcile|BLOCKED|preflight|state/);
    assert.equal(calls.length,before,'no redispatch on a reconciliation task');
  }finally{w.dispose();}
});

test('R2-010 both seats succeed and are both recorded',async()=>{
  const w=mk();
  try{
    const {runtime}=fakeRuntime(w.store,{qualityFails:false});
    const c=new WorkflowController({store:w.store,runtime,p0:null,gitOps:{assertUnchanged:async()=>{}}});
    const t=w.store.get(w.id);
    const r=await c.invokePair(t,'A1-review','a'.repeat(40));
    assert.equal(r.pass,true);
    const after=w.store.get(w.id);
    assert.equal(after.history.filter(h=>h.role==='spec_reviewer').length,1);
    assert.equal(after.history.filter(h=>h.role==='quality_reviewer').length,1);
    const arts=w.store.db.prepare('SELECT name FROM artifacts WHERE task_id=?').all(w.id).map(x=>x.name);
    assert(arts.some(n=>n.includes('spec_reviewer')));
    assert(arts.some(n=>n.includes('quality_reviewer')));
    assert.equal(w.store.dispatches(w.id).filter(d=>d.state==='TERMINAL').length,2);
    w.store.verify(w.id);
  }finally{w.dispose();}
});

test('R2-010 duplicate reviewer Agent IDs are recorded then fail closed',async()=>{
  const w=mk();
  try{
    const {runtime}=fakeRuntime(w.store,{qualityFails:false,sameAgent:true});
    const c=new WorkflowController({store:w.store,runtime,p0:null,gitOps:{assertUnchanged:async()=>{}}});
    const t=w.store.get(w.id);
    await assert.rejects(()=>c.invokePair(t,'A1-review','a'.repeat(40)),/identity invalid/);
    const after=w.store.get(w.id);
    assert.equal(after.status,'NEEDS_RECONCILIATION');
    assert.equal(after.history.length,2,'both seats are preserved as evidence before the pair is rejected');
    w.store.verify(w.id);
  }finally{w.dispose();}
});

test('R2-010 F8 RESIDUAL: preflight failure overwrites NEEDS_RECONCILIATION status',async()=>{
  const w=mk();
  try{
    const {runtime}=fakeRuntime(w.store,{qualityFails:true});
    const c=new WorkflowController({store:w.store,runtime,p0:null,gitOps:{assertUnchanged:async()=>{}}});
    const t=w.store.get(w.id);
    await assert.rejects(()=>c.invokePair(t,'A1-review','a'.repeat(40)),/saved finished seats/);
    assert.equal(w.store.get(w.id).status,'NEEDS_RECONCILIATION');
    delete process.env.P1_LIVE_ALLOWED;
    delete process.env.P1_HOST_ISOLATION_ATTESTED;
    let err=null;
    try{await c.run(w.id);}catch(e){err=e;}
    assert(err,'run must not proceed');
    const after=w.store.get(w.id);
    console.log('R2-010-F8-AFTER-RUN status='+after.status+' stage='+after.stage+' pendingHuman='+String(after.pendingHuman));
    // Record actual behavior; this is a finding if NEEDS_RECONCILIATION is lost.
    assert.equal(after.status,'BLOCKED','observed residual: reconciliation status is overwritten by preflight failure');
    assert.equal(after.stage,'BLOCKED');
  }finally{w.dispose();}
});
