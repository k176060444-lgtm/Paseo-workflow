import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {Store} from '../offline-copy/src/store.mjs';
import {WorkflowController} from '../offline-copy/src/controller.mjs';
import {canonical,sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../offline-copy/src/policy.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r6-auth-'));
const pair=generateKeyPairSync('ed25519');
const trust=path.join(root,'trust.json');
fs.writeFileSync(trust,JSON.stringify({schema:1,human:{'test-key':pair.publicKey.export({format:'pem',type:'spki'})}}));
const goodHash=sha256(fs.readFileSync(trust,'utf8'));
const oldFile=process.env.P1_TRUST_ROOTS_FILE,oldHash=process.env.P1_TRUST_ROOTS_SHA256;
process.env.P1_TRUST_ROOTS_FILE=trust;process.env.P1_TRUST_ROOTS_SHA256=goodHash;
function frozen(){const f={schema:1,intent:'Synthetic signed approval probe',policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};f.digest=sha256(f);return f;}
function makeStore(){const d=fs.mkdtempSync(path.join(root,'state-'));return {d,store:new Store(d)};}
function task(id,f){return {id,frozen:f,trustRootSha256:goodHash,stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,lastA:null,lastB:null,p0Initial:null,p0Final:null,history:[],pendingHuman:null,inflight:null,bFindings:[],changesInB:false,worktree:null,created:new Date().toISOString()};}
function proof(fields,{issuedAt=new Date().toISOString(),signIt=true}={}){
  const st={purpose:'P1_HUMAN_GATE_V1',taskId:fields.taskId,gate:fields.gate,digest:fields.digest,actor:fields.actor,receipt:fields.receipt,nonce:randomUUID(),issuedAt};
  if(fields.evidenceSha256!==undefined)st.evidenceSha256=fields.evidenceSha256;
  return {schema:1,keyId:'test-key',statement:st,signature:signIt?sign(null,Buffer.from(canonical(st)),pair.privateKey).toString('base64'):'A'.repeat(86)+'=='};
}
const results=[];function rec(name,result,detail=''){results.push({name,result,detail});console.log(result,name,detail);}
function reject(name,fn,re){try{fn();rec(name,'NOT_CONFIRMED','accepted');}catch(e){const ok=re.test(e.message);rec(name,ok?'CONFIRMED':'WRONG_ERROR',e.message.slice(0,160));}}
function accept(name,fn){try{fn();rec(name,'CONFIRMED');}catch(e){rec(name,'NOT_CONFIRMED',e.message.slice(0,160));}}
const f=frozen(),fields={taskId:'TASKR6AUTH',gate:'0.1',digest:f.digest,actor:'human',receipt:'Signed human approval for exact frozen digest.'};
const p=proof(fields);
accept('R6-003 valid Ed25519 proof accepted',()=>{const {store}=makeStore();store.verifyHumanProof(p,fields);store.close();});
for(const [tag,mod] of [
 ['wrong task',{...fields,taskId:'TASK0000'}],
 ['wrong gate',{...fields,gate:'0.2'}],
 ['wrong digest',{...fields,digest:'a'.repeat(64)}],
 ['wrong actor',{...fields,actor:'impostor'}],
 ['wrong receipt',{...fields,receipt:'replaced approval string'}],
])reject('R6-003 rejects '+tag,()=>{const {store}=makeStore();store.verifyHumanProof(p,mod);store.close();},/signed statement mismatch/);
reject('R6-003 rejects tampered signature',()=>{const {store}=makeStore();const t=structuredClone(p);t.statement.receipt+=' tampered';store.verifyHumanProof(t,{...fields,receipt:t.statement.receipt});store.close();},/invalid independent human approval signature/);
reject('R6-003 rejects stale 40-minute proof',()=>{const {store}=makeStore();store.verifyHumanProof(proof(fields,{issuedAt:new Date(Date.now()-40*60000).toISOString()}),fields);store.close();},/stale/);
reject('R6-003 rejects future 5-minute proof',()=>{const {store}=makeStore();store.verifyHumanProof(proof(fields,{issuedAt:new Date(Date.now()+5*60000).toISOString()}),fields);store.close();},/stale/);
reject('R6-003 rejects trust-root SHA mismatch at Store construction',()=>{process.env.P1_TRUST_ROOTS_SHA256='f'.repeat(64);try{new Store(path.join(root,'badstate'));}finally{process.env.P1_TRUST_ROOTS_SHA256=goodHash;}},/trust roots manifest digest mismatch/);
{
  const {store,d}=makeStore();try{
    const id='TASKR6AUTH';store.init(task(id,f));
    store.verifyHumanProof(p,fields);store.verifyHumanProof(p,fields);
    rec('R6-003 verifier accepts same nonce twice (no nonce ledger)','CONFIRMED');
  }finally{store.close();fs.rmSync(d,{recursive:true,force:true});}
}
{
  const {store,d}=makeStore();try{
    const id='TASKR6AUTH';store.init(task(id,f));
    const actor='fake-human',receipt='Fabricated approval without any signature at all.';
    const ev=store.artifact(id,'approval-0-1.json',{gate:'0.1',digest:f.digest,actor,receipt});
    const t=store.get(id);t.stage='PLANNER';t.status='READY';
    reject('R6-001 unsigned self-consistent approval cannot pass Gate 0.1',()=>store.save(t,'GATE_0.1_APPROVED',{actor,digest:f.digest,approvalSha256:ev.sha256}),/signature envelope missing|not provisioned/);
  }finally{store.close();fs.rmSync(d,{recursive:true,force:true});}
}
{
  const {store,d}=makeStore();try{
    const id='TASKR6AUTH';const c=new WorkflowController({store,runtime:null,p0:null});
    store.init(task(id,f));
    const r=c.approve({id,gate:'0.1',digest:f.digest,actor:'human',receipt:fields.receipt,proof:p});
    assert.equal(r.stage,'PLANNER');store.verify(id);
    rec('R6-003 Controller.approve with valid Ed25519 proof advances Gate 0.1','CONFIRMED');
  }finally{store.close();fs.rmSync(d,{recursive:true,force:true});}
}
{
  const {store,d}=makeStore();try{
    const ev='e'.repeat(64);const st={...fields,gate:'5.9',digest:'d'.repeat(40),receipt:'Final compliance approval with evidence binding.',evidenceSha256:ev};
    const p59=proof(st);const fields59={taskId:st.taskId,gate:'5.9',digest:st.digest,actor:st.actor,receipt:st.receipt,evidenceSha256:ev};
    accept('R6-003 Gate 5.9 proof binds final-compliance SHA',()=>store.verifyHumanProof(p59,fields59));
    reject('R6-003 Gate 5.9 proof rejects substituted evidence SHA',()=>store.verifyHumanProof(p59,{...fields59,evidenceSha256:'a'.repeat(64)}),/must bind final compliance/);
  }finally{store.close();fs.rmSync(d,{recursive:true,force:true});}
}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r6/logs/probe-r6-auth.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length);
try{fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch(e){console.log('CLEANUP_WARNING',e.code);}
if(oldFile===undefined)delete process.env.P1_TRUST_ROOTS_FILE;else process.env.P1_TRUST_ROOTS_FILE=oldFile;
if(oldHash===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;else process.env.P1_TRUST_ROOTS_SHA256=oldHash;