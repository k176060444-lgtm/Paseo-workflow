import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {IndependentExecutionAttestor} from '../src/attestor.mjs';
import {PaseoAgentRuntime} from '../src/agents.mjs';
import {canonical,sha256} from '../src/policy.mjs';

test('R8-001 production IPC submits actual identifiers, external witness responds signed',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'p1-witness-'));
  const socket=process.platform==='win32'
    ?'\\\\.\\pipe\\p1-'+randomUUID().replaceAll('-','')
    :path.join(folder,'witness.sock');
  const pair=generateKeyPairSync('ed25519');
  let observed=[];
  const server=http.createServer((req,res)=>{
    let input='';
    req.on('data',d=>{input+=d;});
    req.on('end',()=>{
      const record=JSON.parse(input);
      observed.push(record);
      const statement={purpose:record.source==='paseo-agent'? 'P1_EXECUTION_ATTESTATION_V2':'P1_EXECUTION_ATTESTATION_V1',
        taskId:record.taskId,role:record.role,phase:record.phase,
        commit:record.commit,agentId:record.agentId,dispatchId:record.dispatchId,
        rawSha256:record.claimedRawSha256,
        ...(record.source==='paseo-agent'?{model:record.expectedModel,
          harness:record.expectedHarness,soulSha256:record.expectedSoulSha256}:{}),
        nonce:randomUUID(),
        issuedAt:new Date().toISOString()};
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({schema:1,keyId:'test-independent-server',statement,
        signature:sign(null,Buffer.from(canonical(statement)),pair.privateKey).toString('base64')}));
    });
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(socket,resolve);
  });
  try{
    const witness=new IndependentExecutionAttestor(socket);
    const task={id:'TASKR801',frozen:{
      roles:{spec_reviewer:{model:'opencode/approved',harness:'opencode'}},
      souls:{spec_reviewer:{sha256:'a'.repeat(64)}}}};
    const bare={role:'spec_reviewer',phase:'A1-review-spec_reviewer',
      agentId:'independent-agent',dispatchId:'dispatch-1',
      verdict:'PASS',summary:'Synthetic external IPC test only',findings:[],taskSpec:null};
    const proof=await witness.attestPaseo({task,role:bare.role,phase:bare.phase,
      commit:'a'.repeat(40),agentId:bare.agentId,dispatchId:bare.dispatchId,raw:bare});
    assert.equal(proof.statement.rawSha256,sha256(bare));
    assert.equal(observed[0].source,'paseo-agent');
    assert.equal(observed[0].agentId,'independent-agent');
    assert.equal(observed[0].requiredProtocol,'P1_EXECUTION_ATTESTATION_V2');
    assert.equal(proof.statement.model,'opencode/approved');
    assert.equal(proof.statement.soulSha256,'a'.repeat(64));
    const tests={pass:true,receipts:[{argv:['node','--test'],code:0,logSha256:'e'.repeat(64),ok:true}]};
    const result=await witness.attestTests({task,phase:'A1-test',commit:'a'.repeat(40),
      sha:'a'.repeat(40),cwd:folder,tests});
    assert.equal(result.statement.role,'test_executor');
    assert.equal(observed[1].source,'os-tests');
    const preflight=await witness.attestP0Preflight({
      task,node:{id:'5bao',serverId:'srv5',physicalId:'host5',
        workspaceId:'ws5',cwd:'/p0'},commit:'a'.repeat(40)});
    assert.equal(observed[2].source,'paseo-p0-workspace');
    assert(preflight.signature);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(folder,{recursive:true,force:true});
  }
});
test('R8-001 Paseo runtime requires IPC witness before terminal completion',async()=>{
  const result={verdict:'PASS',summary:'Independent synthetic reviewer output',findings:[]};
  const task={id:'TASKR802',currentSha:'a'.repeat(40),frozen:{
    roles:{spec_reviewer:{model:'opencode/approved',harness:'opencode'}},
    souls:{spec_reviewer:{text:'Review the frozen commit independently.',
      sha256:'e'.repeat(64)}}}};
  const events=[],store={
    recordIntent:()=>events.push('INTENT'),recordAck:()=>events.push('ACK'),
    recordTerminal:()=>events.push('TERMINAL')
  };
  const runtime=new PaseoAgentRuntime('ws://127.0.0.1:6767/ws',{
    attestor:{attestPaseo:async fields=>{
      assert.equal(fields.agentId,'agent-r802');
      assert.equal(fields.phase,'A1-review-spec_reviewer');
      events.push('EXTERNAL-WITNESS');
      return {schema:1,signature:'signed-test-only'};
    }}
  });
  runtime.client={agents:{create:async()=>({id:'agent-r802',
    waitForFinish:async()=>({status:'idle',lastMessage:JSON.stringify(result)})})}};
  const output=await runtime.execute({task,role:'spec_reviewer',
    phase:'A1-review-spec_reviewer',cwd:'/synthetic',prompt:'Review',store});
  assert.equal(output.agentId,'agent-r802');
  assert(output.attestation);
  assert.deepEqual(events,['INTENT','ACK','EXTERNAL-WITNESS','TERMINAL']);
  const noWitness=new PaseoAgentRuntime('ws://127.0.0.1:6767/ws');
  noWitness.client=runtime.client;
  events.length=0;
  await assert.rejects(()=>noWitness.execute({task,role:'spec_reviewer',
    phase:'A1-review-spec_reviewer',cwd:'/synthetic',prompt:'Review',store}),
    /independent Paseo execution attestor not installed/);
  assert.deepEqual(events,['INTENT','ACK']);
});
