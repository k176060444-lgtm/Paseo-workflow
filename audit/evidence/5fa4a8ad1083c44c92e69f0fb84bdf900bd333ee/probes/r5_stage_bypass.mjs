import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../offline-copy/src/store.mjs';
import {WorkflowController} from '../offline-copy/src/controller.mjs';
import {sha256,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../offline-copy/src/policy.mjs';

function makeFrozen(){
  const f={schema:1,intent:'Synthetic task for S0-R4 stage/approval probes',project:{repo:'C:/nonexistent',baseRef:'HEAD'},tests:{commands:[]},policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  f.digest=sha256(f);return f;
}
function setup(overrides={}){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-stage-'));
  const store=new Store(path.join(tmp,'state')),id='TASKR5A';
  const task={id,frozen:makeFrozen(),stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,
    taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,history:[],pendingHuman:null,
    created:new Date().toISOString(),...overrides};
  store.init(task);
  return {tmp,store,id,controller:new WorkflowController({store,runtime:null,p0:null}),
    close(){store.close();fs.rmSync(tmp,{recursive:true,force:true});}};
}
const results=[];
function probe(name,fn){
  try{fn();results.push({name,result:'CONFIRMED'});console.log('CONFIRMED',name);}
  catch(e){results.push({name,result:'NOT_CONFIRMED',error:e.message});console.log('NOT_CONFIRMED',name,e.message);}
}

probe('R5-001a save() can jump WAIT_GATE_01 -> PLANNER/READY without Gate 0.1 approval',()=>{
  const w=setup();try{
    const t=w.store.get(w.id);t.stage='PLANNER';t.status='READY';
    w.store.save(t,'GATE_0.1_APPROVED');
    assert.equal(w.store.get(w.id).stage,'PLANNER');
    assert.equal(w.store.get(w.id).status,'READY');
    w.store.verify(w.id);
  }finally{w.close();}
});

probe('R5-001b save() can forge currentSha and WAIT_GATE_59, then approve Gate 5.9 with no tests/P0',()=>{
  const w=setup();try{
    const sha='d'.repeat(40);
    let t=w.store.get(w.id);t.currentSha=sha;t.stage='WAIT_GATE_59';t.status='READY';
    w.store.save(t,'A_COMMIT_FROZEN');
    w.store.verify(w.id);
    const r=w.controller.approve({id:w.id,gate:'5.9',digest:sha,actor:'fake-human',
      receipt:'Fake approval receipt long enough to pass the length check.'});
    assert.equal(r.stage,'CLOSED');
    assert.equal(w.store.get(w.id).stage,'CLOSED');
    assert.equal(w.store.get(w.id).status,'APPROVED_FOR_SEPARATE_RELEASE_REVIEW');
    w.store.verify(w.id);
  }finally{w.close();}
});

probe('R5-001c init() can create a task already at WAIT_GATE_59 with fake currentSha, then approve',()=>{
  const sha='e'.repeat(40);
  const w=setup({stage:'WAIT_GATE_59',status:'READY',currentSha:sha,aRound:10,bRound:10});try{
    w.store.verify(w.id);
    const r=w.controller.approve({id:w.id,gate:'5.9',digest:sha,actor:'fake-human',
      receipt:'Fake approval receipt long enough to pass the length check.'});
    assert.equal(r.stage,'CLOSED');
    assert.equal(w.store.get(w.id).stage,'CLOSED');
    w.store.verify(w.id);
  }finally{w.close();}
});

probe('R5-001d TASK_SPEC can be frozen at WAIT_GATE_01, then stage set to PREPARE without Gate 0.1/0.2',()=>{
  const w=setup();try{
    const t=w.store.get(w.id);
    t.taskSpec='A sufficiently long synthetic task specification for bypass probe.';
    t.taskSpecSha=sha256(t.taskSpec);
    t.stage='PREPARE';t.status='READY';
    w.store.save(t,'TASK_SPEC_CANDIDATE');
    assert.equal(w.store.get(w.id).stage,'PREPARE');
    assert.equal(w.store.get(w.id).taskSpecSha,sha256(t.taskSpec));
    w.store.verify(w.id);
  }finally{w.close();}
});

probe('R5-001e save() can forge lastB/P0 evidence and pass compliance() at READY_FINAL',()=>{
  const w=setup();try{
    const sha='f'.repeat(40);
    const t=w.store.get(w.id);
    t.currentSha=sha;t.stage='READY_FINAL';t.status='READY';
    t.lastB={tests:{pass:true},commit:sha};
    t.p0Initial={passed:true,commit:sha,reports:[{physicalId:'fake-A'},{physicalId:'fake-B'}]};
    t.bFindings=[];
    w.store.save(t,'A_COMMIT_FROZEN');
    assert.equal(w.controller.compliance(t),true);
    w.store.verify(w.id);
  }finally{w.close();}
});

probe('R5-001f save() can advance aRound with GATE_A_ROUND_START at WAIT_GATE_01 (no real round)',()=>{
  const w=setup();try{
    const t=w.store.get(w.id);t.aRound=1;
    w.store.save(t,'GATE_A_ROUND_START');
    assert.equal(w.store.get(w.id).aRound,1);
    assert.equal(w.store.get(w.id).stage,'WAIT_GATE_01');
    w.store.verify(w.id);
  }finally{w.close();}
});

probe('R5-001g save() accepts arbitrary baseSha/currentSha with no Git object/ancestry check',()=>{
  const w=setup();try{
    let t=w.store.get(w.id);t.baseSha='1'.repeat(40);
    w.store.save(t,'WORKTREE_PREPARED');
    t=w.store.get(w.id);t.currentSha='2'.repeat(40);
    w.store.save(t,'A_COMMIT_FROZEN');
    assert.equal(w.store.get(w.id).baseSha,'1'.repeat(40));
    assert.equal(w.store.get(w.id).currentSha,'2'.repeat(40));
    w.store.verify(w.id);
  }finally{w.close();}
});

probe('R5-001h save() appends forged reviewer history without any seat/commit validation',()=>{
  const w=setup();try{
    const t=w.store.get(w.id);
    t.history.push({role:'spec_reviewer',verdict:'PASS',sha:'f'.repeat(40),agentId:'fake-agent'});
    w.store.save(t,'REVIEW_SEAT_RECORDED');
    assert.equal(w.store.get(w.id).history.length,1);
    w.store.verify(w.id);
  }finally{w.close();}
});

fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r4/logs/probe-r5-stage.json',
  JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length);