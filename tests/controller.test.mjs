import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign,createHmac,randomUUID} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {ROLE_PERMISSIONS,MAX_A,MAX_B,providerOptions,sha256,canonical} from '../src/policy.mjs';
import {verifyCommitEvidenceSync} from '../src/git.mjs';

function setup({workerFails=false,remediationFails=false,p0HasFindings=false,ambiguous=false,conflicting=false}={}) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p1-case-'));
  const g=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim();
  const repo=path.join(tmp,'repo');fs.mkdirSync(repo);
  g(repo,'init','-q');
  fs.writeFileSync(path.join(repo,'source.txt'),'synthetic baseline');
  g(repo,'add','.');
  g(repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','baseline');
  const keys=generateKeyPairSync('ed25519');
  const witness=generateKeyPairSync('ed25519');
  const manifest=path.join(tmp,'public-trust.json');
  fs.writeFileSync(manifest,JSON.stringify({schema:1,human:{
    'offline-auditor':keys.publicKey.export({format:'pem',type:'spki'})},
    execution:{'offline-execution-witness':witness.publicKey.export({format:'pem',type:'spki'})}}));
  const prevTrustFile=process.env.P1_TRUST_ROOTS_FILE;
  const prevTrustHash=process.env.P1_TRUST_ROOTS_SHA256;
  process.env.P1_TRUST_ROOTS_FILE=manifest;
  process.env.P1_TRUST_ROOTS_SHA256=sha256(fs.readFileSync(manifest,'utf8'));
  // TEST-ONLY external witness. Production Controller never receives this
  // signing key and cannot manufacture execution attestation signatures.
  function attest(fields){
    const statement={purpose:'P1_EXECUTION_ATTESTATION_V1',...fields,
      nonce:randomUUID(),issuedAt:new Date().toISOString()};
    return {schema:1,keyId:'offline-execution-witness',statement,
      signature:sign(null,Buffer.from(canonical(statement)),witness.privateKey).toString('base64')};
  }
  function proof(gate,digest,receipt,actor='user'){
    const statement={purpose:'P1_HUMAN_GATE_V1',taskId:'TASK1234',gate,digest,
      actor,receipt,nonce:randomUUID(),issuedAt:new Date().toISOString(),
      ...(gate==='5.9'?{
        evidenceSha256:store.evidenceDigest('TASK1234','final-compliance.json'),
        evidenceRoot:store.evidenceRoot('TASK1234')
      }:{})};
    return {schema:1,keyId:'offline-auditor',statement,
      signature:sign(null,Buffer.from(canonical(statement)),keys.privateKey).toString('base64')};
  }
  const roles={};const soulDir=path.join(tmp,'souls');fs.mkdirSync(soulDir);
  for(const [role] of Object.entries(ROLE_PERMISSIONS)){
    const text=`# ${role}\nThis role must follow the approved specification, review exact commits, and obey permissions. All results must carry factual evidence.\n`;
    fs.writeFileSync(path.join(soulDir,role+'.md'),text);
    if(!role.startsWith('blind_'))roles[role]={harness:role.includes('worker')||role==='spec_reviewer'||role==='tester_gate_b'?'opencode':'codex',
      model:(role.includes('worker')||role==='spec_reviewer'||role==='tester_gate_b'?'opencode':'codex')+'/model-id',soul:'souls/'+role+'.md'};
    else roles[role]={soul:'souls/'+role+'.md'};
  }
  const nodes=['5bao','9bao'].map((id,i)=>{
    const file=path.join(tmp,'p0-'+id+'.hmac');
    fs.writeFileSync(file,Buffer.alloc(48,0x43+i));
    return {id,physicalId:'physical-'+id,sshAlias:id,harness:'opencode',
      model:'opencode/model',hmacKeyPath:file,enabled:true,role:i===0?'blind_a':'blind_b',
      runner:'/runner',config:'/config'};
  });
  const matrix=path.join(tmp,'matrix.json');const intent=path.join(tmp,'intent.md');
  fs.writeFileSync(matrix,JSON.stringify({schema:1,project:{repo:'repo'},runtime:{paseoUrl:'ws://127.0.0.1/ws'},tests:{commands:[['node','--test']]},roles,p0:{transport:'legacy-hmac',nodes}}));
  fs.writeFileSync(intent,'Implement a precise and approved programming feature with fully independent review.');
  const store=new Store(path.join(tmp,'state'));
  let workerCount=0,remCount=0,reportCount=0,modelCalls=[];
  const runtime={execute:async x=>{
    modelCalls.push(x.role);
    const number=modelCalls.length,dispatchId='mock-'+number,agentId='fake-agent-'+number;
    x.store.recordIntent(x.task.id,x.phase,dispatchId);
    if(ambiguous&&x.role==='planner')throw Error('provider lost connection after request');
    x.store.recordAck(dispatchId,agentId);
    const verdict=x.role==='worker'&&workerFails?'FAIL':
      x.role==='worker_remediation'&&remediationFails?'FAIL':'PASS';
    x.store.recordTerminal(dispatchId);
    const base={role:x.role,phase:x.phase,agentId,dispatchId,verdict,
      summary:'synthetic test runtime only',findings:verdict==='FAIL'?['needs fixing']:[],
      taskSpec:x.role==='planner'?'Build a tested feature using the approved specification and TDD.':null};
    const attestation=attest({taskId:x.task.id,role:x.role,phase:x.phase,
      commit:x.task.currentSha??null,agentId,dispatchId,rawSha256:sha256(base)});
    return {...base,attestation};
  }};
  let commitCount=0;
  const gitOps={
    head:async dir=>g(dir,'rev-parse','HEAD'),
    prepare:async (source,base,dir)=>{
      const sha=g(source,'rev-parse',base+'^{commit}');
      fs.mkdirSync(path.dirname(dir),{recursive:true});
      g(source,'worktree','add','--detach',dir,sha);
      return sha;
    },
    commitWorktree:async dir=>{
      fs.writeFileSync(path.join(dir,'source.txt'),'synthetic edit '+(++commitCount));
      g(dir,'add','.');
      g(dir,'-c','user.name=Test','-c','user.email=test@localhost',
        'commit','-qm','synthetic worker commit '+commitCount);
      return g(dir,'rev-parse','HEAD');
    },
    assertUnchanged:async (dir,sha)=>{assert.equal(g(dir,'rev-parse','HEAD'),sha);},
    makeTestCheckout:async (source,sha,dir)=>{
      fs.mkdirSync(path.dirname(dir),{recursive:true});
      g(source,'worktree','add','--detach',dir,sha);return dir;
    },
    verifyCommitEvidenceSync,
    testRun:async (dir,commands,store,id,phase)=>{
      const sha=g(dir,'rev-parse','HEAD');
      const bare={pass:true,receipts:[{code:0,ok:true,argv:['node','--test'],logSha256:'0'.repeat(64)}]};
      return {...bare,attestation:attest({taskId:id,role:'test_executor',phase,
        commit:sha,agentId:'',dispatchId:'',
        rawSha256:sha256({sha,tests:bare})})};
    }
  };
  const p0={review:async({task,commit,cycle,store})=>{
    reportCount++;
    const isInitial=cycle.startsWith('initial');
    const issue=p0HasFindings&&isInitial?['fix this defect']:[];
    const reports=[];
    for(const node of nodes){
      const jobId=sha256(task.id+':'+cycle+':'+commit+':'+node.id).slice(0,40);
      store.recordIntent(task.id,'P0:'+cycle+':'+node.id,jobId);
      store.recordAck(jobId,node.id+':'+jobId);
      const verdict=(conflicting&&node.id==='5bao')||issue.length?'FAIL':'PASS';
      const findings=verdict==='FAIL'?['HIGH: reviewer disagreed']:issue;
      const body={jobId,nodeId:node.id,physicalId:node.physicalId,commit,
        harness:node.harness,model:node.model,exitCode:0,clean:true,
        stdoutSha256:'f'.repeat(64),verdict,summary:'synthetic P0 signed result',
        findings};
      const mac=createHmac('sha256',fs.readFileSync(node.hmacKeyPath))
        .update(canonical(body)).digest('hex');
      const evidence=store.artifact(task.id,'p0-'+cycle+'-'+node.id+'-result.json',{body,mac});
      store.recordTerminal(jobId);
      reports.push({...body,evidence});
    }
    const findings=reports.flatMap(r=>r.findings);
    return {commit,cycle,reports,findings,passed:findings.length===0&&!conflicting,
      dispute:conflicting,skipped:[],cancelled:[]};
  }};
  const c=new WorkflowController({store,runtime,p0,gitOps});
  const create=c.create({id:'TASK1234',configFile:matrix,intentFile:intent});
  const receipt01='Explicit user approval of goal and role-matrix digest.';
  c.approve({id:'TASK1234',gate:'0.1',digest:create.digest,actor:'user',
    receipt:receipt01,proof:proof('0.1',create.digest,receipt01)});
  process.env.P1_LIVE_ALLOWED='YES';process.env.P1_HOST_ISOLATION_ATTESTED='YES';
  return {tmp,c,store,modelCalls,getP0Calls:()=>reportCount,gitOps,proof,prevTrustFile,prevTrustHash};
}
async function movePastPlanning(x){
  const plan=await x.c.run('TASK1234');
  assert.equal(plan.stage,'WAIT_GATE_02');
  const t=x.c.required('TASK1234');
  const msg='Approved the exact proposed TASK_SPEC SHA for implementation.';
  x.c.approve({id:t.id,gate:'0.2',digest:t.taskSpecSha,actor:'user',
    receipt:msg,proof:x.proof('0.2',t.taskSpecSha,msg)});
}
function finish(x){
  x.store.close();
  if(x.prevTrustFile===undefined)delete process.env.P1_TRUST_ROOTS_FILE;
  else process.env.P1_TRUST_ROOTS_FILE=x.prevTrustFile;
  if(x.prevTrustHash===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;
  else process.env.P1_TRUST_ROOTS_SHA256=x.prevTrustHash;
  fs.rmSync(x.tmp,{recursive:true,force:true});
}

test('happy path uses exactly one Gate A and Gate B round, skips remediation and arbitration',async()=>{
 const x=setup();try{await movePastPlanning(x);const result=await x.c.run('TASK1234');
 assert.equal(result.stage,'WAIT_GATE_59');assert.equal(result.aRound,1);assert.equal(result.bRound,1);
 assert.equal(x.getP0Calls(),1);assert(!x.modelCalls.includes('worker_remediation'));assert(!x.modelCalls.includes('arbitrator'));
 const ledger=x.store.verify('TASK1234');assert(ledger.events>10);
 const msg='User authorizes closing P1; separate deployment remains out of scope.';
 x.c.approve({id:'TASK1234',gate:'5.9',digest:result.currentSha,actor:'user',
   receipt:msg,proof:x.proof('5.9',result.currentSha,msg)});
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
 assert.throws(()=>x.store.save(t,'TAMPER'),/frozen config is immutable|unrecognized workflow state transition/);
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
 const x=setup();try{assert.throws(()=>x.c.approve({id:'TASK1234',gate:'0.2',digest:'f'.repeat(64),actor:'user',receipt:'User approved the wrong SHA.'}),/gate not awaiting|not waiting for explicit human approval/);
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

test('R6-004 direct Store final close independently checks real worktree HEAD',async()=>{
 const x=setup();
 try{
   await movePastPlanning(x);
   const final=await x.c.run('TASK1234');
   assert.equal(final.stage,'WAIT_GATE_59');
   const message='Human signs this exact final commit and compliance evidence';
   const proof=x.proof('5.9',final.currentSha,message);
   const approvalFile='approval-5-9-'+proof.statement.nonce+'.json';
   const artifact=x.store.artifact('TASK1234',approvalFile,
     {gate:'5.9',digest:final.currentSha,actor:'user',receipt:message,proof,
       at:new Date().toISOString()});
   const t=x.c.required('TASK1234');
   execFileSync('git',['-C',t.worktree,'checkout','--detach','-q',t.baseSha]);
   t.stage='CLOSED';t.status='APPROVED_FOR_SEPARATE_RELEASE_REVIEW';
   assert.throws(()=>x.store.save(t,'GATE_5.9_APPROVED',{
     digest:final.currentSha,actor:'user',approvalSha256:artifact.sha256,
     approvalNonce:proof.statement.nonce,approvalFile}),/worktree HEAD|unverified/);
   assert.equal(x.c.required('TASK1234').stage,'WAIT_GATE_59');
   x.store.verify('TASK1234');
 }finally{finish(x);}
});

test('R7-002 final Gate rejects late evidence not covered by signed compliance root',async()=>{
 const x=setup();
 try{
   await movePastPlanning(x);
   const final=await x.c.run('TASK1234');
   assert.equal(final.stage,'WAIT_GATE_59');
   const before=x.store.evidenceRoot('TASK1234');
   const raw=JSON.parse(fs.readFileSync(path.join(x.store.dir('TASK1234'),'evidence','final-compliance.json'),'utf8'));
   assert.equal(raw.evidenceRoot,before);
   x.store.artifact('TASK1234','late-unapproved-evidence.json',{unexpected:'late'});
   assert.notEqual(x.store.evidenceRoot('TASK1234'),before);
   const msg='Human signs the new snapshot but old compliance is stale';
   assert.throws(()=>x.c.approve({id:'TASK1234',gate:'5.9',digest:final.currentSha,
     actor:'user',receipt:msg,proof:x.proof('5.9',final.currentSha,msg)}),
     /final compliance receipt mismatched/);
   assert.equal(x.c.required('TASK1234').stage,'WAIT_GATE_59');
   x.store.verify('TASK1234');
 }finally{finish(x);}
});
