import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {Store} from '../repo/src/store.mjs';
import {canonical,sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../repo/src/policy.mjs';
import {seedSyntheticTask,syntheticHumanAuthority} from '../repo/tests/fixtures.mjs';
import {loadTrustRoots,verifyExecutionAttestation} from '../repo/src/auth.mjs';
const results=[];function rec(name,outcome,detail=''){results.push({name,result:outcome,detail});console.log(outcome.padEnd(17),name,detail);}
function fixture(stage){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r7-attest-'));
  const id='TASKR7A'+Math.random().toString(16).slice(2,6).toUpperCase();
  const authority=syntheticHumanAuthority(root,id);
  const store=new Store(path.join(root,'state'));
  const frozen={schema:1,intent:'Synthetic execution attestation probe; no production claim',policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  frozen.digest=sha256(frozen);
  const prefix=stage==='A_REVIEW'?'A1-review':'B1-review';
  seedSyntheticTask(store,{id,frozen,stage,status:'READY',currentSha:'a'.repeat(40),baseSha:'c'.repeat(40),aRound:1,bRound:1,history:[],inflight:null,worktree:root});
  return {root,id,store,authority,prefix,frozen,close(){try{store.close();}catch{} authority.restore();fs.rmSync(root,{recursive:true,force:true});}};
}
function seat(w,role,{agentId,dispatchId=role+'-'+randomUUID(),verdict='PASS',attest=true,keyId='synthetic-witness',taskId,commit,phase,rawRole,rawAgent,rawDispatch,rawPhase}={}){
  const fullPhase=w.prefix+'-'+role;
  const rid=agentId??role+'-agent';
  const r={role:rawRole??role,phase:rawPhase??fullPhase,agentId:rawAgent??rid,dispatchId:rawDispatch??dispatchId,
    verdict,summary:'synthetic signed execution',findings:[],taskSpec:null};
  w.store.recordIntent(w.id,fullPhase,dispatchId);
  w.store.recordAck(dispatchId,rid);
  w.store.recordTerminal(dispatchId);
  let a=attest?w.authority.attest(role,phase??fullPhase,commit??'a'.repeat(40),rid,dispatchId,r,taskId):undefined;
  if(a&&keyId!=='synthetic-witness')a={...a,keyId};
  const ev=w.store.artifact(w.id,`${w.prefix}-${role}-${randomUUID().slice(0,6)}.json`,a?{...r,attestation:a}:r);
  const t=w.store.get(w.id);
  t.history.push({role,phase:w.prefix,sha:commit??'a'.repeat(40),agentId:rid,verdict,evidenceSha256:ev.sha256});
  return {r,ev,t,dispatchId,agentId:rid,a};
}
function saveSeat(w,s,attestKey){const t=w.store.get(w.id);t.history.push(s.t.history.at(-1));return w.store.save(t,'REVIEW_SEAT_RECORDED',{role:s.r.role,sha:t.currentSha,agentId:s.agentId,evidenceSha256:s.ev.sha256});}
function one(w,opts){const s=seat(w,'spec_reviewer',opts);return {s};}
function expectReject(name,fn){try{fn();rec(name,'NOT_CONFIRMED','accepted unexpectedly');}catch(e){rec(name,'CONFIRMED',String(e.message).slice(0,120));}}
function expectPass(name,fn){try{fn();rec(name,'CONFIRMED');}catch(e){rec(name,'NOT_CONFIRMED',String(e.message).slice(0,160));}}
// Correct synthetic two-seat signed review for A and B.
for(const stage of ['A_REVIEW','B_REVIEW']){
  const w=fixture(stage);
  try{
    const s1=seat(w,'spec_reviewer',{agentId:'agent-spec-'+stage});
    const s2=seat(w,'quality_reviewer',{agentId:'agent-quality-'+stage});
    saveSeat(w,s1);saveSeat(w,s2);
    const t=w.store.get(w.id);t.stage=stage==='A_REVIEW'?'A_TEST':'B_TEST';t.status='READY';
    expectPass('R7-001 signed two-seat '+stage+' PASS',()=>w.store.save(t,stage==='A_REVIEW'?'A_REVIEW_PASS':'B_REVIEW_PASS'));
    assert.equal(w.store.get(w.id).stage,stage==='A_REVIEW'?'A_TEST':'B_TEST');
  }finally{w.close();}
}
// Missing/wrong/tampered fields.
for(const [label,mut] of [
  ['no attestation',{attest:false}],
  ['wrong issuer',{keyId:'not-approved'}],
  ['tampered raw',{tamperRaw:true}],
  ['replaced agentId',{rawAgent:'other-agent'}],
  ['replaced dispatchId',{rawDispatch:'other-dispatch'}],
  ['cross taskId',{taskId:'TASKOTHER'}],
  ['cross role',{rawRole:'quality_reviewer'}],
  ['cross phase',{phase:'A9-review'}],
]){
  const w=fixture('A_REVIEW');
  try{
    const s=seat(w,'spec_reviewer',{agentId:'agent-'+label,...mut});
    if(mut.tamperRaw){const raw={...s.r,summary:'TAMPERED'};s.ev=w.store.artifact(w.id,'tampered-'+randomUUID().slice(0,6)+'.json',{...raw,attestation:s.a});s.t.history[0].evidenceSha256=s.ev.sha256;}
    expectReject('R7-001 '+label,()=>saveSeat(w,s));
    assert.equal(w.store.get(w.id).history.length,0);
    w.store.verify(w.id);
  }finally{w.close();}
}

// One PASS and one FAIL signed seat: both histories retained, gate must not pass.
{
  const w=fixture('A_REVIEW');
  try{
    saveSeat(w,seat(w,'spec_reviewer',{agentId:'mixed-spec',verdict:'FAIL'}));
    saveSeat(w,seat(w,'quality_reviewer',{agentId:'mixed-quality',verdict:'PASS'}));
    const t=w.store.get(w.id);t.stage='A_TEST';t.status='READY';
    expectReject('R7-001 mixed PASS/FAIL cannot pass',()=>w.store.save(t,'A_REVIEW_PASS'));
    rec('R7-001 mixed PASS/FAIL retains valid seat',w.store.get(w.id).history.length===2?'CONFIRMED':'NOT_CONFIRMED');
    w.store.verify(w.id);
  }finally{w.close();}
}
// A seat for a different commit is accepted into append-only history, but must not pass this gate.
{
  const w=fixture('A_REVIEW');
  try{
    const s=seat(w,'spec_reviewer',{agentId:'cross-commit-agent',commit:'b'.repeat(40)});
    let seatAccepted=false;try{saveSeat(w,s);seatAccepted=true;}catch(e){}
    rec('R7-001 cross-commit seat record',seatAccepted?'NOT_CONFIRMED':'CONFIRMED',seatAccepted?'accepted into history (cannot pass current commit)':'rejected');
    const t=w.store.get(w.id);t.stage='A_TEST';t.status='READY';
    expectReject('R7-001 cross-commit cannot pass A_REVIEW',()=>w.store.save(t,'A_REVIEW_PASS'));
    w.store.verify(w.id);
  }finally{w.close();}
}
// Wrong signature: mutate a signed envelope without re-signing.
for(const stage of ['A_REVIEW']){
  const w=fixture(stage);
  try{
    const s=seat(w,'spec_reviewer',{agentId:'agent-wrongsig'});
    const bad={...s.a,signature:s.a.signature.slice(0,20)+'A'+s.a.signature.slice(21)};
    s.ev=w.store.artifact(w.id,'wrongsig-'+randomUUID().slice(0,6)+'.json',{...s.r,attestation:bad});
    s.t.history[0].evidenceSha256=s.ev.sha256;
    expectReject('R7-001 tampered signature',()=>saveSeat(w,s));
    w.store.verify(w.id);
  }finally{w.close();}
}
// Duplicate agentId across two otherwise valid seats must fail at pass.
{
  const w=fixture('A_REVIEW');
  try{
    const s1=seat(w,'spec_reviewer',{agentId:'same-agent'});
    const s2=seat(w,'quality_reviewer',{agentId:'same-agent'});
    saveSeat(w,s1);saveSeat(w,s2);
    const t=w.store.get(w.id);t.stage='A_TEST';t.status='READY';
    expectReject('R7-001 duplicate agentId',()=>w.store.save(t,'A_REVIEW_PASS'));
    w.store.verify(w.id);
  }finally{w.close();}
}
// One seat only.
{
  const w=fixture('A_REVIEW');
  try{
    saveSeat(w,seat(w,'spec_reviewer',{agentId:'only-spec'}));
    const t=w.store.get(w.id);t.stage='A_TEST';t.status='READY';
    expectReject('R7-001 one reviewer seat',()=>w.store.save(t,'A_REVIEW_PASS'));
    w.store.verify(w.id);
  }finally{w.close();}
}
// Execution issuer key duplicated as human key: purpose isolation is not enforced.
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r7-samekey-'));
  const oldF=process.env.P1_TRUST_ROOTS_FILE,oldH=process.env.P1_TRUST_ROOTS_SHA256;
  try{
    const pair=generateKeyPairSync('ed25519');
    const pem=pair.publicKey.export({format:'pem',type:'spki'});
    const mf=path.join(root,'trust.json');fs.writeFileSync(mf,JSON.stringify({schema:1,human:{'same-key':pem},execution:{'same-key':pem}}));
    process.env.P1_TRUST_ROOTS_FILE=mf;process.env.P1_TRUST_ROOTS_SHA256=sha256(fs.readFileSync(mf,'utf8'));
    const roots=loadTrustRoots();const statement={purpose:'P1_EXECUTION_ATTESTATION_V1',taskId:'T',role:'spec_reviewer',phase:'A1-review-spec_reviewer',commit:'a'.repeat(40),agentId:'a',dispatchId:'d',rawSha256:'b'.repeat(64),nonce:randomUUID(),issuedAt:new Date().toISOString()};
    const env={schema:1,keyId:'same-key',statement,signature:sign(null,Buffer.from(canonical(statement)),pair.privateKey).toString('base64')};
    expectPass('R7-001 same key in human+execution accepted',()=>verifyExecutionAttestation(roots,env,{taskId:'T',role:'spec_reviewer',phase:'A1-review-spec_reviewer',commit:'a'.repeat(40),agentId:'a',dispatchId:'d',rawSha256:'b'.repeat(64)}));
  }finally{
    if(oldF===undefined)delete process.env.P1_TRUST_ROOTS_FILE;else process.env.P1_TRUST_ROOTS_FILE=oldF;
    if(oldH===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;else process.env.P1_TRUST_ROOTS_SHA256=oldH;
    fs.rmSync(root,{recursive:true,force:true});
  }
}
// Old execution attestation has no lower-bound freshness check.
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r7-oldattest-'));
  const oldF=process.env.P1_TRUST_ROOTS_FILE,oldH=process.env.P1_TRUST_ROOTS_SHA256;
  try{
    const pair=generateKeyPairSync('ed25519');const mf=path.join(root,'trust.json');
    fs.writeFileSync(mf,JSON.stringify({schema:1,human:{'old-human':pair.publicKey.export({format:'pem',type:'spki'})},execution:{'old-exec':pair.publicKey.export({format:'pem',type:'spki'})}}));
    process.env.P1_TRUST_ROOTS_FILE=mf;process.env.P1_TRUST_ROOTS_SHA256=sha256(fs.readFileSync(mf,'utf8'));
    const roots=loadTrustRoots();const issuedAt=new Date(Date.now()-86400000).toISOString();
    const statement={purpose:'P1_EXECUTION_ATTESTATION_V1',taskId:'T',role:'spec_reviewer',phase:'A1-review-spec_reviewer',commit:'a'.repeat(40),agentId:'a',dispatchId:'d',rawSha256:'b'.repeat(64),nonce:randomUUID(),issuedAt};
    const env={schema:1,keyId:'old-exec',statement,signature:sign(null,Buffer.from(canonical(statement)),pair.privateKey).toString('base64')};
    expectPass('R7-001 old execution attestation accepted',()=>verifyExecutionAttestation(roots,env,{taskId:'T',role:'spec_reviewer',phase:'A1-review-spec_reviewer',commit:'a'.repeat(40),agentId:'a',dispatchId:'d',rawSha256:'b'.repeat(64)}));
  }finally{
    if(oldF===undefined)delete process.env.P1_TRUST_ROOTS_FILE;else process.env.P1_TRUST_ROOTS_FILE=oldF;
    if(oldH===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;else process.env.P1_TRUST_ROOTS_SHA256=oldH;
    fs.rmSync(root,{recursive:true,force:true});
  }
}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r7/logs/probe-r7-attestation.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length,'NOT_CONFIRMED',results.filter(x=>x.result==='NOT_CONFIRMED').length);