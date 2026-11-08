import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../offline-copy/src/store.mjs';
import {sha256,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../offline-copy/src/policy.mjs';

function frozen(){
  const f={schema:1,intent:'Synthetic round/ledger probe',policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  f.digest=sha256(f);return f;
}
function setup(){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-rounds-'));
  const store=new Store(path.join(tmp,'state')),id='TASKR5R';
  store.init({id,frozen:frozen(),stage:'BLOCKED',status:'BLOCKED',aRound:10,bRound:9,
    taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,history:[],pendingHuman:'incident',
    created:'2026-11-08T00:00:00.000Z'});
  return {tmp,store,id,close(){store.close();fs.rmSync(tmp,{recursive:true,force:true});}};
}
const results=[];
function expectThrow(name,fn,re){
  try{fn();results.push({name,result:'NOT_CONFIRMED'});console.log('NOT_CONFIRMED',name);}
  catch(e){const ok=re.test(e.message);results.push({name,result:ok?'CONFIRMED':'WRONG_ERROR',error:e.message});console.log(ok?'CONFIRMED':'WRONG_ERROR',name,e.message);}
}
function expectOk(name,fn){try{fn();results.push({name,result:'CONFIRMED'});console.log('CONFIRMED',name);}catch(e){results.push({name,result:'NOT_CONFIRMED',error:e.message});console.log('NOT_CONFIRMED',name,e.message);}}

{
  const w=setup();try{
    const baseline=w.store.verify(w.id);
    const t=w.store.get(w.id);t.aRound=0;t.bRound=0;
    expectThrow('R4-001 reset 10/9 -> 0/0 rejected',()=>w.store.save(t,'BUDGET_RESET'),/cannot reset|decrease/);
    assert.equal(w.store.get(w.id).aRound,10);assert.equal(w.store.get(w.id).bRound,9);
    assert.deepEqual(w.store.verify(w.id),baseline);
  }finally{w.close();}
}
{
  const w=setup();try{
    const t=w.store.get(w.id);t.bRound=8;
    expectThrow('R4-001 decrease 9 -> 8 rejected',()=>w.store.save(t,'GATE_B_ROUND_START'),/cannot reset|decrease/);
  }finally{w.close();}
}
{
  const w=setup();try{
    const t=w.store.get(w.id);t.bRound=11;
    expectThrow('R4-001 >10 rejected',()=>w.store.save(t,'GATE_B_ROUND_START'),/budget/);
  }finally{w.close();}
}
{
  const w=setup();try{
    const t=w.store.get(w.id);t.bRound=10;t.aRound=0;
    expectThrow('R4-001 aRound 10 -> 0 rejected',()=>w.store.save(t,'GATE_A_ROUND_START'),/cannot reset|decrease/);
  }finally{w.close();}
}
{
  const w=setup();try{
    const t=w.store.get(w.id);t.bRound=10;
    expectThrow('R4-001 round change with wrong event type rejected',()=>w.store.save(t,'NOT_A_ROUND_START'),/only advance/);
  }finally{w.close();}
}
{
  const w=setup();try{
    const t=w.store.get(w.id);t.bRound=10;
    expectOk('R4-001 legal +1 with GATE_B_ROUND_START accepted',()=>w.store.save(t,'GATE_B_ROUND_START'));
    assert.equal(w.store.get(w.id).bRound,10);w.store.verify(w.id);
  }finally{w.close();}
}
{
  const w=setup();try{
    const t=w.store.get(w.id);
    t.frozen={...t.frozen,intent:'forged'};t.frozen.digest=sha256(Object.fromEntries(Object.entries(t.frozen).filter(([k])=>k!=='digest')));
    expectThrow('R4-002 frozen replacement with recomputed digest rejected',()=>w.store.save(t,'FORGED_FREEZE'),/frozen config is immutable/);
  }finally{w.close();}
}
{
  const w=setup();try{
    let t=w.store.get(w.id);t.history.push({role:'x'});w.store.save(t,'APPEND_OK');
    t=w.store.get(w.id);t.history=[];
    expectThrow('R4-001 history truncation rejected',()=>w.store.save(t,'HISTORY_WIPE'),/cannot be truncated/);
    t=w.store.get(w.id);t.history.push({role:'forged',verdict:'PASS'});
    expectOk('R4-001 arbitrary history append accepted',()=>w.store.save(t,'REVIEW_SEAT_RECORDED'));
  }finally{w.close();}
}
{
  const w=setup();try{
    let t=w.store.get(w.id);t.baseSha='1'.repeat(40);w.store.save(t,'WORKTREE_PREPARED');
    t=w.store.get(w.id);t.baseSha='2'.repeat(40);
    expectThrow('R4-001 baseSha replacement rejected',()=>w.store.save(t,'WORKTREE_PREPARED'),/baseSha cannot be replaced/);
    t=w.store.get(w.id);t.currentSha='3'.repeat(40);
    expectThrow('R4-001 currentSha with wrong event rejected',()=>w.store.save(t,'NOT_A_COMMIT'),/currentSha may only change/);
    t=w.store.get(w.id);t.currentSha='4'.repeat(40);
    expectOk('R4-001 currentSha arbitrary value with A_COMMIT_FROZEN accepted',()=>w.store.save(t,'A_COMMIT_FROZEN'));
  }finally{w.close();}
}
{
  const w=setup();try{
    const old=w.store.get(w.id);
    const t=w.store.get(w.id);t.aRound=9;t.bRound=8;t.history=[];
    expectThrow('R4-001 old snapshot replay (lower rounds/history) rejected',()=>w.store.save(t,'REPLAY'),/cannot reset|decrease|truncated/);
    assert.equal(w.store.get(w.id).aRound,10);assert.equal(w.store.get(w.id).bRound,9);
    assert.equal(old.aRound,10);w.store.verify(w.id);
  }finally{w.close();}
}
{
  const w=setup();try{
    let t=w.store.get(w.id);t.taskSpec='A sufficiently long synthetic task specification.';t.taskSpecSha=sha256(t.taskSpec);
    expectThrow('R4-002 taskSpec with wrong event type rejected',()=>w.store.save(t,'UNAUTHORIZED_EDIT'),/Planner candidate/);
    t=w.store.get(w.id);t.taskSpec='A sufficiently long synthetic task specification.';t.taskSpecSha=sha256(t.taskSpec);
    expectOk('R4-002 taskSpec freeze via TASK_SPEC_CANDIDATE accepted at BLOCKED stage',()=>w.store.save(t,'TASK_SPEC_CANDIDATE'));
  }finally{w.close();}
}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r4/logs/probe-r5-rounds.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length);