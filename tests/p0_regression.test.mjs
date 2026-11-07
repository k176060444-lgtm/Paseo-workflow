import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {SshP0Adapter} from '../src/p0.mjs';
import {canonical} from '../src/policy.mjs';

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p0-regression-'));
  const nodes=['5bao','9bao','rusty'].map((id,i)=>{
    const hmacKeyPath=path.join(root,`key-${id}`);fs.writeFileSync(hmacKeyPath,Buffer.alloc(40,65+i));
    return {id,physicalId:`physical-${id}`,hmacKeyPath,sshAlias:id,role:['blind_a','blind_b','blind_c'][i],harness:'opencode',model:'opencode/model',enabled:true,runner:'/runner',config:'/config'};
  });
  const store=new Store(path.join(root,'state'));
  store.init({id:'TASK1234',frozen:{digest:'x'.repeat(64)},stage:'P0'});
  const task={id:'TASK1234',frozen:{souls:{blind_a:{text:'Soul A'},blind_b:{text:'Soul B'},blind_c:{text:'Soul C'}}}};
  return{root,store,nodes,task,close(){store.close();fs.rmSync(root,{recursive:true,force:true});}};
}
function signed(node,jobId,commit){
  const body={jobId,nodeId:node.id,physicalId:node.physicalId,commit,model:node.model,harness:node.harness,exitCode:0,clean:true,
    stdoutSha256:'f'.repeat(64),verdict:'PASS',summary:'passed',findings:[]};
  return{body,mac:createHmac('sha256',fs.readFileSync(node.hmacKeyPath)).update(canonical(body)).digest('hex')};
}
const commit='a'.repeat(40);

test('F3: distinct key paths with identical key bytes never dispatch',async()=>{
  const w=fixture();try{
    fs.copyFileSync(w.nodes[0].hmacKeyPath,w.nodes[1].hmacKeyPath);
    const adapter=new SshP0Adapter(w.nodes);
    let calls=0;adapter.ssh=async()=>{calls++;};
    await assert.rejects(()=>adapter.review({task:w.task,commit,taskSpec:'spec',store:w.store,cycle:'initial-A1'}),/duplicate P0 attestation key content/);
    assert.equal(calls,0);
  }finally{w.close();}
});

test('F2: optional third probe failure does not prevent two verified primary seats',async()=>{
  const w=fixture();try{
    const adapter=new SshP0Adapter(w.nodes,{pollMs:0,extraThirdMs:0,sleep:async()=>{}});
    const requests=new Map();let thirdSubmitted=false;
    adapter.ssh=async(node,action,payload)=>{
      if(action==='probe'){
        if(node.id==='rusty')throw new Error('preflight refused');
        return{nodeId:node.id,physicalId:node.physicalId,status:'READY'};
      }
      if(action==='submit') {if(node.id==='rusty')thirdSubmitted=true;requests.set(node.id,payload);return{jobId:payload.jobId,status:'ACCEPTED'};}
      if(action==='status') return{jobId:payload.jobId,status:'FINISHED',result:signed(node,payload.jobId,commit)};
      throw new Error('unexpected action');
    };
    const r=await adapter.review({task:w.task,commit,taskSpec:'spec',store:w.store,cycle:'initial-A1'});
    assert(r.passed);assert.equal(r.reports.length,2);assert(!thirdSubmitted);assert.deepEqual(r.missing,['rusty']);
    w.store.verify(w.task.id);
  }finally{w.close();}
});

test('F2: lingering optional third is cancelled and separately receipted',async()=>{
  const w=fixture();try{
    const adapter=new SshP0Adapter(w.nodes,{pollMs:0,extraThirdMs:0,sleep:async()=>{}});
    const requested=new Map(),actions=[];
    adapter.ssh=async(node,action,payload)=>{
      actions.push(`${node.id}:${action}`);
      if(action==='probe')return{nodeId:node.id,physicalId:node.physicalId,status:'READY'};
      if(action==='submit'){requested.set(node.id,payload);return{jobId:payload.jobId,status:'ACCEPTED'};}
      if(action==='status')return node.id==='rusty'?{jobId:payload.jobId,status:'RUNNING'}:
        {jobId:payload.jobId,status:'FINISHED',result:signed(node,payload.jobId,commit)};
      if(action==='cancel')return{jobId:payload.jobId,nodeId:node.id,status:'CANCELLED'};
    };
    const r=await adapter.review({task:w.task,commit,taskSpec:'spec',store:w.store,cycle:'initial-A1'});
    assert.equal(r.passed,true);assert.deepEqual(r.missing,['rusty']);
    assert(actions.includes('rusty:cancel'));assert.equal(r.cancelled.length,1);
    w.store.verify(w.task.id);
  }finally{w.close();}
});

test('F2: optional third lost submit ACK never silently passes',async()=>{
  const w=fixture();try{
    const adapter=new SshP0Adapter(w.nodes);adapter.ssh=async(node,action,payload)=>{
      if(action==='probe')return{nodeId:node.id,physicalId:node.physicalId,status:'READY'};
      if(action==='submit'&&node.id==='rusty')throw new Error('lost ACK');
      if(action==='submit')return{jobId:payload.jobId,status:'ACCEPTED'};
    };
    await assert.rejects(()=>adapter.review({task:w.task,commit,taskSpec:'spec',store:w.store,cycle:'initial-A1'}),/lost ACK/);
    assert.equal(w.store.dispatches(w.task.id).filter(x=>x.state==='DISPATCH_INTENT').length,1);
  }finally{w.close();}
});

test('F3: signed physicalId mismatch cannot pass',()=>{
  const w=fixture();try{
    const a=new SshP0Adapter(w.nodes);
    const envelope=signed(w.nodes[0],'job-id',commit);
    envelope.body.physicalId='impostor';
    envelope.mac=createHmac('sha256',fs.readFileSync(w.nodes[0].hmacKeyPath)).update(canonical(envelope.body)).digest('hex');
    assert.throws(()=>a.verify(w.nodes[0],envelope,'job-id',commit),/physical inventory mismatch/);
  }finally{w.close();}
});
