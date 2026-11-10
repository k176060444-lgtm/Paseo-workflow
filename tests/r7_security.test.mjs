import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {seedSyntheticTask,syntheticHumanAuthority} from './fixtures.mjs';
import {sha256,canonical,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../src/policy.mjs';
function fixture(stage){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r7-'));
  const id='TASKR700',authority=syntheticHumanAuthority(root,id);
  const store=new Store(path.join(root,'state'));
  const frozen={schema:1,intent:'Synthetic independent witness regression only',
    policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  frozen.digest=sha256(frozen);
  seedSyntheticTask(store,{id,frozen,stage,status:'INFLIGHT',
    currentSha:'d'.repeat(40),baseSha:'c'.repeat(40),
    aRound:1,bRound:1,history:[],inflight:{role:'review_pair',phase:'A1-review'}});
  return {root,store,id,close(){store.close();authority.restore();fs.rmSync(root,{recursive:true,force:true});}};
}
for(const [stage,prefix] of [['A_REVIEW','A1-review'],['B_REVIEW','B1-review']]){
  test('R7-001 '+stage+' cannot fake reviewer seats via public dispatch/artifact/save',()=>{
    const w=fixture(stage);
    try{
      const role='spec_reviewer',phase=prefix+'-'+role;
      const jobId='fake-dispatch-'+role,agentId='fake-agent-'+role;
      w.store.recordIntent(w.id,phase,jobId);
      w.store.recordAck(jobId,agentId);
      w.store.recordTerminal(jobId);
      const raw={role,phase,agentId,dispatchId:jobId,
        verdict:'PASS',summary:'I pretend I reviewed the commit',findings:[],taskSpec:null};
      const ev=w.store.artifact(w.id,'fake-'+role+'.json',raw);
      const t=w.store.get(w.id);
      t.history.push({role,phase:prefix,sha:t.currentSha,agentId,
        verdict:'PASS',evidenceSha256:ev.sha256});
      assert.throws(()=>w.store.save(t,'REVIEW_SEAT_RECORDED',{
        role,sha:t.currentSha,agentId,evidenceSha256:ev.sha256
      }),/independent execution attestor|attestation|signed execution/i);
      assert.equal(w.store.get(w.id).history.length,0);
      assert.equal(w.store.get(w.id).stage,stage);
      w.store.verify(w.id);
    }finally{w.close();}
  });
}
test('R7-003 consumed approval table exists and is bound to the hash ledger',()=>{
  const w=fixture('A_REVIEW');
  try{
    const before=w.store.verify(w.id);
    assert(w.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='consumed_approvals'").get());
    w.store.db.prepare("INSERT INTO consumed_approvals(key_id,nonce,task_id,gate) VALUES(?,?,?,?)")
      .run('synthetic-key','00000000-0000-0000-0000-000000000001',w.id,'0.1');
    assert.throws(()=>w.store.verify(w.id),/consumed approval nonce ledger mismatch/);
    w.store.db.prepare('DELETE FROM consumed_approvals WHERE task_id=?').run(w.id);
    assert.deepEqual(w.store.verify(w.id),before);
  }finally{w.close();}
});

test('R7-003 identical nonce is rejected across distinct tasks and valid signatures',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-nonce-'));
  const prevFile=process.env.P1_TRUST_ROOTS_FILE,prevHash=process.env.P1_TRUST_ROOTS_SHA256;
  let store;
  try{
    const {privateKey,publicKey}=generateKeyPairSync('ed25519');
    const procedure=generateKeyPairSync('ed25519');
    const manifest=path.join(root,'trust.json');
    fs.writeFileSync(manifest,JSON.stringify({schema:1,human:{
      'nonce-auditor':publicKey.export({format:'pem',type:'spki')}},
      procedure:{'independent-process':procedure.publicKey.export({format:'pem',type:'spki'})}}));
    process.env.P1_TRUST_ROOTS_FILE=manifest;
    process.env.P1_TRUST_ROOTS_SHA256=sha256(fs.readFileSync(manifest,'utf8'));
    store=new Store(path.join(root,'state'));
    const nonce=randomUUID(),ids=['TASKNONCE1','TASKNONCE2'];
    for(const [i,id] of ids.entries()){
      const frozen={schema:1,intent:'Synthetic nonce-consumption test in independent tasks',
        policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
      frozen.digest=sha256(frozen);
      const t={id,frozen,trustRootSha256:store.trustRootDigest(),stage:'WAIT_GATE_01',
        status:'WAITING_HUMAN',aRound:0,bRound:0,taskSpec:null,taskSpecSha:null,
        baseSha:null,currentSha:null,lastA:null,lastB:null,p0Initial:null,p0Final:null,
        history:[],inflight:null,pendingHuman:null};
      store.init(t);
      const receipt='Approved in disposable synthetic nonce test '+i,actor='auditor';
      const pStatement={purpose:'P1_PROCESS_GATE_V1',taskId:id,gate:'0.1',
        digest:frozen.digest,actor,receiptSha256:sha256(receipt),
        stateSha256:sha256(t),evidenceRoot:store.evidenceRoot(id),
        scope:'PROCESS_ONLY',verdict:'COMPLIANT',
        checks:['GATE_BASIS','HUMAN_AUTHORITY','PROCESS_EVIDENCE'],
        nonce:randomUUID(),issuedAt:new Date().toISOString()};
      const processProof={schema:1,keyId:'independent-process',statement:pStatement,
        signature:sign(null,Buffer.from(canonical(pStatement)),
          procedure.privateKey).toString('base64')};
      const statement={purpose:'P1_HUMAN_GATE_V1',taskId:id,gate:'0.1',
        digest:frozen.digest,actor,receipt,nonce,processProofSha256:sha256(processProof),
        issuedAt:new Date().toISOString()};
      const proof={schema:1,keyId:'nonce-auditor',statement,
        signature:sign(null,Buffer.from(canonical(statement)),privateKey).toString('base64')};
      const approvalFile='approval-0-1-'+nonce+'.json';
      const ev=store.artifact(id,approvalFile,{gate:'0.1',
        digest:frozen.digest,actor,receipt,proof,processProof});
      const next=store.get(id);next.stage='PLANNER';next.status='READY';
      const save=()=>store.save(next,'GATE_0.1_APPROVED',{
        digest:frozen.digest,actor,approvalSha256:ev.sha256,approvalNonce:nonce,approvalFile,
        processNonce:processProof.statement.nonce,processProofSha256:sha256(processProof)});
      if(i===0)assert.doesNotThrow(save);
      else assert.throws(save,/signed human approval nonce already consumed/);
      assert.equal(store.get(id).stage,i===0?'PLANNER':'WAIT_GATE_01');
      store.verify(id);
    }
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM consumed_approvals').get().count,2);
  }finally{
    store?.close();
    if(prevFile===undefined)delete process.env.P1_TRUST_ROOTS_FILE;
    else process.env.P1_TRUST_ROOTS_FILE=prevFile;
    if(prevHash===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;
    else process.env.P1_TRUST_ROOTS_SHA256=prevHash;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
