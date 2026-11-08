import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {ROLE_PERMISSIONS,MAX_A,MAX_B,providerOptions,sha256} from '../src/policy.mjs';

function setup({workerFails=false,remediationFails=false,p0HasFindings=false,ambiguous=false,conflicting=false}={}) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p1-case-'));
  const roles={};const soulDir=path.join(tmp,'souls');fs.mkdirSync(soulDir);
  for(const [role] of Object.entries(ROLE_PERMISSIONS)){
    const text=`# ${role}\nThis role must follow the approved specification, review exact commits, and obey permissions. All results must carry factual evidence.\n`;
    fs.writeFileSync(path.join(soulDir,role+'.md'),text);
    if(!role.startsWith('blind_'))roles[role]={harness:role.includes('worker')||role==='spec_reviewer'||role==='tester_gate_b'?'opencode':'codex',
      model:(role.includes('worker')||role==='spec_reviewer'||role==='tester_gate_b'?'opencode':'codex')+'/model-id',soul:'souls/'+role+'.md'};
    else roles[role]={soul:'souls/'+role+'.md'};
  }
  const matrix=path.join(tmp,'matrix.json');const intent=path.join(tmp,'intent.md');
  fs.writeFileSync(matrix,JSON.stringify({schema:1,project:{repo:'repo'},runtime:{paseoUrl:'ws://127.0.0.1/ws'},tests:{commands:[['node','--test']]},roles}));
  fs.writeFileSync(intent,'Implement a precise and approved programming feature with fully independent review.');
  const store=new Store(path.join(tmp,'state'));
  let workerCount=0,remCount=0,reportCount=0,modelCalls=[];
  const runtime={execute:async x=>{
    modelCalls.push(x.role);
    if(ambiguous&&x.role==='planner')throw Error('provider lost connection after request');
    const verdict=x.role==='worker'&&workerFails?'FAIL':x.role==='worker_remediation'&&remediationFails?'FAIL':'PASS';
    return {role:x.role,phase:x.phase,agentId:`fake-agent-${modelCalls.length}`,dispatchId:'fake',verdict,summary:'fake simulation only',findings:verdict==='FAIL'?['needs fixing']:[],taskSpec:x.role==='planner'?'Build a tested feature using the approved specification and TDD.':null};
  }};
  let commitCount=0;
  const gitOps={
    head:async()=>('a'.repeat(40)),
    prepare:async()=>('a'.repeat(40)),
    commitWorktree:async()=>String(++commitCount).padStart(40,'b'),
    assertUnchanged:async()=>{},
    makeTestCheckout:async(repo,sha,dir)=>dir,
    testRun:async()=>({pass:true,receipts:[{code:0,ok:true,argv:['node','--test'],logSha256:'0'.repeat(64)}]})
  };
  const p0={review:async({commit,cycle})=>{
    reportCount++;
    const isInitial=cycle.startsWith('initial');
    const issue=(p0HasFindings&&isInitial)?['fix this defect']:[];
    return {commit,cycle,passed:issue.length===0&&!conflicting,dispute:conflicting,findings:issue,
      reports:[{nodeId:'5bao',physicalId:'physical-A',commit,verdict:conflicting?'FAIL':'PASS',findings:issue},
        {nodeId:'9bao',physicalId:'physical-B',commit,verdict:'PASS',findings:[]}]};
  }};
  const c=new WorkflowController({store,runtime,p0,gitOps});
  const create=c.create({id:'TASK1234',configFile:matrix,intentFile:intent});
  c.approve({id:'TASK1234',gate:'0.1',digest:create.digest,actor:'user',receipt:'Explicit user approval of goal and role-matrix digest.'});
  process.env.P1_LIVE_ALLOWED='YES';process.env.P1_HOST_ISOLATION_ATTESTED='YES';
  return {tmp,c,store,modelCalls,getP0Calls:()=>reportCount,gitOps};
}
async function movePastPlanning(x){
  const plan=await x.c.run('TASK1234');
  assert.equal(plan.stage,'WAIT_GATE_02');
  const t=x.c.required('TASK1234');
  x.c.approve({id:t.id,gate:'0.2',digest:t.taskSpecSha,actor:'user',receipt:'Approved the exact proposed TASK_SPEC SHA for implementation.'});
}
function finish(x){x.store.close();fs.rmSync(x.tmp,{recursive:true,force:true});}

test('happy path uses exactly one Gate A and Gate B round, skips remediation and arbitration',async()=>{
 const x=setup();try{await movePastPlanning(x);const result=await x.c.run('TASK1234');
 assert.equal(result.stage,'WAIT_GATE_59');assert.equal(result.aRound,1);assert.equal(result.bRound,1);
 assert.equal(x.getP0Calls(),1);assert(!x.modelCalls.includes('worker_remediation'));assert(!x.modelCalls.includes('arbitrator'));
 const ledger=x.store.verify('TASK1234');assert(ledger.events>10);
 x.c.approve({id:'TASK1234',gate:'5.9',digest:result.currentSha,actor:'user',receipt:'User authorizes closing P1; separate deployment remains out of scope.'});
 assert.equal(x.c.required('TASK1234').stage,'CLOSED');}finally{finish(x);}
});

test('changed Gate B commit forces P0 again on precise final SHA',async()=>{
 const x=setup({p0HasFindings:true});try{await movePastPlanning(x);const r=await x.c.run('TASK1234');
 assert.equal(r.stage,'WAIT_GATE_59');assert.equal(x.getP0Calls(),2);
 assert(x.modelCalls.includes('worker_remediation'));
 const t=x.c.required('TASK1234');assert.notEqual(t.p0Initial.commit,t.p0Final.commit);
 assert.equal(t.p0Final.commit,r.currentSha);assert.equal(t.lastB.commit,r.currentSha);
 }finally{finish(x);}
});

test('Gate A exactly ten rounds and no eleventh dispatch',async()=>{
 const x=setup({workerFails:true});try{await movePastPlanning(x);const r=await x.c.run('TASK1234');
 assert.equal(r.stage,'STOPPED_BUDGET');assert.equal(r.aRound,10);assert.equal(x.modelCalls.filter(q=>q==='worker').length,10);
 assert.equal(x.getP0Calls(),0);}finally{finish(x);}
});

test('Gate B exactly ten rounds, no reset on remediation failure',async()=>{
 const x=setup({p0HasFindings:true,remediationFails:true});try{await movePastPlanning(x);const r=await x.c.run('TASK1234');
 assert.equal(r.stage,'STOPPED_BUDGET');assert.equal(r.bRound,10);
 assert.equal(x.modelCalls.filter(q=>q==='worker_remediation').length,10);
 }finally{finish(x);}
});

test('post-dispatch ambiguous result blocks without silent redispatch',async()=>{
 const x=setup({ambiguous:true});try{await assert.rejects(()=>x.c.run('TASK1234'),/provider lost connection/);
 let t=x.c.required('TASK1234');assert.equal(t.status,'NEEDS_RECONCILIATION');
 await assert.rejects(()=>x.c.run('TASK1234'),/reconcile before dispatch/);
 assert.equal(x.modelCalls.filter(q=>q==='planner').length,1);}finally{finish(x);}
});

test('config SHA/role permissions and SQL ledger resist casual drift',async()=>{
 const x=setup();try{const t=x.c.required('TASK1234');t.frozen.policy.permissions.planner='WORKSPACE_WRITE';
 assert.throws(()=>x.store.save(t,'TAMPER'),/frozen config is immutable/);
 const raw=x.store.db.prepare('SELECT data FROM tasks WHERE id=?').get('TASK1234').data;
 x.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(raw.replace('READ_ONLY','SUPERUSER'),'TASK1234');
 assert.throws(()=>x.store.verify('TASK1234'),/state differs/);
 }finally{finish(x);}
});

test('permission policy is code-fixed and TEST_ONLY agent is read-only; no dangerous access',()=>{
 assert.equal(MAX_A,10);assert.equal(MAX_B,10);
 assert.equal(providerOptions('tester_gate_a','codex').sandbox_mode,'read-only');
 assert.equal(providerOptions('tester_gate_b','opencode').permission.edit,'deny');
 assert.equal(providerOptions('worker','opencode').permission.external_directory,'deny');
 assert.equal(providerOptions('spec_reviewer','opencode').permission.bash,'deny');
});

test('human gate requires precise digest and explicit approval text',()=>{
 const x=setup();try{assert.throws(()=>x.c.approve({id:'TASK1234',gate:'0.2',digest:'f'.repeat(64),actor:'user',receipt:'User approved the wrong SHA.'}),/gate not awaiting/);
 }finally{finish(x);}
});

test('real config/ and souls/ sibling layout freezes without path escape',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p1-layout-'));
 const configdir=path.join(tmp,'config'); const soulsdir=path.join(tmp,'souls');
 fs.mkdirSync(configdir); fs.mkdirSync(soulsdir);
 const roles={};
 for(const role of Object.keys(ROLE_PERMISSIONS)){
   fs.writeFileSync(path.join(soulsdir,`${role}.md`),`# ${role}\nApproved role instructions for this stage with fixed duties and immutable evidence contracts.\n`);
   roles[role]={soul:`../souls/${role}.md`};
   if(!role.startsWith('blind_'))Object.assign(roles[role],{harness:'codex',model:'codex/approved-model'});
 }
 const cf=path.join(configdir,'matrix.json'),intent=path.join(configdir,'intent.md');
 fs.writeFileSync(cf,JSON.stringify({schema:1,project:{repo:'../source',baseRef:'HEAD'},tests:{commands:[['node','--test']]},roles}));
 fs.writeFileSync(intent,'The human-approved intent is a documented test feature with independent review.');
 const store=new Store(path.join(tmp,'state'));
 try{
   const c=new WorkflowController({store,runtime:null,p0:null});
   const res=c.create({id:'TASK5678',configFile:cf,intentFile:intent});
   assert.equal(res.stage,'WAIT_GATE_01');
   assert.equal(Object.keys(c.required('TASK5678').frozen.souls).length,11);
 }finally{store.close();fs.rmSync(tmp,{recursive:true,force:true});}
});
