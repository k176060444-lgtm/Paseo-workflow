import test from 'node:test';
import assert from 'node:assert/strict';
import {mock,adapter} from './s0_p0_fixtures.mjs';
import {WorkflowController} from '../src/controller.mjs';

const commit='a'.repeat(40);
const never=()=>new Promise(()=>{});
const review=(x,a)=>a.review({task:x.task,commit,cycle:'initial-A1',taskSpec:'Synthetic requirement',store:x.store});
for(const method of ['list','client'])
test('S0 deadline routes: hanging Hosts '+method+' cannot block collection forever',async()=>{
  const x=mock();x.client.hosts[method]=never;
  await assert.rejects(()=>review(x,adapter(x,{callTimeoutMs:10})),/requires 2 authenticated/);
  assert.equal(x.seen.created.length,0);
});
test('S0 deadline routes: hanging direct connection is bounded without dispatch',async()=>{
  const x=mock(),n=x.nodes[0];n.paseoUrl='ws://192.168.5.6:6767/ws';n.passwordEnv='PASEO_SYNTHETIC_PASSWORD';
  const prior=process.env[n.passwordEnv];process.env[n.passwordEnv]='synthetic-only';
  try{
    await assert.rejects(()=>review(x,adapter(x,{callTimeoutMs:10,directClientFactory:never})),/requires 2 authenticated/);
    assert.equal(x.seen.created.length,0);
  }finally{if(prior===undefined)delete process.env[n.passwordEnv];else process.env[n.passwordEnv]=prior;}
});
test('S0 deadline routes: late create ACK is not reused as an authorized recreation',async()=>{
  const x=mock();let resolve;
  x.scopes.srv_5bao.agents.create=()=>new Promise(r=>{resolve=r;});
  await assert.rejects(()=>review(x,adapter(x,{callTimeoutMs:10})),/deadline exceeded: create/);
  resolve({id:'late-original-agent'});
  await assert.rejects(()=>review(x,adapter(x)),/existing P0 dispatch/);
  assert.equal(x.store.dispatches().length,1);
  assert.equal(x.store.dispatches()[0].state,'DISPATCH_INTENT');
});
test('S0 R7: pending native technical ruling reaches Tester B then Arbitrator before Worker remediation',async()=>{
  const saves=[],controller=new WorkflowController({store:{save:(_t,type)=>saves.push(type)}});
  controller.compliance=()=>true;
  const t={stage:'B_ENTER',status:'READY',currentSha:commit,bRound:0,bFindings:['HIGH: disputed'],history:[],
    p0Initial:{commit,requiresArbitrator:true},p0Final:null};
  await controller.step(t);assert.equal(t.stage,'B_TEST');assert.equal(t.bRound,0);
  controller.test=async()=>({pass:true,agent:{verdict:'PASS'},tests:{pass:true},commit});
  t.p0Dispute=true;await controller.step(t);assert.equal(t.stage,'ARBITRATOR');
  // A real rejected Arbitrator result permits the normal remediation loop.
  t.stage='B_ENTER';t.history.push({role:'arbitrator',sha:commit});
  await controller.step(t);assert.equal(t.stage,'B_WORKER');
  assert.deepEqual(saves,['B_REMEDIATION_SKIPPED','ARBITRATOR_TRIGGERED','B_REMEDIATION_REQUIRED']);
});
