import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../offline-copy/src/store.mjs';
import {ROLE_PERMISSIONS, MAX_A, MAX_B, sha256} from '../offline-copy/src/policy.mjs';
import {parseAgentOutput} from '../offline-copy/src/policy.mjs';

function mk(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r3quick-'));
  const store=new Store(path.join(dir,'state'));
  const id='TASKR3Q1';
  const frozen={intent:'synthetic',schema:1,policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  frozen.digest=sha256(frozen);
  store.init({id,frozen,stage:'BLOCKED',status:'BLOCKED',aRound:10,bRound:9,currentSha:null,taskSpecSha:null,history:[],inflight:null});
  return {dir,store,id};
}
const w=mk();
const t=w.store.get(w.id); t.aRound=0; t.bRound=0;
try{w.store.save(t,'BUDGET_RESET');console.log('SAVE_ACCEPTED aRound=',w.store.get(w.id).aRound,'bRound=',w.store.get(w.id).bRound);}
catch(e){console.log('SAVE_REJECTED',e.message);}
try{console.log('VERIFY_AFTER_SAVE events=',w.store.verify(w.id).events);}catch(e){console.log('VERIFY_REJECTED',e.message);}

const outer={verdict:'FAIL',summary:'outer real report',findings:['BLOCKER: x'],nested:{verdict:'PASS',summary:'inner example',findings:[]}};
const raw1='## report\n'+JSON.stringify(outer,null,2)+'\nTrailing prose';
try{const r=parseAgentOutput(raw1,'spec_reviewer');console.log('PARSER_NESTED=',r.verdict,r.summary);}catch(e){console.log('PARSER_NESTED_REJECTED',e.message);}
const raw2='## report\nExample: '+JSON.stringify({verdict:'PASS',summary:'example',findings:[]})+'\nActual: '+JSON.stringify({verdict:'FAIL',summary:'real failure',findings:['BLOCKER: x']})+'\ntrailing';
try{const r=parseAgentOutput(raw2,'spec_reviewer');console.log('PARSER_EXAMPLE=',r.verdict,r.summary);}catch(e){console.log('PARSER_EXAMPLE_REJECTED',e.message);}
w.store.close();fs.rmSync(w.dir,{recursive:true,force:true});
