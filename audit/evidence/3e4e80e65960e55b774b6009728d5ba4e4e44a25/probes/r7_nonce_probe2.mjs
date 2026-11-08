import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {Store} from '../repo/src/store.mjs';
import {sha256,canonical,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../repo/src/policy.mjs';
import {seedSyntheticTask} from '../repo/tests/fixtures.mjs';
const out=[];const rec=(name,result,detail='')=>{out.push({name,result,detail});console.log(result.padEnd(16),name,detail);};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r7-nonce-'));
const pair=generateKeyPairSync('ed25519');
const mf=path.join(root,'trust.json');
fs.writeFileSync(mf,JSON.stringify({schema:1,human:{'nonce-auditor':pair.publicKey.export({format:'pem',type:'spki'})}}));
const oldF=process.env.P1_TRUST_ROOTS_FILE,oldH=process.env.P1_TRUST_ROOTS_SHA256;
process.env.P1_TRUST_ROOTS_FILE=mf;process.env.P1_TRUST_ROOTS_SHA256=sha256(fs.readFileSync(mf,'utf8'));
const store=new Store(path.join(root,'state'));
const frozen={schema:1,intent:'Synthetic nonce atomicity probe',policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};frozen.digest=sha256(frozen);
function task(id,stage,extra={}){seedSyntheticTask(store,{id,frozen,stage,status:'WAITING_HUMAN',aRound:0,bRound:0,history:[],inflight:null,...extra});return id;}
let currentTask='';
function proof(gate,digest,nonce,actor='auditor',receipt='Independent human approval for synthetic nonce probe'){
  const statement={purpose:'P1_HUMAN_GATE_V1',taskId:currentTask,gate,digest,actor,receipt,nonce:nonce??randomUUID(),issuedAt:new Date().toISOString()};
  return {schema:1,keyId:'nonce-auditor',statement,signature:sign(null,Buffer.from(canonical(statement)),pair.privateKey).toString('base64')};
}
let nonce;
try{
  const id=task('TASKROLLBACK','WAIT_GATE_01');currentTask=id;
  const p=proof('0.1',frozen.digest,null);nonce=p.statement.nonce;
  const ev=store.artifact(id,'approval-0-1.json',{gate:'0.1',digest:frozen.digest,actor:'auditor',receipt:p.statement.receipt,proof:p});
  let t=store.get(id);t.stage='PLANNER';t.status='READY';t.aRound=1;
  try{store.save(t,'GATE_0.1_APPROVED',{digest:frozen.digest,actor:'auditor',approvalSha256:ev.sha256,approvalNonce:nonce});rec('R7-003 forced failure after consume rejected','NOT_CONFIRMED','save accepted');}
  catch(e){rec('R7-003 forced failure after consume rejected','CONFIRMED',String(e.message).slice(0,100));}
  rec('R7-003 nonce row rolled back',store.db.prepare('SELECT COUNT(*) AS n FROM consumed_approvals WHERE nonce=?').get(nonce).n===0?'CONFIRMED':'NOT_CONFIRMED');
  t=store.get(id);t.stage='PLANNER';t.status='READY';t.aRound=0;
  try{store.save(t,'GATE_0.1_APPROVED',{digest:frozen.digest,actor:'auditor',approvalSha256:ev.sha256,approvalNonce:nonce});rec('R7-003 same nonce reusable after rollback','CONFIRMED');}
  catch(e){rec('R7-003 same nonce reusable after rollback','NOT_CONFIRMED',String(e.message).slice(0,120));}
  rec('R7-003 nonce consumed exactly once',store.db.prepare('SELECT COUNT(*) AS n FROM consumed_approvals WHERE nonce=?').get(nonce).n===1?'CONFIRMED':'NOT_CONFIRMED');
  const spec='A sufficiently long synthetic TASK_SPEC used only to test Gate 0.2 nonce consumption.';
  const id2=task('TASKGATE2','WAIT_GATE_02',{taskSpec:spec,taskSpecSha:sha256(spec)});currentTask=id2;
  store.artifact(id2,'TASK_SPEC.md',spec);
  const p2=proof('0.2',sha256(spec),nonce);
  const ev2=store.artifact(id2,'approval-0-2.json',{gate:'0.2',digest:sha256(spec),actor:'auditor',receipt:p2.statement.receipt,proof:p2});
  let t2=store.get(id2);t2.stage='PREPARE';t2.status='READY';
  try{store.save(t2,'GATE_0.2_APPROVED',{digest:sha256(spec),actor:'auditor',approvalSha256:ev2.sha256,approvalNonce:nonce});rec('R7-003 cross-gate nonce rejected','NOT_CONFIRMED','save accepted');}
  catch(e){rec('R7-003 cross-gate nonce rejected','CONFIRMED',String(e.message).slice(0,120));}
  const id3=task('TASKREC','BLOCKED',{status:'BLOCKED',currentSha:null,taskSpec:null,taskSpecSha:null});currentTask=id3;
  const basis=store.get(id3).frozen.digest;
  const pr=proof('recovery',basis,nonce);
  const rEv=store.artifact(id3,'recovery-test.json',{origin:'BLOCKED',target:'PLANNER',actor:'auditor',receipt:pr.statement.receipt,expectedSha:null,expectedBasis:basis,proof:pr});
  const t3=store.get(id3);t3.stage='PLANNER';t3.status='READY';
  try{store.save(t3,'HUMAN_CONTROLLED_RECOVERY',{actor:'auditor',evidenceSha256:rEv.sha256,target:'PLANNER',recoveryNonce:nonce});rec('R7-003 recovery nonce rejected','NOT_CONFIRMED','save accepted');}
  catch(e){rec('R7-003 recovery nonce rejected','CONFIRMED',String(e.message).slice(0,120));}
  store.verify('TASKROLLBACK');
}catch(e){console.error('FATAL',e);process.exitCode=1;}finally{
  store.close();
  if(oldF===undefined)delete process.env.P1_TRUST_ROOTS_FILE;else process.env.P1_TRUST_ROOTS_FILE=oldF;
  if(oldH===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;else process.env.P1_TRUST_ROOTS_SHA256=oldH;
  fs.rmSync(root,{recursive:true,force:true});
}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r7/logs/probe-r7-nonce.json',JSON.stringify(out,null,2));
console.log('TOTAL',out.length,'CONFIRMED',out.filter(x=>x.result==='CONFIRMED').length);