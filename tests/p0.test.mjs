import {seedSyntheticTask,resealSyntheticState} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {SshP0Adapter} from '../src/p0.mjs';
import {canonical,sha256} from '../src/policy.mjs';
import {Store} from '../src/store.mjs';

function mock(){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p0-test-'));
 const nodes=['5bao','9bao','rusty'].map((id,i)=>{
   const key=path.join(tmp,id+'.hmac');fs.writeFileSync(key,Buffer.alloc(40,0x41+i));
   return{id,physicalId:'physical-'+id,hmacKeyPath:key,enabled:true,role:['blind_a','blind_b','blind_c'][i],harness:'opencode',model:'opencode/model',sshAlias:id,runner:'/runner.py',config:'/config'};
 });
 const store=new Store(path.join(tmp,'state'));
 const task={id:'TASK1234',frozen:{souls:{blind_a:{text:'A'},blind_b:{text:'B'},blind_c:{text:'C'}}}};
 seedSyntheticTask(store,{id:task.id,frozen:{digest:'0'.repeat(64)},stage:'P0'});
 return {nodes,store,task,tmp,done(){store.close();fs.rmSync(tmp,{recursive:true,force:true});}};
}
function fakeSsh(adapter,{third='pending',wrongKey=false}={}){
 const seen=new Map();
 adapter.ssh=async(node,action,spec)=>{
   if(action==='probe')return{status:'READY',nodeId:node.id,physicalId:node.physicalId};
   if(action==='submit'){seen.set(spec.jobId,spec);return{jobId:spec.jobId,status:'ACCEPTED'};}
   if(action==='cancel')return{jobId:spec.jobId,nodeId:node.id,status:'CANCELLED'};
   const current=seen.get(spec.jobId);
   if(node.id==='rusty'&&third==='pending')return{jobId:spec.jobId,status:'RUNNING'};
   const body={jobId:spec.jobId,nodeId:node.id,physicalId:node.physicalId,commit:current.commit,model:node.model,harness:node.harness,exitCode:0,
     clean:true,stdoutSha256:'0'.repeat(64),findings:[],verdict:'PASS'};
   const key=fs.readFileSync(node.hmacKeyPath);
   const mac=createHmac('sha256',wrongKey?Buffer.alloc(40):key).update(canonical(body)).digest('hex');
   return{jobId:spec.jobId,status:'FINISHED',result:{body,mac}};
 };
}

test('P0: two distinct signed nodes pass; third nonmandatory after extra window',async()=>{
 const x=mock();try{
   const adapter=new SshP0Adapter(x.nodes,{pollMs:0,extraThirdMs:0,deadlineMs:100,sleep:async()=>{}});
   fakeSsh(adapter);
   const result=await adapter.review({task:x.task,commit:'f'.repeat(40),taskSpec:'test spec',store:x.store,cycle:'initial-A1'});
   assert.equal(result.reports.length,2);assert(result.passed);assert.deepEqual(result.missing,['rusty']);
 }finally{x.done();}
});

test('P0: spoofed MAC cannot count toward quorum',async()=>{
 const x=mock();try{
   const adapter=new SshP0Adapter(x.nodes.slice(0,2),{pollMs:0,deadlineMs:10,sleep:async()=>{}});
   fakeSsh(adapter,{wrongKey:true});
   await assert.rejects(()=>adapter.review({task:x.task,commit:'f'.repeat(40),taskSpec:'spec',store:x.store,cycle:'initial-A1'}),/attestation MAC/);
 }finally{x.done();}
});

test('P0: same physical identity fails before dispatch',async()=>{
 const x=mock();try{
   x.nodes[1].physicalId=x.nodes[0].physicalId;
   const adapter=new SshP0Adapter(x.nodes.slice(0,2));fakeSsh(adapter);
   await assert.rejects(()=>adapter.review({task:x.task,commit:'f'.repeat(40),taskSpec:'spec',store:x.store,cycle:'initial-A1'}),/duplicate physical IDs/);
 }finally{x.done();}
});
