import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { verifyCommitEvidenceSync } from './git.mjs';
import {loadTrustRoots,verifyHumanApproval,verifyExecutionAttestation} from './auth.mjs';
import {SshP0Adapter} from './p0.mjs';
import {verifyPaseoP0Envelope} from './p0_paseo.mjs';
import { canonical, sha256, assert, checkedId, MAX_A, MAX_B, ROLE_PERMISSIONS, PASS, acceptedP0Dispute, verifyGateBTests } from './policy.mjs';

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
      CREATE TABLE IF NOT EXISTS artifacts(task_id TEXT NOT NULL, name TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(task_id,name));
CREATE TABLE IF NOT EXISTS consumed_approvals(key_id TEXT NOT NULL,nonce TEXT NOT NULL,task_id TEXT NOT NULL,gate TEXT NOT NULL,PRIMARY KEY(key_id,nonce));
CREATE TABLE IF NOT EXISTS consumed_executions(key_id TEXT NOT NULL,nonce TEXT NOT NULL,task_id TEXT NOT NULL,phase TEXT NOT NULL,statement_digest TEXT NOT NULL,PRIMARY KEY(key_id,nonce));`);
  }
  dir(id) { return path.join(this.root,'tasks',checkedId(id)); }
  evidenceDigest(id,name){
    this.verify(id);
    const entry=this.db.prepare('SELECT digest FROM artifacts WHERE task_id=? AND name=?')
      .get(id,name);
    assert(entry&&/^[a-f0-9]{64}$/.test(entry.digest),
      'requested registered evidence digest unavailable');
    return entry.digest;
  }
  approvalNonceUsed(keyId,nonce){
    assert(typeof keyId==='string'&&typeof nonce==='string','approval nonce identity required');
    return !!this.db.prepare('SELECT 1 FROM consumed_approvals WHERE key_id=? AND nonce=?').get(keyId,nonce);
  }
  p0TrustRoots(){return this.#trustRoots?.p0??null;}
  trustRootDigest(){return this.#trustRoots?.digest??null;}
  nonceHash(id){return sha256(this.db.prepare(
    'SELECT key_id,nonce,gate FROM consumed_approvals WHERE task_id=? ORDER BY key_id,nonce').all(id));}
  executionNonceHash(id){return sha256(this.db.prepare(
    'SELECT key_id,nonce,phase,statement_digest FROM consumed_executions WHERE task_id=? ORDER BY key_id,nonce').all(id));}
  #consumeExecution(t,h,proof){
    const key=proof.keyId,nonce=proof.statement.nonce,hash=sha256(proof.statement);
    assert(!this.db.prepare('SELECT 1 FROM consumed_executions WHERE key_id=? AND nonce=?').get(key,nonce),
      'independent execution attestation nonce already consumed');
    this.db.prepare('INSERT INTO consumed_executions(key_id,nonce,task_id,phase,statement_digest) VALUES(?,?,?,?,?)')
      .run(key,nonce,t.id,h.phase,hash);
  }
  evidenceRoot(id){
    return sha256({artifacts:this.db.prepare(
      "SELECT name,digest FROM artifacts WHERE task_id=? AND name<>'final-compliance.json' AND name NOT LIKE 'approval-5-9-%' AND name<>'approval-5-9.json' ORDER BY name"
    ).all(id),dispatches:this.db.prepare(
      'SELECT id,phase,agent_id,state,created FROM dispatches WHERE task_id=? ORDER BY id').all(id)});
  }
  #consumeApproval(id,gate,proof){
    assert(proof?.schema===1&&typeof proof.keyId==='string'&&
      typeof proof.statement?.nonce==='string','signed approval nonce missing');
    const key=proof.keyId,nonce=proof.statement.nonce;
    assert(!this.db.prepare('SELECT 1 FROM consumed_approvals WHERE key_id=? AND nonce=?').get(key,nonce),
      'signed human approval nonce already consumed');
    this.db.prepare('INSERT INTO consumed_approvals(key_id,nonce,task_id,gate) VALUES(?,?,?,?)')
      .run(key,nonce,id,gate);
  }
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
      const registered=this.db.prepare('SELECT digest FROM artifacts WHERE task_id=? AND name=?')
        .get(id,name);
      if(registered){
        // A retry with identical bytes is safe: it creates NO new ledger event.
        // Different bytes are never silently overwritten under a fixed name.
        assert(registered.digest===digest&&fs.existsSync(file)&&
          fs.lstatSync(file).isFile()&&sha256(fs.readFileSync(file,'utf8'))===digest,
          'registered evidence conflict: immutable name or bytes mismatch');
        return {path:file,sha256:digest,reused:true};
      }
      assert(!fs.existsSync(file),
        'orphan evidence file requires independently authorized reconciliation: '+name);
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
    for(const key of ['taskSpec','taskSpecSha','userAlignment','alignmentSha','alignmentApprovalSha','baseSha','currentSha','lastA','lastB','p0Initial','p0Final'])
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
  // Original evidence is read via the registered manifest and checked digest;
  // neither Arbitrator nor Pro-Audit should rely on model-written summaries.
  readEvidenceByDigest(id,digest){
    this.verify(id);
    assert(typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest),
      'invalid registered evidence SHA');
    const row=this.db.prepare('SELECT name FROM artifacts WHERE task_id=? AND digest=?')
      .get(id,digest);
    assert(row?.name,'review docket evidence missing');
    return {name:row.name,sha256:digest,content:this.#requireArtifact(id,row.name,digest)};
  }
  #checkGateReceipt(oldTask,nextTask,type,payload){
    const gate=type==='GATE_0.1_APPROVED'?'0.1':type==='GATE_0.2_APPROVED'?'0.2':'5.9';
    const file=payload.approvalFile;
    assert(typeof payload.approvalNonce==='string'&&
      file==='approval-'+gate.replace('.','-')+'-'+payload.approvalNonce+'.json',
      'Gate approval requires nonce-scoped original filename');
    const raw=this.#requireArtifact(oldTask.id,file,payload.approvalSha256);
    const receipt=JSON.parse(raw);
    const digest=gate==='0.1'?oldTask.frozen.digest:gate==='0.2'?oldTask.alignmentApprovalSha:oldTask.currentSha;
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
      evidenceSha256:gate==='5.9'?this.evidenceDigest(oldTask.id,'final-compliance.json'):null,
      evidenceRoot:gate==='5.9'?this.evidenceRoot(oldTask.id):null,
    });
    assert(receipt.proof.statement.nonce===payload.approvalNonce,
      'approval signature nonce does not match persisted transition');
    this.#consumeApproval(oldTask.id,gate,receipt.proof);
    if(gate==='0.2'){
      assert(oldTask.taskSpecSha&&oldTask.taskSpec,'Gate 0.2 needs frozen TASK_SPEC');
      this.#requireArtifact(oldTask.id,'TASK_SPEC.md',oldTask.taskSpecSha);
      this.#requireArtifact(oldTask.id,'USER_ALIGNMENT.md',oldTask.alignmentSha);
      assert(oldTask.alignmentApprovalSha===sha256({alignmentSha:oldTask.alignmentSha,
        taskSpecSha:oldTask.taskSpecSha}),'signed Gate 0.2 does not bind both approved artifacts');
    }
    if(gate==='5.9')this.#validateFinalGate(oldTask);
  }
  #validateFinalGate(t){
    assert(t.stage==='WAIT_GATE_59'&&t.status==='WAITING_HUMAN',
      'Gate 5.9 requires waiting human stage');
    assert(t.aRound>=1&&t.bRound>=0&&t.aRound<=MAX_A&&t.bRound<=MAX_B&&
      (t.bRound>0||(!t.changesInB&&t.p0Initial?.commit===t.currentSha)),
      'Gate 5.9 has incomplete or invalid round budgets');
    assert(typeof t.baseSha==='string'&&/^[a-f0-9]{40}$/.test(t.baseSha)&&
      typeof t.currentSha==='string'&&/^[a-f0-9]{40}$/.test(t.currentSha),
      'Gate 5.9 requires exact frozen Git commits');
    assert(t.lastA?.pass===true&&t.lastA?.commit,'Gate 5.9 missing Tester A pass');
    verifyGateBTests(t);
    assert(t.lastB?.pass===true&&t.lastB?.tests?.pass===true&&
      t.lastB?.commit===t.currentSha,'Gate 5.9 missing independent Tester B pass');
    const p0=t.p0Final??t.p0Initial;
    assert(p0?.commit===t.currentSha&&(p0.passed===true||acceptedP0Dispute(t)),
      'Gate 5.9 requires passing P0 or an authenticated evidence-bound final dispute ruling');
    assert(Array.isArray(p0.reports)&&p0.reports.length>=2&&
      new Set(p0.reports.map(r=>r.physicalId)).size>=2&&
      p0.reports.every(r=>r.commit===t.currentSha&&Array.isArray(r.findings))&&
      (p0.passed===true||acceptedP0Dispute(t)),
      'Gate 5.9 P0 physical quorum/commit/unresolved disputes invalid');
    assert(!t.bFindings?.length,'Gate 5.9 unresolved findings');
    assert(t.finalArbitration?.sha===t.currentSha&&PASS(t.finalArbitration.verdict),
      'Gate 5.9 requires final Arbitrator acceptance of original user intent and code completeness');
    assert(t.history.some(h=>h.role==='arbitrator'&&h.sha===t.currentSha&&
      h.agentId===t.finalArbitration.agentId&&PASS(h.verdict)),
      'Gate 5.9 missing authenticated final Arbitrator execution');
    verifyCommitEvidenceSync(t.frozen.project.repo,t.baseSha,t.currentSha,t.worktree);
    this.#verifyP0Nodes(t,p0);
    const record=this.db.prepare("SELECT name,digest FROM artifacts WHERE task_id=? AND name='final-compliance.json'").get(t.id);
    const artifact=JSON.parse(this.#requireArtifact(t.id,'final-compliance.json',record?.digest));
    assert(artifact.pass===true&&artifact.finalSha===t.currentSha&&
      artifact.baseSha===t.baseSha&&artifact.taskConfigSha===t.frozen.digest&&
      artifact.evidenceRoot===this.evidenceRoot(t.id),
      'Gate 5.9 final compliance receipt mismatched');
    assert(t.history.some(h=>h.role==='test_executor'&&h.sha===t.currentSha&&h.pass===true&&
      this.db.prepare('SELECT 1 FROM artifacts WHERE task_id=? AND digest=?').get(t.id,h.evidenceSha256)),
      'Gate 5.9 needs persisted Tester B receipts');
    assert(t.history.some(h=>h.role==='P0'&&h.sha===t.currentSha&&
      (h.passed===true||acceptedP0Dispute(t))&&
      this.db.prepare('SELECT 1 FROM artifacts WHERE task_id=? AND digest=?').get(t.id,h.evidenceSha256)),
      'Gate 5.9 needs persisted P0 evidence');
    for(const h of t.history)
      if(['spec_reviewer','quality_reviewer','test_executor','tester_gate_a',
          'tester_gate_b','arbitrator','pro_audit'].includes(h.role))
        this.#verifyHistoryExecution(t,h);
    // Process compliance must surround EVERY actual role dispatch, including
    // both independent reviewers, Tester command execution, P0 and Arbitrator.
    // The final gate independently checks both signed receipts and their order.
    const auditedRoles=new Set(['planner','worker','spec_reviewer','quality_reviewer',
      'tester_gate_a','tester_gate_b','test_executor','worker_remediation',
      'arbitrator','P0']);
    for(let i=0;i<t.history.length;i++){
      const h=t.history[i];
      if(!auditedRoles.has(h.role))continue;
      const actualPhase=['spec_reviewer','quality_reviewer'].includes(h.role)&&
        /^[AB][0-9]+-review$/.test(h.phase)?h.phase+'-'+h.role:h.phase;
      // Never match by phase alone: retries and authorized recoveries must have
      // distinct audit sessions with their own independently attested reports.
      assert(typeof h.auditSessionId==='string'&&
        /^[a-f0-9-]{36}$/i.test(h.auditSessionId),
        'target role has no unique audit session identity');
      const name=checkpoint=>'audit-'+checkpoint+'-'+h.role+'-'+actualPhase;
      const matching=(checkpoint)=>t.history.map((a,j)=>({a,j})).filter(({a,j})=>
        a.role==='pro_audit'&&a.phase===name(checkpoint)&&
        a.auditSessionId===h.auditSessionId&&a.auditBinding?.checkpoint===checkpoint&&
        (checkpoint==='PRE'?j<i:j>i));
      const pres=matching('PRE'),posts=matching('POST');
      assert(pres.length===1&&posts.length===1,
        'expected exactly one PRE and POST bound to this dispatch audit session');
      const targetRecord=this.db.prepare('SELECT name FROM artifacts WHERE task_id=? AND digest=?')
        .get(t.id,h.evidenceSha256);
      assert(targetRecord,'target execution original evidence missing');
      const target=JSON.parse(this.#requireArtifact(t.id,targetRecord.name,h.evidenceSha256));
      for(const [checkpoint,items] of [['PRE',pres],['POST',posts]]){
        const receipt=items[0].a,binding=receipt.auditBinding;
        assert(receipt.verdict==='PASS','noncompliant process check cannot release Gate 5.9');
        assert(binding?.schema===1&&binding.sessionId===h.auditSessionId&&
          binding.targetRole===h.role&&binding.targetPhase===actualPhase&&
          binding.checkpoint===checkpoint&&
          binding.approvedHarness===(t.frozen.roles?.[h.role]?.harness??null)&&
          binding.approvedModel===(t.frozen.roles?.[h.role]?.model??null)&&
          binding.approvedSoulSha256===(t.frozen.souls?.[h.role]?.sha256??null),
          'signed audit binding does not match frozen target role/matrix/Soul');
        // POST must identify the *real evidence artifact*, not an unrelated
        // result on the same stage/phase.
        assert(checkpoint==='POST'?
          binding.targetEvidenceSha256===h.evidenceSha256&&
          binding.targetAgentId===(h.agentId??null)&&
          binding.targetDispatchId===(target.dispatchId??null):
          binding.targetEvidenceSha256===null&&
          binding.targetDispatchId===null&&binding.targetAgentId===null,
          'process compliance report cannot be linked to the exact dispatch');
        const found=this.db.prepare('SELECT name FROM artifacts WHERE task_id=? AND digest=?')
          .get(t.id,receipt.evidenceSha256);
        assert(found,'process audit missing independently registered original report');
        const raw=JSON.parse(this.#requireArtifact(t.id,found.name,receipt.evidenceSha256));
        assert(raw.role==='pro_audit'&&raw.phase===receipt.phase&&
          canonical(raw.auditBinding)===canonical(binding)&&raw.verdict==='PASS'&&
          Array.isArray(raw.findings)&&raw.findings.length===0,
          'original signed process compliance report has mismatched binding or findings');
        this.#verifyHistoryExecution(t,receipt);
      }
    }
  }
  #verifyP0Nodes(t,summary){
    const inventory=(t.frozen.p0?.nodes??[]).filter(n=>n.enabled===true);
    assert(inventory.length>=2,'no trusted independent P0 node inventory');
    const mode=t.frozen.p0?.transport;
    // Legacy HMAC is retained solely for isolated regression fixtures.
    // The normal CLI refuses it; it must never silently become a fallback.
    assert(['paseo','legacy-hmac'].includes(mode),'P0 backend must be explicitly pinned');
    if(mode==='legacy-hmac')
      new SshP0Adapter(inventory).validateInventory();
    else{
      assert(this.#trustRoots?.p0?.size>=2,'independent P0 signing keys not provisioned');
      assert(new Set(inventory.map(x=>x.serverId)).size===inventory.length&&
        new Set(inventory.map(x=>x.physicalId)).size===inventory.length,
        'Paseo remote daemon/physical identity collision');
    }
    const distinct=new Set();
    for(const report of summary.reports){
      const node=inventory.find(n=>n.id===report.nodeId);
      assert(node,'P0 report node not in approved inventory');
      assert(!distinct.has(node.physicalId),'duplicate P0 physical node');
      const cycle=summary.cycle;
      assert(typeof cycle==='string'&&/^(initial-A|final-B)\d+$/.test(cycle),
        'invalid signed P0 cycle');
      const jobId=sha256(t.id+':'+cycle+':'+t.currentSha+':'+node.id).slice(0,40);
      const name='p0-'+cycle+'-'+node.id+'-result.json';
      assert(report.evidence?.sha256,'P0 original node evidence digest missing');
      const raw=JSON.parse(this.#requireArtifact(t.id,name,report.evidence.sha256));
      const requestFile='p0-'+cycle+'-'+node.id+'-request.json';
      const record=this.db.prepare('SELECT digest FROM artifacts WHERE task_id=? AND name=?')
        .get(t.id,requestFile);
      const request=mode==='paseo'?
        JSON.parse(this.#requireArtifact(t.id,requestFile,record?.digest)):null;
      if(mode==='paseo'){
        assert(request?.jobId===jobId&&request.commit===t.currentSha&&
          request.binding?.role===node.role&&
          request.binding?.soulSha256===t.frozen.souls?.[node.role]?.sha256&&
          request.binding?.promptSha256===request.promptSha256&&
          request.binding?.taskSpecSha256===sha256(t.taskSpec)&&
          request.binding?.intentSha256===t.frozen.intentSha256&&
          request.binding?.workspaceId===node.workspaceId&&request.binding?.cwd===node.cwd,
          'original requested blind-review role/Soul/prompt/spec/intent/workspace mismatch');
      }
      const verified=mode==='paseo'
        ?verifyPaseoP0Envelope(this.#trustRoots,node,raw,
          {taskId:t.id,cycle,jobId,commit:t.currentSha,binding:request.binding})
        :new SshP0Adapter(inventory).verify(node,raw,jobId,t.currentSha);
      assert(verified.physicalId===report.physicalId&&verified.verdict===report.verdict&&
        canonical(verified.findings)===canonical(report.findings),
        'P0 summary mismatch with signed raw report');
      const dispatch=this.db.prepare('SELECT state,agent_id,phase FROM dispatches WHERE id=? AND task_id=?')
        .get(jobId,t.id);
      const expectedAgent=mode==='paseo'?node.serverId+':'+verified.agentId:undefined;
      assert(dispatch?.state==='TERMINAL'&&dispatch.phase==='P0:'+cycle+':'+node.id&&
        (mode!=='paseo'||dispatch.agent_id===expectedAgent),
        'P0 node lacks matching completed Paseo Agent dispatch');
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
      this.#verifyHistoryExecution(t,h);
    }
  }
  #verifyHistoryExecution(t,h,{consume=false}={}){
    const artifact=this.db.prepare('SELECT name FROM artifacts WHERE task_id=? AND digest=?')
      .get(t.id,h.evidenceSha256);
    assert(artifact,'execution history missing registered original artifact');
    const raw=JSON.parse(this.#requireArtifact(t.id,artifact.name,h.evidenceSha256));
    let proof,expected;
    if(h.role==='test_executor'){
      assert(raw.sha===h.sha&&raw.tests?.pass===h.pass&&raw.tests?.attestation,
        'independently attested Tester commands required');
      const {attestation,...bareTests}=raw.tests;
      proof=attestation;
      expected={taskId:t.id,role:'test_executor',phase:h.phase,commit:h.sha,
        agentId:'',dispatchId:'',rawSha256:sha256({sha:raw.sha,tests:bareTests})};
    }else{
      const phase=['spec_reviewer','quality_reviewer'].includes(h.role)&&/^[AB][0-9]+-review$/.test(h.phase)?
        h.phase+'-'+h.role:h.phase;
      assert(raw.role===h.role&&raw.phase===phase&&raw.agentId===h.agentId&&
        raw.verdict===h.verdict&&typeof raw.dispatchId==='string',
        'Agent execution result/history mismatch');
      const {attestation,...bare}=raw;
      proof=attestation;
      expected={taskId:t.id,role:h.role,phase,commit:h.sha??null,
        agentId:h.agentId,dispatchId:raw.dispatchId,rawSha256:sha256(bare)};
      const approved=t.frozen.roles?.[h.role];
      if(approved){
        assert(raw.model===approved.model&&raw.harness===approved.harness&&
          raw.soulSha256===t.frozen.souls?.[h.role]?.sha256,
          'execution observed model/Harness/Soul differs from approved matrix');
        Object.assign(expected,{model:raw.model,harness:raw.harness,soulSha256:raw.soulSha256});
      }
      const dispatch=this.db.prepare('SELECT state,agent_id,phase FROM dispatches WHERE id=? AND task_id=?')
        .get(raw.dispatchId,t.id);
      assert(dispatch?.state==='TERMINAL'&&dispatch.agent_id===h.agentId&&
        dispatch.phase===phase,'execution attestation lacks matching terminal dispatch');
    }
    assert(t.trustRootSha256!==null&&t.trustRootSha256===this.trustRootDigest(),
      'execution trust root not pinned to task');
    const checked=verifyExecutionAttestation(this.#trustRoots,proof,expected,{allowHistorical:!consume});
    const stored=this.db.prepare('SELECT task_id,phase,statement_digest FROM consumed_executions WHERE key_id=? AND nonce=?')
      .get(proof.keyId,proof.statement.nonce);
    if(consume)this.#consumeExecution(t,h,proof);
    else assert(stored?.task_id===t.id&&stored.phase===h.phase&&
      stored.statement_digest===sha256(proof.statement),
      'execution attestation not independently consumed/anchored');
    return checked;
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
    const basis=oldTask.currentSha??oldTask.alignmentApprovalSha??oldTask.taskSpecSha??oldTask.frozen.digest;
    assert(data.origin===oldTask.stage&&data.target===nextTask.stage&&
      data.actor===payload.actor&&data.expectedSha===(oldTask.currentSha??null)&&
      data.expectedBasis===(oldTask.currentSha?null:oldTask.alignmentApprovalSha??oldTask.taskSpecSha??oldTask.frozen.digest),
      'recovery artifact/target/basis mismatch');
    this.verifyHumanProof(data.proof,{taskId:oldTask.id,gate:'recovery',
      digest:basis,actor:data.actor,receipt:data.receipt});
    assert(payload.recoveryNonce===data.proof.statement.nonce,
      'recovery signed nonce mismatch');
    this.#consumeApproval(oldTask.id,'recovery',data.proof);
    for(const row of this.db.prepare(
      "SELECT payload FROM events WHERE task_id=? AND type='HUMAN_CONTROLLED_RECOVERY'"
    ).all(oldTask.id))
      assert(JSON.parse(row.payload).recoveryNonce!==payload.recoveryNonce,
        'replayed recovery authorization');
  }
  #validateStageTransition(oldTask,t,type,payload){
    const moves={
      'GATE_0.1_APPROVED':['WAIT_GATE_01','PLANNER'],
      'GATE_0.2_APPROVED':['WAIT_GATE_02','PLAN_DETAIL'],
      'PLAN_DETAIL_COMPLETE':['PLAN_DETAIL','PREPARE'],
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
      'GATE_B_TEST_PASS':['B_TEST','ARBITRATOR'],
      'P0_CONFLICT_NEEDS_ARBITRATION':['P0_FINAL','ARBITRATOR'],
      'P0_FINAL_REQUIRES_REMEDIATION':['P0_FINAL','B_ENTER'],
      'P0_FINAL_PASS':['P0_FINAL','ARBITRATOR'],
      'ARBITRATION_FINALIZED':['ARBITRATOR','READY_FINAL'],
      'ARBITRATION_NEEDS_REMEDIATION':['ARBITRATOR','B_ENTER'],
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
        GATE_A_ROUND_START:['A_WORKER'],GATE_B_ROUND_START:['B_WORKER'],
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
      assert(((oldTask.stage==='BLOCKED'&&['BLOCKED','WAITING_HUMAN'].includes(oldTask.status))||
        (oldTask.stage==='WAIT_HUMAN'&&oldTask.status==='WAITING_HUMAN'))&&
        ['PLANNER','PLAN_DETAIL','PREPARE','A_WORKER','A_TEST',
          'B_ENTER','B_WORKER','B_TEST','P0_INITIAL','P0_FINAL','ARBITRATOR','READY_FINAL'].includes(t.stage)&&
        t.status==='READY'&&!oldTask.inflight&&
        (oldTask.blockedStage?oldTask.blockedStage===t.stage:
          oldTask.stage==='BLOCKED'&&!oldTask.taskSpecSha&&t.stage==='PLANNER'),
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
      verifyGateBTests(t);
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
      this.#verifyP0Nodes(t,p0);
    }
    if(type==='PLAN_DETAIL_COMPLETE'){
      assert(t.history.some(h=>h.role==='spec_reviewer'&&h.phase==='workplan-scope-review'&&
        PASS(h.verdict)&&h.evidenceSha256&&
        this.db.prepare('SELECT 1 FROM artifacts WHERE task_id=? AND digest=?')
          .get(t.id,h.evidenceSha256)),
        'independent scope-consistency review required before freezing detailed plan');
      assert(typeof t.workPlan==='string'&&t.workPlanSha===sha256(t.workPlan),
        'detailed plan must be frozen after Gate 0.2');
      this.#requireArtifact(t.id,'WORK_PLAN.md',t.workPlanSha);
    }
    if(type==='ARBITRATION_FINALIZED'){
      assert(t.finalArbitration?.sha===t.currentSha&&PASS(t.finalArbitration.verdict),
        'final Arbitrator must bind current commit');
      const p0=t.p0Final??t.p0Initial;
      assert(p0?.passed===true||acceptedP0Dispute(t),
        'final arbitration cannot waive unverifiable P0 evidence');
      assert(!t.bFindings?.length,'arbitration did not close outstanding findings');
      assert(t.history.some(h=>h.role==='arbitrator'&&h.sha===t.currentSha&&
        h.agentId===t.finalArbitration.agentId&&PASS(h.verdict)),
        'final Arbitrator execution receipt missing');
    }
    if(type==='TASK_SPEC_CANDIDATE'){
      assert(t.taskSpecSha===payload.sha256,'Planner TASK_SPEC digest missing from transition');
      this.#requireArtifact(t.id,'TASK_SPEC.md',t.taskSpecSha);
      assert(t.alignmentSha===payload.alignmentSha&&
        t.alignmentApprovalSha===payload.approvalSha&&
        t.alignmentApprovalSha===sha256({alignmentSha:t.alignmentSha,taskSpecSha:t.taskSpecSha}),
        'Planner alignment and frozen spec approval digest mismatch');
      this.#requireArtifact(t.id,'USER_ALIGNMENT.md',t.alignmentSha);
      assert(oldTask.status==='READY'&&oldTask.inflight===null||oldTask.status==='READY'&&oldTask.inflight===undefined,
        'Planner must be completed before freezing TASK_SPEC');
    }
    if(type==='WAITING_HUMAN_GATE_5_9')this.#validateFinalGate({...t,stage:'WAIT_GATE_59',status:'WAITING_HUMAN'});
    const protectedEvidence={
      lastA:new Set(['GATE_A_PASS']),
      lastB:new Set(['NEED_FINAL_COMMIT_P0','ARBITRATOR_TRIGGERED','P0_FINDINGS_OUTSTANDING','GATE_B_TEST_PASS']),
      p0Initial:new Set(['P0_INITIAL_COLLECTED']),
      p0Final:new Set(['P0_CONFLICT_NEEDS_ARBITRATION','P0_FINAL_REQUIRES_REMEDIATION','P0_FINAL_PASS']),
      aFindings:new Set(['WORKER_TECHNICAL_FAIL','A_REVIEW_FAIL','GATE_A_TEST_FAIL']),
      bFindings:new Set(['P0_INITIAL_COLLECTED','B_WORKER_FAIL','B_COMMIT_FROZEN',
        'B_REVIEW_FAIL','B_TEST_FAIL','ARBITRATION_FINALIZED','P0_CONFLICT_NEEDS_ARBITRATION',
        'P0_FINAL_REQUIRES_REMEDIATION','P0_FINAL_PASS','ARBITRATION_NEEDS_REMEDIATION']),
      p0Dispute:new Set(['P0_INITIAL_COLLECTED','P0_CONFLICT_NEEDS_ARBITRATION',
        'P0_FINAL_REQUIRES_REMEDIATION','P0_FINAL_PASS','ARBITRATION_FINALIZED']),
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
    assert(nextTask.trustRootSha256===oldTask.trustRootSha256,
      'pinned trust root cannot be changed by a state transition');
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
    const align=(t)=>{
      const present=t.userAlignment!==null&&t.userAlignment!==undefined;
      assert(present===(t.alignmentSha!==null&&t.alignmentSha!==undefined)&&
        present===(t.alignmentApprovalSha!==null&&t.alignmentApprovalSha!==undefined),
        'plain-language alignment, hashes and spec approval must be present together');
      if(!present)return null;
      assert(typeof t.userAlignment==='string'&&t.userAlignment.length>40&&
        t.alignmentSha===sha256(t.userAlignment)&&
        t.alignmentApprovalSha===sha256({alignmentSha:t.alignmentSha,taskSpecSha:t.taskSpecSha}),
        'frozen user-alignment hash or combined Gate 0.2 digest mismatch');
      return {content:t.userAlignment,sha:t.alignmentSha,approval:t.alignmentApprovalSha};
    };
    const beforeAlign=align(oldTask),afterAlign=align(nextTask);
    if(beforeAlign)assert(canonical(beforeAlign)===canonical(afterAlign),
      'approved user alignment is immutable');
    else if(afterAlign)assert(type==='TASK_SPEC_CANDIDATE',
      'user alignment may only be established by Planner candidate');
    for(const key of ['created','baseSha']){
      if(oldTask[key]!==undefined&&oldTask[key]!==null)
        assert(nextTask[key]===oldTask[key],`${key} cannot be replaced`);
    }
    if(oldTask.baseSha===null&&nextTask.baseSha!==null&&nextTask.baseSha!==undefined)
      assert(type==='WORKTREE_PREPARED','baseSha may only be established by worktree preparation');
    if(oldTask.workPlan!==undefined&&oldTask.workPlan!==null)
      assert(nextTask.workPlan===oldTask.workPlan&&nextTask.workPlanSha===oldTask.workPlanSha,
        'approved detailed plan is immutable');
    else if(nextTask.workPlan!==undefined&&nextTask.workPlan!==null)
      assert(type==='PLAN_DETAIL_COMPLETE'&&nextTask.workPlanSha===sha256(nextTask.workPlan),
        'detailed work plan may only be frozen after Gate 0.2');
    if(oldTask.finalArbitration!==undefined&&oldTask.finalArbitration!==null)
      assert(canonical(oldTask.finalArbitration)===canonical(nextTask.finalArbitration),
        'final Arbitrator conclusion cannot be replaced or erased');
    else if(nextTask.finalArbitration!==undefined&&nextTask.finalArbitration!==null)
      assert(type==='ARBITRATION_FINALIZED','final Arbitrator may only be set at authenticated completion');
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
        if(type==='REVIEW_SEAT_RECORDED'){
          const expectedPhase=(nextTask.stage==='A_REVIEW'?'A'+nextTask.aRound:
            nextTask.stage==='B_REVIEW'?'B'+nextTask.bRound:'')+'-review';
          assert(entry.sha===nextTask.currentSha&&entry.phase===expectedPhase,
            'review seat must match current frozen Commit and reviewer round');
        }
        if(['ROLE_TERMINAL','REVIEW_SEAT_RECORDED','TEST_RECEIPTS'].includes(type))
          this.#verifyHistoryExecution(nextTask,entry,{consume:true});
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
      _dispatch_sha256:this.dispatchHash(id),_artifact_sha256:this.artifactHash(id),
      _nonce_sha256:this.nonceHash(id),_execution_nonce_sha256:this.executionNonceHash(id)});
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
  // Before human-controlled replay, prove that every allegedly completed
  // dispatch corresponds to ONE original independently attested execution.
  // TERMINAL alone is insufficient: a crash can occur after terminal ACK but
  // before the Controller registers the result for downstream phases.
  assertRecoverableDispatches(id){
    this.verify(id);
    const t=this.get(id);
    const checkedP0=new Set();
    for(const d of this.dispatches(id)){
      assert(d.state==='TERMINAL',
        'recoverable task contains outstanding remote dispatch; read-only reconcile first');
      if(d.phase.startsWith('P0:')){
        const match=/^P0:(initial-A[1-9]\d*|final-B[1-9]\d*):([a-zA-Z0-9_-]+)$/.exec(d.phase);
        assert(match,'P0 dispatch has invalid cycle/peer');
        const cycle=match[1],nodeId=match[2];
        const p0=[t.p0Initial,t.p0Final].find(p=>
          p?.cycle===cycle&&p.reports?.some(r=>r.nodeId===nodeId&&r.jobId===d.id));
        assert(p0,'P0 TERMINAL row has no matching independently signed original result');
        if(!checkedP0.has(cycle)){
          this.#verifyP0Nodes({...t,currentSha:p0.commit},p0);
          checkedP0.add(cycle);
        }
        continue;
      }
      const matches=[];
      for(const h of t.history??[]){
        if(typeof h.evidenceSha256!=='string')continue;
        const entry=this.db.prepare('SELECT name FROM artifacts WHERE task_id=? AND digest=?')
          .get(id,h.evidenceSha256);
        assert(entry?.name,'recorded execution is missing its authenticated artifact');
        const original=JSON.parse(this.#requireArtifact(id,entry.name,h.evidenceSha256));
        if(original.dispatchId===d.id){
          assert(original.phase===d.phase&&original.agentId===d.agent_id&&
            h.agentId===d.agent_id,
            'recovered Agent original execution conflicts with terminal ledger identity');
          matches.push(h);
        }
      }
      assert(matches.length===1,
        'TERMINAL dispatch has no unique registered original signed execution; BLOCKED');
      this.#verifyHistoryExecution(t,matches[0]);
    }
    return true;
  }

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
    assert(last._nonce_sha256===this.nonceHash(id),'consumed approval nonce ledger mismatch');
    assert(last._execution_nonce_sha256===this.executionNonceHash(id),'execution nonce ledger mismatch');
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
