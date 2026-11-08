import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../repo/src/store.mjs';
import {WorkflowController} from '../repo/src/controller.mjs';
import {PaseoAgentRuntime} from '../repo/src/agents.mjs';
import {sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../repo/src/policy.mjs';
import {seedSyntheticTask,syntheticHumanAuthority} from '../repo/tests/fixtures.mjs';
const out=[];const rec=(name,result,detail='')=>{out.push({name,result,detail});console.log(result.padEnd(16),name,detail);};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r7-runtime-'));const id='TASKR7RT';const authority=syntheticHumanAuthority(root,id);
const taskRoot=path.join(root,'worktree');fs.mkdirSync(taskRoot);
const soulText='# spec reviewer\nRead-only review with independent evidence and exact commit checks.\n';
const frozen={schema:1,intent:'Synthetic production runtime attestation probe',
  policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS},
  roles:{spec_reviewer:{harness:'codex',model:'codex/model'},quality_reviewer:{harness:'codex',model:'codex/model'}},
  souls:{spec_reviewer:{text:soulText,sha256:sha256(soulText)},quality_reviewer:{text:soulText,sha256:sha256(soulText)}},
  project:{repo:taskRoot,baseRef:'HEAD'}};
frozen.digest=sha256(frozen);
const store=new Store(path.join(root,'state'));
seedSyntheticTask(store,{id,frozen,stage:'A_REVIEW',status:'READY',currentSha:'a'.repeat(40),baseSha:'a'.repeat(40),aRound:1,bRound:1,history:[],inflight:null,worktree:taskRoot});
const runtime=new PaseoAgentRuntime('ws://127.0.0.1:6767/ws');
runtime.client={agents:{create:async({title})=>({id:'fake-'+title.replace(/[^a-z0-9]/gi,'').slice(-8),waitForFinish:async()=>({status:'idle',lastMessage:JSON.stringify({verdict:'PASS',summary:'synthetic runtime result',findings:[]})})})}};
runtime.execute=async({task,role,phase,store})=>{
  const dispatchId='fake-dispatch-'+role;
  store.recordIntent(task.id,phase,dispatchId);store.recordAck(dispatchId,'fake-'+role);store.recordTerminal(dispatchId);
  return {role,phase,agentId:'fake-'+role,dispatchId,verdict:'PASS',summary:'synthetic runtime result',findings:[],taskSpec:null};
};
const gitOps={head:async()=> 'a'.repeat(40),assertUnchanged:async()=>{}};
const c=new WorkflowController({store,runtime,p0:null,gitOps});
try{
  const t=store.get(id);
  try{await c.invokePair(t,'A1-review','a'.repeat(40));rec('R7-001 PaseoAgentRuntime result accepted','NOT_CONFIRMED','accepted without attestation');}
  catch(e){rec('R7-001 PaseoAgentRuntime result rejected','CONFIRMED',String(e.message).slice(0,140));}
  rec('R7-001 runtime returns attestation','CONFIRMED','PaseoAgentRuntime.execute source returns no attestation field (src/agents.mjs:54)');
}finally{store.close();authority.restore();fs.rmSync(root,{recursive:true,force:true});}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r7/logs/probe-r7-runtime.json',JSON.stringify(out,null,2));
console.log('TOTAL',out.length,'CONFIRMED',out.filter(x=>x.result==='CONFIRMED').length);