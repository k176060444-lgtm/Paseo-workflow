import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {Store} from '../offline-copy/src/store.mjs';
import {SshP0Adapter} from '../offline-copy/src/p0.mjs';
import {canonical} from '../offline-copy/src/policy.mjs';

function fixture(n=3){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r3p0-'));
  const nodes=['5bao','9bao','rusty'].slice(0,n).map((id,i)=>{
    const hmacKeyPath=path.join(root,`key-${id}`);fs.writeFileSync(hmacKeyPath,Buffer.alloc(40,65+i));
    return {id,physicalId:`physical-${id}`,hmacKeyPath,sshAlias:id,role:['blind_a','blind_b','blind_c'][i],
      harness:'opencode',model:'opencode/model',enabled:true,runner:'/runner',config:'/config'};
  });
  const store=new Store(path.join(root,'state'));
  store.init({id:'TASKR3P0',frozen:{digest:'d'.repeat(64),souls:{blind_a:{text:'A'},blind_b:{text:'B'},blind_c:{text:'C'}}},stage:'P0'});
  const task={id:'TASKR3P0',frozen:{souls:{blind_a:{text:'A'},blind_b:{text:'B'},blind_c:{text:'C'}}}};
  return {root,store,nodes,task,close(){try{store.close()}catch{}for(let i=0;i<8;i++){try{fs.rmSync(root,{recursive:true,force:true});return;}catch{}}}};
}
function signed(node,jobId,commit,verdict='PASS',findings=[]){
  const body={jobId,nodeId:node.id,physicalId:node.physicalId,commit,model:node.model,harness:node.harness,
    exitCode:0,clean:true,stdoutSha256:'f'.repeat(64),verdict,summary:'synthetic',findings};
  return {body,mac:createHmac('sha256',fs.readFileSync(node.hmacKeyPath)).update(canonical(body)).digest('hex')};
}
const commit='a'.repeat(40);
function adapter(w,verdicts){
  const a=new SshP0Adapter(w.nodes,{pollMs:0,extraThirdMs:0,deadlineMs:100,sleep:async()=>{}});
  a.ssh=async(node,action,payload)=>{
    if(action==='probe')return {status:'READY',nodeId:node.id,physicalId:node.physicalId};
    if(action==='submit')return {jobId:payload.jobId,status:'ACCEPTED'};
    if(action==='status'){
      const v=verdicts[node.id]||{verdict:'PASS',findings:[]};
      return {jobId:payload.jobId,status:'FINISHED',result:signed(node,payload.jobId,commit,v.verdict,v.findings)};
    }
    if(action==='cancel')return {jobId:payload.jobId,nodeId:node.id,status:'CANCELLED'};
    throw new Error('unexpected action');
  };
  return a;
}

test('R3-007: one LOW-comment seat plus one PASS does not pass P0',async()=>{
  const w=fixture(2);
  try{
    const r=await adapter(w,{ '5bao':{verdict:'APPROVE_WITH_COMMENTS',findings:['LOW: nit']}, '9bao':{verdict:'PASS',findings:[]} })
      .review({task:w.task,commit,taskSpec:'spec',store:w.store,cycle:'initial-A1'});
    assert.equal(r.reports.length,2);
    assert.equal(r.passed,false,'unresolved LOW finding must not pass P0');
    assert(r.findings.some(f=>/LOW/.test(f)));
    w.store.verify(w.task.id);
  }finally{w.close();}
});

test('R3-007: APPROVE_WITH_COMMENTS without findings plus PASS passes',async()=>{
  const w=fixture(2);
  try{
    const r=await adapter(w,{ '5bao':{verdict:'APPROVE_WITH_COMMENTS',findings:[]}, '9bao':{verdict:'PASS',findings:[]} })
      .review({task:w.task,commit,taskSpec:'spec',store:w.store,cycle:'initial-A1'});
    assert.equal(r.passed,true);
  }finally{w.close();}
});

test('R3-007: LOW-comment seat plus FAIL creates a dispute and does not pass',async()=>{
  const w=fixture(2);
  try{
    const r=await adapter(w,{ '5bao':{verdict:'APPROVE_WITH_COMMENTS',findings:['LOW: nit']}, '9bao':{verdict:'FAIL',findings:['BLOCKER: x']} })
      .review({task:w.task,commit,taskSpec:'spec',store:w.store,cycle:'initial-A1'});
    assert.equal(r.passed,false);
    assert.equal(r.dispute,true);
  }finally{w.close();}
});

test('R3-007: a single seat can never pass P0 (two distinct nodes required)',async()=>{
  const w=fixture(1);
  try{
    const a=new SshP0Adapter(w.nodes);
    await assert.rejects(()=>a.review({task:w.task,commit,taskSpec:'spec',store:w.store,cycle:'initial-A1'}),/at least two/);
  }finally{w.close();}
});

test('R3-007: duplicate physical identity is rejected before dispatch',async()=>{
  const w=fixture(2);
  try{
    w.nodes[1].physicalId=w.nodes[0].physicalId;
    const a=new SshP0Adapter(w.nodes);
    let calls=0;a.ssh=async()=>{calls++;};
    await assert.rejects(()=>a.review({task:w.task,commit,taskSpec:'spec',store:w.store,cycle:'initial-A1'}),/duplicate physical IDs/);
    assert.equal(calls,0);
  }finally{w.close();}
});

test('R3-007: signed P0 APPROVE_WITH_COMMENTS HIGH/LOW and PASS+LOW gates',()=>{
  const w=fixture(2);
  try{
    const a=new SshP0Adapter(w.nodes);
    const node=w.nodes[0];
    const low=signed(node,'j'.repeat(40),commit,'APPROVE_WITH_COMMENTS',['LOW: nit']);
    assert.equal(a.verify(node,low,'j'.repeat(40),commit).verdict,'APPROVE_WITH_COMMENTS');
    const med=signed(node,'j'.repeat(40),commit,'APPROVE_WITH_COMMENTS',['MEDIUM: issue']);
    assert.equal(a.verify(node,med,'j'.repeat(40),commit).verdict,'APPROVE_WITH_COMMENTS');
    const high=signed(node,'j'.repeat(40),commit,'APPROVE_WITH_COMMENTS',['HIGH: unsafe']);
    assert.throws(()=>a.verify(node,high,'j'.repeat(40),commit),/comments have blocking/);
    const passlow=signed(node,'j'.repeat(40),commit,'PASS',['LOW: contradictory']);
    assert.throws(()=>a.verify(node,passlow,'j'.repeat(40),commit),/contradictory PASS/);
  }finally{w.close();}
});