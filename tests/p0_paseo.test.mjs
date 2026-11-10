import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {PaseoP0Adapter} from '../src/p0_paseo.mjs';
import {canonical,sha256} from '../src/policy.mjs';

function mock({badKey=false,createUnknown=false,thirdRunning=true}={}){
  const nodes=['5bao','9bao','rusty'].map((id,i)=>({
    id,physicalId:'physical-'+id,serverId:'srv_'+id,registrationId:'hst_'+id,
    workspaceId:'ws_'+id,cwd:'/srv/p0/'+id,transport:'direct',enabled:true,
    role:['blind_a','blind_b','blind_c'][i],
    harness:'opencode',model:'opencode/approved',
  }));
  const pairs=new Map(nodes.map(n=>[n.id,generateKeyPairSync('ed25519')]));
  const roots=new Map(nodes.map(n=>[n.id,pairs.get(n.id).publicKey]));
  const seen={created:[],intents:[],terminal:[],artifacts:[]};
  const states=new Map();
  const raw=JSON.stringify({verdict:'PASS',summary:'Synthetic evidence only',findings:[]});
  function signed(node,statement){
    const body={...statement,nonce:randomUUID(),issuedAt:new Date().toISOString()};
    const pair=pairs.get(badKey&&node.id!=='rusty'?'rusty':node.id);
    return {schema:1,keyId:node.id,statement:body,
      signature:sign(null,Buffer.from(canonical(body)),pair.privateKey).toString('base64')};
  }
  const attestor={
    attestP0Preflight:async({node,task,commit})=>signed(node,{
      purpose:'P1_P0_WORKSPACE_PREFLIGHT_V1',taskId:task.id,
      nodeId:node.id,physicalId:node.physicalId,serverId:node.serverId,
      workspaceId:node.workspaceId,cwd:node.cwd,commit,head:commit,clean:true}),
    attestP0Result:async({node,task,cycle,commit,jobId,agentId,raw:actual})=>{
      const report={taskId:task.id,cycle,jobId,commit,nodeId:node.id,
        physicalId:node.physicalId,serverId:node.serverId,
        agentId,model:node.model,harness:node.harness,
        rawMessage:actual,stdoutSha256:sha256(actual),exitCode:0,clean:true,
        verdict:'PASS',summary:'Synthetic evidence only',findings:[]};
      return {report,proof:signed(node,{
        purpose:'P1_P0_NODE_RESULT_V1',taskId:task.id,cycle,jobId,commit,
        nodeId:node.id,physicalId:node.physicalId,serverId:node.serverId,
        agentId,model:node.model,harness:node.harness,reportSha256:sha256(report)})};
    }
  };
  const scopes=Object.fromEntries(nodes.map(node=>[node.serverId,{
    workspaces:{ref:id=>({refresh:async()=>({workspace:{directory:node.cwd,id}})})},
    agents:{
      create:async opts=>{
        seen.created.push({serverId:node.serverId,opts});
        if(createUnknown&&node.id==='5bao')throw new Error('DAEMON_CONNECTION_LOST: outcome unknown');
        const id='agent-'+node.id;
        states.set(id,thirdRunning&&node.id==='rusty'?'running':'idle');
        return {id};
      },
      ref:id=>({
        refresh:async()=>({agent:{id,status:states.get(id)}}),
        waitForFinish:async()=>({status:'idle',lastMessage:raw}),
        archive:async()=>{states.set(id,'closed');return {archivedAt:new Date().toISOString()};}
      }),
      list:async()=>({entries:[]})
    },
    dispose:async()=>{}
  }]));
  const client={hosts:{
    list:async()=>({hosts:nodes.map(n=>({
      serverId:n.serverId,registrationId:n.registrationId,
      metadata:{p1Transport:'direct'},enabled:true,target:'wss://private-vpn-host/ws'}))}),
    client:async id=>scopes[id]
  }};
  const store={
    artifact:(_id,name,data)=>{seen.artifacts.push(name);return {sha256:sha256(data),path:'/synthetic/'+name};},
    recordIntent:(id,phase,jobId)=>seen.intents.push(jobId),
    recordAck:()=>{},
    recordTerminal:id=>seen.terminal.push(id),
    event:()=>{}
  };
  const task={id:'TASKP800',frozen:{souls:Object.fromEntries(['blind_a','blind_b','blind_c'].map(r=>[
    r,{text:'Read only independent audit of the frozen commit',sha256:'a'.repeat(64)}]))}};
  return {nodes,client,attestor,roots,seen,task,store};
}
function adapter(x,options={}){
  return new PaseoP0Adapter(x.nodes,{client:x.client,attestor:x.attestor,p0Roots:x.roots,
    pollMs:0,extraThirdMs:0,deadlineMs:2000,sleep:async()=>{},...options});
}
test('Paseo P0: two authenticated hosts pass, third confirmed cancelled, no SSH',async()=>{
  const x=mock();
  const r=await adapter(x).review({task:x.task,commit:'a'.repeat(40),
    taskSpec:'Synthetic frozen spec',store:x.store,cycle:'initial-A1'});
  assert.equal(x.seen.created.length,3);
  assert.equal(r.reports.length,2);
  assert.equal(r.reports[0].serverId,'srv_5bao');
  assert.equal(r.cancelled.length,1);
  assert.equal(r.passed,true);
  assert.equal(new Set(r.reports.map(z=>z.physicalId)).size,2);
  assert.equal(x.seen.terminal.length,3);
});
test('Paseo P0: preflight signed by wrong physical node stops before any paid Agent',async()=>{
  const x=mock({badKey:true});
  await assert.rejects(()=>adapter(x).review({task:x.task,commit:'a'.repeat(40),
    taskSpec:'Synthetic frozen spec',store:x.store,cycle:'initial-A1'}),
    /Paseo P0 lacks|P0 requires 2|P0 witness|authenticated Paseo hosts/);
  assert.equal(x.seen.created.length,0);
});
test('Paseo P0: ambiguous create response never causes duplicate create',async()=>{
  const x=mock({createUnknown:true});
  await assert.rejects(()=>adapter(x).review({task:x.task,commit:'a'.repeat(40),
    taskSpec:'Synthetic frozen spec',store:x.store,cycle:'initial-A1'}),
    /DAEMON_CONNECTION_LOST/);
  assert.equal(x.seen.created.filter(z=>z.serverId==='srv_5bao').length,1);
  assert.equal(x.seen.intents.length,1);
});
test('Paseo P0: duplicate physical node and SSH transport rejected',()=>{
  const x=mock();
  x.nodes[1].physicalId=x.nodes[0].physicalId;
  assert.throws(()=>adapter(x).validateInventory(),/duplicate physical host/);
  const y=mock();y.nodes[1].transport='ssh';
  assert.throws(()=>adapter(y).validateInventory(),/only permits pinned direct/);
});


test('Paseo P0: real-layout direct SDK path authenticates each daemon without registered Hosts',async()=>{
  const x=mock();
  x.nodes[2].enabled=false;
  const observed=[];
  for(const n of x.nodes.slice(0,2)){
    n.paseoUrl=n.id==='5bao'?'ws://192.168.5.6:6767/ws':'ws://192.168.9.6:6767/ws';
    n.passwordEnv='PASEO_'+n.id.toUpperCase()+'_PASSWORD';
  }
  const envs=x.nodes.slice(0,2).map(n=>[n.passwordEnv,process.env[n.passwordEnv]]);
  for(const [name] of envs)process.env[name]='synthetic-test-only';
  try{
    const directClientFactory=async({url,password,node})=>{
      observed.push({url,password:password==='synthetic-test-only',nodeId:node.id});
      const remote=await x.client.hosts.client(node.serverId);
      return {
        ...remote,
        hosts:{list:async()=>({self:{serverId:node.serverId}})},
        providers:{listAvailable:async()=>({opencode:true})},
        workspaces:{ref:id=>({refresh:async()=>({workspace:{workspaceDirectory:node.cwd,id}})})},
        close:async()=>{},
      };
    };
    const result=await adapter(x,{directClientFactory}).review({
      task:x.task,commit:'a'.repeat(40),taskSpec:'Approved synthetic requirement',
      store:x.store,cycle:'initial-A1'});
    assert.equal(result.passed,true);
    assert.equal(result.reports.length,2);
    assert.equal(observed.length,2);
    assert(observed.every(x=>x.password));
    assert.deepEqual(new Set(observed.map(x=>x.nodeId)),new Set(['5bao','9bao']));
  }finally{
    for(const [name,old] of envs){
      if(old===undefined)delete process.env[name];else process.env[name]=old;
    }
  }
});
test('Paseo P0: direct SDK mismatch of serverId fails closed before remote Agent creation',async()=>{
  const x=mock();
  x.nodes[2].enabled=false;
  for(const n of x.nodes.slice(0,2)){
    n.paseoUrl='ws://192.168.5.6:6767/ws';
    n.passwordEnv='PASEO_TEST_PASSWORD';
  }
  const old=process.env.PASEO_TEST_PASSWORD;
  process.env.PASEO_TEST_PASSWORD='synthetic-test-only';
  try{
    const directClientFactory=async({node})=>{
      const remote=await x.client.hosts.client(node.serverId);
      return {...remote,hosts:{list:async()=>({self:{serverId:'wrong-id'}})},
        providers:{listAvailable:async()=>({opencode:true})},close:async()=>{}};
    };
    await assert.rejects(()=>adapter(x,{directClientFactory}).review({
      task:x.task,commit:'a'.repeat(40),taskSpec:'Synthetic',store:x.store,
      cycle:'initial-A1'}),/P0 requires 2 authenticated/);
    assert.equal(x.seen.created.length,0);
  }finally{
    if(old===undefined)delete process.env.PASEO_TEST_PASSWORD;
    else process.env.PASEO_TEST_PASSWORD=old;
  }
});
