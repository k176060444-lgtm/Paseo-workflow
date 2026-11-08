import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../offline-copy/src/store.mjs';
import {sha256,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../offline-copy/src/policy.mjs';
function frozen(intent='Synthetic valid creation'){
  const f={schema:1,intent,project:{repo:'C:/nonexistent',baseRef:'HEAD'},tests:{commands:[]},policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS},souls:{}};
  f.digest=sha256(f);return f;
}
function setup(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-init-'));const store=new Store(path.join(root,'state'));const id='TASKR5INIT';
  const honest={id,frozen:frozen(),stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,lastA:null,lastB:null,p0Initial:null,p0Final:null,history:[],pendingHuman:null,inflight:null,bFindings:[],changesInB:false,worktree:null,created:new Date().toISOString()};
  return {root,store,id,honest,close(){store.close();fs.rmSync(root,{recursive:true,force:true});}};
}
const results=[];function rec(name,result,detail=''){results.push({name,result,detail});console.log(result,name,detail);}
function reject(name,fn,re){const w=setup();try{try{fn(w);rec(name,'NOT_CONFIRMED','accepted');}catch(e){const ok=re.test(e.message);rec(name,ok?'CONFIRMED':'WRONG_ERROR',e.message.slice(0,140));}assert.equal(w.store.get(w.id),null);}finally{w.close();}}
function accept(name,fn){const w=setup();try{try{fn(w);w.store.verify(w.id);rec(name,'CONFIRMED');}catch(e){rec(name,'NOT_CONFIRMED',e.message.slice(0,140));}}finally{w.close();}}

reject('R5-002 init rejects WAIT_GATE_59',w=>{const t={...w.honest,stage:'WAIT_GATE_59'};w.store.init(t);},/new tasks must start|Gate 0.1/);
reject('R5-002 init rejects READY status',w=>{const t={...w.honest,status:'READY'};w.store.init(t);},/new tasks must start|Gate 0.1/);
reject('R5-002 init rejects nonzero rounds',w=>{const t={...w.honest,aRound:10,bRound:9};w.store.init(t);},/round budgets/);
reject('R5-002 init rejects pre-set TASK_SPEC',w=>{const t={...w.honest,taskSpec:'A pre-set task specification longer than twenty chars.'};w.store.init(t);},/pre-seed/);
reject('R5-002 init rejects pre-set currentSha',w=>{const t={...w.honest,currentSha:'d'.repeat(40)};w.store.init(t);},/pre-seed/);
reject('R5-002 init rejects pre-set lastB/P0',w=>{const t={...w.honest,lastB:{pass:true},p0Initial:{passed:true}};w.store.init(t);},/pre-seed/);
reject('R5-002 init rejects nonempty history',w=>{const t={...w.honest,history:[{role:'fake'}]};w.store.init(t);},/history must be empty/);
reject('R5-002 init rejects forged frozen digest',w=>{const t=structuredClone(w.honest);t.frozen.intent='changed';w.store.init(t);},/frozen digest mismatch/);
reject('R5-002 init rejects inflated policy',w=>{const t=structuredClone(w.honest);t.frozen.policy.maxA=100;t.frozen.digest=sha256(Object.fromEntries(Object.entries(t.frozen).filter(([k])=>k!=='digest')));w.store.init(t);},/budget policy/);
reject('R5-002 init rejects bad Soul digest',w=>{const t=structuredClone(w.honest);t.frozen.souls={planner:{text:'soul',sha256:'a'.repeat(64)}};t.frozen.digest=sha256(Object.fromEntries(Object.entries(t.frozen).filter(([k])=>k!=='digest')));w.store.init(t);},/Soul/);
accept('R5-002 honest init accepted',w=>w.store.init(w.honest));
accept('R5-001 public event rejects workflow event',w=>{w.store.init(w.honest);assert.throws(()=>w.store.event(w.id,'GATE_5.9_APPROVED',{}),/unsupported public event/);});
accept('R5-001 public event allows CONFIG_FROZEN only',w=>{w.store.init(w.honest);w.store.event(w.id,'CONFIG_FROZEN',{sha256:w.honest.frozen.digest});w.store.verify(w.id);});
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r5/logs/probe-r5-init-event.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length);