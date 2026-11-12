import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {sha256} from '../src/policy.mjs';
import {seedSyntheticTask,syntheticHumanAuthority} from './fixtures.mjs';

for(const state of ['DISPATCH_INTENT','ACKNOWLEDGED','TERMINAL'])
test('S0 Q1: public commitRecovery rejects unreconciled '+state,()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'s0-q1-'));
  const id='TASKS0Q1',authority=syntheticHumanAuthority(root,id);
  const store=new Store(path.join(root,'state'));
  try{
    seedSyntheticTask(store,{id,stage:'BLOCKED',status:'BLOCKED',
      blockedStage:'PLANNER',reviewerReuse:null,frozen:{intent:'Synthetic recovery boundary only'}});
    store.recordIntent(id,'planner','original-dispatch');
    if(state!=='DISPATCH_INTENT')store.recordAck('original-dispatch','original-agent');
    if(state==='TERMINAL')store.recordTerminal('original-dispatch');
    const before=store.get(id),actor='human',receipt='Explicit synthetic human authorization cannot waive dispatch reconciliation';
    const proof=authority.proof('recovery',before.frozen.digest,actor,receipt,store);
    const content={actor,receipt,expectedSha:null,expectedBasis:before.frozen.digest,
      origin:before.stage,target:'PLANNER',blockedStage:before.blockedStage,
      stateSha256:sha256(before),proof};
    const next={...before,stage:'PLANNER',status:'READY',blockedStage:null,
      reviewerReuse:null,pendingHuman:null};
    const anchor=store.verify(id),nonces=store.nonceHash(id);
    assert.throws(()=>store.commitRecovery(next,{name:'recovery-q1.json',content,
      payload:{actor,evidenceSha256:sha256(content),target:'PLANNER',
        recoveryNonce:proof.statement.nonce,blockedStage:before.blockedStage,
        stateSha256:sha256(before)}}),/outstanding remote dispatch|unique registered original signed execution/);
    assert.deepEqual(store.get(id),before);
    assert.deepEqual(store.verify(id),anchor);
    assert.equal(store.nonceHash(id),nonces);
    assert.equal(fs.existsSync(path.join(store.dir(id),'evidence','recovery-q1.json')),false);
  }finally{store.close();authority.restore();fs.rmSync(root,{recursive:true,force:true});}
});
