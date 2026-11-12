// Synthetic SDK and ephemeral witness keys only; no network or models.
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {PaseoP0Adapter} from '../src/p0_paseo.mjs';
import {canonical,sha256} from '../src/policy.mjs';
import assert from 'node:assert/strict';

export function mock({badKey=false,createUnknown=false,thirdRunning=true,signedAgeMs=0}={}){
  const nodes=['5bao','9bao','rusty'].map((id,i)=>({
    id,physicalId:'physical-'+id,serverId:'srv_'+id,registrationId:'hst_'+id,
    workspaceId:'ws_'+id,cwd:'/srv/p0/'+id,transport:'direct',enabled:true,
    role:['blind_a','blind_b','blind_c'][i],
    harness:'opencode',model:'opencode/approved',
  }));
  const pairs=new Map(nodes.map(n=>[n.id,generateKeyPairSync('ed25519')]));
  const roots=new Map(nodes.map(n=>[n.id,pairs.get(n.id).publicKey]));
  const seen={created:[],intents:[],terminal:[],artifacts:[],payloads:{}};
  const journal=new Map();
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
      purpose:'P1_P0_WORKSPACE_PREFLIGHT_V2',taskId:task.id,
      nodeId:node.id,physicalId:node.physicalId,serverId:node.serverId,
      workspaceId:node.workspaceId,cwd:node.cwd,commit,head:commit,clean:true,independentSession:true,osReadonlyIsolation:true,nativeTaskIdentity:true,
      verifiedTermination:node.id!=='rusty'}),
    attestP0Result:async({node,task,cycle,commit,jobId,agentId,raw:actual,binding})=>{
      const report={taskId:task.id,cycle,jobId,commit,nodeId:node.id,
        physicalId:node.physicalId,serverId:node.serverId,
        agentId,model:node.model,harness:node.harness,binding,
        independentSession:true,osReadonlyIsolation:true,nativeTaskId:'native-'+agentId,
        rawMessage:actual,stdoutSha256:sha256(actual),exitCode:0,clean:true,
        verdict:JSON.parse(actual).verdict,summary:JSON.parse(actual).summary,findings:JSON.parse(actual).findings};
      return {report,proof:signed(node,{
        purpose:binding?'P1_P0_NODE_RESULT_V2':'P1_P0_NODE_RESULT_V1',taskId:task.id,cycle,jobId,commit,
        nodeId:node.id,physicalId:node.physicalId,serverId:node.serverId,
        agentId,model:node.model,harness:node.harness,
        ...(binding?{bindingSha256:sha256(binding)}:{}),reportSha256:sha256(report)})};
    },
    attestP0Termination:async({node,task,cycle,jobId,commit,agentId})=>signed(node,{
      purpose:'P1_P0_TERMINATION_V1',taskId:task.id,cycle,jobId,commit,
      nodeId:node.id,physicalId:node.physicalId,serverId:node.serverId,
      workspaceId:node.workspaceId,agentId,terminated:true,nativeExecutionState:'TERMINAL',
      nativeTaskId:'native-'+agentId})
  };
  const scopes=Object.fromEntries(nodes.map(node=>[node.serverId,{
    cancelAgent:async id=>{states.set(id,'idle');},
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
      metadata:{p1Transport:'direct'},enabled:true,
      source:{key:'direct'},targetDescription:'wss://private-vpn-host/ws'}))}),
    client:async id=>scopes[id]
  }};
  const store={
    artifact:(_id,name,data)=>{seen.artifacts.push(name);seen.payloads[name]=structuredClone(data);return {sha256:sha256(data),path:'/synthetic/'+name};},
    recordIntent:(id,phase,jobId)=>{assert(!journal.has(jobId));seen.intents.push(jobId);journal.set(jobId,{id:jobId,task_id:id,phase,state:'DISPATCH_INTENT'});},
    recordAck:(id,agentId)=>Object.assign(journal.get(id),{agent_id:agentId,state:'ACKNOWLEDGED'}),
    recordTerminal:id=>{seen.terminal.push(id);journal.get(id).state='TERMINAL';},
    dispatches:()=>[...journal.values()],
    event:()=>{}
  };
  const task={id:'TASKP800',frozen:{intent:'Synthetic original user request for approved independent review',souls:Object.fromEntries(['blind_a','blind_b','blind_c'].map(r=>[
    r,{text:'Read only independent audit of the frozen commit',sha256:'a'.repeat(64)}]))}};
  task.frozen.intentSha256=sha256(task.frozen.intent);
  for(const soul of Object.values(task.frozen.souls))soul.sha256=sha256(soul.text);
  return {nodes,client,attestor,roots,seen,task,store,scopes,states,signed,raw};
}
export function adapter(x,options={}){
  return new PaseoP0Adapter(x.nodes,{client:x.client,attestor:x.attestor,p0Roots:x.roots,
    pollMs:0,extraThirdMs:0,deadlineMs:2000,sleep:async()=>{},...options});
}
