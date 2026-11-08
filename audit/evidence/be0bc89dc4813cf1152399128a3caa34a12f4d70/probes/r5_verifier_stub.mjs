import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../offline-copy/src/store.mjs';
import {sha256,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../offline-copy/src/policy.mjs';
import {seedSyntheticTask} from '../offline-copy/tests/fixtures.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-stub-'));
const store=new Store(path.join(root,'state'),{gitVerifier:()=>true});const id='TASKR5STUB';
const frozen={schema:1,intent:'Synthetic verifier stub probe',project:{repo:'C:/nonexistent',baseRef:'HEAD'},tests:{commands:[]},policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS},souls:{}};frozen.digest=sha256(frozen);
const honest={id,frozen,stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,lastA:null,lastB:null,p0Initial:null,p0Final:null,history:[],pendingHuman:null,inflight:null,bFindings:[],changesInB:false,worktree:null,created:new Date().toISOString()};
let result='NOT_CONFIRMED',detail='';
try{
  seedSyntheticTask(store,{...honest,stage:'PREPARE',status:'READY'});
  const wt=path.join(store.dir(id),'worktree');fs.mkdirSync(path.dirname(wt),{recursive:true});
  const t=store.get(id);t.stage='A_WORKER';t.status='READY';t.baseSha='f'.repeat(40);t.currentSha=t.baseSha;t.worktree=wt;
  store.save(t,'WORKTREE_PREPARED',{baseSha:t.baseSha});
  store.verify(id);result='CONFIRMED';detail='stub gitVerifier accepted fake SHA';
}catch(e){detail=e.message;}
console.log(result,'R6-005 gitVerifier stub can disable Git trust',detail);
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r5/logs/probe-r5-verifier-stub.json',JSON.stringify([{name:'R6-005 gitVerifier stub can disable Git trust',result,detail}],null,2));
store.close();fs.rmSync(root,{recursive:true,force:true});