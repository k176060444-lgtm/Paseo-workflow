import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign,createHmac,randomUUID} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {ROLE_PERMISSIONS,MAX_A,MAX_B,providerOptions,sha256,canonical,verifyGateBTests} from '../src/policy.mjs';
import {verifyCommitEvidenceSync} from '../src/git.mjs';
import {resealLastEventSyntheticState} from './fixtures.mjs';

function setup({workerFails=false,remediationFails=false,p0HasFindings=false,ambiguous=false,conflicting=false,arbResolves=true,scopeDrift=false,preRejectRole=null,p0ForgedPass=false,p0SignedHistorical=false,duplicateReviewerAgent=false}={}) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p1-case-'));
  const g=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim();
  const repo=path.join(tmp,'repo');fs.mkdirSync(repo);
  g(repo,'init','-q');
  fs.writeFileSync(path.join(repo,'source.txt'),'synthetic baseline');
  g(repo,'add','.');
  g(repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','baseline');
  const keys=generateKeyPairSync('ed25519');
  const witness=generateKeyPairSync('ed25519');
  const processWitness=generateKeyPairSync('ed25519');
  const p0Pairs=new Map(['5bao','9bao'].map(id=>[id,generateKeyPairSync('ed25519')]));
  const manifest=path.join(tmp,'public-trust.json');
  fs.writeFileSync(manifest,JSON.stringify({schema:1,human:{
    'offline-auditor':keys.publicKey.export({format:'pem',type:'spki'})},
    execution:{'offline-execution-witness':witness.publicKey.export({format:'pem',type:'spki'})},
    procedure:{'offline-process-witness':processWitness.publicKey.export({format:'pem',type:'spki'})},
    ...(p0SignedHistorical?{p0:Object.fromEntries([...p0Pairs].map(([id,p])=>
      [id,p.publicKey.export({format:'pem',type:'spki'})]))}:{})}));
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
  function proof(gate,digest,receipt,actor='user',statementOverrides={}){
    const signedProcess=['0.1','0.2','5.9','incident'].includes(gate);
    const processStatement=signedProcess?{purpose:'P1_PROCESS_GATE_V1',
      taskId:'TASK1234',gate,digest,actor,receiptSha256:sha256(receipt),
      stateSha256:sha256(store.get('TASK1234')),evidenceRoot:store.evidenceRoot('TASK1234'),
      scope:'PROCESS_ONLY',verdict:'COMPLIANT',
      checks:['GATE_BASIS','HUMAN_AUTHORITY','PROCESS_EVIDENCE'],
      nonce:randomUUID(),issuedAt:new Date().toISOString()}:null;
    const processProof=signedProcess?{schema:1,keyId:'offline-process-witness',
      statement:processStatement,signature:sign(null,Buffer.from(canonical(processStatement)),
        processWitness.privateKey).toString('base64')}:null;
    const recoveryTask=gate==='recovery'?store.get('TASK1234'):null;
    assert(gate!=='recovery'||recoveryTask,'recovery proof requires exact persisted task snapshot');
    const statement={purpose:'P1_HUMAN_GATE_V1',taskId:'TASK1234',gate,digest,
      actor,receipt,
      ...(recoveryTask?{blockedStage:recoveryTask.blockedStage??null,
        stateSha256:sha256(recoveryTask)}:{}),
      nonce:randomUUID(),issuedAt:new Date().toISOString(),
      ...(processProof?{processProofSha256:sha256(processProof)}:{}),
      ...(gate==='incident'?{evidenceSha256:store.incidentEvidenceDigest(
        'TASK1234',store.get('TASK1234'))}:{}),
      ...(gate==='5.9'?{
        evidenceSha256:store.evidenceDigest('TASK1234','final-compliance.json'),
        evidenceRoot:store.evidenceRoot('TASK1234')
      }:{}),...statementOverrides};
    return {schema:1,keyId:'offline-auditor',statement,
      signature:sign(null,Buffer.from(canonical(statement)),keys.privateKey).toString('base64'),
      ...(processProof?{processProof}:{})};
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
    if(p0SignedHistorical)return {
      id,physicalId:'physical-'+id,serverId:'srv_'+id,
      registrationId:'hst_'+id,workspaceId:'workspace-'+id,cwd:'/srv/p0/'+id,
      transport:'direct',enabled:true,role:i===0?'blind_a':'blind_b',
      harness:'opencode',model:'opencode/model'};
    return {id,physicalId:'physical-'+id,sshAlias:id,harness:'opencode',
      model:'opencode/model',hmacKeyPath:file,enabled:true,role:i===0?'blind_a':'blind_b',
      runner:'/runner',config:'/config'};
  });
  const matrix=path.join(tmp,'matrix.json');const intent=path.join(tmp,'intent.md');
  fs.writeFileSync(matrix,JSON.stringify({schema:1,project:{repo:'repo'},runtime:{paseoUrl:'ws://127.0.0.1/ws'},tests:{commands:[['node','--test']],gateB:{smoke:[['node','--test','smoke']],canary:[['node','--test','canary']],regression:[['node','--test','regression']]}},roles,p0:{transport:p0SignedHistorical?'paseo':'legacy-hmac',nodes}}));
  fs.writeFileSync(intent,'Implement a precise and approved programming feature with fully independent review.');
  const store=new Store(path.join(tmp,'state'));
  let workerCount=0,remCount=0,reportCount=0,modelCalls=[];
  const runtime={execute:async x=>{
    modelCalls.push(x.role);
    const number=modelCalls.length,dispatchId='mock-'+number,agentId=duplicateReviewerAgent&&['spec_reviewer','quality_reviewer'].includes(x.role)?'duplicate-reviewer-agent':'fake-agent-'+number;
    x.store.recordIntent(x.task.id,x.phase,dispatchId);
    if(ambiguous&&x.role==='planner')throw Error('provider lost connection after request');
    x.store.recordAck(dispatchId,agentId);
    const verdict=x.role==='pro_audit'&&preRejectRole&&
      x.phase.startsWith('audit-PRE-'+preRejectRole+'-')?'FAIL':
      x.role==='worker'&&workerFails?'FAIL':
      x.role==='worker_remediation'&&remediationFails?'FAIL':
      x.role==='spec_reviewer'&&x.phase==='workplan-scope-review'&&scopeDrift?'FAIL':'PASS';
    x.store.recordTerminal(dispatchId);
    const base={role:x.role,phase:x.phase,agentId,dispatchId,verdict,
      summary:'synthetic test runtime only',findings:verdict==='FAIL'?['needs fixing']:[],
      taskSpec:x.role==='planner'?'Build a tested feature using the approved specification and TDD.':null,
      userAlignment:x.role==='planner'&&x.phase==='planner'? 'User-facing goal, strategy, constraints and acceptance results are explained plainly for the user before any coding decomposition.':null,
      model:x.task.frozen.roles[x.role].model,harness:x.task.frozen.roles[x.role].harness,
      soulSha256:x.task.frozen.souls[x.role].sha256,
      ...(x.auditBinding?{auditBinding:x.auditBinding}:{} )};
    if(x.role==='arbitrator'&&conflicting&&arbResolves){
      const p0=x.task.p0Final??x.task.p0Initial;
      base.disputeResolution={
        reportSetSha256:sha256(p0.reports),
        decisions:p0.reports.filter(r=>r.verdict==='FAIL').map(r=>({
          nodeId:r.nodeId,reportSha256:sha256(r),disposition:'FALSE_POSITIVE',
          rationale:'Synthetic test only: independent evidence marks this finding as a false positive.',
          codeRefs:['source.txt:1']
        }))
      };
    }
    const attestation=attest({purpose:'P1_EXECUTION_ATTESTATION_V2',
      taskId:x.task.id,role:x.role,phase:x.phase,commit:x.task.currentSha??null,
      agentId,dispatchId,model:base.model,harness:base.harness,
      soulSha256:base.soulSha256,rawSha256:sha256(base)});
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
    assertTestWorkspace:async (dir,sha)=>{assert.equal(g(dir,'rev-parse','HEAD'),sha);return [];},
    makeTestCheckout:async (source,sha,dir)=>{
      fs.mkdirSync(path.dirname(dir),{recursive:true});
      g(source,'worktree','add','--detach',dir,sha);return dir;
    },
    verifyCommitEvidenceSync,
    testRun:async (dir,commands,store,id,phase)=>{
      const sha=g(dir,'rev-parse','HEAD');
      const bare={pass:true,receipts:commands.map((argv,i)=>{
        const log=store.artifact(id,phase+'-test-'+(i+1)+'.json',
          {argv,code:0,stdout:'synthetic offline test output',stderr:'',
            timedOut:false,truncated:false});
        return {code:0,ok:true,argv,logSha256:log.sha256,logPath:log.path};
      })};
      return {...bare,attestation:attest({taskId:id,role:'test_executor',phase,
        commit:sha,agentId:'',dispatchId:'',
        rawSha256:sha256({sha,tests:bare})})};
    }
  };
  const p0={review:async({task,commit,cycle,store})=>{
    reportCount++;
    if(p0SignedHistorical){
      const reports=[];
      for(const node of nodes){
        const jobId=sha256(task.id+':'+cycle+':'+commit+':'+node.id).slice(0,40);
        const agentId='signed-agent-'+node.id;
        const prompt='Synthetic approved read-only original P0 test task';
        const binding={role:node.role,soulSha256:task.frozen.souls[node.role].sha256,
          promptSha256:sha256(prompt),taskSpecSha256:sha256(task.taskSpec),
          intentSha256:task.frozen.intentSha256,
          workspaceId:node.workspaceId,cwd:node.cwd};
        const request={jobId,taskId:task.id,cycle,serverId:node.serverId,nodeId:node.id,
          workspaceId:node.workspaceId,commit,soulSha256:binding.soulSha256,
          promptSha256:binding.promptSha256,binding};
        store.artifact(task.id,'p0-'+cycle+'-'+node.id+'-request.json',request);
        store.recordIntent(task.id,'P0:'+cycle+':'+node.id,jobId);
        store.recordAck(jobId,node.serverId+':'+agentId);
        const rawMessage=JSON.stringify({verdict:'PASS',
          summary:'Independent synthetic signed result at original receipt time',findings:[]});
        const report={taskId:task.id,cycle,jobId,commit,nodeId:node.id,
          physicalId:node.physicalId,serverId:node.serverId,agentId,
          model:node.model,harness:node.harness,binding,rawMessage,
          stdoutSha256:sha256(rawMessage),exitCode:0,clean:true,
          verdict:'PASS',summary:'synthetic original signed review',findings:[]};
        const statement={purpose:'P1_P0_NODE_RESULT_V2',taskId:task.id,cycle,
          jobId,commit,nodeId:node.id,physicalId:node.physicalId,
          serverId:node.serverId,agentId,model:node.model,harness:node.harness,
          bindingSha256:sha256(binding),reportSha256:sha256(report),
          nonce:randomUUID(),issuedAt:new Date().toISOString()};
        const proof={schema:1,keyId:node.id,statement,
          signature:sign(null,Buffer.from(canonical(statement)),
            p0Pairs.get(node.id).privateKey).toString('base64')};
        const evidence=store.artifact(task.id,'p0-'+cycle+'-'+node.id+'-result.json',{report,proof});
        store.recordTerminal(jobId);
        reports.push({...report,evidence});
      }
      return {transport:'paseo',commit,cycle,reports,
        findings:[],passed:true,dispute:false,skipped:[],cancelled:[]};
    }
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
    return {commit,cycle,reports,findings,
      passed:p0ForgedPass?true:findings.length===0&&!conflicting,
      dispute:p0ForgedPass?false:conflicting,skipped:[],cancelled:[]};
  }};
  const testCommandWitness={attestTests:async({task,phase,sha,tests})=>{
    const {attestation,...bare}=tests;
    return attest({taskId:task.id,role:'test_executor',phase,commit:sha,
      agentId:'',dispatchId:'',rawSha256:sha256({sha,tests:bare})});
  }};
  const c=new WorkflowController({store,runtime,p0,gitOps,attestor:testCommandWitness});
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
  x.c.approve({id:t.id,gate:'0.2',digest:t.alignmentApprovalSha,actor:'user',
    receipt:msg,proof:x.proof('0.2',t.alignmentApprovalSha,msg)});
}
function finish(x){
  x.store.close();
  if(x.prevTrustFile===undefined)delete process.env.P1_TRUST_ROOTS_FILE;
  else process.env.P1_TRUST_ROOTS_FILE=x.prevTrustFile;
  if(x.prevTrustHash===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;
  else process.env.P1_TRUST_ROOTS_SHA256=x.prevTrustHash;
  fs.rmSync(x.tmp,{recursive:true,force:true});
}

test('happy path skips unnecessary remediation but always runs final Arbitrator',async()=>{
 const x=setup();try{await movePastPlanning(x);const result=await x.c.run('TASK1234');
 assert.equal(result.stage,'WAIT_GATE_59');assert.equal(result.aRound,1);assert.equal(result.bRound,0);
 assert.equal(x.getP0Calls(),1);assert(!x.modelCalls.includes('worker_remediation'));assert(x.modelCalls.includes('arbitrator'));
 assert(x.modelCalls.filter(q=>q==='pro_audit').length>10);
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

test('permission policy keeps TEST_ONLY in disposable write workspace with restricted test commands',()=>{
 assert.equal(MAX_A,10);assert.equal(MAX_B,10);
 assert.equal(providerOptions('tester_gate_a','codex').sandbox_mode,'workspace-write');
 assert.equal(providerOptions('tester_gate_b','opencode').permission.edit,'allow');
 assert.equal(providerOptions('tester_gate_b','opencode',[['npm','test']]).permission.bash['npm test'],'allow');
 assert.equal(providerOptions('tester_gate_b','opencode').permission.bash['*'],'deny');
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
 fs.writeFileSync(cf,JSON.stringify({schema:1,project:{repo:'../source',baseRef:'HEAD'},tests:{commands:[['node','--test']],gateB:{smoke:[['node','--test','smoke']],canary:[['node','--test','canary']],regression:[['node','--test','regression']]}},roles}));
 fs.writeFileSync(intent,'The human-approved intent is a documented test feature with independent review.');
 const store=new Store(path.join(tmp,'state'));
 try{
   const c=new WorkflowController({store,runtime:null,p0:null});
   const res=c.create({id:'TASK5678',configFile:cf,intentFile:intent});
   assert.equal(res.stage,'WAIT_GATE_01');
   assert.equal(Object.keys(c.required('TASK5678').frozen.souls).length,12);
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
       processProof:proof.processProof,at:new Date().toISOString()});
   const t=x.c.required('TASK1234');
   execFileSync('git',['-C',t.worktree,'checkout','--detach','-q',t.baseSha]);
   t.stage='CLOSED';t.status='APPROVED_FOR_SEPARATE_RELEASE_REVIEW';
   assert.throws(()=>x.store.save(t,'GATE_5.9_APPROVED',{
     digest:final.currentSha,actor:'user',approvalSha256:artifact.sha256,
     approvalNonce:proof.statement.nonce,approvalFile,
     processNonce:proof.processProof.statement.nonce,
     processProofSha256:sha256(proof.processProof)}),/worktree HEAD|unverified/);
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

test('signed human recovery resumes a WAIT_HUMAN checkpoint without skipping Gate',async()=>{
 const x=setup();try{
  await movePastPlanning(x);
  const t=x.c.required('TASK1234');
  assert.equal(t.stage,'PLAN_DETAIL');
  x.c.paused(t,'Synthetic question requiring user clarification');
  const stopped=x.c.required('TASK1234');
  assert.equal(stopped.stage,'WAIT_HUMAN');
  assert.equal(stopped.status,'WAITING_HUMAN');
  const msg='Human explicitly clarifies approved details and authorizes resuming this checkpoint.';
  const out=x.c.authorizeRecovery({id:'TASK1234',actor:'user',receipt:msg,
   expectedBasis:t.alignmentApprovalSha,proof:x.proof('recovery',t.alignmentApprovalSha,msg)});
  assert.equal(out.stage,'PLAN_DETAIL');
  assert.equal(x.c.required('TASK1234').status,'READY');
  x.store.verify('TASK1234');
 }finally{finish(x);}
});

test('Arbitrator may dismiss authenticated disputed P0 FALSE_POSITIVE only with exact signed report-set evidence',async()=>{
 const x=setup({conflicting:true});try{
  await movePastPlanning(x);
  const out=await x.c.run('TASK1234');
  assert.equal(out.stage,'WAIT_GATE_59');
  const t=x.c.required('TASK1234');
  assert.equal(t.p0Final.passed,false);
  assert.equal(t.finalArbitration.disputeResolution.reportSetSha256,sha256(t.p0Final.reports));
  assert.equal(t.bFindings.length,0);
  assert.equal(x.getP0Calls(),2);
  x.store.verify('TASK1234');
 }finally{finish(x);}
});

test('Disputed P0 cannot be approved by a generic Arbitrator PASS lacking finding-by-finding ruling',async()=>{
 const x=setup({conflicting:true,arbResolves:false});try{
  await movePastPlanning(x);
  const out=await x.c.run('TASK1234');
  assert.equal(out.stage,'WAIT_HUMAN');
  const t=x.c.required('TASK1234');
  assert.equal(t.finalArbitration,null);
  assert(t.bFindings.length>0);
  x.store.verify('TASK1234');
 }finally{finish(x);}
});

test('unique process audit sessions bind PRE and POST to exact target evidence instead of phase replay',async()=>{
 const x=setup();try{
  await movePastPlanning(x);
  const result=await x.c.run('TASK1234');
  assert.equal(result.stage,'WAIT_GATE_59');
  const t=x.c.required('TASK1234');
  const expected=new Set(['planner','worker','spec_reviewer','quality_reviewer',
    'tester_gate_a','tester_gate_b','test_executor','arbitrator','P0']);
  const actual=t.history.filter(h=>expected.has(h.role));
  assert(actual.length>=9);
  const sessions=new Set();
  for(const h of actual){
    assert.match(h.auditSessionId,/^[a-f0-9-]{36}$/i);
    assert(!sessions.has(h.auditSessionId),'target executions cannot reuse audit sessions');
    sessions.add(h.auditSessionId);
    const audits=t.history.filter(a=>a.role==='pro_audit'&&a.auditSessionId===h.auditSessionId);
    assert.equal(audits.length,2);
    const pre=audits.find(a=>a.auditBinding.checkpoint==='PRE');
    const post=audits.find(a=>a.auditBinding.checkpoint==='POST');
    assert(pre&&post);
    assert.equal(pre.auditBinding.targetEvidenceSha256,null);
    assert.equal(post.auditBinding.targetEvidenceSha256,h.evidenceSha256);
    assert.equal(post.auditBinding.targetAgentId,h.agentId??null);
  }
  x.store.verify('TASK1234');
 }finally{finish(x);}
});


test('execution receipt cannot change observed model after external witness signature',async()=>{
 const x=setup();try{
   const previous=x.c.runtime.execute;
   x.c.runtime.execute=async fields=>{
     const output=await previous(fields);
     if(fields.role==='planner')output.model='unapproved/model';
     return output;
   };
   await assert.rejects(()=>x.c.run('TASK1234'),
     /observed model\/Harness\/Soul differs/);
   const t=x.c.required('TASK1234');
   assert.equal(t.stage,'NEEDS_RECONCILIATION');
   x.store.verify('TASK1234');
 }finally{finish(x);}
});

test('Gate 0.2 binds independently registered USER_ALIGNMENT and TASK_SPEC hashes',async()=>{
 const x=setup();try{
  const first=await x.c.run('TASK1234');
  assert.equal(first.stage,'WAIT_GATE_02');
  const t=x.c.required('TASK1234');
  assert.equal(t.alignmentSha,sha256(t.userAlignment));
  assert.equal(t.alignmentApprovalSha,sha256({alignmentSha:t.alignmentSha,taskSpecSha:t.taskSpecSha}));
  assert.equal(x.store.evidenceDigest(t.id,'USER_ALIGNMENT.md'),t.alignmentSha);
  assert.equal(x.store.evidenceDigest(t.id,'TASK_SPEC.md'),t.taskSpecSha);
  assert.notEqual(t.alignmentApprovalSha,t.taskSpecSha);
  const msg='Human explicitly approves both frozen alignment and technical acceptance scope.';
  assert.throws(()=>x.c.approve({id:t.id,gate:'0.2',digest:t.taskSpecSha,
    actor:'user',receipt:msg,proof:x.proof('0.2',t.taskSpecSha,msg)}),
    /approval does not match frozen digest/);
  const ok=x.c.approve({id:t.id,gate:'0.2',digest:t.alignmentApprovalSha,
    actor:'user',receipt:msg,proof:x.proof('0.2',t.alignmentApprovalSha,msg)});
  assert.equal(ok.stage,'PLAN_DETAIL');
  x.store.verify(t.id);
 }finally{finish(x);}
});

test('unapproved WORK_PLAN drift fails independent scope review before any Worker dispatch',async()=>{
 const x=setup({scopeDrift:true});try{
  await movePastPlanning(x);
  const r=await x.c.run('TASK1234');
  assert.equal(r.stage,'BLOCKED');
  const t=x.c.required('TASK1234');
  assert.equal(t.blockedStage,'PLAN_DETAIL');
  assert.equal(t.workPlan,null);
  assert.equal(x.modelCalls.filter(x=>x==='worker').length,0);
  assert(x.modelCalls.includes('spec_reviewer'));
  x.store.verify('TASK1234');
 }finally{finish(x);}
});

test('Tester B executes and preserves three separate exact approved command layers',async()=>{
  const x=setup();try{
    await movePastPlanning(x);
    const visited=[],original=x.gitOps.testRun;
    x.gitOps.testRun=async(dir,commands,store,id,phase)=>{
      visited.push({phase,commands});
      return original(dir,commands,store,id,phase);
    };
    const result=await x.c.run('TASK1234');
    assert.equal(result.stage,'WAIT_GATE_59');
    const last=x.c.required('TASK1234');
    assert.equal(verifyGateBTests(last),true);
    assert.deepEqual(visited.filter(v=>v.phase.startsWith('B0-test-')).map(v=>v.phase),
      ['B0-test-smoke','B0-test-canary','B0-test-regression']);
    for(const layer of ['smoke','canary','regression']){
      const call=visited.find(v=>v.phase==='B0-test-'+layer);
      assert.deepEqual(call.commands,last.frozen.tests.gateB[layer]);
      assert.equal(last.lastB.tests.layers[layer].pass,true);
    }
    assert.equal(last.lastB.tests.receipts.length,3);
  }finally{finish(x);}
});
test('Gate B cannot be certified if one layer is omitted, command is swapped, or receipt tampered',async()=>{
  const x=setup();try{
    await movePastPlanning(x);
    await x.c.run('TASK1234');
    const t=x.c.required('TASK1234'),original=structuredClone(t.lastB);
    assert.equal(verifyGateBTests(t),true);
    delete t.lastB.tests.layers.canary;
    assert.throws(()=>verifyGateBTests(t),/Tester B canary/);
    t.lastB=structuredClone(original);
    t.lastB.tests.layers.regression.receipts[0].argv=['node','--test','weakened'];
    assert.throws(()=>verifyGateBTests(t),/outside the approved matrix/);
    t.lastB=structuredClone(original);
    t.lastB.tests.receipts=[];
    assert.throws(()=>verifyGateBTests(t),/flattened original receipts/);
    t.lastB=structuredClone(original);
    assert.equal(verifyGateBTests(t),true);
    x.store.verify('TASK1234');
  }finally{finish(x);}
});
test('unapproved test command cannot be exposed as an OpenCode tool permission',()=>{
  const allowed=providerOptions('tester_gate_b','opencode',
    [['git','diff','--check'],['npm','test'],['node','-e','console.log(1)']]).permission.bash;
  assert.equal(allowed['git diff --check'],'allow');
  assert.equal(allowed['npm test'],'allow');
  assert.equal(allowed['node -e console.log(1)'],undefined);
  assert.equal(allowed['*'],'deny');
});

test('A Worker PRE compliance rejection spends zero Gate A technical rounds',async()=>{
  const x=setup({preRejectRole:'worker'});
  try{
    await movePastPlanning(x);
    await assert.rejects(()=>x.c.run('TASK1234'),/Pro-Audit PRE did not approve/);
    const t=x.c.required('TASK1234');
    assert.equal(t.aRound,0);
    assert.equal(t.stage,'BLOCKED');
    assert.equal(x.modelCalls.filter(r=>r==='worker').length,0);
    assert.equal(x.store.dispatches(t.id).filter(r=>r.phase==='A1-worker').length,0);
    x.store.verify(t.id);
  }finally{finish(x);}
});
test('B Remediation PRE compliance rejection spends zero Gate B technical rounds',async()=>{
  const x=setup({preRejectRole:'worker_remediation',p0HasFindings:true});
  try{
    await movePastPlanning(x);
    await assert.rejects(()=>x.c.run('TASK1234'),/Pro-Audit PRE did not approve/);
    const t=x.c.required('TASK1234');
    assert.equal(t.aRound,1);
    assert.equal(t.bRound,0);
    assert.equal(t.stage,'BLOCKED');
    assert.equal(x.modelCalls.filter(r=>r==='worker_remediation').length,0);
    x.store.verify(t.id);
  }finally{finish(x);}
});


test('final Gate refuses a valid log digest borrowed from a different Tester B layer',async()=>{
  const x=setup();
  try{
    await movePastPlanning(x);
    const result=await x.c.run('TASK1234');
    assert.equal(result.stage,'WAIT_GATE_59');
    const t=x.c.required('TASK1234'),actual=t.lastB;
    assert.equal(x.store.verifyOriginalTestLogs(t,actual,actual.agent.phase),undefined);
    const forged=structuredClone(actual);
    forged.tests.layers.smoke.receipts[0].logSha256=
      actual.tests.layers.canary.receipts[0].logSha256;
    assert.throws(()=>x.store.verifyOriginalTestLogs(t,forged,actual.agent.phase),
      /artifact|evidence|digest|mismatch/);
    const forgedExit=structuredClone(actual);
    forgedExit.tests.layers.regression.receipts[0].code=7;
    assert.throws(()=>x.store.verifyOriginalTestLogs(t,forgedExit,actual.agent.phase),
      /original receipt contradicts/);
    x.store.verify('TASK1234');
  }finally{finish(x);}
});

test('all human Gates fail closed if independent process witness is missing or its human countersignature changes',async()=>{
 const x=setup();try{
  const result=await x.c.run('TASK1234');
  assert.equal(result.stage,'WAIT_GATE_02');
  const task=x.c.required('TASK1234');
  const msg='Explicitly accept the independently reviewed user alignment and high-level scope.';
  const signed=x.proof('0.2',task.alignmentApprovalSha,msg);
  assert.throws(()=>x.c.approve({id:task.id,gate:'0.2',
    digest:task.alignmentApprovalSha,actor:'user',receipt:msg,
    proof:{...signed,processProof:undefined}}),
    /independent Gate procedure envelope required/);
  const alternative=x.proof('0.2',task.alignmentApprovalSha,msg);
  assert.throws(()=>x.c.approve({id:task.id,gate:'0.2',
    digest:task.alignmentApprovalSha,actor:'user',receipt:msg,
    proof:{...signed,processProof:alternative.processProof}}),
    /human approval signed statement mismatch/);
  const tampered=structuredClone(signed);
  tampered.processProof.signature='A'.repeat(86)+'==';
  assert.throws(()=>x.c.approve({id:task.id,gate:'0.2',
    digest:task.alignmentApprovalSha,actor:'user',receipt:msg,proof:tampered}),
    /independent Gate procedure signature invalid/);
  assert.equal(x.c.required('TASK1234').stage,'WAIT_GATE_02');
  assert.equal(x.store.approvalNonceUsed(signed.keyId,signed.statement.nonce),false);
  x.store.verify(task.id);
  const approved=x.c.approve({id:task.id,gate:'0.2',
    digest:task.alignmentApprovalSha,actor:'user',receipt:msg,proof:signed});
  assert.equal(approved.stage,'PLAN_DETAIL');
  x.store.verify(task.id);
 }finally{finish(x);}
});
test('independently signed Gate process proof binds exact evidence root and rejects late artifacts',async()=>{
 const x=setup();try{
  await x.c.run('TASK1234');
  const t=x.c.required('TASK1234');
  const msg='User specifically approves this frozen task after process verification.';
  const signed=x.proof('0.2',t.alignmentApprovalSha,msg);
  x.store.artifact(t.id,'unexpected-before-human-approval.json',{late:true});
  assert.throws(()=>x.c.approve({id:t.id,gate:'0.2',
    digest:t.alignmentApprovalSha,actor:'user',receipt:msg,proof:signed}),
    /independent Gate procedural witness does not cover exact approved process/);
  assert.equal(x.c.required(t.id).stage,'WAIT_GATE_02');
  x.store.verify(t.id);
 }finally{finish(x);}
});


test('uncertain incident can only become human BLOCKED when every original dispatch already has independently authenticated result',async()=>{
 const x=setup();try{
  await movePastPlanning(x);
  const end=await x.c.run('TASK1234');
  assert.equal(end.stage,'WAIT_GATE_59');
  const t=x.c.required('TASK1234');
  t.stage='NEEDS_RECONCILIATION';t.status='NEEDS_RECONCILIATION';
  t.blockedStage='READY_FINAL';t.inflight={role:'arbitrator',phase:'synthetic-crash'};
  t.pendingHuman='Synthetic crash after original signed result registration.';
  resealLastEventSyntheticState(x.store,t);
  const msg='I inspected the independent original terminal evidence and permit only incident closure, never immediate redispatch.';
  const signed=x.proof('incident',t.currentSha,msg);
  const output=x.c.certifyIncident({id:t.id,actor:'user',receipt:msg,
    expectedSha:t.currentSha,proof:signed});
  assert.equal(output.stage,'BLOCKED');
  assert.equal(output.status,'BLOCKED');
  assert.equal(output.allowedToRedispatch,false);
  const now=x.c.required(t.id);
  assert.equal(now.inflight,null);
  assert.equal(now.blockedStage,'READY_FINAL');
  assert.equal(x.store.approvalNonceUsed(signed.keyId,signed.statement.nonce),true);
  x.store.verify(t.id);
 }finally{finish(x);}
});
test('incident certificate cannot turn an orphan TERMINAL ACK into a safe restart',async()=>{
 const x=setup();try{
  await movePastPlanning(x);
  await x.c.run('TASK1234');
  const t=x.c.required('TASK1234');
  x.store.recordIntent(t.id,'A1-worker','orphan-terminal-without-report');
  x.store.recordAck('orphan-terminal-without-report','orphan-agent');
  x.store.recordTerminal('orphan-terminal-without-report');
  const current=x.c.required(t.id);
  current.stage='NEEDS_RECONCILIATION';current.status='NEEDS_RECONCILIATION';
  current.blockedStage='A_WORKER';current.inflight={role:'worker',phase:'A1-worker'};
  resealLastEventSyntheticState(x.store,current);
  const msg='I request a safe incident closure while preserving all original records.';
  const signed=x.proof('incident',current.currentSha,msg);
  assert.throws(()=>x.c.certifyIncident({id:current.id,actor:'user',receipt:msg,
    expectedSha:current.currentSha,proof:signed}),
    /TERMINAL dispatch has no unique registered original signed execution/);
  assert.equal(x.c.required(t.id).stage,'NEEDS_RECONCILIATION');
  x.store.verify(t.id);
 }finally{finish(x);}
});

test('R13 D01: ordinary role lost ACK records exact uncertain stage and never auto-retries',async()=>{
 const x=setup({ambiguous:true});try{
  await assert.rejects(()=>x.c.run('TASK1234'),/provider lost connection/);
  const t=x.c.required('TASK1234');
  assert.equal(t.stage,'NEEDS_RECONCILIATION');
  assert.equal(t.status,'NEEDS_RECONCILIATION');
  assert.equal(t.blockedStage,'PLANNER');
  assert.equal(t.inflight,null);
  await assert.rejects(()=>x.c.run('TASK1234'),/reconcile before dispatch/);
  assert.equal(x.modelCalls.filter(r=>r==='planner').length,1);
  x.store.verify(t.id);
 }finally{finish(x);}
});
test('R13 D01: Pro-Audit lost ACK records original phase and cannot be skipped',async()=>{
 const x=setup();try{
  const original=x.c.runtime.execute;
  x.c.runtime.execute=async fields=>{
   const result=await original(fields);
   if(fields.role==='pro_audit')throw Error('synthetic compliance lost ACK');
   return result;
  };
  await assert.rejects(()=>x.c.run('TASK1234'),/synthetic compliance lost ACK/);
  const t=x.c.required('TASK1234');
  assert.equal(t.stage,'NEEDS_RECONCILIATION');
  assert.equal(t.blockedStage,'PLANNER');
  assert.equal(t.inflight,null);
  assert(t.pendingHuman.includes('pro_audit'));
  x.store.verify(t.id);
 }finally{finish(x);}
});
test('R13 D01+D03: completed reviewer seat survives other seat loss without pair replay',async()=>{
 const x=setup();try{
  await movePastPlanning(x);
  const prior=x.c.runtime.execute;
  x.c.runtime.execute=async fields=>{
   const result=await prior(fields);
   if(fields.role==='quality_reviewer'&&/review-quality_reviewer$/.test(fields.phase))
     throw Error('synthetic reviewer provider loss');
   return result;
  };
  await assert.rejects(()=>x.c.run('TASK1234'),/Reviewer call failed/);
  const t=x.c.required('TASK1234');
  assert.equal(t.stage,'NEEDS_RECONCILIATION');
  assert.equal(t.blockedStage,'A_REVIEW');
  assert.equal(t.inflight,null);
  assert.equal(t.history.filter(h=>h.role==='spec_reviewer'&&h.phase==='A1-review').length,1);
  const before=x.modelCalls.filter(q=>q==='spec_reviewer').length;
  await assert.rejects(()=>x.c.run('TASK1234'),/reconcile before dispatch/);
  assert.equal(x.modelCalls.filter(q=>q==='spec_reviewer').length,before);
  x.store.verify(t.id);
 }finally{finish(x);}
});
test('R13 D01: P0 partial unknown operation preserves review checkpoint and every dispatch',async()=>{
 const x=setup();try{
  await movePastPlanning(x);
  const prior=x.c.p0.review;
  x.c.p0.review=async args=>{await prior(args);throw Error('synthetic P0 lost response ACK');};
  await assert.rejects(()=>x.c.run('TASK1234'),/synthetic P0 lost response ACK/);
  const t=x.c.required('TASK1234');
  assert.equal(t.stage,'NEEDS_RECONCILIATION');
  assert.equal(t.blockedStage,'P0_INITIAL');
  assert.equal(t.inflight,null);
  assert.equal(x.getP0Calls(),1);
  await assert.rejects(()=>x.c.run('TASK1234'),/reconcile before dispatch/);
  assert.equal(x.getP0Calls(),1);
  x.store.verify(t.id);
 }finally{finish(x);}
});
test('R13 D02: forged P0 passed:true with signed FAIL seat is rejected before Arbitrator and Gate 5.9',async()=>{
 const x=setup({conflicting:true,p0ForgedPass:true});try{
  await movePastPlanning(x);
  await assert.rejects(()=>x.c.run('TASK1234'),
    /P0 summary passed\/dispute\/findings contradict independently signed seat verdicts/);
  const t=x.c.required('TASK1234');
  assert.equal(t.stage,'NEEDS_RECONCILIATION');
  assert.equal(t.blockedStage,'P0_INITIAL');
  assert.equal(t.finalArbitration,null);
  assert(!x.modelCalls.includes('arbitrator'));
  assert.equal(x.getP0Calls(),1);
  x.store.verify(t.id);
 }finally{finish(x);}
});
test('R13 D11: Arbitrator docket supplies original per-report SHA values directly',async()=>{
 const x=setup({conflicting:true});try{
  await movePastPlanning(x);
  const r=await x.c.run('TASK1234');
  assert.equal(r.stage,'WAIT_GATE_59');
  const t=x.c.required('TASK1234');
  const docket=JSON.parse(x.c.arbitrationDocket(t).serialized);
  assert.equal(docket.p0Summary.reports.length,2);
  for(let i=0;i<t.p0Final.reports.length;i++){
   const source=t.p0Final.reports[i];
   assert.equal(docket.p0Summary.reports[i].reportSha256,sha256(source));
   assert.equal(docket.signedP0Originals[i].reportSha256,sha256(source));
  }
  assert.equal(docket.p0ReportSetSha256,sha256(t.p0Final.reports));
  x.store.verify(t.id);
 }finally{finish(x);}
});

test('R13 D03: signed recovery of fully witnessed reviewer pair reuses both reports with zero additional model calls',async()=>{
 const x=setup();try{
  await movePastPlanning(x);
  await assert.rejects(()=>x.c.run('TASK1234',{maxSteps:3}),
    /maxStep guard reached/);
  const inReview=x.c.required('TASK1234');
  assert.equal(inReview.stage,'A_REVIEW');
  const source=await x.c.invokePair(inReview,'A1-review',inReview.currentSha);
  assert.equal(source.pass,true);
  const originalReports=x.modelCalls.filter(r=>['spec_reviewer','quality_reviewer'].includes(r)).length;
  x.c.paused(inReview,'Synthetic human clarification after both signed Reviewer POST receipts');
  const stopped=x.c.required('TASK1234');
  assert.equal(stopped.stage,'WAIT_HUMAN');
  assert.equal(stopped.blockedStage,'A_REVIEW');
  const msg='I authorize resuming the fully signed original reviewer pair without any replacement model tasks.';
  const accepted=x.c.authorizeRecovery({id:'TASK1234',actor:'user',receipt:msg,
    expectedSha:stopped.currentSha,proof:x.proof('recovery',stopped.currentSha,msg)});
  assert.equal(accepted.stage,'A_REVIEW');
  assert.equal(x.c.required('TASK1234').blockedStage,null);
  assert.equal(x.c.required('TASK1234').reviewerReuse.checkpoint,'A_REVIEW');
  assert.equal(x.store.readCompletedReviewerPair('TASK1234','A_REVIEW',stopped.currentSha).pass,true);
  const result=await x.c.run('TASK1234');
  assert.equal(result.stage,'WAIT_GATE_59');
  assert.equal(x.c.required('TASK1234').blockedStage,null);
  assert.equal(x.c.required('TASK1234').reviewerReuse,null);
  assert.equal(x.modelCalls.filter(r=>['spec_reviewer','quality_reviewer'].includes(r)).length,
    originalReports);
  x.store.verify('TASK1234');
 }finally{finish(x);}
});

test('R13 follow-up: unexpected generic error cannot invent next checkpoint or original in-flight phase',async()=>{
 const x=setup();try{
  const task=x.c.required('TASK1234');
  assert.equal(task.stage,'PLANNER');
  task.stage='BLOCKED';task.status='BLOCKED';task.blockedStage='PLAN_DETAIL';
  task.pendingHuman='Synthetic stage failure with forged checkpoint';
  task.inflight=null;
  assert.throws(()=>x.store.save(task,'UNEXPECTED_STAGE_ERROR',{
    uncertain:false,checkpoint:'PLANNER',originalRole:null,originalPhase:null}),
    /cannot invent a checkpoint or skip a Gate/);
  assert.equal(x.c.required('TASK1234').stage,'PLANNER');
  const active=x.c.required('TASK1234');
  active.status='INFLIGHT';active.inflight={role:'planner',phase:'planner'};
  x.store.save(active,'INFLIGHT',{role:'planner',phase:'planner'});
  const fake=x.c.required('TASK1234');
  fake.stage='NEEDS_RECONCILIATION';fake.status='NEEDS_RECONCILIATION';
  fake.blockedStage='PLANNER';fake.inflight=null;
  fake.pendingHuman='Synthetic interrupted Planner with forged original phase';
  assert.throws(()=>x.store.save(fake,'UNEXPECTED_STAGE_ERROR',{
    uncertain:true,checkpoint:'PLANNER',originalRole:'planner',
    originalPhase:'tampered-phase'}),/must bind the original in-flight role and phase/);
  assert.equal(x.c.required('TASK1234').status,'INFLIGHT');
  const good=x.c.required('TASK1234');
  good.stage='NEEDS_RECONCILIATION';good.status='NEEDS_RECONCILIATION';
  good.blockedStage='PLANNER';good.inflight=null;
  good.pendingHuman='Synthetic genuine unknown Planner execution';
  x.store.save(good,'UNEXPECTED_STAGE_ERROR',{
    uncertain:true,checkpoint:'PLANNER',originalRole:'planner',originalPhase:'planner'});
  assert.equal(x.c.required('TASK1234').blockedStage,'PLANNER');
  assert.equal(x.c.required('TASK1234').stage,'NEEDS_RECONCILIATION');
  x.store.verify('TASK1234');
 }finally{finish(x);}
});

test('R13 follow-up: Store rejects final P0 dispute ruling mutated after independent Arbitrator signed result',async()=>{
 const x=setup({conflicting:true});try{
  await movePastPlanning(x);
  const real=x.c.invoke.bind(x.c);
  x.c.invoke=async(...args)=>{
    const result=await real(...args);
    if(args[1]==='arbitrator'){
      assert(result.disputeResolution?.decisions?.length);
      result.disputeResolution={
        ...result.disputeResolution,
        decisions:result.disputeResolution.decisions.map(d=>({
          ...d,rationale:d.rationale+' This sentence was added after signature.'}))};
    }
    return result;
  };
  await assert.rejects(()=>x.c.run('TASK1234'),
    /finalArbitration\.disputeResolution contradicts original independently signed Arbitrator result/);
  const task=x.c.required('TASK1234');
  assert.equal(task.stage,'BLOCKED');
  assert.equal(task.finalArbitration,null);
  assert.equal(task.status,'BLOCKED');
  x.store.verify('TASK1234');
 }finally{finish(x);}
});

test('R13 follow-up: incomplete reviewer POST process witness permanently blocks source-aware reuse',async()=>{
 const x=setup();try{
  await movePastPlanning(x);
  const previous=x.c.auditRole.bind(x.c);
  x.c.auditRole=async(...args)=>{
    if(args[1]==='quality_reviewer'&&args[3]==='POST')
      throw Error('synthetic missing Quality Reviewer POST witness');
    return previous(...args);
  };
  await assert.rejects(()=>x.c.run('TASK1234'),
    /synthetic missing Quality Reviewer POST witness/);
  const t=x.c.required('TASK1234');
  assert.equal(t.stage,'BLOCKED');
  assert.equal(t.blockedStage,'A_REVIEW');
  assert.throws(()=>x.store.readCompletedReviewerPair('TASK1234','A_REVIEW',t.currentSha),
    /paired original PRE\/POST compliance|missing exact original process audit/);
  assert.equal(x.modelCalls.filter(x=>x==='quality_reviewer').length,1);
  x.store.verify('TASK1234');
 }finally{finish(x);}
});

test('R13 follow-up: real SQLite Gate 5.9 accepts 31-minute-old originally signed Paseo P0, never reissues witness',async()=>{
 const x=setup({p0SignedHistorical:true});
 const OriginalDate=Date;
 try{
  // Isolated harness simulation: bypass only live network/OS capability preflight;
  // native P0 signing, immutable Store, all process-audit history and final
  // approval gates still execute their unmodified production verification code.
  x.c.livePreflight=async()=>{};
  await movePastPlanning(x);
  await assert.rejects(()=>x.c.run('TASK1234',{maxSteps:9}),/maxStep guard reached/);
  const ready=x.c.required('TASK1234');
  assert.equal(ready.stage,'READY_FINAL');
  assert.equal(ready.p0Initial?.reports?.length,2);
  class FutureDate extends OriginalDate{
   constructor(...args){
    if(args.length)super(...args);
    else super(OriginalDate.now()+31*60000);
   }
   static now(){return OriginalDate.now()+31*60000;}
  }
  globalThis.Date=FutureDate;
  const after=await x.c.run('TASK1234');
  assert.equal(after.stage,'WAIT_GATE_59');
  const waiting=x.c.required('TASK1234');
  const message='Human confirms the final Gate after independently signed P0 evidence was originally accepted more than thirty minutes ago.';
  const approval=x.proof('5.9',waiting.currentSha,message);
  const closed=x.c.approve({id:'TASK1234',gate:'5.9',digest:waiting.currentSha,
    actor:'user',receipt:message,proof:approval});
  assert.equal(closed.stage,'CLOSED');
  x.store.verify('TASK1234');
 }finally{
  globalThis.Date=OriginalDate;
  finish(x);
 }
});
