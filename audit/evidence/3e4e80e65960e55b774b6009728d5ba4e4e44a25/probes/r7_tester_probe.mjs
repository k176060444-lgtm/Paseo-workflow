import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Store} from '../repo/src/store.mjs';
import {testRun} from '../repo/src/git.mjs';
import {sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../repo/src/policy.mjs';
import {seedSyntheticTask,syntheticHumanAuthority} from '../repo/tests/fixtures.mjs';
const results=[];function rec(name,outcome,detail=''){results.push({name,result:outcome,detail});console.log(outcome.padEnd(16),name,detail);}
function makeRepo(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r7-tester-'));
  const repo=path.join(root,'repo');fs.mkdirSync(repo);
  const g=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  g('init','-q');fs.writeFileSync(path.join(repo,'README.txt'),'synthetic test repo\n');g('add','.');g('-c','user.name=T','-c','user.email=t@localhost','commit','-qm','base');
  return {root,repo,sha:g('rev-parse','HEAD')};
}
function fixture(stage='B_TEST'){
  const envRoot=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r7-tester-state-'));
  const id='TASKR7T'+Math.random().toString(16).slice(2,6).toUpperCase();
  const authority=syntheticHumanAuthority(envRoot,id);
  const store=new Store(path.join(envRoot,'state'));
  const frozen={schema:1,intent:'Synthetic Tester attestation probe; no production claim',policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  frozen.digest=sha256(frozen);
  const r=makeRepo();
  seedSyntheticTask(store,{id,frozen,stage,status:'READY',currentSha:r.sha,baseSha:r.sha,aRound:1,bRound:1,history:[],inflight:null,worktree:r.repo});
  return {envRoot,root:r.root,repo:r.repo,sha:r.sha,id,store,authority,frozen,
    close(){try{store.close();}catch{}authority.restore();fs.rmSync(envRoot,{recursive:true,force:true});fs.rmSync(r.root,{recursive:true,force:true});}};
}
// Production git.testRun returns no execution attestation; Store rejects the receipt.
{
  const w=fixture();
  try{
    const tests=await testRun(w.repo,[['node','--version']],w.store,w.id,'B1-test');
    rec('R7-001 production git.testRun emits attestation',tests.attestation?'NOT_CONFIRMED':'CONFIRMED','attestation='+String(tests.attestation));
    const ev=w.store.artifact(w.id,'B1-test-test-receipts.json',{sha:w.sha,tests});
    const t=w.store.get(w.id);t.history.push({role:'test_executor',phase:'B1-test',sha:w.sha,pass:tests.pass,evidenceSha256:ev.sha256});
    try{w.store.save(t,'TEST_RECEIPTS',{sha:w.sha,pass:tests.pass,evidenceSha256:ev.sha256});rec('R7-001 production Tester receipt accepted','NOT_CONFIRMED','accepted without attestation');}
    catch(e){rec('R7-001 production Tester receipt rejected','CONFIRMED',String(e.message).slice(0,120));}
    w.store.verify(w.id);
  }finally{w.close();}
}
// A test-only external witness can satisfy the contract if attached correctly.
{
  const w=fixture();
  try{
    const bare={pass:true,receipts:[{code:0,ok:true,argv:['node','--version'],logSha256:'0'.repeat(64)}]};
    const att=w.authority.attest('test_executor','B1-test',w.sha,'','',{sha:w.sha,tests:bare});
    const tests={...bare,attestation:att};
    const ev=w.store.artifact(w.id,'B1-test-test-receipts.json',{sha:w.sha,tests});
    const t=w.store.get(w.id);t.history.push({role:'test_executor',phase:'B1-test',sha:w.sha,pass:true,evidenceSha256:ev.sha256});
    try{w.store.save(t,'TEST_RECEIPTS',{sha:w.sha,pass:true,evidenceSha256:ev.sha256});rec('R7-001 synthetic signed Tester receipt accepted','CONFIRMED');}
    catch(e){rec('R7-001 synthetic signed Tester receipt accepted','NOT_CONFIRMED',String(e.message).slice(0,160));}
    assert.equal(w.store.get(w.id).stage,'B_TEST');w.store.verify(w.id);
  }finally{w.close();}
}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r7/logs/probe-r7-tester.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length,'NOT_CONFIRMED',results.filter(x=>x.result==='NOT_CONFIRMED').length);