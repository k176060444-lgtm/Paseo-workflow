import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {PaseoP0Adapter,verifyPaseoP0Envelope} from '../src/p0_paseo.mjs';
import {canonical,sha256} from '../src/policy.mjs';

function mock({badKey=false,createUnknown=false,thirdRunning=true,signedAgeMs=0}={}){
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
    const body={...statement,nonce:randomUUID(),
      issuedAt:new Date(Date.now()-signedAgeMs).toISOString()};
    const pair=pairs.get(badKey&&node.id!=='rusty'?'rusty':node.id);
    return {schema:1,keyId:node.id,statement:body,
      signature:sign(null,Buffer.from(canonical(body)),pair.privateKey).toString('base64')};
  }
  const attestor={
    attestP0Preflight:async({node,task,commit})=>signed(node,{
      purpose:'P1_P0_WORKSPACE_PREFLIGHT_V1',taskId:task.id,
      nodeId:node.id,physicalId:node.physicalId,serverId:node.serverId,
      workspaceId:node.workspaceId,cwd:node.cwd,commit,head:commit,clean:true}),
    attestP0Result:async({node,task,cycle,commit,jobId,agentId,raw:actual,binding})=>{
      const report={taskId:task.id,cycle,jobId,commit,nodeId:node.id,
        physicalId:node.physicalId,serverId:node.serverId,
        agentId,model:node.model,harness:node.harness,binding,
        rawMessage:actual,stdoutSha256:sha256(actual),exitCode:0,clean:true,
        verdict:'PASS',summary:'Synthetic evidence only',findings:[]};
      return {report,proof:signed(node,{
        purpose:binding?'P1_P0_NODE_RESULT_V2':'P1_P0_NODE_RESULT_V1',taskId:task.id,cycle,jobId,commit,
        nodeId:node.id,physicalId:node.physicalId,serverId:node.serverId,
        agentId,model:node.model,harness:node.harness,
        ...(binding?{bindingSha256:sha256(binding)}:{}),reportSha256:sha256(report)})};
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
  const task={id:'TASKP800',frozen:{intent:'Synthetic original user request for approved independent review',souls:Object.fromEntries(['blind_a','blind_b','blind_c'].map(r=>[
    r,{text:'Read only independent audit of the frozen commit',sha256:'a'.repeat(64)}]))}};
  return {nodes,client,attestor,roots,seen,task,store};
}
function adapter(x,options={}){
  return new PaseoP0Adapter(x.nodes,{client:x.client,attestor:x.attestor,p0Roots:x.roots,
    pollMs:0,extraThirdMs:0,deadlineMs:2000,sleep:async()=>{},...options});
}
test('Paseo P0: unfinished third reviewer is never falsely treated as cancelled/TERMINAL',async()=>{
  const x=mock();
  await assert.rejects(()=>adapter(x).review({task:x.task,commit:'a'.repeat(40),
    taskSpec:'Synthetic frozen spec',store:x.store,cycle:'initial-A1'}),
    /archive is not cancellation/);
  assert.equal(x.seen.created.length,3);
  assert.equal(x.seen.terminal.length,2);
  assert.equal(x.seen.created[2].serverId,'srv_rusty');
});
test('Paseo P0: two independently witnessed finished seats can pass without phantom third',async()=>{
  const x=mock();x.nodes[2].enabled=false;
  const r=await adapter(x).review({task:x.task,commit:'a'.repeat(40),
    taskSpec:'Synthetic frozen spec',store:x.store,cycle:'initial-A1'});
  assert.equal(r.reports.length,2);
  assert.equal(r.passed,true);
  assert.equal(x.seen.created.length,2);
  assert.equal(x.seen.terminal.length,2);
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
        providers:{listAvailable:async()=>({providers:[{provider:'opencode',available:true},{provider:'codex',available:false}]})},
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
        providers:{listAvailable:async()=>({providers:[{provider:'opencode',available:true},{provider:'codex',available:false}]})},close:async()=>{}};
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

test('real SDK providers array rejects unavailable Harness; no Agent creation',async()=>{
 const x=mock();x.nodes[2].enabled=false;
 for(const n of x.nodes.slice(0,2)){n.paseoUrl='ws://192.168.5.6:6767/ws';n.passwordEnv='PASEO_TEST_PASSWORD';}
 const prior=process.env.PASEO_TEST_PASSWORD;process.env.PASEO_TEST_PASSWORD='synthetic';
 try{
  const directClientFactory=async({node})=>{const remote=await x.client.hosts.client(node.serverId);
   return {...remote,hosts:{list:async()=>({self:{serverId:node.serverId}})},
    providers:{listAvailable:async()=>({providers:[{provider:'opencode',available:node.id==='5bao'}]})},
    close:async()=>{}};};
  await assert.rejects(()=>adapter(x,{directClientFactory}).review({
   task:x.task,commit:'a'.repeat(40),taskSpec:'Synthetic',store:x.store,cycle:'initial-A1'}),
   /P0 requires 2 authenticated/);
  assert.equal(x.seen.created.length,0);
 }finally{if(prior===undefined)delete process.env.PASEO_TEST_PASSWORD;
  else process.env.PASEO_TEST_PASSWORD=prior;}
});
test('P0 inventory refuses Worker disguised as blind Reviewer',()=>{
 const x=mock();x.nodes[0].role='worker';
 assert.throws(()=>adapter(x).validateInventory(),/only permits pinned direct/);
});


test('read-only P0 lost-ACK lookup finds exact original labels without creating Agent, and always closes remote',async()=>{
 const x=mock();const node=x.nodes[0];
 node.paseoUrl='ws://192.168.5.6:6767/ws';node.passwordEnv='PASEO_TEST_PASSWORD';
 const old=process.env.PASEO_TEST_PASSWORD;process.env.PASEO_TEST_PASSWORD='synthetic';
 let closes=0,lists=0,creates=0;
 try{
  const directClientFactory=async()=>({
    hosts:{list:async()=>({self:{serverId:node.serverId}})},
    agents:{list:async args=>{
      lists++;assert.equal(args.includeBackground,true);
      return {entries:[
        {agent:{id:'agent-valid',status:'running',labels:{
          'p0-job':'job-valid','p0-task':'TASKP800','p0-cycle':'initial-A1',
          'p0-commit':'a'.repeat(40)}}},
        {agent:{id:'wrong',status:'idle',labels:{'p0-job':'unrelated'}}}
      ]};
    },create:async()=>{creates++;throw Error('reconcile must never create');}},
    close:async()=>{closes++;}
  });
  const r=await adapter(x,{directClientFactory}).reconcileByLabels(node,{
    taskId:'TASKP800',cycle:'initial-A1',jobId:'job-valid',commit:'a'.repeat(40)});
  assert.deepEqual(r.map(a=>a.id),['agent-valid']);
  assert.equal(lists,1);assert.equal(creates,0);assert.equal(closes,1);
  const bad=await adapter(x,{directClientFactory:async()=>({
    hosts:{list:async()=>({self:{serverId:'wrong'}})},
    close:async()=>{closes++;}
  })});
  await assert.rejects(()=>bad.reconcileByLabels(node,{
    taskId:'TASKP800',cycle:'initial-A1',jobId:'job-valid',commit:'a'.repeat(40)}),
    /identity drift/);
  assert.equal(closes,2);
 }finally{
  if(old===undefined)delete process.env.PASEO_TEST_PASSWORD;
  else process.env.PASEO_TEST_PASSWORD=old;
 }
});


test('P0 signed V2 request binding rejects altered user intent even when node identity matches',async()=>{
 const x=mock();x.nodes[2].enabled=false;
 const original=x.attestor.attestP0Result;
 x.attestor.attestP0Result=async args=>{
   const e=await original(args);
   e.report.binding={...e.report.binding,intentSha256:'0'.repeat(64)};
   return e;
 };
 await assert.rejects(()=>adapter(x).review({task:x.task,commit:'a'.repeat(40),
   taskSpec:'Approved synthetic requirement',store:x.store,cycle:'initial-A1'}),
   /signed P0 result does not bind/);
 assert.equal(x.seen.created.length,2);
});

test('R13 follow-up P0: fresh first registration is mandatory but verified original may be replayed 31 minutes later',async()=>{
 const x=mock({signedAgeMs:31*60*1000});
 const node=x.nodes[0],commit='a'.repeat(40),cycle='initial-A1',
   jobId='3'.repeat(40),agentId='original-agent-5bao';
 const binding={role:node.role,workspaceId:node.workspaceId,cwd:node.cwd,
   soulSha256:'1'.repeat(64),promptSha256:'2'.repeat(64),
   taskSpecSha256:'3'.repeat(64),intentSha256:'4'.repeat(64)};
 const raw=JSON.stringify({verdict:'PASS',summary:'Original frozen blind review',findings:[]});
 const envelope=await x.attestor.attestP0Result({
   node,task:x.task,cycle,commit,jobId,agentId,raw,binding});
 const expected={taskId:x.task.id,cycle,jobId,commit,binding};
 assert.throws(()=>verifyPaseoP0Envelope(x.roots,node,envelope,expected),
   /P0 witness stale\/future/);
 assert.equal(verifyPaseoP0Envelope(x.roots,node,envelope,{
   ...expected,allowHistorical:true}).verdict,'PASS');
 const tampered=structuredClone(envelope);
 tampered.report.summary='changed without remote signature';
 assert.throws(()=>verifyPaseoP0Envelope(x.roots,node,tampered,{
   ...expected,allowHistorical:true}),/reportSha256 mismatch/);
 const wrongBinding={...binding,promptSha256:'f'.repeat(64)};
 assert.throws(()=>verifyPaseoP0Envelope(x.roots,node,envelope,{
   ...expected,binding:wrongBinding,allowHistorical:true}),
   /signed P0 result does not bind/);
 const future=mock({signedAgeMs:-3*60*1000});
 const e2=await future.attestor.attestP0Result({
   node:future.nodes[0],task:future.task,cycle,commit,jobId,agentId,raw,binding});
 assert.throws(()=>verifyPaseoP0Envelope(future.roots,future.nodes[0],e2,expected),
   /P0 witness stale\/future/);
});
