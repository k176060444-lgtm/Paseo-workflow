import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {Store} from '../offline-copy/src/store.mjs';
import {SshP0Adapter} from '../offline-copy/src/p0.mjs';
import {canonical, providerOptions, parseAgentOutput, ROLE_PERMISSIONS, PASS, PAUSE} from '../offline-copy/src/policy.mjs';

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-freg-'));
  const nodes=['5bao','9bao','rusty'].map((id,i)=>{
    const hmacKeyPath=path.join(root,`key-${id}`);fs.writeFileSync(hmacKeyPath,Buffer.alloc(40,65+i));
    return {id,physicalId:`physical-${id}`,hmacKeyPath,sshAlias:id,role:['blind_a','blind_b','blind_c'][i],
      harness:'opencode',model:'opencode/model',enabled:true,runner:'/runner',config:'/config'};
  });
  const store=new Store(path.join(root,'state'));
  store.init({id:'TASKF001',frozen:{digest:'d'.repeat(64),souls:{blind_a:{text:'A'},blind_b:{text:'B'},blind_c:{text:'C'}}},stage:'P0'});
  const task={id:'TASKF001',frozen:{souls:{blind_a:{text:'A'},blind_b:{text:'B'},blind_c:{text:'C'}}}};
  return {root,store,nodes,task,close(){try{store.close()}catch{}for(let i=0;i<8;i++){try{fs.rmSync(root,{recursive:true,force:true});return;}catch{}}}};
}
function signed(node,jobId,commit,verdict='PASS',findings=[]){
  const body={jobId,nodeId:node.id,physicalId:node.physicalId,commit,model:node.model,harness:node.harness,
    exitCode:0,clean:true,stdoutSha256:'f'.repeat(64),verdict,summary:'synthetic',findings};
  return {body,mac:createHmac('sha256',fs.readFileSync(node.hmacKeyPath)).update(canonical(body)).digest('hex')};
}
const commit='a'.repeat(40);

function adapterFor(w,{probeFail=null,cancelMode=null}={}){
  const adapter=new SshP0Adapter(w.nodes,{pollMs:0,extraThirdMs:0,deadlineMs:100,sleep:async()=>{}});
  const requested=new Map();
  adapter.ssh=async(node,action,payload)=>{
    if(action==='probe'){
      if(node.id===probeFail)throw new Error('synthetic probe failure');
      return {status:'READY',nodeId:node.id,physicalId:node.physicalId};
    }
    if(action==='submit'){requested.set(node.id,payload);return {jobId:payload.jobId,status:'ACCEPTED'};}
    if(action==='status'){
      if(node.id==='rusty'&&probeFail===null)return {jobId:payload.jobId,status:'RUNNING'};
      return {jobId:payload.jobId,status:'FINISHED',result:signed(node,payload.jobId,commit)};
    }
    if(action==='cancel'){
      if(cancelMode==='finished-fail')return {jobId:payload.jobId,status:'FINISHED',result:signed(node,payload.jobId,commit,'FAIL',['BLOCKER: late finding'])};
      if(cancelMode==='finished-pass')return {jobId:payload.jobId,status:'FINISHED',result:signed(node,payload.jobId,commit)};
      if(cancelMode==='wrong-node')return {jobId:payload.jobId,nodeId:'impostor',status:'CANCELLED'};
      return {jobId:payload.jobId,nodeId:node.id,status:'CANCELLED'};
    }
    throw new Error('unexpected action');
  };
  return adapter;
}

for(const [label,fail] of [['5bao+rusty','9bao'],['5bao+9bao','rusty'],['9bao+rusty','5bao']]){
  test(`F2: two distinct seats ${label} pass while ${fail} is unavailable`,async()=>{
    const w=fixture();
    try{
      const adapter=adapterFor(w,{probeFail:fail});
      const r=await adapter.review({task:w.task,commit,taskSpec:'synthetic spec',store:w.store,cycle:'initial-A1'});
      assert.equal(r.passed,true);
      assert.equal(r.reports.length,2);
      assert.deepEqual(new Set(r.reports.map(x=>x.nodeId)),new Set(label.split('+')));
      assert.deepEqual(r.missing,[fail]);
      w.store.verify(w.task.id);
    }finally{w.close();}
  });
}

test('F2: third seat finishing with FAIL at cancel is included and blocks',async()=>{
  const w=fixture();
  try{
    const adapter=adapterFor(w,{cancelMode:'finished-fail'});
    const r=await adapter.review({task:w.task,commit,taskSpec:'synthetic spec',store:w.store,cycle:'initial-A1'});
    assert.equal(r.reports.length,3);
    assert.equal(r.passed,false);
    assert.equal(r.dispute,true);
    assert(r.findings.some(f=>/late finding/.test(f)));
    w.store.verify(w.task.id);
  }finally{w.close();}
});

test('F2: third seat finishing PASS at cancel is included without blocking',async()=>{
  const w=fixture();
  try{
    const adapter=adapterFor(w,{cancelMode:'finished-pass'});
    const r=await adapter.review({task:w.task,commit,taskSpec:'synthetic spec',store:w.store,cycle:'initial-A1'});
    assert.equal(r.reports.length,3);
    assert.equal(r.passed,true);
    w.store.verify(w.task.id);
  }finally{w.close();}
});

test('F2: cancellation ACK with the wrong node identity blocks',async()=>{
  const w=fixture();
  try{
    const adapter=adapterFor(w,{cancelMode:'wrong-node'});
    await assert.rejects(()=>adapter.review({task:w.task,commit,taskSpec:'synthetic spec',store:w.store,cycle:'initial-A1'}),/cancel uncertain/);
  }finally{w.close();}
});

test('F3: duplicated HMAC key bytes at distinct paths never dispatch',async()=>{
  const w=fixture();
  try{
    fs.copyFileSync(w.nodes[0].hmacKeyPath,w.nodes[1].hmacKeyPath);
    const adapter=new SshP0Adapter(w.nodes);
    let calls=0;adapter.ssh=async()=>{calls++;};
    await assert.rejects(()=>adapter.review({task:w.task,commit,taskSpec:'s',store:w.store,cycle:'initial-A1'}),/duplicate P0 attestation key content/);
    assert.equal(calls,0);
  }finally{w.close();}
});

test('F3: signed physicalId mismatch is rejected',()=>{
  const w=fixture();
  try{
    const a=new SshP0Adapter(w.nodes);
    const e=signed(w.nodes[0],'j'.repeat(40),commit);
    e.body.physicalId='impostor';
    e.mac=createHmac('sha256',fs.readFileSync(w.nodes[0].hmacKeyPath)).update(canonical(e.body)).digest('hex');
    assert.throws(()=>a.verify(w.nodes[0],e,'j'.repeat(40),commit),/physical inventory mismatch/);
  }finally{w.close();}
});

test('F6: provider permission matrix is fixed and deny-by-default for unknown roles/harnesses',()=>{
  const c1=providerOptions('tester_gate_a','codex');
  assert.equal(c1.sandbox_mode,'read-only');
  assert.equal(c1.approval_policy,'never');
  assert.equal(c1.web_search,'disabled');
  const c2=providerOptions('worker','codex');
  assert.equal(c2.sandbox_mode,'workspace-write');
  assert.equal(c2.sandbox_workspace_write.network_access,false);
  const o1=providerOptions('spec_reviewer','opencode');
  assert.equal(o1.permission.edit,'deny');
  assert.equal(o1.permission.bash,'deny');
  assert.equal(o1.permission.webfetch,'deny');
  const o2=providerOptions('tester_gate_b','opencode');
  assert.equal(o2.permission.edit,'deny');
  assert.equal(o2.permission.bash,'deny');
  const o3=providerOptions('worker','opencode');
  assert.equal(o3.permission.edit,'allow');
  assert.equal(o3.permission.external_directory,'deny');
  assert.deepEqual(o3.permission.bash,{'*':'deny','git status*':'allow','git diff*':'allow'});
  assert.throws(()=>providerOptions('unknown_role','codex'),/unrecognized role/);
  assert.throws(()=>providerOptions('worker','unknown_harness'),/unsupported harness/);
  assert.equal(Object.keys(ROLE_PERMISSIONS).length,11);
});

test('F1/F5: verdict helpers are consistent at the trust boundary',()=>{
  assert(PASS('PASS'));
  assert(PASS('APPROVE_WITH_COMMENTS'));
  assert(!PASS('FAIL'));
  assert(PAUSE('QUESTION'));
  assert(PAUSE('NEEDS_SPECIALIST'));
  assert.throws(()=>parseAgentOutput(JSON.stringify({verdict:'PASS',summary:'x',findings:['BLOCKER: x']}),'spec_reviewer'),/inconsistent/);
});

test('F7: an empty event table is rejected',()=>{
  const w=fixture();
  try{
    w.store.db.prepare('DELETE FROM events WHERE task_id=?').run(w.task.id);
    assert.throws(()=>w.store.verify(w.task.id),/task missing audit events/);
  }finally{w.close();}
});

test('F10: a read-only store does not create a missing state directory',()=>{
  const missing=path.join(os.tmpdir(),`p1-missing-${process.pid}-${Date.now()}`);
  assert(!fs.existsSync(missing));
  assert.throws(()=>new Store(missing,{readOnly:true}),/state database not found/);
  assert(!fs.existsSync(missing));
});
