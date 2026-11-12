import test from 'node:test';
import assert from 'node:assert/strict';
import {PaseoP0Adapter,validatedEndpoint,p0Eligibility,verifyPaseoP0Envelope} from '../src/p0_paseo.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {sha256,assertP0Summary,providerOptions} from '../src/policy.mjs';
import {mock,adapter} from './s0_p0_fixtures.mjs';

const commit='a'.repeat(40),cycle='initial-A1';
const review=(x,a=adapter(x))=>a.review({task:x.task,commit,cycle,taskSpec:'Frozen synthetic requirement',store:x.store});
const never=()=>new Promise(()=>{});
function termination(x,{fail=false,ackLost=false,witnessNever=false}={}){
  const pre=x.attestor.attestP0Preflight;
  x.attestor.attestP0Preflight=async args=>{
    const proof=await pre(args);
    return x.signed(args.node,{...proof.statement,verifiedTermination:true});
  };
  x.seen.cancelled=[];
  x.scopes.srv_rusty.cancelAgent=async id=>{
    x.seen.cancelled.push(id);
    if(fail)throw Error('cancel ACK lost');
    x.states.set(id,'idle');
    if(ackLost)throw Error('cancel applied but ACK lost');
  };
  x.attestor.attestP0Termination=witnessNever?never:async({node,task,cycle,jobId,commit,agentId})=>
    x.signed(node,{purpose:'P1_P0_TERMINATION_V1',taskId:task.id,cycle,jobId,commit,
      nodeId:node.id,physicalId:node.physicalId,serverId:node.serverId,
      workspaceId:node.workspaceId,agentId,terminated:true,nativeExecutionState:'TERMINAL',nativeTaskId:'native-'+agentId});
}
test('S0 R1/R5: 5bao+9bao mainline succeeds while rusty is P0_INELIGIBLE',async()=>{
  const x=mock();x.nodes[2].harness='rustyhand';x.nodes[2].model='rustyhand/unapproved';
  x.nodes[2].eligibility={status:'P0_INELIGIBLE'};
  const r=await review(x);assert.equal(r.quorum.validReportCount,2);
  assert.equal(r.passed,true);assert.equal(r.execution.state,'CLOSED');
  assert.deepEqual(r.reports.map(r=>r.nodeId),['5bao','9bao']);
  assert.equal(r.skipped.find(s=>s.nodeId==='rusty').eligibility,'P0_INELIGIBLE');
  assert.equal(x.seen.created.length,2);
  assert.throws(()=>providerOptions('blind_c','rustyhand'),/unsupported harness/);
});
test('S0 R1/R5: missing independently witnessed OS isolation cannot count as a third seat',async()=>{
  const x=mock();termination(x);
  const pre=x.attestor.attestP0Preflight;
  x.attestor.attestP0Preflight=async args=>{
    const p=await pre(args);return x.signed(args.node,{...p.statement,osReadonlyIsolation:args.node.id!=='rusty'});
  };
  const r=await review(x);assert.equal(r.quorum.validReportCount,2);
  assert.equal(r.reports.some(r=>r.nodeId==='rusty'),false);
  assert.equal(x.seen.created.some(j=>j.serverId==='srv_rusty'),false);
});
test('S0 R1: 9bao+fully qualified simulated rusty form quorum when 5bao preflight is unavailable',async()=>{
  const x=mock({thirdRunning:false});termination(x);
  const hosts=x.client.hosts.client;
  x.client.hosts.client=async id=>{if(id==='srv_5bao')throw Error('unavailable');return hosts(id);};
  const r=await review(x);assert.deepEqual(r.reports.map(r=>r.nodeId),['9bao','rusty']);
  assert.equal(r.quorum.established,true);assert.equal(r.execution.state,'CLOSED');
});
test('S0 R1: a lone eligible physical node cannot start paid dispatch',async()=>{
  const x=mock();x.nodes[2].eligibility={status:'P0_INELIGIBLE'};
  x.scopes.srv_9bao.workspaces.ref=()=>({refresh:async()=>{throw Error('unavailable');}});
  await assert.rejects(()=>review(x),/requires 2 authenticated/);
  assert.equal(x.seen.created.length,0);
});
test('S0 R2: exactly 600000ms after quorum, third execution is cancelled and independently read back',async()=>{
  const x=mock();termination(x);let now=0;const waits=[];
  const r=await review(x,adapter(x,{clock:()=>now,deadlineMs:7200000,extraThirdMs:600000,pollMs:200000,
    sleep:async ms=>{waits.push(ms);now+=ms;}}));
  assert.equal(now,600000);assert.equal(r.quorum.establishedAt,0);
  assert.equal(r.quorum.validReportCount,2);assert.equal(r.cancelled.length,1);
  assert.equal(r.execution.state,'CLOSED');assert.deepEqual(waits,[200000,200000,200000]);
  assert.equal(x.seen.created.length,3);assert.equal(x.seen.terminal.length,3);
  assert.deepEqual(x.seen.cancelled,['agent-rusty']);
  assert.throws(()=>adapter(x,{extraThirdMs:600001}),/600000ms/);
});
test('S0 R2: cancel failure retains technical quorum but execution remains NEEDS_RECONCILIATION',async()=>{
  const x=mock();termination(x,{fail:true});
  const r=await review(x);assert.equal(r.quorum.established,true);assert.equal(r.passed,true);
  assert.equal(r.execution.state,'NEEDS_RECONCILIATION');
  assert.equal(r.execution.jobs.find(j=>j.nodeId==='rusty').state,'UNKNOWN');
  assert.equal(x.seen.terminal.length,2);assert.equal(r.cancelled.length,0);
});
test('S0 R2: lost cancel ACK is accepted only after signed native termination proof',async()=>{
  const x=mock();termination(x,{ackLost:true});
  const r=await review(x);assert.equal(r.execution.state,'CLOSED');
  assert.equal(r.cancelled[0].cancelAck,'UNKNOWN');
  assert.equal(x.seen.terminal.length,3);
});
test('S0 R3: third create ACK loss does not erase valid quorum or fabricate a terminal execution',async()=>{
  const x=mock();termination(x);
  x.scopes.srv_rusty.agents.create=async opts=>{x.seen.created.push({serverId:'srv_rusty',opts});throw Error('ACK lost');};
  const r=await review(x);assert.equal(r.quorum.established,true);
  const job=r.execution.jobs.find(j=>j.nodeId==='rusty');
  assert.equal(job.agentId,null);assert.equal(job.state,'UNKNOWN');
  assert.equal(r.execution.state,'NEEDS_RECONCILIATION');
  assert.equal(x.store.dispatches().find(d=>d.id===job.jobId).state,'DISPATCH_INTENT');
});
test('S0 R3: expired create retains immutable intent and a second call never recreates its Job ID',async()=>{
  const x=mock();x.scopes.srv_5bao.agents.create=never;
  await assert.rejects(()=>review(x,adapter(x,{callTimeoutMs:15})),/deadline exceeded: create/);
  const ids=x.store.dispatches();assert.equal(ids.length,1);assert.equal(ids[0].state,'DISPATCH_INTENT');
  await assert.rejects(()=>review(x),/existing P0 dispatch/);assert.equal(x.seen.intents.length,1);
});
test('S0 R4: two different physical hosts may share cwd AND daemon-scoped Workspace ID',async()=>{
  const x=mock();x.nodes[0].cwd=x.nodes[1].cwd='/srv/same';
  x.nodes[0].workspaceId=x.nodes[1].workspaceId='workspace_local';
  const r=await review(x);assert.equal(r.quorum.validReportCount,2);assert.equal(r.passed,true);
});
test('S0 R4: Tailscale requires exact approved endpoint, encryption and application password',()=>{
  const node={paseoUrl:'ws://100.100.88.100:6767/ws',passwordEnv:'PASEO_RUSTY_PASSWORD'};
  assert.throws(()=>validatedEndpoint(node),/explicitly approved encrypted/);
  assert.throws(()=>validatedEndpoint({...node,paseoUrl:'wss://100.100.88.100:6767/ws'}),/explicitly approved encrypted/);
  node.network={transport:'tailscale',encrypted:true,applicationPassword:true,approvedEndpoint:node.paseoUrl};
  assert.equal(validatedEndpoint(node),node.paseoUrl);
  for(const change of [{encrypted:false},{applicationPassword:false},{approvedEndpoint:'ws://100.100.88.5:6767/ws'}])
    assert.throws(()=>validatedEndpoint({...node,network:{...node.network,...change}}),/explicitly approved encrypted/);
  assert.throws(()=>validatedEndpoint({...node,paseoUrl:'ws://1.1.1.1:6767/ws'}),/unencrypted/);
});
for(const field of ['serverId','workspaceId','commit','osReadonlyIsolation','nativeTaskIdentity'])
test('S0 R4/R6: independently signed wrong preflight '+field+' is rejected before dispatch',async()=>{
  const x=mock(),pre=x.attestor.attestP0Preflight;
  x.nodes[2].enabled=false;
  x.attestor.attestP0Preflight=async args=>{
    const p=await pre(args);return x.signed(args.node,{...p.statement,[field]:field.includes('Isolation')||field==='nativeTaskIdentity'?false:'wrong'});
  };
  await assert.rejects(()=>review(x),/requires 2 authenticated/);assert.equal(x.seen.created.length,0);
});
for(const verdict of ['FAIL','QUESTION','NEEDS_SPECIALIST'])
test('S0 R7: valid third '+verdict+' is preserved for independent Arbitrator; never majority PASS',async()=>{
  const x=mock({thirdRunning:false});termination(x);
  const old=x.scopes.srv_rusty.agents.ref;
  x.scopes.srv_rusty.agents.ref=id=>({...old(id),waitForFinish:async()=>({status:'idle',
    lastMessage:JSON.stringify({verdict,summary:'Independent synthetic disagreement',findings:['HIGH: source evidence needs resolution']})})});
  const r=await review(x,adapter(x,{extraThirdMs:600000}));
  assert.equal(r.reports.length,3);assert.equal(r.passed,false);assert.equal(r.dispute,true);
  assert.equal(r.requiresArbitrator,true);assert.equal(r.execution.state,'CLOSED');
  assert.equal(r.reports[2].verdict,verdict);assertP0Summary(r);
});
test('S0 R7: two valid reports with conflicting technical opinions require Arbitrator',async()=>{
  const x=mock();x.nodes[2].enabled=false;
  const old=x.scopes.srv_9bao.agents.ref;
  x.scopes.srv_9bao.agents.ref=id=>({...old(id),waitForFinish:async()=>({status:'idle',
    lastMessage:JSON.stringify({verdict:'FAIL',summary:'Synthetic code defect',findings:['HIGH: inspect source']})})});
  const r=await review(x);assert.equal(r.quorum.established,true);
  assert.equal(r.passed,false);assert.equal(r.dispute,true);assert.equal(r.requiresArbitrator,true);
});
for(const operation of ['host-directory','host-client','workspace','preflight-witness','create','status','finish','result-witness','close','poll','cancel','termination-witness'])
test('S0 R3: permanently unresponsive '+operation+' is bounded by deadline',async()=>{
  const x=mock();const a=adapter(x,{callTimeoutMs:10});
  await assert.rejects(()=>a.call(operation,never),/deadline exceeded/);
});
for(const operation of ['workspace','preflight-witness','status','finish','result-witness','close'])
test('S0 R3: real adapter path bounds hanging '+operation,async()=>{
  const x=mock();x.nodes[2].enabled=false;
  for(const remote of Object.values(x.scopes)){
    if(operation==='workspace')remote.workspaces.ref=()=>({refresh:never});
    if(operation==='status')remote.agents.ref=()=>({refresh:never});
    if(operation==='finish'){const ref=remote.agents.ref;remote.agents.ref=id=>({...ref(id),waitForFinish:never});}
    if(operation==='close')remote.dispose=never;
  }
  if(operation==='preflight-witness')x.attestor.attestP0Preflight=never;
  if(operation==='result-witness')x.attestor.attestP0Result=never;
  const run=review(x,adapter(x,{callTimeoutMs:10}));
  if(operation==='close')assert.equal((await run).quorum.established,true);
  else await assert.rejects(()=>run,/requires 2 authenticated|physical quorum invalid/);
});
test('S0 R7: Controller persists quorum separately and refuses advancement with unknown paid execution',async()=>{
  const x=mock();termination(x,{fail:true});const summary=await review(x);
  const t={...x.task,stage:'P0_INITIAL',status:'READY',currentSha:commit,history:[]};
  const saves=[],artifacts=[];
  const store={save:(_t,type)=>saves.push(type),artifact:(_id,name,value)=>{
    artifacts.push({name,value});return {sha256:sha256(value)};}};
  const controller=new WorkflowController({store,p0:{review:async()=>summary}});
  controller.auditRole=async()=>({auditSessionId:'synthetic-only'});
  await assert.rejects(()=>controller.p0Review(t,cycle),/NEEDS_RECONCILIATION/);
  assert.equal(t.status,'NEEDS_RECONCILIATION');assert.equal(t.blockedStage,'P0_INITIAL');
  assert.equal(saves.includes('P0_COMPLETE'),false);
  assert.equal(artifacts.find(a=>a.name.endsWith('-summary.json')).value.quorum.established,true);
});

for(const operation of ['poll','cancel','cancel-readback','termination-witness'])
test('S0 R3: actual third-seat '+operation+' hang retains quorum and a bounded closeout result',async()=>{
  const x=mock();termination(x,{witnessNever:operation==='termination-witness'});
  if(operation==='cancel')x.scopes.srv_rusty.cancelAgent=never;
  if(operation==='cancel-readback'){
    const ref=x.scopes.srv_rusty.agents.ref;
    x.scopes.srv_rusty.agents.ref=id=>({...ref(id),refresh:()=>
      x.seen.cancelled.length?never():ref(id).refresh()});
  }
  let now=0;
  const r=await review(x,adapter(x,{callTimeoutMs:10,clock:()=>now,extraThirdMs:600000,
    deadlineMs:7200000,pollMs:operation==='poll'?1:600000,sleep:operation==='poll'?never:async ms=>{now+=ms;}}));
  assert.equal(r.quorum.established,true);assert.equal(r.quorum.validReportCount,2);
  assert.equal(r.execution.state,operation==='poll'?'CLOSED':'NEEDS_RECONCILIATION');
  if(operation!=='poll')assert.equal(r.execution.jobs.find(j=>j.nodeId==='rusty').state,'UNKNOWN');
});

for(const unready of ['missing-identity','duplicate-identity'])
test('S0 R1/R4: optional '+unready+' does not invalidate qualified 5bao+9bao identities',async()=>{
  const x=mock();
  if(unready==='missing-identity')delete x.nodes[2].physicalId;
  else x.nodes[2].physicalId=x.nodes[0].physicalId;
  const r=await review(x);assert.equal(r.quorum.validReportCount,2);
  assert.equal(r.execution.state,'CLOSED');assert.equal(x.seen.created.length,2);
  assert.equal(r.skipped.find(s=>s.nodeId==='rusty').eligibility,'P0_INELIGIBLE');
});
