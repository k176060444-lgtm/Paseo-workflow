import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../repo/src/store.mjs';
import {sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../repo/src/policy.mjs';
import {seedSyntheticTask,syntheticHumanAuthority} from '../repo/tests/fixtures.mjs';
const out=[];const rec=(name,result,detail='')=>{out.push({name,result,detail});console.log(result.padEnd(16),name,detail);};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r7-root-'));const id='TASKR7ROOT';const authority=syntheticHumanAuthority(root,id);
const store=new Store(path.join(root,'state'));
const frozen={schema:1,intent:'Synthetic evidence-root probe',policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};frozen.digest=sha256(frozen);
seedSyntheticTask(store,{id,frozen,stage:'A_REVIEW',status:'READY',currentSha:'a'.repeat(40),baseSha:'c'.repeat(40),aRound:1,bRound:1,history:[],inflight:null,worktree:root});
try{
  const r0=store.evidenceRoot(id);const a=store.artifact(id,'base-artifact.json',{v:1});const r1=store.evidenceRoot(id);
  rec('R7-002 evidenceRoot changes after artifact add',r0!==r1?'CONFIRMED':'NOT_CONFIRMED',`${r0.slice(0,12)} -> ${r1.slice(0,12)}`);
  const b=store.artifact(id,'second-artifact.json',{v:2});const r2=store.evidenceRoot(id);
  rec('R7-002 evidenceRoot deterministic ordered hash',r2===store.evidenceRoot(id)?'CONFIRMED':'NOT_CONFIRMED',r2.slice(0,12));
  const beforeSpecial=store.evidenceRoot(id);
  store.artifact(id,'final-compliance.json',{pass:true,evidenceRoot:beforeSpecial});
  store.artifact(id,'approval-5-9.json',{gate:'5.9'});
  rec('R7-002 final/5.9 artifacts excluded',store.evidenceRoot(id)===beforeSpecial?'CONFIRMED':'NOT_CONFIRMED');
  const beforeLate=store.evidenceRoot(id);store.artifact(id,'late-unapproved.json',{late:true});
  rec('R7-002 late artifact changes root',store.evidenceRoot(id)!==beforeLate?'CONFIRMED':'NOT_CONFIRMED');
  // Direct file tamper: verify must fail.
  fs.writeFileSync(path.join(store.dir(id),'evidence','base-artifact.json'),'{"v":999}');
  try{store.verify(id);rec('R7-002 raw artifact tamper detected','NOT_CONFIRMED','verify accepted');}catch(e){rec('R7-002 raw artifact tamper detected','CONFIRMED',String(e.message).slice(0,100));}
  // Restore original and test dispatch tamper.
  fs.writeFileSync(path.join(store.dir(id),'evidence','base-artifact.json'),JSON.stringify({v:1}));
  store.recordIntent(id,'A1-review-spec_reviewer','dispatch-root-1');store.recordAck('dispatch-root-1','agent-root-1');store.recordTerminal('dispatch-root-1');
  const beforeDispatch=store.evidenceRoot(id);
  store.db.prepare("UPDATE dispatches SET state='FORGED' WHERE id='dispatch-root-1'").run();
  rec('R7-002 dispatch tamper changes root',store.evidenceRoot(id)!==beforeDispatch?'CONFIRMED':'NOT_CONFIRMED');
  try{store.verify(id);rec('R7-002 dispatch tamper detected by ledger','NOT_CONFIRMED','verify accepted');}catch(e){rec('R7-002 dispatch tamper detected by ledger','CONFIRMED',String(e.message).slice(0,100));}
  // Delete a registered row and file: root changes; verify fails.
  const beforeDelete=store.evidenceRoot(id);
  store.db.prepare("DELETE FROM artifacts WHERE task_id=? AND name='second-artifact.json'").run(id);
  fs.unlinkSync(path.join(store.dir(id),'evidence','second-artifact.json'));
  rec('R7-002 artifact deletion changes root',store.evidenceRoot(id)!==beforeDelete?'CONFIRMED':'NOT_CONFIRMED');
  try{store.verify(id);rec('R7-002 artifact deletion detected','NOT_CONFIRMED','verify accepted');}catch(e){rec('R7-002 artifact deletion detected','CONFIRMED',String(e.message).slice(0,100));}
}catch(e){console.error('FATAL',e);process.exitCode=1;}finally{store.close();authority.restore();fs.rmSync(root,{recursive:true,force:true});}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r7/logs/probe-r7-root.json',JSON.stringify(out,null,2));
console.log('TOTAL',out.length,'CONFIRMED',out.filter(x=>x.result==='CONFIRMED').length);