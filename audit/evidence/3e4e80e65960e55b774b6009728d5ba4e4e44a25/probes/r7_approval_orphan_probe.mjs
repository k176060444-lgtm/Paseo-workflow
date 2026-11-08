import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {Store} from '../repo/src/store.mjs';
import {WorkflowController} from '../repo/src/controller.mjs';
import {sha256,canonical,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../repo/src/policy.mjs';
import {seedSyntheticTask} from '../repo/tests/fixtures.mjs';
const out=[];const rec=(name,result,detail='')=>{out.push({name,result,detail});console.log(result.padEnd(16),name,detail);};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r7-orphan-'));const pair=generateKeyPairSync('ed25519');const mf=path.join(root,'trust.json');
fs.writeFileSync(mf,JSON.stringify({schema:1,human:{'orphan-auditor':pair.publicKey.export({format:'pem',type:'spki'})}}));
const oldF=process.env.P1_TRUST_ROOTS_FILE,oldH=process.env.P1_TRUST_ROOTS_SHA256;process.env.P1_TRUST_ROOTS_FILE=mf;process.env.P1_TRUST_ROOTS_SHA256=sha256(fs.readFileSync(mf,'utf8'));
const store=new Store(path.join(root,'state'));
const frozen={schema:1,intent:'Synthetic failed-approval orphan probe',policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};frozen.digest=sha256(frozen);
function task(id){seedSyntheticTask(store,{id,frozen,stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,history:[],inflight:null});}
function proof(id,gate,digest,nonce){const actor='auditor',receipt='Independent signed approval with exact synthetic basis';
 const s={purpose:'P1_HUMAN_GATE_V1',taskId:id,gate,digest,actor,receipt,nonce:nonce??randomUUID(),issuedAt:new Date().toISOString()};
 return {schema:1,keyId:'orphan-auditor',statement:s,signature:sign(null,Buffer.from(canonical(s)),pair.privateKey).toString('base64')};}
try{
 task('TASKORPHAN1');task('TASKORPHAN2');
 const c=new WorkflowController({store,runtime:null,p0:null});
 const n=randomUUID();const p1=proof('TASKORPHAN1','0.1',frozen.digest,n);
 c.approve({id:'TASKORPHAN1',gate:'0.1',digest:frozen.digest,actor:'auditor',receipt:p1.statement.receipt,proof:p1});
 rec('R7-002 first approval succeeds',store.get('TASKORPHAN1').stage==='PLANNER'?'CONFIRMED':'NOT_CONFIRMED');
 const p2=proof('TASKORPHAN2','0.1',frozen.digest,n);
 try{c.approve({id:'TASKORPHAN2',gate:'0.1',digest:frozen.digest,actor:'auditor',receipt:p2.statement.receipt,proof:p2});rec('R7-002 second same-nonce approval rejected','NOT_CONFIRMED','accepted');}
 catch(e){rec('R7-002 second same-nonce approval rejected','CONFIRMED',String(e.message).slice(0,90));}
 rec('R7-002 failed approval leaves registered artifact',store.db.prepare("SELECT 1 FROM artifacts WHERE task_id='TASKORPHAN2' AND name='approval-0-1.json'").get()?'CONFIRMED':'NOT_CONFIRMED');
 rec('R7-002 failed approval keeps task stage',store.get('TASKORPHAN2').stage==='WAIT_GATE_01'?'CONFIRMED':'NOT_CONFIRMED');
 const p3=proof('TASKORPHAN2','0.1',frozen.digest,null);
 try{c.approve({id:'TASKORPHAN2',gate:'0.1',digest:frozen.digest,actor:'auditor',receipt:p3.statement.receipt,proof:p3});rec('R7-002 retry after failed approval','NOT_CONFIRMED','retry accepted');}
 catch(e){rec('R7-002 retry after failed approval','CONFIRMED',String(e.message).slice(0,120));}
 store.verify('TASKORPHAN1');store.verify('TASKORPHAN2');
}catch(e){console.error('FATAL',e);process.exitCode=1;}finally{store.close();if(oldF===undefined)delete process.env.P1_TRUST_ROOTS_FILE;else process.env.P1_TRUST_ROOTS_FILE=oldF;if(oldH===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;else process.env.P1_TRUST_ROOTS_SHA256=oldH;fs.rmSync(root,{recursive:true,force:true});}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r7/logs/probe-r7-approval-orphan.json',JSON.stringify(out,null,2));
console.log('TOTAL',out.length,'CONFIRMED',out.filter(x=>x.result==='CONFIRMED').length);