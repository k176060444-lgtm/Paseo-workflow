import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as git from './git.mjs';
import {assert,checkedId,freezeConfig,MAX_A,MAX_B,sha256,PASS,PAUSE,hasBlockingFinding,TERMINAL,ROLE_PERMISSIONS} from './policy.mjs';

const ROLE_PROMPT = `Obey the frozen Soul, approved TASK_SPEC, stage constraints and exact SHA. Do NOT claim tests passed without evidence. End with one JSON object matching {"verdict":"PASS|FAIL|QUESTION|NEEDS_SPECIALIST|APPROVE_WITH_COMMENTS","summary":"...","findings":["..."]}. Planner must also include taskSpec string.`;

export class WorkflowController {
  constructor({store,runtime,p0,gitOps=git}) {this.store=store;this.runtime=runtime;this.p0=p0;this.git=gitOps;}
  create({id,configFile,intentFile}){
    checkedId(id);
    const frozen=freezeConfig(configFile,intentFile);
    const t={id,frozen,stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,
      baseSha:null,currentSha:null,taskSpec:null,taskSpecSha:null,
      lastA:null,lastB:null,p0Initial:null,p0Final:null,changesInB:false,
      bFindings:[],pendingHuman:null,history:[],created:new Date().toISOString()};
    this.store.init(t);
    const snapshot=this.store.artifact(id,'frozen-manifest.json',frozen);
    this.store.event(id,'CONFIG_FROZEN',{sha256:frozen.digest,artifactSha256:snapshot.sha256});
    return {id,digest:frozen.digest,stage:t.stage};
  }
  approve({id,gate,digest,actor,receipt}){
    const t=this.required(id);
    assert(typeof actor==='string'&&actor.trim().length>1,'approval actor required');
    assert(typeof receipt==='string'&&receipt.trim().length>15,'human approval receipt required');
    assert(gate==='0.1'||gate==='0.2'||gate==='5.9','unsupported gate');
    const allowed={'0.1':'WAIT_GATE_01','0.2':'WAIT_GATE_02','5.9':'WAIT_GATE_59'};
    assert(t.stage===allowed[gate],'gate not awaiting human approval');
    const expected=gate==='0.1'?t.frozen.digest:gate==='0.2'?t.taskSpecSha:t.currentSha;
    assert(expected&&digest===expected,'approval does not match frozen digest');
    const approval=this.store.artifact(id,`approval-${gate.replace('.','-')}.json`,{gate,digest,actor,receipt,at:new Date().toISOString()});
    if(gate==='0.1'){t.stage='PLANNER';t.status='READY';}
    else if(gate==='0.2'){t.stage='PREPARE';t.status='READY';}
    else {t.stage='CLOSED';t.status='APPROVED_FOR_SEPARATE_RELEASE_REVIEW';}
    this.store.save(t,`GATE_${gate}_APPROVED`,{digest,actor,approvalSha256:approval.sha256});
    return {id,stage:t.stage,approvalSha256:approval.sha256};
  }
  required(id){const t=this.store.get(id);assert(t,`unknown task ${id}`);return t;}
  async livePreflight(t){
    assert(process.env.P1_LIVE_ALLOWED==='YES','live dispatch disabled; set P1_LIVE_ALLOWED=YES after audit');
    assert(process.env.P1_HOST_ISOLATION_ATTESTED==='YES','host isolation has not been attested');
    assert(t.frozen.digest===sha256(Object.fromEntries(Object.entries(t.frozen).filter(([k])=>k!=='digest'))),'frozen config digest mismatch');
    this.compliance(t);
  }
  compliance(t){
    this.store.verify(t.id);
    assert(t.aRound<=MAX_A&&t.bRound<=MAX_B,'round budget exceeded');
    assert(t.frozen.policy.maxA===MAX_A&&t.frozen.policy.maxB===MAX_B,'budget policy mismatch');
    for (const [role,perm] of Object.entries(ROLE_PERMISSIONS))
      assert(t.frozen.policy.permissions[role]===perm,'role permissions modified');
    if(t.stage==='READY_FINAL'||t.stage==='WAIT_GATE_59'){
      assert(t.lastB?.tests?.pass===true,'missing final Tester B pass');
      assert(t.lastB?.commit===t.currentSha,'Tester B commit mismatch');
      const p0=t.p0Final??t.p0Initial;
      assert(p0?.passed===true&&p0.commit===t.currentSha,'P0 must cover final commit');
      assert(p0.reports.length>=2&&new Set(p0.reports.map(r=>r.physicalId)).size>=2,'insufficient physical P0 seats');
      assert(!t.bFindings.length,'unresolved P0 findings');
    }
    return true;
  }
  async invoke(t,role,phase,prompt,cwd=t.worktree){
    // Save an in-flight marker BEFORE any external side effect. Crashes must not auto-retry.
    const expectedSha=(ROLE_PERMISSIONS[role]==='READ_ONLY'||ROLE_PERMISSIONS[role]==='TEST_ONLY')?await this.git.head(cwd):null;
    t.status='INFLIGHT';t.inflight={role,phase,at:new Date().toISOString()};
    this.store.save(t,'INFLIGHT',{role,phase});
    let result;
    try{result=await this.runtime.execute({task:t,role,phase,cwd,prompt:`${ROLE_PROMPT}\n${prompt}`,store:this.store});}
    catch(e){t.status='NEEDS_RECONCILIATION';t.pendingHuman=String(e.message);this.store.save(t,'EXECUTION_UNCERTAIN',{role,phase,error:String(e.message)});throw e;}
    assert(!PASS(result.verdict)||!hasBlockingFinding(result.findings??[])&&
      (result.verdict!=='PASS'||!(result.findings??[]).length),
      `${role}: contradictory PASS/findings; reconcile manually`);
    if(expectedSha) await this.git.assertUnchanged(cwd,expectedSha);
    const artifact=this.store.artifact(t.id,`${phase}-${role}-${randomUUID().slice(0,8)}.json`,result);
    t.history.push({role,phase,agentId:result.agentId,verdict:result.verdict,evidenceSha256:artifact.sha256,at:new Date().toISOString()});
    t.inflight=null;t.status='READY';
    this.store.save(t,'ROLE_TERMINAL',{role,phase,verdict:result.verdict,evidenceSha256:artifact.sha256});
    return result;
  }
  async invokePair(t,prefix,sha){
    t.status='INFLIGHT';t.inflight={role:'review_pair',phase:prefix,sha};
    this.store.save(t,'REVIEW_PAIR_STARTED',{sha});
    const seats=['spec_reviewer','quality_reviewer'];
    const run=async(role)=>this.runtime.execute({task:t,role,phase:`${prefix}-${role}`,cwd:t.worktree,
      prompt:`${ROLE_PROMPT}\nTASK_SPEC:\n${t.taskSpec}\nReview exactly commit ${sha}. No edits. Independent report; do not see the other reviewer's findings.`,store:this.store});
    const settled=await Promise.allSettled(seats.map(run));
    const successful=new Map(), errors=[];
    // Save EACH finished seat before handling its peer's failure (R2-010).
    for(let i=0;i<seats.length;i++){
      const role=seats[i], result=settled[i];
      if(result.status==='rejected'){errors.push({role,error:String(result.reason)});continue;}
      const r=result.value;
      if(r?.role!==role||typeof r.agentId!=='string'||!r.agentId){
        errors.push({role,error:'invalid or mismatched reviewer identity'});continue;
      }
      const artifact=this.store.artifact(t.id,`${prefix}-${role}-${randomUUID().slice(0,8)}.json`,r);
      t.history.push({role,phase:prefix,agentId:r.agentId,verdict:r.verdict,evidenceSha256:artifact.sha256,sha});
      this.store.save(t,'REVIEW_SEAT_RECORDED',{role,sha,agentId:r.agentId,evidenceSha256:artifact.sha256});
      successful.set(role,r);
    }
    if(errors.length || successful.size!==2 ||
       successful.get('spec_reviewer').agentId===successful.get('quality_reviewer').agentId){
      t.status='NEEDS_RECONCILIATION';t.pendingHuman='Concurrent reviewer execution uncertain or invalid';
      this.store.save(t,'REVIEW_PAIR_UNCERTAIN',{sha,completed:[...successful.keys()],errors});
      throw new Error('Reviewer call failed or identity invalid; saved finished seats; reconcile before continuing');
    }
    await this.git.assertUnchanged(t.worktree,sha);
    const spec=successful.get('spec_reviewer'),quality=successful.get('quality_reviewer');
    t.inflight=null;t.status='READY';this.store.save(t,'REVIEW_PAIR_TERMINAL',{sha,spec:spec.verdict,quality:quality.verdict});
    return {spec,quality,pass:PASS(spec.verdict)&&PASS(quality.verdict)&&!hasBlockingFinding(spec.findings)&&!hasBlockingFinding(quality.findings)&&
      (spec.verdict!=='PASS'||spec.findings.length===0)&&(quality.verdict!=='PASS'||quality.findings.length===0),
      pause:PAUSE(spec.verdict)||PAUSE(quality.verdict),findings:[...spec.findings,...quality.findings]};
  }
  async test(t,role,phase,sha){
    const testdir=path.join(this.store.dir(t.id),`test-${phase}`);
    const dir=await this.git.makeTestCheckout(t.frozen.project.repo,sha,testdir);
    const agent=await this.invoke(t,role,phase,`TASK_SPEC:\n${t.taskSpec}\nInspect exact commit ${sha} in disposable test checkout. Do not modify product source. Controller will independently execute the frozen test commands.`,dir);
    const tests=await this.git.testRun(dir,t.frozen.tests.commands,this.store,t.id,phase);
    const evidence=this.store.artifact(t.id,`${phase}-test-receipts.json`,{sha,tests});
    t.history.push({role:'test_executor',phase,sha,pass:tests.pass,evidenceSha256:evidence.sha256});
    this.store.save(t,'TEST_RECEIPTS',{sha,pass:tests.pass,evidenceSha256:evidence.sha256});
    return {agent,tests,commit:sha,pass:tests.pass&&PASS(agent.verdict),findings:agent.findings};
  }
  async p0Review(t,cycle){
    t.status='INFLIGHT';t.inflight={role:'P0',phase:cycle,sha:t.currentSha};
    this.store.save(t,'P0_STARTED',{cycle,sha:t.currentSha});
    let p;
    try{p=await this.p0.review({task:t,commit:t.currentSha,taskSpec:t.taskSpec,store:this.store,cycle});}
    catch(e){t.status='NEEDS_RECONCILIATION';t.pendingHuman=String(e.message);this.store.save(t,'P0_UNCERTAIN',{cycle,error:String(e.message)});throw e;}
    const ev=this.store.artifact(t.id,`p0-${cycle}-summary.json`,p);
    t.status='READY';t.inflight=null;
    t.history.push({role:'P0',phase:cycle,sha:t.currentSha,passed:p.passed,evidenceSha256:ev.sha256});
    this.store.save(t,'P0_COMPLETE',{cycle,sha:t.currentSha,passed:p.passed,evidenceSha256:ev.sha256});
    return p;
  }
  next(t,stage,type,payload={}){t.stage=stage;t.status=TERMINAL.has(stage)?'WAITING_HUMAN':'READY';this.store.save(t,type,payload);}
  paused(t,message){t.pendingHuman=message;this.next(t,'WAIT_HUMAN','AWAITING_CLARIFICATION',{message});}
  failed(t,message){t.pendingHuman=message;this.next(t,'BLOCKED','COMPLIANCE_OR_INFRA_BLOCK',{message});}
  async step(t){
    if(TERMINAL.has(t.stage)||t.status==='INFLIGHT')return;
    this.compliance(t);
    switch(t.stage){
      case 'PLANNER':{
        const r=await this.invoke(t,'planner','planner',`User goal:\n${t.frozen.intent}\nCreate a precise, actionable TASK_SPEC. No source edits.`,t.frozen.project.repo);
        if(PAUSE(r.verdict)){this.paused(t,'Planner requires clarification: '+r.summary);return;}
        if(!PASS(r.verdict)){this.failed(t,'Planner failed to produce acceptable TASK_SPEC');return;}
        t.taskSpec=r.taskSpec;t.taskSpecSha=sha256(r.taskSpec);
        this.store.artifact(t.id,'TASK_SPEC.md',r.taskSpec);
        this.next(t,'WAIT_GATE_02','TASK_SPEC_CANDIDATE',{sha256:t.taskSpecSha});return;
      }
      case 'PREPARE':{
        const dir=path.join(this.store.dir(t.id),'worktree');
        t.baseSha=await this.git.prepare(t.frozen.project.repo,t.frozen.project.baseRef,dir);
        t.worktree=dir;t.currentSha=t.baseSha;
        this.next(t,'A_WORKER','WORKTREE_PREPARED',{baseSha:t.baseSha});return;
      }
      case 'A_WORKER':{
        if(t.aRound>=MAX_A){this.next(t,'STOPPED_BUDGET','GATE_A_EXHAUSTED');return;}
        t.aRound++;this.store.save(t,'GATE_A_ROUND_START',{round:t.aRound});
        const r=await this.invoke(t,'worker',`A${t.aRound}-worker`,
          `TASK_SPEC:\n${t.taskSpec}\nPrior findings:\n${t.aFindings?.join('\n')??'none'}\nImplement using TDD; no production side-effects.`);
        if(PAUSE(r.verdict)){this.paused(t,'Worker requests clarification: '+r.summary);return;}
        if(!PASS(r.verdict)){t.aFindings=r.findings;this.next(t,'A_WORKER','WORKER_TECHNICAL_FAIL');return;}
        t.currentSha=await this.git.commitWorktree(t.worktree,`A round ${t.aRound}`);
        this.next(t,'A_REVIEW','A_COMMIT_FROZEN',{sha:t.currentSha});return;
      }
      case 'A_REVIEW':{
        const r=await this.invokePair(t,`A${t.aRound}-review`,t.currentSha);
        if(r.pause){this.paused(t,'Reviewer question or specialist needed');return;}
        if(!r.pass){t.aFindings=r.findings;this.next(t,'A_WORKER','A_REVIEW_FAIL',{findings:r.findings});return;}
        this.next(t,'A_TEST','A_REVIEW_PASS');return;
      }
      case 'A_TEST':{
        const r=await this.test(t,'tester_gate_a',`A${t.aRound}-test`,t.currentSha);
        if(PAUSE(r.agent.verdict)){this.paused(t,'Tester A requests clarification');return;}
        if(!r.pass){t.aFindings=r.findings;this.next(t,'A_WORKER','GATE_A_TEST_FAIL',{receipts:r.tests.receipts});return;}
        t.lastA=r;this.next(t,'P0_INITIAL','GATE_A_PASS',{sha:t.currentSha});return;
      }
      case 'P0_INITIAL':{
        const r=await this.p0Review(t,`initial-A${t.aRound}`);
        t.p0Initial=r;
        // A disagreement is a real issue. Do not collapse FAIL/QUESTION into a fabricated PASS.
        t.bFindings=[...r.findings];
        if(!r.passed && t.bFindings.length===0) t.bFindings=['P0 failed without a finding; block until reconciled'];
        t.p0Dispute=r.dispute || (r.reports.some(x=>x.verdict==='PASS')&&r.reports.some(x=>x.verdict==='FAIL'));
        this.next(t,'B_ENTER','P0_INITIAL_COLLECTED',{pass:r.passed,dispute:t.p0Dispute});return;
      }
      case 'B_ENTER':{
        if(t.bRound>=MAX_B){this.next(t,'STOPPED_BUDGET','GATE_B_EXHAUSTED');return;}
        t.bRound++;this.store.save(t,'GATE_B_ROUND_START',{round:t.bRound});
        this.next(t,t.bFindings.length?'B_WORKER':'B_TEST',t.bFindings.length?'B_REMEDIATION_REQUIRED':'B_REMEDIATION_SKIPPED');return;
      }
      case 'B_WORKER':{
        const r=await this.invoke(t,'worker_remediation',`B${t.bRound}-worker`,
          `TASK_SPEC:\n${t.taskSpec}\nConfirmed issues:\n${t.bFindings.join('\n')}\nFix only approved issues, preserve evidence; perform TDD.`);
        if(PAUSE(r.verdict)){this.paused(t,'Remediation requests clarification');return;}
        if(!PASS(r.verdict)){t.bFindings=r.findings.length?r.findings:t.bFindings;this.next(t,'B_ENTER','B_WORKER_FAIL');return;}
        const old=t.currentSha;
        t.currentSha=await this.git.commitWorktree(t.worktree,`B round ${t.bRound}`);
        t.changesInB ||= t.currentSha!==old;
        if(t.currentSha===old){this.failed(t,'Remediation claimed success but did not create a changed commit');return;}
        t.bFindings=[];
        this.next(t,'B_REVIEW','B_COMMIT_FROZEN',{sha:t.currentSha});return;
      }
      case 'B_REVIEW':{
        const r=await this.invokePair(t,`B${t.bRound}-review`,t.currentSha);
        if(r.pause){this.paused(t,'B reviewer needs clarification');return;}
        if(!r.pass){t.bFindings=r.findings;this.next(t,'B_ENTER','B_REVIEW_FAIL');return;}
        this.next(t,'B_TEST','B_REVIEW_PASS');return;
      }
      case 'B_TEST':{
        const r=await this.test(t,'tester_gate_b',`B${t.bRound}-test`,t.currentSha);
        if(PAUSE(r.agent.verdict)){this.paused(t,'Tester B requires clarification');return;}
        if(!r.pass){t.bFindings=r.findings.length?r.findings:['Independent Tester B failed'];this.next(t,'B_ENTER','B_TEST_FAIL');return;}
        t.lastB=r;
        const currentP0=t.p0Final??t.p0Initial;
        if(!currentP0||currentP0.commit!==t.currentSha){this.next(t,'P0_FINAL','NEED_FINAL_COMMIT_P0');return;}
        if(t.p0Dispute){this.next(t,'ARBITRATOR','ARBITRATOR_TRIGGERED');return;}
        if(t.bFindings.length){this.next(t,'B_ENTER','P0_FINDINGS_OUTSTANDING');return;}
        this.next(t,'READY_FINAL','GATE_B_TEST_PASS');return;
      }
      case 'P0_FINAL':{
        const r=await this.p0Review(t,`final-B${t.bRound}`);
        t.p0Final=r;t.bFindings=[...r.findings];
        if(!r.passed && t.bFindings.length===0) t.bFindings=['Final P0 verdict not PASS; report requires investigation'];
        t.p0Dispute=r.dispute||(r.reports.some(x=>x.verdict==='PASS')&&r.reports.some(x=>x.verdict==='FAIL'));
        if(t.p0Dispute){this.next(t,'ARBITRATOR','P0_CONFLICT_NEEDS_ARBITRATION');return;}
        if(!r.passed || t.bFindings.length){this.next(t,'B_ENTER','P0_FINAL_REQUIRES_REMEDIATION');return;}
        this.next(t,'READY_FINAL','P0_FINAL_PASS',{sha:r.commit});return;
      }
      case 'ARBITRATOR':{
        const r=await this.invoke(t,'arbitrator',`B${t.bRound}-arbitrator`,
          `TASK_SPEC:\n${t.taskSpec}\nConflict reports for commit ${t.currentSha}:\n${JSON.stringify(t.p0Final??t.p0Initial)}\nAdjudicate technical disagreement; you cannot waive quorum, tests or compliance.`,t.worktree);
        if(PAUSE(r.verdict)||!PASS(r.verdict)){this.paused(t,'Unresolved arbitration: '+r.summary);return;}
        // Arbitrator cannot override an actual FAIL or an invalid P0 report.
        if(t.bFindings.length||!(t.p0Final??t.p0Initial)?.passed){this.paused(t,'Arbitrator cannot waive blocking P0 findings; human action required');return;}
        t.p0Dispute=false;
        this.next(t,'READY_FINAL','ARBITRATION_RECORDED');return;
      }
      case 'READY_FINAL':{
        this.compliance(t);
        const compliance=this.store.artifact(t.id,'final-compliance.json',{
          policy:'10+10+Compliance Gate',taskId:t.id,baseSha:t.baseSha,
          finalSha:t.currentSha,aRound:t.aRound,bRound:t.bRound,
          p0:(t.p0Final??t.p0Initial).reports.map(x=>({nodeId:x.nodeId,physicalId:x.physicalId,commit:x.commit,verdict:x.verdict})),
          testerB:t.lastB.tests.receipts,controller:'v0.1.0',taskConfigSha:t.frozen.digest,
          ledger:this.store.verify(t.id),pass:true});
        this.next(t,'WAIT_GATE_59','WAITING_HUMAN_GATE_5_9',{complianceSha256:compliance.sha256,finalCommit:t.currentSha});return;
      }
      default:throw new Error(`unknown stage ${t.stage}`);
    }
  }
  async run(id,{maxSteps=100}={}){
    return this.store.withLock(id,async()=>{
      const start=this.required(id);
      try { await this.livePreflight(start); }
      catch (e) {
        // Never re-seal corrupted state: a detected ledger failure must stay corrupt
        // and require offline forensic recovery from a trusted anchor (R2-001).
        this.store.verify(id);
        if (!TERMINAL.has(start.stage)) {
          start.status='BLOCKED'; start.pendingHuman=`Preflight failed: ${e.message}`;
          start.blockedStage=start.stage; start.stage='BLOCKED';
          this.store.save(start,'PREFLIGHT_BLOCKED',{reason:e.message});
        }
        throw e;
      }
      for(let i=0;i<maxSteps;i++){
        const t=this.required(id);
        if(TERMINAL.has(t.stage))return {id,stage:t.stage,status:t.status,aRound:t.aRound,bRound:t.bRound,currentSha:t.currentSha};
        assert(t.status==='READY',`task state ${t.status}: reconcile before dispatch`);
        try{await this.step(t);}catch(e){
          const latest=this.required(id);
          if(latest.status==='INFLIGHT'||latest.status==='READY'){
            const uncertain=Boolean(latest.inflight) || this.store.dispatches(id).some(d=>d.state!=='TERMINAL');
            latest.blockedStage=t.stage;
            latest.stage=uncertain?'NEEDS_RECONCILIATION':'BLOCKED';
            latest.status=uncertain?'NEEDS_RECONCILIATION':'BLOCKED';
            latest.pendingHuman=`Stage ${t.stage} failed: ${e.message}`;
            this.store.save(latest,'UNEXPECTED_STAGE_ERROR',{error:e.message,uncertain});
          }
          throw e;
        }
      }
      throw new Error('maxStep guard reached; invoke run explicitly again');
    });
  }
  inspect(id){return this.store.readSnapshot(()=>{
    this.store.verify(id);
    const t=this.required(id);return {id,stage:t.stage,status:t.status,aRound:t.aRound,bRound:t.bRound,sha:t.currentSha,
      specSha:t.taskSpecSha,configSha:t.frozen.digest,inflight:t.inflight,pendingHuman:t.pendingHuman,
      dispatches:this.store.dispatches(id),ledger:this.store.verify(id)};
  });}
  // Noncompliance recovery deliberately has no generic skip-a-gate operation.
  authorizeRecovery({id,actor,receipt,expectedSha=null,expectedBasis=null}){
    this.store.verify(id);
    const t=this.required(id);
    assert(t.stage==='BLOCKED'&&t.status==='BLOCKED','recovery only for definitely blocked, non-inflight stage');
    assert(!t.inflight,'recovery requires zero in-flight operations');
    assert(this.store.dispatches(id).every(d=>d.state==='TERMINAL'),
      'outstanding dispatch must be reconciled with original provider/host receipts first');
    if(t.currentSha!==null) assert(t.currentSha===expectedSha,'Git SHA not the approved recovery basis');
    else {
      assert(expectedSha===null,'pre-commit recovery must not invent a Git SHA');
      assert(expectedBasis===(t.taskSpecSha??t.frozen.digest),
        'pre-commit recovery requires the frozen task/spec digest as explicit basis');
    }
    assert(typeof actor==='string'&&actor.trim().length>1&&typeof receipt==='string'&&receipt.length>15,'explicit recovery receipt required');
    const ev=this.store.artifact(id,`recovery-${randomUUID().slice(0,10)}.json`,{actor,receipt,expectedSha,expectedBasis,origin:t.stage});
    // Recovery moves only to a revalidation stage, never unconditionally to PASS.
    t.pendingHuman=null;t.status='READY';
    // Never skip review or tests after a compliance violation. Re-enter an earlier
    // technical stage; its budget remains consumed, subject to the fixed limit.
    if(t.p0Initial)t.stage='B_ENTER';
    else if(t.taskSpecSha&&t.baseSha)t.stage='A_WORKER';
    else if(t.taskSpecSha)t.stage='PREPARE';
    else t.stage='PLANNER';
    this.store.save(t,'HUMAN_CONTROLLED_RECOVERY',{actor,evidenceSha256:ev.sha256,target:t.stage});
    return {id,stage:t.stage};
  }
}
