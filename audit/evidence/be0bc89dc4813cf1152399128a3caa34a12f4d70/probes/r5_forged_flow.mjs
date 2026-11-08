import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Store} from '../offline-copy/src/store.mjs';
import {sha256,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../offline-copy/src/policy.mjs';

function git(dir,...args){return execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();}
function mkRepo(root){
  const repo=path.join(root,'repo');fs.mkdirSync(repo);git(repo,'init','-q');
  fs.writeFileSync(path.join(repo,'file.txt'),'base');
  git(repo,'add','.');git(repo,'-c','user.name=T','-c','user.email=t@l','commit','-qm','base');
  return repo;
}
const BASE=git
const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-forged-'));
const repo=mkRepo(root);
const store=new Store(path.join(root,'state'));const id='TASKR5FORGE';
const frozen={schema:1,intent:'Forged but internally consistent workflow',project:{repo,baseRef:'HEAD'},tests:{commands:[]},policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS},souls:{}};
frozen.digest=sha256(frozen);
store.init({id,frozen,stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,lastA:null,lastB:null,p0Initial:null,p0Final:null,history:[],pendingHuman:null,inflight:null,bFindings:[],changesInB:false,worktree:null,created:new Date().toISOString()});
const steps=[];
function step(name,fn){try{fn();store.verify(id);steps.push({name,result:'OK'});console.log('OK',name);}catch(e){steps.push({name,result:'FAIL',error:e.message});console.log('FAIL',name,e.message);throw e;}}

step('Gate 0.1 fake approval artifact',()=>{
  const a=store.artifact(id,'approval-0-1.json',{gate:'0.1',digest:frozen.digest,actor:'fake-human',receipt:'Fake human approval receipt long enough.'});
  const t=store.get(id);t.stage='PLANNER';t.status='READY';
  store.save(t,'GATE_0.1_APPROVED',{digest:frozen.digest,actor:'fake-human',approvalSha256:a.sha256});
});
const spec='Fabricated TASK_SPEC accepted without any Planner execution.';
const specSha=sha256(spec);
step('Planner TASK_SPEC fake artifact',()=>{
  const a=store.artifact(id,'TASK_SPEC.md',spec);
  assert.equal(a.sha256,specSha);
  const t=store.get(id);t.taskSpec=spec;t.taskSpecSha=specSha;t.stage='WAIT_GATE_02';t.status='WAITING_HUMAN';
  store.save(t,'TASK_SPEC_CANDIDATE',{sha256:specSha});
});
step('Gate 0.2 fake approval artifact',()=>{
  const a=store.artifact(id,'approval-0-2.json',{gate:'0.2',digest:specSha,actor:'fake-human',receipt:'Fake human approval receipt long enough.'});
  const t=store.get(id);t.stage='PREPARE';t.status='READY';
  store.save(t,'GATE_0.2_APPROVED',{digest:specSha,actor:'fake-human',approvalSha256:a.sha256});
});
let base,child,wt;
step('WORKTREE_PREPARED real repo',()=>{
  base=git(repo,'rev-parse','HEAD');
  wt=path.join(store.dir(id),'worktree');fs.mkdirSync(path.dirname(wt),{recursive:true});
  git(repo,'worktree','add','--detach',wt,base);
  const t=store.get(id);t.stage='A_WORKER';t.status='READY';t.baseSha=base;t.currentSha=base;t.worktree=wt;
  store.save(t,'WORKTREE_PREPARED',{baseSha:base});
});
step('GATE_A_ROUND_START',()=>{const t=store.get(id);t.aRound=1;store.save(t,'GATE_A_ROUND_START',{round:1});});
step('A_COMMIT_FROZEN real child commit',()=>{
  fs.writeFileSync(path.join(wt,'file.txt'),'child');git(wt,'add','.');git(wt,'-c','user.name=T','-c','user.email=t@l','commit','-qm','child');
  child=git(wt,'rev-parse','HEAD');
  const t=store.get(id);t.currentSha=child;t.stage='A_REVIEW';t.status='READY';
  store.save(t,'A_COMMIT_FROZEN',{sha:child});
});
step('A_REVIEW_PASS with no reviewer evidence',()=>{const t=store.get(id);t.stage='A_TEST';t.status='READY';store.save(t,'A_REVIEW_PASS',{sha:child});});
step('Tester A fake history/artifact',()=>{
  const a=store.artifact(id,'tester-a.json',{pass:true,commit:child});
  const t=store.get(id);t.history.push({role:'test_executor',sha:child,pass:true,evidenceSha256:a.sha256});
  store.save(t,'TEST_RECEIPTS',{sha:child,pass:true,evidenceSha256:a.sha256});
});
step('GATE_A_PASS fake Tester A',()=>{
  const t=store.get(id);t.lastA={pass:true,tests:{pass:true},commit:child};t.stage='P0_INITIAL';t.status='READY';
  store.save(t,'GATE_A_PASS',{sha:child});
});
step('P0_STARTED',()=>{const t=store.get(id);t.status='INFLIGHT';store.save(t,'P0_STARTED',{cycle:'fake'});});
step('P0_COMPLETE fake P0 history',()=>{
  const a=store.artifact(id,'p0-evidence.json',{fake:true});
  const t=store.get(id);t.history.push({role:'P0',sha:child,passed:true,evidenceSha256:a.sha256});t.status='READY';
  store.save(t,'P0_COMPLETE',{cycle:'fake',sha:child,passed:true,evidenceSha256:a.sha256});
});
step('P0_INITIAL_COLLECTED fake 2-seat P0',()=>{
  const t=store.get(id);t.p0Initial={passed:true,commit:child,reports:[
    {physicalId:'fake-A',commit:child,verdict:'PASS',findings:[]},
    {physicalId:'fake-B',commit:child,verdict:'PASS',findings:[]}]};
  t.stage='B_ENTER';t.status='READY';store.save(t,'P0_INITIAL_COLLECTED',{pass:true});
});
step('GATE_B_ROUND_START',()=>{const t=store.get(id);t.bRound=1;store.save(t,'GATE_B_ROUND_START',{round:1});});
step('B_REMEDIATION_SKIPPED',()=>{const t=store.get(id);t.stage='B_TEST';t.status='READY';store.save(t,'B_REMEDIATION_SKIPPED',{});});
step('Tester B fake history/artifact',()=>{
  const a=store.artifact(id,'tester-b.json',{pass:true,commit:child});
  const t=store.get(id);t.history.push({role:'test_executor',sha:child,pass:true,evidenceSha256:a.sha256});
  store.save(t,'TEST_RECEIPTS',{sha:child,pass:true,evidenceSha256:a.sha256});
});
step('GATE_B_TEST_PASS fake Tester B',()=>{
  const t=store.get(id);t.lastB={pass:true,tests:{pass:true},commit:child};t.stage='READY_FINAL';t.status='READY';
  store.save(t,'GATE_B_TEST_PASS',{sha:child});
});
step('WAITING_HUMAN_GATE_5_9 fake compliance',()=>{
  store.artifact(id,'final-compliance.json',{pass:true,finalSha:child,baseSha:base,taskConfigSha:frozen.digest});
  const t=store.get(id);t.stage='WAIT_GATE_59';t.status='WAITING_HUMAN';
  store.save(t,'WAITING_HUMAN_GATE_5_9',{finalCommit:child});
});
step('GATE_5.9_APPROVED fake human receipt with final Git verifier stubbed to throw',()=>{
  const a=store.artifact(id,'approval-5-9.json',{gate:'5.9',digest:child,actor:'fake-human',receipt:'Fake human final approval receipt long enough.'});
  store.gitVerifier=()=>{throw new Error('final Git verifier unexpectedly called');};
  const t=store.get(id);t.stage='CLOSED';t.status='APPROVED_FOR_SEPARATE_RELEASE_REVIEW';
  store.save(t,'GATE_5.9_APPROVED',{digest:child,actor:'fake-human',approvalSha256:a.sha256,finalCommit:child});
});
const final=store.get(id);store.verify(id);
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r5/logs/probe-r5-forged-flow.json',JSON.stringify({steps,finalStage:final.stage,finalStatus:final.status,currentSha:final.currentSha,aRound:final.aRound,bRound:final.bRound,evidence:store.db.prepare('SELECT name,digest FROM artifacts WHERE task_id=? ORDER BY name').all(id)},null,2));
console.log('FINAL',final.stage,final.status,'steps',steps.length);
store.close();fs.rmSync(root,{recursive:true,force:true});