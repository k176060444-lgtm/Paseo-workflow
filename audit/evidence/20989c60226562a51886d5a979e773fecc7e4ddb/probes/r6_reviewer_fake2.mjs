import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {Store} from '../offline-copy/src/store.mjs';
import {sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../offline-copy/src/policy.mjs';
import {seedSyntheticTask} from '../offline-copy/tests/fixtures.mjs';

const trustDir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r6-review-trust-'));
const pair=generateKeyPairSync('ed25519');
const trust=path.join(trustDir,'trust.json');
fs.writeFileSync(trust,JSON.stringify({schema:1,human:{'test-key':pair.publicKey.export({format:'pem',type:'spki'})}}));
const oldFile=process.env.P1_TRUST_ROOTS_FILE,oldHash=process.env.P1_TRUST_ROOTS_SHA256;
process.env.P1_TRUST_ROOTS_FILE=trust;process.env.P1_TRUST_ROOTS_SHA256=sha256(fs.readFileSync(trust,'utf8'));
const frozen={schema:1,intent:'Synthetic reviewer dispatch probe',policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};frozen.digest=sha256(frozen);
function make(stage,round){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r6-review-'));
  const store=new Store(path.join(dir,'state'));const id='TASKR6REV';
  const boot={id,frozen,trustRootSha256:store.trustRootDigest(),stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,lastA:null,lastB:null,p0Initial:null,p0Final:null,history:[],pendingHuman:null};
  seedSyntheticTask(store,{...boot,stage,status:'READY',aRound:stage.startsWith('B')?1:round,bRound:stage.startsWith('B')?1:0,currentSha:'d'.repeat(40),baseSha:'c'.repeat(40)});
  return {dir,store,id,close(){store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function addSeat(w,phase,role,agent){
  const job=`job-${phase}-${role}`;const dispatchPhase=`${phase}-${role}`;
  w.store.recordIntent(w.id,dispatchPhase,job);w.store.recordAck(job,agent);w.store.recordTerminal(job);
  const raw={role,phase:`${phase}-${role}`,agentId:agent,verdict:'PASS',summary:'fabricated reviewer report',findings:[]};
  const art=w.store.artifact(w.id,`${role}-fake.json`,raw);
  let t=w.store.get(w.id);t.history.push({role,phase,agentId:agent,verdict:'PASS',sha:t.currentSha,evidenceSha256:art.sha256});
  w.store.save(t,'REVIEW_SEAT_RECORDED',{role,phase,agentId:agent,sha:t.currentSha,evidenceSha256:art.sha256});
}
const results=[];function rec(name,result,detail=''){results.push({name,result,detail});console.log(result,name,detail);}
{
  const w=make('A_REVIEW',1);try{
    let t=w.store.get(w.id);t.stage='A_TEST';t.status='READY';
    try{w.store.save(t,'A_REVIEW_PASS');rec('R6-002 A_REVIEW_PASS without evidence rejected','NOT_CONFIRMED','accepted');}
    catch(e){const ok=/two independent Reviewer seats/.test(e.message);rec('R6-002 A_REVIEW_PASS without evidence rejected',ok?'CONFIRMED':'WRONG_ERROR',e.message.slice(0,140));}
  }finally{w.close();}
}
{
  const w=make('A_REVIEW',1);try{
    addSeat(w,'A1-review','spec_reviewer','fake-agent-spec');addSeat(w,'A1-review','quality_reviewer','fake-agent-quality');
    let t=w.store.get(w.id);t.stage='A_TEST';t.status='READY';
    try{w.store.save(t,'A_REVIEW_PASS');w.store.verify(w.id);rec('R6-002 fabricated dispatch+artifacts pass A_REVIEW_PASS','CONFIRMED');}
    catch(e){rec('R6-002 fabricated dispatch+artifacts pass A_REVIEW_PASS','NOT_CONFIRMED',e.message.slice(0,160));}
  }finally{w.close();}
}
{
  const w=make('A_REVIEW',1);try{
    addSeat(w,'A1-review','spec_reviewer','same-agent');addSeat(w,'A1-review','quality_reviewer','same-agent');
    let t=w.store.get(w.id);t.stage='A_TEST';t.status='READY';
    try{w.store.save(t,'A_REVIEW_PASS');rec('R6-002 duplicate agentId rejected','NOT_CONFIRMED','accepted');}
    catch(e){const ok=/reused/.test(e.message);rec('R6-002 duplicate agentId rejected',ok?'CONFIRMED':'WRONG_ERROR',e.message.slice(0,140));}
  }finally{w.close();}
}
{
  const w=make('B_REVIEW',1);try{
    addSeat(w,'B1-review','spec_reviewer','fake-b-spec');addSeat(w,'B1-review','quality_reviewer','fake-b-quality');
    let t=w.store.get(w.id);t.stage='B_TEST';t.status='READY';
    try{w.store.save(t,'B_REVIEW_PASS');w.store.verify(w.id);rec('R6-002 fabricated dispatch+artifacts pass B_REVIEW_PASS','CONFIRMED');}
    catch(e){rec('R6-002 fabricated dispatch+artifacts pass B_REVIEW_PASS','NOT_CONFIRMED',e.message.slice(0,160));}
  }finally{w.close();}
}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r6/logs/probe-r6-reviewer.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length);
fs.rmSync(trustDir,{recursive:true,force:true});
if(oldFile===undefined)delete process.env.P1_TRUST_ROOTS_FILE;else process.env.P1_TRUST_ROOTS_FILE=oldFile;
if(oldHash===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;else process.env.P1_TRUST_ROOTS_SHA256=oldHash;