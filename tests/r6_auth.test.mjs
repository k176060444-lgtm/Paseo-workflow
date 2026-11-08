import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {canonical,sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../src/policy.mjs';
import {seedSyntheticTask} from './fixtures.mjs';

function fixture(withAuthority=false){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r6-'));
  const previous={file:process.env.P1_TRUST_ROOTS_FILE,hash:process.env.P1_TRUST_ROOTS_SHA256};
  let pair=null;
  if(withAuthority){
    pair=generateKeyPairSync('ed25519');
    const file=path.join(root,'trust.json');
    fs.writeFileSync(file,JSON.stringify({schema:1,human:{'local-test-key':
      pair.publicKey.export({format:'pem',type:'spki'})}}));
    process.env.P1_TRUST_ROOTS_FILE=file;
    process.env.P1_TRUST_ROOTS_SHA256=sha256(fs.readFileSync(file,'utf8'));
  }else{
    delete process.env.P1_TRUST_ROOTS_FILE;
    delete process.env.P1_TRUST_ROOTS_SHA256;
  }
  const store=new Store(path.join(root,'state')),id='TASKR600';
  const frozen={schema:1,intent:'Authorized synthetic regression test only',
    policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  frozen.digest=sha256(frozen);
  const boot={id,frozen,trustRootSha256:store.trustRootDigest(),
    stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,
    taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,
    lastA:null,lastB:null,p0Initial:null,p0Final:null,history:[],pendingHuman:null};
  function proof(gate,digest,actor='human',receipt='Human approves the exact task digest at this gate.'){
    const statement={purpose:'P1_HUMAN_GATE_V1',taskId:id,gate,digest,actor,receipt,
      nonce:randomUUID(),issuedAt:new Date().toISOString()};
    return {schema:1,keyId:'local-test-key',statement,
      signature:sign(null,Buffer.from(canonical(statement)),pair.privateKey).toString('base64')};
  }
  return {root,store,id,boot,proof,close(){
    store.close();
    if(previous.file===undefined)delete process.env.P1_TRUST_ROOTS_FILE;
    else process.env.P1_TRUST_ROOTS_FILE=previous.file;
    if(previous.hash===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;
    else process.env.P1_TRUST_ROOTS_SHA256=previous.hash;
    fs.rmSync(root,{recursive:true,force:true});
  }};
}
test('R6-003 unsigned self-consistent approval artifact cannot approve Gate 0.1',()=>{
  const w=fixture(false);
  try{
    w.store.init(w.boot);
    const actor='fake-human',receipt='Fabricated authorization string without a real signature';
    const approvalFile='approval-0-1-'+randomUUID()+'.json';
    const ev=w.store.artifact(w.id,approvalFile,
      {gate:'0.1',digest:w.boot.frozen.digest,actor,receipt});
    const task=w.store.get(w.id);
    task.stage='PLANNER';task.status='READY';
    assert.throws(()=>w.store.save(task,'GATE_0.1_APPROVED',
      {actor,digest:w.boot.frozen.digest,approvalSha256:ev.sha256,approvalFile}),/not independently provisioned|trust roots changed/);
    assert.equal(w.store.get(w.id).stage,'WAIT_GATE_01');
  }finally{w.close();}
});
test('R6-003 Ed25519 human signature binds task, gate, digest, actor and receipt',()=>{
  const w=fixture(true);
  try{
    w.store.init(w.boot);
    const receipt='I approve this exact frozen specification and task, signed offline';
    const approval=w.proof('0.1',w.boot.frozen.digest,'human',receipt);
    assert.doesNotThrow(()=>w.store.verifyHumanProof(approval,
      {taskId:w.id,gate:'0.1',digest:w.boot.frozen.digest,actor:'human',receipt}));
    for(const forged of [
      {taskId:'TASK0000',gate:'0.1',digest:w.boot.frozen.digest,actor:'human',receipt},
      {taskId:w.id,gate:'0.2',digest:w.boot.frozen.digest,actor:'human',receipt},
      {taskId:w.id,gate:'0.1',digest:'a'.repeat(64),actor:'human',receipt},
      {taskId:w.id,gate:'0.1',digest:w.boot.frozen.digest,actor:'impostor',receipt},
      {taskId:w.id,gate:'0.1',digest:w.boot.frozen.digest,actor:'human',receipt:'replaced approval string'},
    ])assert.throws(()=>w.store.verifyHumanProof(approval,forged),/signed statement mismatch/);
    const tampered=structuredClone(approval);tampered.statement.receipt+=' tampered';
    assert.throws(()=>w.store.verifyHumanProof(tampered,
      {taskId:w.id,gate:'0.1',digest:w.boot.frozen.digest,actor:'human',receipt:tampered.statement.receipt}),
      /invalid independent human approval signature/);
    const approvalFile='approval-0-1-'+approval.statement.nonce+'.json';
    const ev=w.store.artifact(w.id,approvalFile,
      {gate:'0.1',digest:w.boot.frozen.digest,actor:'human',receipt,proof:approval});
    const task=w.store.get(w.id);
    task.stage='PLANNER';task.status='READY';
    w.store.save(task,'GATE_0.1_APPROVED',{
      actor:'human',digest:w.boot.frozen.digest,
      approvalSha256:ev.sha256,approvalNonce:approval.statement.nonce,approvalFile});
    assert.equal(w.store.get(w.id).stage,'PLANNER');
    w.store.verify(w.id);
  }finally{w.close();}
});
test('R6-003 signer expiry and invalid signature are fail-closed',()=>{
  const w=fixture(true);
  try{
    const msg='Explicitly authorize task acceptance with bounded validity';
    const good=w.proof('0.1',w.boot.frozen.digest,'human',msg);
    const stale=structuredClone(good);
    stale.statement.issuedAt=new Date(Date.now()-40*60000).toISOString();
    assert.throws(()=>w.store.verifyHumanProof(stale,
      {taskId:w.id,gate:'0.1',digest:w.boot.frozen.digest,actor:'human',receipt:msg}),/stale/);
    const wrong=structuredClone(good);
    wrong.signature='A'.repeat(86)+'==';
    assert.throws(()=>w.store.verifyHumanProof(wrong,
      {taskId:w.id,gate:'0.1',digest:w.boot.frozen.digest,actor:'human',receipt:msg}),/invalid independent human approval signature/);
  }finally{w.close();}
});
test('R6-002 Reviewer PASS cannot skip two real review seats and registered evidence',()=>{
  const w=fixture(false);
  try{
    seedSyntheticTask(w.store,{...w.boot,stage:'A_REVIEW',status:'READY',
      aRound:1,currentSha:'d'.repeat(40),baseSha:'c'.repeat(40)});
    const t=w.store.get(w.id);
    t.stage='A_TEST';t.status='READY';
    assert.throws(()=>w.store.save(t,'A_REVIEW_PASS'),/two independent Reviewer seats/);
    assert.equal(w.store.get(w.id).stage,'A_REVIEW');
    w.store.verify(w.id);
  }finally{w.close();}
});
test('R6-005 Git verifier cannot be injected at construction or monkeypatched to skip trust',()=>{
  const w=fixture(false);
  try{
    assert.throws(()=>new Store(path.join(w.root,'other'),{gitVerifier:()=>true}),/injectable Git verifier forbidden/);
    seedSyntheticTask(w.store,{...w.boot,stage:'PREPARE',status:'READY'});
    const t=w.store.get(w.id);
    t.stage='A_WORKER';t.baseSha='d'.repeat(40);t.currentSha=t.baseSha;
    t.worktree=path.join(w.store.dir(w.id),'worktree');
    w.store.gitVerifier=()=>true; // public property is ignored: Store invokes imported verifier.
    assert.throws(()=>w.store.save(t,'WORKTREE_PREPARED'),/Git repository missing|unverified/);
    assert.equal(w.store.get(w.id).baseSha,null);
    w.store.verify(w.id);
  }finally{w.close();}
});

test('R6 recovery is also signed and cannot be reopened with actor/receipt alone',()=>{
  const w=fixture(true);
  try{
    seedSyntheticTask(w.store,{...w.boot,stage:'BLOCKED',status:'BLOCKED'});
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    const message='Independent operator explicitly approves safe controlled recovery';
    const basis=w.boot.frozen.digest;
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',receipt:message,
      expectedBasis:basis}),/authenticated human approval not provisioned|signature envelope missing/);
    assert.equal(w.store.get(w.id).stage,'BLOCKED');
    const restored=c.authorizeRecovery({id:w.id,actor:'human',receipt:message,
      expectedBasis:basis,proof:w.proof('recovery',basis,'human',message)});
    assert.equal(restored.stage,'PLANNER');
    w.store.verify(w.id);
  }finally{w.close();}
});

test('R6 Gate 5.9 signature cannot omit or substitute final compliance artifact digest',()=>{
  const w=fixture(true);
  try{
    const message='Independent operator approves final compliance report';
    const fake=w.proof('5.9','d'.repeat(40),'human',message);
    const fields={taskId:w.id,gate:'5.9',digest:'d'.repeat(40),actor:'human',
      receipt:message,evidenceSha256:'e'.repeat(64),evidenceRoot:'a'.repeat(64)};
    assert.throws(()=>w.store.verifyHumanProof(fake,fields),/must bind final compliance evidence/);
    // A signer with the actual private key can sign the exact evidence digest.
    fake.statement.evidenceSha256=fields.evidenceSha256;
    fake.statement.evidenceRoot=fields.evidenceRoot;
    // Tampering with a signed statement without a new signature is rejected.
    assert.throws(()=>w.store.verifyHumanProof(fake,fields),/invalid independent human approval signature/);
  }finally{w.close();}
});
