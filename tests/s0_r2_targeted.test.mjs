// Narrow regression checks for the independently reported S0 failures.
// Synthetic SDK/Witness only; these tests never connect to a daemon or invoke a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PaseoP0Adapter} from '../src/p0_paseo.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {describeP0Reconciliation} from '../src/p0_reconciliation.mjs';
import {PaseoAgentRuntime} from '../src/agents.mjs';
import {mock,adapter} from './s0_p0_fixtures.mjs';

const review=x=>adapter(x).review({task:x.task,commit:'a'.repeat(40),
  taskSpec:'Fixed synthetic independent review requirements',store:x.store,cycle:'initial-A1'});

test('S0-R2: initializing is nonterminal; it must keep polling the same Agent',async()=>{
  const x=mock();x.nodes[2].enabled=false;
  const ref=x.scopes.srv_5bao.agents.ref;let reads=0;
  x.scopes.srv_5bao.agents.ref=id=>({
    ...ref(id),refresh:async()=>({agent:{id,status:['initializing','running','idle'][Math.min(reads++,2)]}})});
  const result=await review(x);
  assert.equal(result.quorum.established,true);
  assert.equal(result.execution.state,'CLOSED');
  assert.equal(result.reports.length,2);
  assert(reads>=3);
});

test('S0-R2: a later primary create failure closes any earlier known paid Agent',async()=>{
  const x=mock();x.nodes[2].enabled=false;
  const cancel=x.scopes.srv_5bao.cancelAgent;let cancellations=0;
  x.scopes.srv_5bao.cancelAgent=async id=>{cancellations++;return cancel(id);};
  x.scopes.srv_9bao.agents.create=async()=>{throw Error('SECOND_PRIMARY_CREATE_FAILED');};
  await assert.rejects(review(x),/SECOND_PRIMARY_CREATE_FAILED/);
  assert.equal(cancellations,1,'earlier acknowledged Agent must receive cancel');
  assert.equal(x.store.dispatches().filter(d=>d.state==='TERMINAL').length,1);
  assert.equal(x.store.dispatches().filter(d=>d.state==='DISPATCH_INTENT').length,1);
  assert(x.seen.artifacts.includes('p0-initial-A1-incomplete.json'));
  assert.equal(x.seen.payloads['p0-initial-A1-incomplete.json'].execution.state,
    'NEEDS_RECONCILIATION');
});

test('S0-R2: no primary paid dispatch without separately witnessed termination capability',async()=>{
  const x=mock();x.nodes[2].enabled=false;
  const pre=x.attestor.attestP0Preflight;
  x.attestor.attestP0Preflight=async args=>{
    const signed=await pre(args);
    return x.signed(args.node,{...signed.statement,verifiedTermination:false});
  };
  await assert.rejects(review(x),/termination capability/);
  assert.equal(x.seen.created.length,0);
});

test('S0-R2: definite zero-dispatch preflight failure is BLOCKED, not UNKNOWN',async()=>{
  const x=mock();
  const t={id:x.task.id,stage:'P0_INITIAL',status:'READY',currentSha:'a'.repeat(40),
    worktree:'/synthetic'};
  const records=[];
  const controller={
    store:{save:(...args)=>records.push(args),dispatches:()=>[]},
    auditRole:async()=>({auditSessionId:'synthetic-audit'}),
    p0:{review:async()=>{throw Error('only one eligible node');}},
    markExecutionUncertain:()=>{throw Error('must not mark a zero-dispatch failure as uncertain');}
  };
  await assert.rejects(
    WorkflowController.prototype.p0Review.call(controller,t,'initial-A1'),
    /only one eligible node/);
  assert.equal(t.stage,'BLOCKED');
  assert.equal(t.status,'BLOCKED');
  assert.equal(t.inflight,null);
  assert.equal(records.at(-1)[1],'P0_PRE_DISPATCH_BLOCKED');
});

test('S0-R2: actual SDK DaemonClient constructor accepts a nonempty clientId',async t=>{
  let DaemonClient;
  try{({DaemonClient}=await import('@getpaseo/client/internal/daemon-client'));}
  catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'){t.skip('installed SDK unavailable; runtime contract not verified');return;}throw e;}
  const driver=new DaemonClient({
    url:'ws://127.0.0.1:6767/ws',password:'synthetic-test-not-a-secret',
    clientId:'p1-controller-synthetic-sdk-check',connectTimeoutMs:500,
    reconnect:{enabled:false},logger:{debug(){},info(){},warn(){},error(){}}
  });
  assert(driver,'constructor rejected valid clientId');
  await driver.close();
});

test('S0-R2: a Registered Host with SSH source is never connected for P0',async()=>{
  const x=mock();let connected=0;
  x.client.hosts.list=async()=>({hosts:x.nodes.map(n=>({
    registrationId:n.registrationId,serverId:n.serverId,enabled:true,
    metadata:{p1Transport:'ssh'},source:{id:'source-'+n.id,key:'550e8400-e29b-41d4-a716-446655440000'},
    targetDescription:'ssh://forbidden-host'
  }))});
  x.client.hosts.client=async()=>{connected++;throw Error('must not connect SSH');};
  await assert.rejects(review(x),/requires 2 authenticated/);
  assert.equal(connected,0);
  assert.equal(x.seen.created.length,0);
});

test('S0-R2: realistic Connected Host source UUID is metadata, not transport',async()=>{
  const x=mock();x.nodes[2].enabled=false;
  const r=await review(x);
  assert.equal(r.quorum.established,true);
  assert.equal(x.seen.created.length,2);
});
test('S0-R2: cancelled execution retains stage and signed proof if cancel artifact fails',async()=>{
  const x=mock();x.nodes[2].enabled=false;
  x.scopes.srv_9bao.agents.create=async()=>{throw Error('CREATE_FAILED');};
  const artifact=x.store.artifact;
  x.store.artifact=(id,name,body)=>{
    if(name.endsWith('-5bao-cancel.json'))throw Error('CANCEL_ARTIFACT_IO_FAILURE');
    return artifact(id,name,body);
  };
  await assert.rejects(review(x),/CREATE_FAILED/);
  const incomplete=x.seen.payloads['p0-initial-A1-incomplete.json'];
  const first=incomplete.execution.jobs.find(j=>j.nodeId==='5bao');
  assert.equal(first.state,'UNKNOWN');
  assert.equal(first.terminateStage,'cancel-evidence');
  assert.equal(first.cleanupError,'CANCEL_ARTIFACT_IO_FAILURE');
  assert.equal(first.cancelEvidenceWriteFailed,true);
  assert.equal(first.verifiedTerminationProof.statement.agentId,'agent-5bao');
  assert.equal(x.store.dispatches().find(j=>j.phase.endsWith(':5bao')).state,'ACKNOWLEDGED');
});
test('S0-R2: termination witness rejects mismatched known original nativeTaskId',async()=>{
  const x=mock();x.nodes[2].enabled=false;
  const create=x.scopes.srv_5bao.agents.create;
  x.scopes.srv_5bao.agents.create=async opts=>({...await create(opts),nativeTaskId:'original-task'});
  x.scopes.srv_9bao.agents.create=async()=>{throw Error('CREATE_FAILED');};
  await assert.rejects(review(x),/CREATE_FAILED/);
  const first=x.seen.payloads['p0-initial-A1-incomplete.json'].execution.jobs.find(j=>j.nodeId==='5bao');
  assert.equal(first.state,'UNKNOWN');
  assert.match(first.cleanupError,/nativeTaskId/);
});

test('S0-R2 F6: no local ACK and no remote record remain UNKNOWN',()=>{
  const r=describeP0Reconciliation({agent_id:null,state:'DISPATCH_INTENT'},[],'srv_5bao');
  assert.equal(r.consistent,false);
  assert.equal(r.outcome,'UNKNOWN_ACK');
  assert.equal(r.manualReconciliationRequired,true);
  const observed=describeP0Reconciliation({agent_id:null},[{id:'orphan'}],'srv_5bao');
  assert.equal(observed.consistent,false);
  assert.equal(observed.outcome,'UNACKNOWLEDGED_REMOTE_MATCH');
  const matched=describeP0Reconciliation({agent_id:'srv_5bao:agent-1'},
    [{id:'agent-1'}],'srv_5bao');
  assert.equal(matched.consistent,true);
  assert.equal(matched.outcome,'IDENTIFIED_NOT_RECOVERED');
});

test('S0-R2 F12: hung local create is bounded with immutable Intent and no retry',async()=>{
  const runtime=new PaseoAgentRuntime('ws://127.0.0.1:6767/ws',{createTimeoutMs:15});
  let creates=0,intents=0,acks=0;
  runtime.client={agents:{create:async()=>{creates++;return new Promise(()=>{});}}};
  const task={id:'TASKR2',currentSha:'a'.repeat(40),
    frozen:{roles:{worker:{model:'opencode/approved',harness:'opencode'}},
      souls:{worker:{text:'synthetic-test-only',sha256:'a'.repeat(64)}}}};
  const store={recordIntent:()=>{intents++;},recordAck:()=>{acks++;}};
  await assert.rejects(runtime.execute({
    task,role:'worker',phase:'A1-worker',cwd:'/synthetic',prompt:'test',
    store
  }),/deadline exceeded: local agent create/);
  assert.equal(creates,1);
  assert.equal(intents,1);
  assert.equal(acks,0);
});
