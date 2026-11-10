import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {loadTrustRoots,verifyExecutionAttestation} from '../src/auth.mjs';
import {canonical,sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../src/policy.mjs';
import {seedSyntheticTask,syntheticHumanAuthority} from './fixtures.mjs';

function withManifest(fn){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r8-'));
  const oldFile=process.env.P1_TRUST_ROOTS_FILE;
  const oldHash=process.env.P1_TRUST_ROOTS_SHA256;
  const file=path.join(root,'trust.json');
  const human=generateKeyPairSync('ed25519');
  const execution=generateKeyPairSync('ed25519');
  const p0=generateKeyPairSync('ed25519');
  function set(manifest){
    fs.writeFileSync(file,JSON.stringify(manifest));
    process.env.P1_TRUST_ROOTS_FILE=file;
    process.env.P1_TRUST_ROOTS_SHA256=sha256(fs.readFileSync(file,'utf8'));
  }
  const pem=k=>k.publicKey.export({format:'pem',type:'spki'});
  try{return fn({root,set,pem,human,execution,p0});}
  finally{
    if(oldFile===undefined)delete process.env.P1_TRUST_ROOTS_FILE;
    else process.env.P1_TRUST_ROOTS_FILE=oldFile;
    if(oldHash===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;
    else process.env.P1_TRUST_ROOTS_SHA256=oldHash;
    fs.rmSync(root,{recursive:true,force:true});
  }
}
test('R8-002 human and execution key material/issuer overlap fail closed',()=>{
  withManifest(({set,pem,human,execution})=>{
    set({schema:1,human:{alice:pem(human)},execution:{witness:pem(human)}});
    assert.throws(loadTrustRoots,/key overlap forbidden/);
    set({schema:1,human:{same:pem(human)},execution:{same:pem(execution)}});
    assert.throws(loadTrustRoots,/key overlap forbidden/);
    set({schema:1,human:{alice:pem(human)},execution:{witness:pem(execution)}});
    const roots=loadTrustRoots();assert.equal(roots.execution.size,1);
  });
});
test('R8-003 execution receipt issued 24 hours ago cannot be admitted',()=>{
  withManifest(({set,pem,human,execution})=>{
    set({schema:1,human:{alice:pem(human)},execution:{witness:pem(execution)}});
    const expected={taskId:'TASK8000',role:'spec_reviewer',phase:'A1-review-spec_reviewer',
      commit:'a'.repeat(40),agentId:'agent-1',dispatchId:'dispatch-1',
      rawSha256:'e'.repeat(64)};
    const statement={purpose:'P1_EXECUTION_ATTESTATION_V1',...expected,
      nonce:randomUUID(),issuedAt:new Date(Date.now()-24*3600000).toISOString()};
    const proof={schema:1,keyId:'witness',statement,
      signature:sign(null,Buffer.from(canonical(statement)),execution.privateKey).toString('base64')};
    assert.throws(()=>verifyExecutionAttestation(loadTrustRoots(),proof,expected),/stale/);
  });
});
test('R8-004 properly signed cross-Commit local Reviewer cannot pollute history',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r8-review-'));
  const id='TASKR800',authority=syntheticHumanAuthority(root,id);
  const store=new Store(path.join(root,'state'));
  try{
    const frozen={schema:1,intent:'Isolated signed reviewer commit-mismatch regression',
      policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
    frozen.digest=sha256(frozen);
    seedSyntheticTask(store,{id,frozen,stage:'A_REVIEW',status:'READY',
      baseSha:'c'.repeat(40),currentSha:'d'.repeat(40),aRound:1,bRound:0,history:[]});
    const role='spec_reviewer',phase='A1-review-spec_reviewer';
    store.recordIntent(id,phase,'dispatch-r8');
    store.recordAck('dispatch-r8','agent-r8');
    store.recordTerminal('dispatch-r8');
    const raw={role,phase,agentId:'agent-r8',dispatchId:'dispatch-r8',
      verdict:'PASS',summary:'Synthetic approved unrelated commit',findings:[],taskSpec:null};
    const attestation=authority.attest(role,phase,'e'.repeat(40),'agent-r8','dispatch-r8',raw);
    const ev=store.artifact(id,'review-unrelated.json',{...raw,attestation});
    const t=store.get(id);
    t.history.push({role,phase:'A1-review',sha:'e'.repeat(40),agentId:'agent-r8',
      verdict:'PASS',evidenceSha256:ev.sha256});
    assert.throws(()=>store.save(t,'REVIEW_SEAT_RECORDED',{role}),
      /review seat must match current frozen Commit/);
    assert.equal(store.get(id).history.length,0);
    store.verify(id);
  }finally{store.close();authority.restore();fs.rmSync(root,{recursive:true,force:true});}
});
test('R8-005 failed approval attempt cannot wedge new independently signed retry',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r8-approval-'));
  const id='TASKR805',authority=syntheticHumanAuthority(root,id);
  const store=new Store(path.join(root,'state'));
  try{
    const frozen={schema:1,intent:'Isolated approval retry and unique receipt filename',
      policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
    frozen.digest=sha256(frozen);
    const boot={id,frozen,trustRootSha256:store.trustRootDigest(),
      stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,
      taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,
      lastA:null,lastB:null,p0Initial:null,p0Final:null,history:[],inflight:null,
      pendingHuman:null};
    store.init(boot);
    const c=new WorkflowController({store,runtime:null,p0:null});
    const receipt='Human explicitly authorizes recovery from synthetic save failure';
    const original=store.save.bind(store);
    store.save=()=>{throw new Error('synthetic save failure after artifact registration');};
    assert.throws(()=>c.approve({id,gate:'0.1',digest:frozen.digest,actor:'human',
      receipt,proof:authority.proof('0.1',frozen.digest,'human',receipt,store)}),
      /synthetic save failure/);
    store.save=original;
    const result=c.approve({id,gate:'0.1',digest:frozen.digest,actor:'human',
      receipt,proof:authority.proof('0.1',frozen.digest,'human',receipt,store)});
    assert.equal(result.stage,'PLANNER');
    const names=store.db.prepare('SELECT name FROM artifacts WHERE task_id=?').all(id)
      .map(x=>x.name).filter(x=>x.startsWith('approval-0-1-'));
    assert.equal(names.length,2);
    assert.equal(new Set(names).size,2);
    store.verify(id);
  }finally{store.close();authority.restore();fs.rmSync(root,{recursive:true,force:true});}
});

test('independent Gate process public key must not alias the human approver or execution witness',()=>{
 withManifest(({set,pem,human,execution})=>{
   set({schema:1,human:{approver:pem(human)},procedure:{gate:pem(human)}});
   assert.throws(loadTrustRoots,/overlap|independent/);
   set({schema:1,human:{approver:pem(human)},
     execution:{witness:pem(execution)},procedure:{gate:pem(execution)}});
   assert.throws(loadTrustRoots,/overlap|independent/);
   const process=generateKeyPairSync('ed25519');
   set({schema:1,human:{approver:pem(human)},
     execution:{witness:pem(execution)},procedure:{gate:pem(process)}});
   assert.equal(loadTrustRoots().procedure.size,1);
 });
});
