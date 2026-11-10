import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {HermesA2AP0Seat,OptionalRustyP0} from '../src/p0_a2a.mjs';
import {canonical,sha256} from '../src/policy.mjs';

function setup(){
  const node={id:'rusty',peerName:'rustyhand',transport:'a2a',serverId:'a2a-rustyhand',
    physicalId:'physical-rusty',role:'blind_c',harness:'rusty',model:'rusty/approved'};
  const pair=generateKeyPairSync('ed25519'),roots=new Map([['rusty',pair.publicKey]]);
  const task={id:'TASKP800',frozen:{intent:'Synthetic fixed intention, no real user data',
    souls:{blind_c:{text:'Perform independent read-only review',sha256:'a'.repeat(64)}}}};
  const events=[];
  const store={
    artifact:(id,name,body)=>{events.push({event:'artifact',name});return {sha256:sha256(body)};},
    recordIntent:(id,phase,job)=>events.push({event:'intent',job}),
    recordAck:(job,id)=>events.push({event:'ack',job,id}),
    recordTerminal:(job)=>events.push({event:'terminal',job}),
  };
  function envelope({cycle,commit,jobId,agentId}){
    const rawMessage=JSON.stringify({verdict:'PASS',summary:'Synthetic reviewer only',findings:[]});
    const report={taskId:task.id,cycle,jobId,commit,nodeId:'rusty',physicalId:node.physicalId,
      serverId:node.serverId,agentId,harness:node.harness,model:node.model,
      rawMessage,stdoutSha256:sha256(rawMessage),exitCode:0,clean:true,
      verdict:'PASS',summary:'Synthetic reviewer only',findings:[]};
    const statement={purpose:'P1_P0_NODE_RESULT_V1',taskId:task.id,cycle,jobId,commit,
      nodeId:'rusty',physicalId:node.physicalId,serverId:node.serverId,
      agentId,model:node.model,harness:node.harness,reportSha256:sha256(report),
      nonce:randomUUID(),issuedAt:new Date().toISOString()};
    return {report,proof:{schema:1,keyId:'rusty',statement,
      signature:sign(null,Buffer.from(canonical(statement)),pair.privateKey).toString('base64')}};
  }
  return {node,roots,task,store,events,envelope};
}
test('rusty A2A: cannot dispatch without native Hermes tool bridge and pinned key',()=>{
 const x=setup();
 assert.throws(()=>new HermesA2AP0Seat(x.node,{p0Roots:x.roots}).validate(),
   /Hermes native A2A/);
 assert.throws(()=>new HermesA2AP0Seat(x.node,{bridge:{submit:async()=>{}},p0Roots:x.roots}).validate(),
   /Hermes native A2A/);
 assert.equal(x.events.length,0);
});
test('rusty A2A: traceable Task ID and independently signed original report required',async()=>{
 const x=setup(),commit='a'.repeat(40),cycle='initial-A1';
 const jobId=sha256(x.task.id+':'+cycle+':'+commit+':rusty').slice(0,40);
 const agentId='a2a-independent-reviewer';
 let submit=0,poll=0;
 const bridge={
   submit:async({peerName,request})=>{
     submit++;assert.equal(peerName,'rustyhand');assert.equal(request.commit,commit);
     return {taskId:'native-a2a-task-123',agentId};
   },
   status:async({taskId})=>{
     poll++;assert.equal(taskId,'native-a2a-task-123');
     return {taskId,status:'completed',envelope:x.envelope({cycle,commit,jobId,agentId})};
   },
 };
 const seat=new HermesA2AP0Seat(x.node,{bridge,p0Roots:x.roots,pollMs:0});
 const result=await seat.review({task:x.task,commit,cycle,taskSpec:'Synthetic specification',store:x.store});
 assert.equal(result.verdict,'PASS');
 assert.equal(result.agentId,agentId);
 assert.equal(submit,1);assert.equal(poll,1);
 assert.equal(x.events.filter(x=>x.event==='intent').length,1);
 assert.equal(x.events.filter(x=>x.event==='terminal').length,1);
});
test('rusty A2A: missing Task ID fails closed without duplicate model dispatch',async()=>{
 const x=setup();let sent=0;
 const bridge={submit:async()=>{sent++;return {context:'not-a-task-id'};},
   status:async()=>{throw Error('must not poll');}};
 const seat=new HermesA2AP0Seat(x.node,{bridge,p0Roots:x.roots});
 await assert.rejects(()=>seat.review({task:x.task,commit:'a'.repeat(40),
   cycle:'initial-A1',taskSpec:'Synthetic',store:x.store}),/Task\/Agent IDs/);
 assert.equal(sent,1);
 assert.equal(x.events.filter(x=>x.event==='terminal').length,0);
});
test('optional rusty third seat does not invent quorum and combines only signed results',async()=>{
 const x=setup();let thirdCall=0;
 const paseo={review:async()=>({transport:'paseo',reports:[
   {physicalId:'physical-5bao',verdict:'PASS',findings:[]},
   {physicalId:'physical-9bao',verdict:'PASS',findings:[]}],
   passed:true,findings:[],dispute:false})};
 const third={validate:()=>{},review:async()=>{thirdCall++;return {
   physicalId:'physical-rusty',verdict:'PASS',findings:[]};}};
 const r=await new OptionalRustyP0({paseo,third}).review({});
 assert.equal(thirdCall,1);assert.equal(r.reports.length,3);
 assert.equal(r.passed,true);
 const without=await new OptionalRustyP0({paseo}).review({});
 assert.equal(without.reports.length,2);
});
