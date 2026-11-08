import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { verifyCommitEvidenceSync } from './git.mjs';
import {loadTrustRoots,verifyHumanApproval} from './auth.mjs';
import {SshP0Adapter} from './p0.mjs';
import { canonical, sha256, assert, checkedId, MAX_A, MAX_B, ROLE_PERMISSIONS, PASS } from './policy.mjs';

export class Store {
  // Only the Store's own verified, synchronous mutation methods may append
  // against an already-mutated row. No public caller can set this private flag.
  #trustedEventWrite=false;
  #trustRoots=null;
  #appendVerifiedMutation(id,type,payload) {
    assert(!this.#trustedEventWrite,'nested trusted event append forbidden');
    this.#trustedEventWrite=true;
    try { return this.event(id,type,payload); }
    finally { this.#trustedEventWrite=false; }
  }
  constructor(root,{readOnly=false,gitVerifier}={}) {
    assert(gitVerifier===undefined,'injectable Git verifier forbidden in production');
    this.#trustRoots=loadTrustRoots();
    this.root=path.resolve(root);
    this.readOnly=readOnly;
    if (readOnly) {
      assert(fs.existsSync(path.join(this.root,'workflow.sqlite')),'state database not found (read-only)');
    } else fs.mkdirSync(this.root,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path.join(this.root,'workflow.sqlite'),{readOnly});
    if(!readOnly) this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, previous TEXT NOT NULL, digest TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dispatches(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, phase TEXT NOT NULL, agent_id TEXT, state TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts(task_id TEXT NOT NULL, name TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(task_id,name));`);
  }
  dir(id) { return path.join(this.root,'tasks',checkedId(id)); }
  trustRootDigest(){return this.#trustRoots?.digest??null;}
  verifyHumanProof(envelope,fields){
    return verifyHumanApproval(this.#trustRoots,envelope,fields);
  }
  transaction(fn) {
    assert(!this.readOnly,'store opened read-only');
    this.db.exec('BEGIN IMMEDIATE');
    try {const result=fn(); this.db.exec('COMMIT');return result;}
    catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  dispatchHash(id){
    return sha256(this.db.prepare('SELECT id,phase,agent_id,state,created FROM dispatches WHERE task_id=? ORDER BY id').all(id));
  }
  artifactHash(id){
    return sha256(this.db.prepare('SELECT name,digest FROM artifacts WHERE task_id=? ORDER BY name').all(id));
  }
  artifact(id,name,content) {
    assert(!this.readOnly,'store opened read-only');
    assert(/^[a-zA-Z0-9._-]{1,100}$/.test(name),'unsafe artifact filename');
    const data=typeof content==='string'?content:canonical(content);
    const digest=sha256(data);
    // BEGIN IMMEDIATE spans verification, disk write/fsync and registration:
    // no other SQLite writer can slip between the verified anchor and append.
    // A file left by a failed registration is intentionally an orphan that
    // requires manual reconciliation; never delete potentially useful evidence.
    return this.transaction(()=>{
      this.verify(id);
      const anchor={
        state:sha256(this.get(id)),
        dispatch:this.dispatchHash(id),
        artifacts:this.artifactHash(id),
        head:this.db.prepare('SELECT digest FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id)?.digest,
      };
      const base=path.join(this.dir(id),'evidence');
      fs.mkdirSync(base,{recursive:true,mode:0o700});
      const file=path.join(base,name);
      const fd=fs.openSync(file,'wx',0o600);
      try{fs.writeFileSync(fd,data,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      // Recheck even under BEGIN IMMEDIATE: same-connection/monkeypatched
      // synchronous callbacks must not re-anchor an altered state.
      assert(anchor.state===sha256(this.get(id)),'task state changed during evidence fsync');
      assert(anchor.dispatch===this.dispatchHash(id),'dispatch changed during evidence fsync');
      assert(anchor.artifacts===this.artifactHash(id),'manifest changed during evidence fsync');
      assert(anchor.head===this.db.prepare('SELECT digest FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id)?.digest,
        'ledger changed during evidence fsync');
      this.db.prepare('INSERT INTO artifacts(task_id,name,digest) VALUES(?,?,?)').run(id,name,digest);
      this.#appendVerifiedMutation(id,'ARTIFACT_REGISTERED',{name,digest});
      return {path:file,sha256:digest};
    });
  }
  #validateCreation(t){
    checkedId(t?.id);
    assert(t.trustRootSha256===this.trustRootDigest(),
      'new task trust roots are not pinned to approved deployment');
    assert(t.stage==='WAIT_GATE_01'&&t.status==='WAITING_HUMAN',
      'new tasks must start at human Gate 0.1');
    assert(t.aRound===0&&t.bRound===0,'new task round budgets must start at zero');
    for(const key of ['taskSpec','taskSpecSha','baseSha','currentSha','lastA','lastB','p0Initial','p0Final'])
      assert(t[key]===null||t[key]===undefined,`new task may not pre-seed ${key}`);
    assert(!t.inflight&&!t.pendingHuman,'new task must not claim pending execution');
    assert(!t.changesInB,'new task cannot claim B changes');
    assert(Array.isArray(t.history)&&t.history.length===0,'new task history must be empty');
    assert(!t.bFindings||Array.isArray(t.bFindings)&&t.bFindings.length===0,
      'new task cannot preload findings');
    assert(t.frozen&&typeof t.frozen==='object'&&typeof t.frozen.digest==='string',
      'frozen source required');
    const {digest,...snapshot}=t.frozen;
    assert(digest===sha256(snapshot),'new task frozen digest mismatch');
    if(t.frozen.intentSha256!==undefined)
      assert(sha256(t.frozen.intent)===t.frozen.intentSha256,'new task intent hash mismatch');
    assert(t.frozen.policy?.maxA===MAX_A&&t.frozen.policy?.maxB===MAX_B,
      'new task budget policy mismatch');
    for(const [role,permission] of Object.entries(ROLE_PERMISSIONS))
      assert(t.frozen.policy?.permissions?.[role]===permission,
        `new task role permissions mismatch: ${role}`);
    for(const soul of Object.values(t.frozen.souls??{}))
      assert(typeof soul.text==='string'&&soul.sha256===sha256(soul.text),
        'new task Soul content/digest mismatch');
  }
  #requireArtifact(id,name,digest){
    assert(typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest),
      'missing trustworthy artifact digest');
    const entry=this.db.prepare('SELECT digest FROM artifacts WHERE task_id=? AND name=?').get(id,name);
    assert(entry?.digest===digest,`required registered artifact missing: ${name}`);
    return fs.readFileSync(path.join(this.dir(id),'evidence',name),'utf8');
  }
  #checkGateReceipt(oldTask,nextTask,type,payload){
    const gate=type==='GATE_0.1_APPROVED'?'0.1':type==='GATE_0.2_APPROVED'?'0.2':'5.9';
    const file=`approval-${gate.replace('.','-')}.json`;
    const raw=this.#requireArtifact(oldTask.id,file,payload.approvalSha256);
    const receipt=JSON.parse(raw);
    const digest=gate==='0.1'?oldTask.frozen.digest:gate==='0.2'?oldTask.taskSpecSha:oldTask.currentSha;
    assert(receipt.gate===gate&&receipt.digest===digest&&payload.digest===digest,
      'approval artifact does not match exact Gate basis');
    assert(typeof receipt.actor==='string'&&receipt.actor.length>1&&
      typeof receipt.receipt==='string'&&receipt.receipt.length>15&&
      payload.actor===receipt.actor,'human Gate receipt missing or inconsistent');
    assert(oldTask.trustRootSha256!==null&&
      oldTask.trustRootSha256===this.trustRootDigest(),
      'approval trust roots changed or were not independently provisioned');
    this.verifyHumanProof(receipt.proof,{
      taskId:oldTask.id,gate,digest,actor:receipt.actor,receipt:receipt.receipt,
    });
    assert(receipt.proof.statement.nonce===payload.approvalNonce,
      'approval signature nonce does not match persisted transition');
    if(gate==='0.2'){
      assert(oldTask.taskSpecSha&&oldTask.taskSpec,'Gate 0.2 needs frozen TASK_SPEC');
      this.#requireArtifact(oldTask.id,'TASK_SPEC.md',oldTask.taskSpecSha);
    }
    if(gate==='5.9')this.#validateFinalGate(oldTask);
  }
  #validateFinalGate(t){
    assert(t.stage==='WAIT_GATE_59'&&t.status==='WAITING_HUMAN',
      'Gate 5.9 requires waiting human stage');
    assert(t.aRound>=1&&t.bRound>=1&&t.aRound<=MAX_A&&t.bRound<=MAX_B,
      'Gate 5.9 has incomplete or invalid round budgets');
    assert(typeof t.baseSha==='string'&&/^[a-f0-9]{40}$/.test(t.baseSha)&&
      typeof t.currentSha==='string'&&/^[a-f0-9]{40}$/.test(t.currentSha),
      'Gate 5.9 requires exact frozen Git commits');
    assert(t.lastA?.pass===true&&t.lastA?.commit,'Gate 5.9 missing Tester A pass');
    assert(t.lastB?.pass===true&&t.lastB?.tests?.pass===true&&
      t.lastB?.commit===t.currentSha,'Gate 5.9 missing independent Tester B pass');
    const p0=t.p0Final??t.p0Initial;
    assert(p0?.passed===true&&p0.commit===t.currentSha,
      'Gate 5.9 requires P0 for the exact final SHA');
    assert(Array.isArray(p0.reports)&&p0.reports.length>=2&&
      new Set(p0.reports.map(r=>r.physicalId)).size>=2&&
      p0.reports.every(r=>r.commit===t.currentSha&&PASS(r.verdict)&&
        Array.isArray(r.findings)&&r.findings.length===0),
      'Gate 5.9 P0 physical quorum/commit/findings invalid');
    assert(!t.bFindings?.length,'Gate 5.9 unresolved findings');
    verifyCommitEvidenceSync(t.frozen.project.repo,t.baseSha,t.currentSha,t.worktree);
    this.#verifyP0Nodes(t,p0);
    const record=this.db.prepare("SELECT name,digest FROM artifacts WHERE task_id=? AND name='final-compliance.json'").get(t.id);
    const artifact=JSON.parse(this.#requireArtifact(t.id,'final-compliance.json',record?.digest));
    assert(artifact.pass===true&&artifact.finalSha===t.currentSha&&
      artifact.baseSha===t.baseSha&&artifact.taskConfigSha===t.frozen.digest,
      'Gate 5.9 final compliance receipt mismatched');
    assert(t.history.some(h=>h.role==='test_executor'&&h.sha===t.currentSha&&h.pass===true&&
      this.db.prepare('SELECT 1 FROM artifacts WHERE task_id=? AND digest=?').get(t.id,h.evidenceSha256)),
      'Gate 5.9 needs persisted Tester B receipts');
    assert(t.history.some(h=>h.role==='P0'&&h.sha===t.currentSha&&h.passed===true&&
      this.db.prepare('SELECT 1 FROM artifacts WHERE task_id=? AND digest=?').get(t.id,h.evidenceSha256)),
      'Gate 5.9 needs persisted P0 evidence');
  }
  #verifyP0Nodes(t,summary){
    const inventory=(t.frozen.p0?.nodes??[]).filter(n=>n.enabled===true);
    assert(inventory.length>=2,'no trusted independent P0 node inventory');
    const adapter=new SshP0Adapter(inventory);
    adapter.validateInventory();
    const distinct=new Set();
    for(const report of summary.reports){
      const node=inventory.find(n=>n.id===report.nodeId);
      assert(node,'P0 report node not present in approved physical inventory');
      assert(!distinct.has(node.physicalId),'duplicate P0 physical node');
      const cycle=summary.cycle;
      assert(typeof cycle==='string'&&/^(initial-A|final-B)\d+$/.test(cycle),
        'invalid signed P0 cycle');
      const jobId=sha256(`${t.id}:${cycle}:${t.currentSha}:${node.id}`).slice(0,40);
      const name=`p0-${cycle}-${node.id}-result.json`;
      assert(report.evidence?.sha256,'P0 node raw evidence digest missing');
      const raw=this.#requireArtifact(t.id,name,report.evidence.sha256);
      const verified=adapter.verify(node,JSON.parse(raw),jobId,t.currentSha);
      assert(verified.physicalId===report.physicalId&&verified.verdict===report.verdict&&
        canonical(verified.findings)===canonical(report.findings),
        'P0 summary does not match authenticated raw node report');
      const dispatch=this.db.prepare('SELECT state,agent_id,phase FROM dispatches WHERE id=? AND task_id=?')
        .get(jobId,t.id);
      assert(dispatch?.state==='TERMINAL'&&dispatch.phase===`P0:${cycle}:${node.id}`,
        'P0 report has no completed, recorded remote dispatch');
      distinct.add(node.physicalId);
    }
    assert(distinct.size>=2,'P0 authenticated physical quorum incomplete');
  }
  #verifyReviewerPair(t){
    const prefix=t.stage==='A_REVIEW'? 'A'+t.aRound:'B'+t.bRound;
    const phase=`${prefix}-review`, roles=['spec_reviewer','quality_reviewer'];
    const seen=new Set();
    for(const role of roles){
      const matches=t.history.filter(h=>h.role===role&&h.phase===phase&&h.sha===t.currentSha);
      assert(matches.length===1,'two independent Reviewer seats required for exact Commit');
      const h=matches[0];
      assert(typeof h.agentId==='string'&&h.agentId&&!seen.has(h.agentId),
        'Reviewer agent identity missing or reused');
      seen.add(h.agentId);
      const artifact=this.db.prepare('SELECT name FROM artifacts WHERE task_id=? AND digest=?')
        .get(t.id,h.evidenceSha256);
      assert(artifact,'missing Reviewer registered result');
      const raw=JSON.parse(this.#requireArtifact(t.id,artifact.name,h.evidenceSha256));
      assert(raw.agentId===h.agentId&&raw.role===role&&raw.verdict===h.verdict&&
        raw.phase===phase+'-'+role&&PASS(raw.verdict)&&
        Array.isArray(raw.findings)&&
        (raw.verdict==='PASS'?raw.findings.length===0:
          raw.findings.every(f=>/^\s*(?:[-*]\s*)?\[?(?:LOW|MEDIUM|INFO|ADVISORY)\]?\s*[:：-]/i.test(f))),
        'Reviewer result missing or has unclassified/blocking findings');
      const dispatch=this.db.prepare('SELECT state,agent_id FROM dispatches WHERE task_id=? AND phase=?')
        .all(t.id,phase+'-'+role);
      assert(dispatch.some(d=>d.state==='TERMINAL'&&d.agent_id===h.agentId),
        'Reviewer has no completed Paseo dispatch/ACK');
    }
  }
  #verifyRecoveryReceipt(oldTask,nextTask,payload){
    assert(oldTask.trustRootSha256!==null&&
      oldTask.trustRootSha256===this.trustRootDigest(),
      'recovery trust roots not independently provisioned');
    const name=this.db.prepare('SELECT name FROM artifacts WHERE task_id=? AND digest=?')
      .get(oldTask.id,payload.evidenceSha256)?.name;
    assert(typeof name==='string'&&/^recovery-[a-z0-9-]+\.json$/.test(name),
      'authenticated recovery artifact missing');
    const data=JSON.parse(this.#requireArtifact(oldTask.id,name,payload.evidenceSha256));
    const basis=oldTask.currentSha??oldTask.taskSpecSha??oldTask.frozen.digest;
    assert(data.origin==='BLOCKED'&&data.target===nextTask.stage&&
      data.actor===payload.actor&&data.expectedSha===(oldTask.currentSha??null)&&
      data.expectedBasis===(oldTask.currentSha?null:oldTask.taskSpecSha??oldTask.frozen.digest),
      'recovery artifact/target/basis mismatch');
    this.verifyHumanProof(data.proof,{taskId:oldTask.id,gate:'recovery',
      digest:basis,actor:data.actor,receipt:data.receipt});
    assert(payload.recoveryNonce===data.proof.statement.nonce,
      'recovery signed nonce mismatch');
    for(const row of this.db.prepare(
      "SELECT payload FROM events WHERE task_id=? AND type='HUMAN_CONTROLLED_RECOVERY'"
    ).all(oldTask.id))
      assert(JSON.parse(row.payload).recoveryNonce!==payload.recoveryNonce,
        'replayed recovery authorization');
  }
  #validateStageTransition(oldTask,t,type,payload){
    const moves={
      'GATE_0.1_APPROVED':['WAIT_GATE_01','PLANNER'],
      'GATE_0.2_APPROVED':['WAIT_GATE_02','PREPARE'],
      'GATE_5.9_APPROVED':['WAIT_GATE_59','CLOSED'],
      'TASK_SPEC_CANDIDATE':['PLANNER','WAIT_GATE_02'],
      'WORKTREE_PREPARED':['PREPARE','A_WORKER'],
      'A_COMMIT_FROZEN':['A_WORKER','A_REVIEW'],
      'A_REVIEW_FAIL':['A_REVIEW','A_WORKER'],
      'A_REVIEW_PASS':['A_REVIEW','A_TEST'],
      'GATE_A_TEST_FAIL':['A_TEST','A_WORKER'],
      'GATE_A_PASS':['A_TEST','P0_INITIAL'],
      'P0_INITIAL_COLLECTED':['P0_INITIAL','B_ENTER'],
      'B_REMEDIATION_REQUIRED':['B_ENTER','B_WORKER'],
      'B_REMEDIATION_SKIPPED':['B_ENTER','B_TEST'],
      'GATE_A_EXHAUSTED':['A_WORKER','STOPPED_BUDGET'],
      'GATE_B_EXHAUSTED':['B_ENTER','STOPPED_BUDGET'],
      'B_WORKER_FAIL':['B_WORKER','B_ENTER'],
      'B_COMMIT_FROZEN':['B_WORKER','B_REVIEW'],
      'B_REVIEW_FAIL':['B_REVIEW','B_ENTER'],
      'B_REVIEW_PASS':['B_REVIEW','B_TEST'],
      'B_TEST_FAIL':['B_TEST','B_ENTER'],
      'NEED_FINAL_COMMIT_P0':['B_TEST','P0_FINAL'],
      'ARBITRATOR_TRIGGERED':['B_TEST','ARBITRATOR'],
      'P0_FINDINGS_OUTSTANDING':['B_TEST','B_ENTER'],
      'GATE_B_TEST_PASS':['B_TEST','READY_FINAL'],
      'P0_CONFLICT_NEEDS_ARBITRATION':['P0_FINAL','ARBITRATOR'],
      'P0_FINAL_REQUIRES_REMEDIATION':['P0_FINAL','B_ENTER'],
      'P0_FINAL_PASS':['P0_FINAL','READY_FINAL'],
      'ARBITRATION_RECORDED':['ARBITRATOR','READY_FINAL'],
      'WAITING_HUMAN_GATE_5_9':['READY_FINAL','WAIT_GATE_59'],
    };
    const same=new Set(['INFLIGHT','EXECUTION_UNCERTAIN','ROLE_TERMINAL','REVIEW_PAIR_STARTED',
      'REVIEW_SEAT_RECORDED','REVIEW_PAIR_UNCERTAIN','REVIEW_PAIR_TERMINAL',
      'TEST_RECEIPTS','P0_STARTED','P0_UNCERTAIN','P0_COMPLETE',
      'GATE_A_ROUND_START','GATE_B_ROUND_START','WORKER_TECHNICAL_FAIL','AUDIT_NOTE']);
    if(moves[type]){
      assert(oldTask.stage===moves[type][0]&&t.stage===moves[type][1],
        `illegal workflow stage transition ${type}: ${oldTask.stage} -> ${t.stage}`);
      const status=type==='GATE_5.9_APPROVED'?'APPROVED_FOR_SEPARATE_RELEASE_REVIEW':
        ['TASK_SPEC_CANDIDATE','WAITING_HUMAN_GATE_5_9','GATE_A_EXHAUSTED','GATE_B_EXHAUSTED'].includes(type)?'WAITING_HUMAN':'READY';
      assert(t.status===status,`unexpected status for stage transition ${type}`);
    }else if(same.has(type)){
      assert(t.stage===oldTask.stage,`event ${type} cannot change stage`);
      const status={
        INFLIGHT:'INFLIGHT',P0_STARTED:'INFLIGHT',REVIEW_PAIR_STARTED:'INFLIGHT',
        EXECUTION_UNCERTAIN:'NEEDS_RECONCILIATION',
        P0_UNCERTAIN:'NEEDS_RECONCILIATION',REVIEW_PAIR_UNCERTAIN:'NEEDS_RECONCILIATION',
        ROLE_TERMINAL:'READY',P0_COMPLETE:'READY',REVIEW_PAIR_TERMINAL:'READY',
      }[type];
      if(status)assert(t.status===status,`unexpected status for ${type}`);
      else assert(t.status===oldTask.status,`event ${type} cannot change task status`);
      const scoped={
        GATE_A_ROUND_START:['A_WORKER'],GATE_B_ROUND_START:['B_ENTER'],
        REVIEW_PAIR_STARTED:['A_REVIEW','B_REVIEW'],REVIEW_SEAT_RECORDED:['A_REVIEW','B_REVIEW'],
        REVIEW_PAIR_UNCERTAIN:['A_REVIEW','B_REVIEW'],REVIEW_PAIR_TERMINAL:['A_REVIEW','B_REVIEW'],
        P0_STARTED:['P0_INITIAL','P0_FINAL'],P0_UNCERTAIN:['P0_INITIAL','P0_FINAL'],
        P0_COMPLETE:['P0_INITIAL','P0_FINAL'],
      };
      if(scoped[type])assert(scoped[type].includes(oldTask.stage),
        `event ${type} not allowed at stage ${oldTask.stage}`);
      if(type==='ROLE_TERMINAL'||type==='EXECUTION_UNCERTAIN'||type==='REVIEW_PAIR_TERMINAL'||
         type==='P0_COMPLETE'||type==='REVIEW_PAIR_UNCERTAIN')
        assert(oldTask.status==='INFLIGHT',`event ${type} requires in-flight execution`);
    }else if(type==='HUMAN_CONTROLLED_RECOVERY'){
      assert(oldTask.stage==='BLOCKED'&&oldTask.status==='BLOCKED'&&
        ['PLANNER','PREPARE','A_WORKER','B_ENTER'].includes(t.stage)&&t.status==='READY',
        'recovery cannot skip a stage or clear unresolved state');
      this.#verifyRecoveryReceipt(oldTask,t,payload);
    }else if(type==='AWAITING_CLARIFICATION'||type==='COMPLIANCE_OR_INFRA_BLOCK'){
      assert(t.stage===(type==='AWAITING_CLARIFICATION'?'WAIT_HUMAN':'BLOCKED')&&
        t.status==='WAITING_HUMAN','invalid human-stop transition');
    }else if(type==='PREFLIGHT_BLOCKED'){
      assert(oldTask.status==='READY'&&t.stage==='BLOCKED'&&t.status==='BLOCKED',
        'invalid preflight block');
    }else if(type==='UNEXPECTED_STAGE_ERROR'){
      assert(['BLOCKED','NEEDS_RECONCILIATION'].includes(t.stage)&&
        t.status===t.stage,'invalid unexpected error reconciliation');
    }else{
      throw new Error(`unrecognized workflow state transition: ${type}`);
    }
    if(type.startsWith('GATE_')&&type.endsWith('_APPROVED'))
      this.#checkGateReceipt(oldTask,t,type,payload);
    if(type==='GATE_A_ROUND_START')
      assert(t.aRound===oldTask.aRound+1&&t.bRound===oldTask.bRound,
        'Gate A round start must consume exactly one A slot');
    if(type==='GATE_B_ROUND_START')
      assert(t.bRound===oldTask.bRound+1&&t.aRound===oldTask.aRound,
        'Gate B round start must consume exactly one B slot');
    if(type==='WORKTREE_PREPARED')
      assert(/^[a-f0-9]{40}$/.test(t.baseSha??'')&&t.baseSha===t.currentSha&&
        typeof t.worktree==='string'&&t.worktree.length>0,
        'worktree preparation requires exact base SHA and path');
    if(type==='A_COMMIT_FROZEN'||type==='B_COMMIT_FROZEN'){
      assert(/^[a-f0-9]{40}$/.test(t.currentSha??'')&&
        t.baseSha&&t.currentSha!==oldTask.currentSha,
        'commit freeze requires changed full Git SHA and frozen base');
    }
    if(type==='A_REVIEW_PASS'||type==='B_REVIEW_PASS')
      this.#verifyReviewerPair(oldTask);
    if(type==='GATE_A_PASS'){
      assert(t.lastA?.pass===true&&t.lastA?.tests?.pass===true&&
        t.lastA.commit===t.currentSha,'Gate A pass requires successful Tester A evidence');
      assert(t.history.some(h=>h.role==='test_executor'&&h.sha===t.currentSha&&h.pass===true&&
        this.db.prepare('SELECT 1 FROM artifacts WHERE task_id=? AND digest=?').get(t.id,h.evidenceSha256)),
        'Gate A pass requires registered Tester evidence');
    }
    if(['NEED_FINAL_COMMIT_P0','ARBITRATOR_TRIGGERED','P0_FINDINGS_OUTSTANDING','GATE_B_TEST_PASS'].includes(type)){
      assert(t.lastB?.pass===true&&t.lastB?.tests?.pass===true&&t.lastB.commit===t.currentSha,
        'Gate B pass requires matching Tester B evidence');
      assert(t.history.some(h=>h.role==='test_executor'&&h.sha===t.currentSha&&h.pass===true&&
        this.db.prepare('SELECT 1 FROM artifacts WHERE task_id=? AND digest=?').get(t.id,h.evidenceSha256)),
        'Gate B pass requires registered Tester B evidence');
    }
    if(type==='P0_INITIAL_COLLECTED'||type==='P0_FINAL_PASS'||
       type==='P0_CONFLICT_NEEDS_ARBITRATION'||type==='P0_FINAL_REQUIRES_REMEDIATION'){
      const p0=type==='P0_INITIAL_COLLECTED'?t.p0Initial:t.p0Final;
      assert(p0?.commit===t.currentSha&&Array.isArray(p0.reports)&&p0.reports.length>=2,
        'P0 transition missing exact-commit multi-seat report');
      assert(t.history.some(h=>h.role==='P0'&&h.sha===t.currentSha&&
        this.db.prepare('SELECT 1 FROM artifacts WHERE task_id=? AND digest=?').get(t.id,h.evidenceSha256)),
        'P0 transition missing persisted review evidence');
    }
    if(type==='TASK_SPEC_CANDIDATE'){
      assert(t.taskSpecSha===payload.sha256,'Planner TASK_SPEC digest missing from transition');
      this.#requireArtifact(t.id,'TASK_SPEC.md',t.taskSpecSha);
      assert(oldTask.status==='READY'&&oldTask.inflight===null||oldTask.status==='READY'&&oldTask.inflight===undefined,
        'Planner must be completed before freezing TASK_SPEC');
    }
    if(type==='WAITING_HUMAN_GATE_5_9')this.#validateFinalGate({...t,stage:'WAIT_GATE_59',status:'WAITING_HUMAN'});
    const protectedEvidence={
      lastA:new Set(['GATE_A_PASS']),
      lastB:new Set(['NEED_FINAL_COMMIT_P0','ARBITRATOR_TRIGGERED','P0_FINDINGS_OUTSTANDING','GATE_B_TEST_PASS']),
      p0Initial:new Set(['P0_INITIAL_COLLECTED']),
      p0Final:new Set(['P0_CONFLICT_NEEDS_ARBITRATION','P0_FINAL_REQUIRES_REMEDIATION','P0_FINAL_PASS']),
    };
    for(const [key,events] of Object.entries(protectedEvidence))
      if(canonical(oldTask[key])!==canonical(t[key]))
        assert(events.has(type),`${key} may only update at verified workflow stage`);
    if(type==='WAITING_HUMAN_GATE_5_9'||type==='GATE_5.9_APPROVED')
      this.#validateFinalGate(type==='GATE_5.9_APPROVED'?oldTask:{...t,stage:'WAIT_GATE_59',status:'WAITING_HUMAN'});
  }
  init(task) {
    this.#validateCreation(task);
    assert(!this.get(task.id),'task already exists');
    fs.mkdirSync(this.dir(task.id),{recursive:true,mode:0o700});
    this.transaction(()=>{
      this.db.prepare('INSERT INTO tasks(id,data) VALUES(?,?)').run(task.id,canonical(task));
      this.#appendVerifiedMutation(task.id,'CREATED',{digest:task.frozen.digest});
    });
  }
  get(id) {
    const row=this.db.prepare('SELECT data FROM tasks WHERE id=?').get(checkedId(id));
    return row?JSON.parse(row.data):null;
  }
  #validateTaskTransition(oldTask,nextTask,type,payload){
    this.#validateStageTransition(oldTask,nextTask,type,payload);
    assert(oldTask&&nextTask&&oldTask.id===nextTask.id,'task identity changed');
    assert(canonical(nextTask.frozen)===canonical(oldTask.frozen),
      'frozen config is immutable after task creation');
    for(const [key,limit] of [['aRound',10],['bRound',10]]){
      const prev=oldTask[key],curr=nextTask[key];
      if(prev===undefined&&curr===undefined)continue; // synthetic legacy fixtures
      assert(Number.isInteger(prev)&&prev>=0&&prev<=limit,
        `invalid persisted ${key} round counter`);
      assert(Number.isInteger(curr)&&curr>=prev&&curr<=limit&&curr-prev<=1,
        `${key} budget cannot reset, decrease, skip rounds or exceed limit`);
      if(curr!==prev)
        assert(type===(key==='aRound'?'GATE_A_ROUND_START':'GATE_B_ROUND_START'),
          `${key} may only advance in its round-start transition`);
    }
    const pair=(t)=>{
      const spec=t.taskSpec,hash=t.taskSpecSha;
      const present=spec!==null&&spec!==undefined;
      assert(present===(hash!==null&&hash!==undefined),
        'TASK_SPEC and digest must both be present or absent');
      if(!present)return null;
      assert(typeof spec==='string'&&spec.length>20&&typeof hash==='string'&&hash===sha256(spec),
        'TASK_SPEC digest mismatch');
      return {spec,hash};
    };
    const before=pair(oldTask),after=pair(nextTask);
    if(before){
      assert(after&&after.spec===before.spec&&after.hash===before.hash,
        'approved TASK_SPEC is immutable');
    }else if(after){
      assert(type==='TASK_SPEC_CANDIDATE',
        'TASK_SPEC may only be frozen at the Planner candidate transition');
    }
    for(const key of ['created','baseSha']){
      if(oldTask[key]!==undefined&&oldTask[key]!==null)
        assert(nextTask[key]===oldTask[key],`${key} cannot be replaced`);
    }
    if(oldTask.baseSha===null&&nextTask.baseSha!==null&&nextTask.baseSha!==undefined)
      assert(type==='WORKTREE_PREPARED','baseSha may only be established by worktree preparation');
    if(oldTask.worktree!==null&&oldTask.worktree!==undefined)
      assert(nextTask.worktree===oldTask.worktree,'worktree path is immutable after preparation');
    if((oldTask.worktree===null||oldTask.worktree===undefined)&&nextTask.worktree){
      assert(type==='WORKTREE_PREPARED','worktree path may only be established at preparation');
      assert(path.resolve(nextTask.worktree)===path.resolve(this.dir(nextTask.id),'worktree'),
        'worktree must use the task-isolated approved directory');
    }
    if(oldTask.currentSha!==undefined&&oldTask.currentSha!==nextTask.currentSha)
      assert(['WORKTREE_PREPARED','A_COMMIT_FROZEN','B_COMMIT_FROZEN'].includes(type),
        'currentSha may only change when freezing a worktree or commit');
    if(oldTask.currentSha!==nextTask.currentSha||
       oldTask.baseSha!==nextTask.baseSha){
      assert(['WORKTREE_PREPARED','A_COMMIT_FROZEN','B_COMMIT_FROZEN'].includes(type),
        'Git trust root can only change at verified freeze events');
      // This check intentionally runs inside the existing immediate SQL
      // transaction: bogus SHA cannot be persisted even transiently.
      verifyCommitEvidenceSync(nextTask.frozen?.project?.repo,nextTask.baseSha,
        nextTask.currentSha,nextTask.worktree,oldTask.currentSha??null);
    }
    if(Array.isArray(oldTask.history)){
      assert(Array.isArray(nextTask.history)&&nextTask.history.length>=oldTask.history.length,
        'history cannot be truncated');
      assert(canonical(nextTask.history.slice(0,oldTask.history.length))===canonical(oldTask.history),
        'history is append-only');
      const added=nextTask.history.slice(oldTask.history.length);
      if(added.length){
        assert(['ROLE_TERMINAL','REVIEW_SEAT_RECORDED','TEST_RECEIPTS','P0_COMPLETE'].includes(type),
          'only authenticated role/test/P0 completion may append history');
        assert(added.length===1,'one evidence-backed history entry per event');
        const entry=added[0];
        const artifact=this.db.prepare('SELECT name FROM artifacts WHERE task_id=? AND digest=?').get(
          nextTask.id,entry?.evidenceSha256);
        assert(artifact,'history entry requires registered evidence artifact');
        if(type==='REVIEW_SEAT_RECORDED')
          assert(['spec_reviewer','quality_reviewer'].includes(entry.role)&&
            entry.agentId,'reviewer history role or identity invalid');
        if(type==='P0_COMPLETE')assert(entry.role==='P0'&&entry.sha===nextTask.currentSha,
          'P0 history must bind exact commit');
        if(type==='TEST_RECEIPTS')assert(entry.role==='test_executor'&&
          entry.sha===nextTask.currentSha,'test receipt must bind exact commit');
      }
    }
  }
  save(t,type,payload={}) {
    this.transaction(()=>{
      this.verify(t.id);
      const oldTask=this.get(t.id);
      this.#validateTaskTransition(oldTask,t,type,payload);
      this.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(canonical(t),t.id);
      this.#appendVerifiedMutation(t.id,type,{stage:t.stage,status:t.status,...payload});
    });
  }
  event(id,type,payload){
    assert(!this.readOnly,'store opened read-only');
    if(!this.#trustedEventWrite) assert(['CONFIG_FROZEN','P0_OPTIONAL_NOT_DISPATCHED'].includes(type),
      'unsupported public event type: use validated Store methods');
    // Standalone events (including P0 probe-skip) MUST verify their anchor
    // before they can add a new chain head. Atomic BEGIN IMMEDIATE prevents a
    // concurrent writer from changing the anchor between verify and append.
    if(!this.#trustedEventWrite)
      return this.transaction(()=>{this.verify(id);return this.#appendEventRaw(id,type,payload);});
    return this.#appendEventRaw(id,type,payload);
  }
  #appendEventRaw(id,type,payload) {
    const prev=this.db.prepare('SELECT digest FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id)?.digest??'0'.repeat(64);
    const at=new Date().toISOString();
    const body=canonical({...payload,_state_sha256:sha256(this.get(id)),
      _dispatch_sha256:this.dispatchHash(id),_artifact_sha256:this.artifactHash(id)});
    const digest=sha256({id,type,body,previous:prev,at});
    this.db.prepare('INSERT INTO events(task_id,type,payload,previous,digest,at) VALUES(?,?,?,?,?,?)').run(id,type,body,prev,digest,at);
    return digest;
  }
  recordIntent(id,phase,dispatchId){
    this.transaction(()=>{
      this.verify(id);
      this.db.prepare('INSERT INTO dispatches(id,task_id,phase,agent_id,state,created) VALUES(?,?,?,?,?,?)')
        .run(dispatchId,id,phase,null,'DISPATCH_INTENT',new Date().toISOString());
      this.#appendVerifiedMutation(id,'DISPATCH_INTENT',{phase,dispatchId});
    });
  }
  recordAck(dispatchId,agentId){
    this.transaction(()=>{
      const d=this.db.prepare('SELECT * FROM dispatches WHERE id=?').get(dispatchId);
      assert(d,'unknown dispatch');
      this.verify(d.task_id);
      assert(d&&d.state==='DISPATCH_INTENT','unknown or previously acknowledged dispatch');
      this.db.prepare('UPDATE dispatches SET agent_id=?,state=? WHERE id=?')
        .run(agentId,'ACKNOWLEDGED',dispatchId);
      this.#appendVerifiedMutation(d.task_id,'DISPATCH_ACK',{dispatchId,agentId,phase:d.phase});
    });
  }
  recordTerminal(dispatchId){
    this.transaction(()=>{
      const d=this.db.prepare('SELECT * FROM dispatches WHERE id=?').get(dispatchId);
      assert(d,'unknown dispatch');
      this.verify(d.task_id);
      assert(d&&d.state==='ACKNOWLEDGED','terminal requires a known acknowledged dispatch');
      this.db.prepare('UPDATE dispatches SET state=? WHERE id=?').run('TERMINAL',dispatchId);
      this.#appendVerifiedMutation(d.task_id,'DISPATCH_TERMINAL',{dispatchId,phase:d.phase,agentId:d.agent_id});
    });
  }
  dispatches(id){return this.db.prepare('SELECT * FROM dispatches WHERE task_id=? ORDER BY created,id').all(id);}
  verify(id){
    assert(this.get(id),'unknown task');
    let previous='0'.repeat(64), count=0;
    for(const e of this.db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY seq').all(id)){
      assert(e.previous===previous,'event ledger previous digest mismatch');
      assert(e.digest===sha256({id,type:e.type,body:e.payload,previous,at:e.at}),'event ledger hash mismatch');
      previous=e.digest;count++;
    }
    assert(count>0,'task missing audit events');
    const last=JSON.parse(this.db.prepare('SELECT payload FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id).payload);
    assert(last._state_sha256===sha256(this.get(id)),'persisted task state differs from ledger');
    assert(last._dispatch_sha256===this.dispatchHash(id),'dispatch ledger mismatch');
    assert(last._artifact_sha256===this.artifactHash(id),'artifact manifest mismatch');
    const registered=this.db.prepare('SELECT name,digest FROM artifacts WHERE task_id=?').all(id);
    const expectedNames=new Set(registered.map(entry=>entry.name));
    const evidenceDir=path.join(this.dir(id),'evidence');
    if(fs.existsSync(evidenceDir)){
      for(const name of fs.readdirSync(evidenceDir)){
        // A crashed artifact registration may leave a real file without a manifest row.
        // Preserve it for manual reconciliation; never silently accept or delete it.
        assert(expectedNames.has(name),`unregistered evidence file requires reconciliation: ${name}`);
        assert(fs.lstatSync(path.join(evidenceDir,name)).isFile(),`non-regular evidence artifact: ${name}`);
      }
    }
    for(const entry of registered){
      const file=path.join(this.dir(id),'evidence',entry.name);
      assert(fs.existsSync(file),'missing registered evidence artifact');
      assert(sha256(fs.readFileSync(file,'utf8'))===entry.digest,`evidence artifact hash mismatch: ${entry.name}`);
    }
    return {events:count,head:previous,dispatchSha256:last._dispatch_sha256,artifactSha256:last._artifact_sha256};
  }
  readSnapshot(fn){
    // All reads including chain verification observe one SQLite snapshot (R2-003).
    this.db.exec('BEGIN');
    try { const result=fn(); this.db.exec('COMMIT'); return result; }
    catch(e){ this.db.exec('ROLLBACK'); throw e; }
  }
  withLock(id,cb){
    assert(!this.readOnly,'store opened read-only');
    const file=path.join(this.dir(id),'controller.lock');
    // Stale lock after crash intentionally requires explicit external reconciliation.
    const fd=fs.openSync(file,'wx',0o600);
    fs.writeSync(fd,JSON.stringify({pid:process.pid,created:new Date().toISOString()}));fs.fsyncSync(fd);
    const done=()=>{fs.closeSync(fd);fs.unlinkSync(file);};
    return Promise.resolve().then(cb).finally(done);
  }
  close(){this.db.close();}
}
