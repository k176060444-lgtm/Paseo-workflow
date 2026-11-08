import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {seedSyntheticTask} from './fixtures.mjs';
import {sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../src/policy.mjs';
function fixture(stage){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r7-'));
  delete process.env.P1_TRUST_ROOTS_FILE;
  delete process.env.P1_TRUST_ROOTS_SHA256;
  const store=new Store(path.join(root,'state')),id='TASKR700';
  const frozen={schema:1,intent:'Synthetic independent witness regression only',
    policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  frozen.digest=sha256(frozen);
  seedSyntheticTask(store,{id,frozen,stage,status:'INFLIGHT',
    currentSha:'d'.repeat(40),baseSha:'c'.repeat(40),
    aRound:1,bRound:1,history:[],inflight:{role:'review_pair',phase:'A1-review'}});
  return {root,store,id,close(){store.close();fs.rmSync(root,{recursive:true,force:true});}};
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
