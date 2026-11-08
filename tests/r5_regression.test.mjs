import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {verifyCommitEvidenceSync} from '../src/git.mjs';
import {sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../src/policy.mjs';
import {seedSyntheticTask} from './fixtures.mjs';
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-'));
  const store=new Store(path.join(root,'state')),id='TASKR500';
  const frozen={schema:1,intent:'Synthetic approved purpose for R5 regression',policy:{
    maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  frozen.digest=sha256(frozen);
  const honest={id,stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,
    frozen,taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,
    lastA:null,lastB:null,p0Initial:null,p0Final:null,history:[],pendingHuman:null};
  return {root,store,id,honest,close(){store.close();fs.rmSync(root,{recursive:true,force:true});}};
}
function git(dir,...args){return execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();}
test('R5-002 init requires original Gate 0.1, no preseeded final state or budget',()=>{
  const w=fixture();
  try{
    for(const changed of [
      {stage:'WAIT_GATE_59'},
      {status:'READY'},
      {aRound:10,bRound:9},
      {taskSpec:'Injected speculative text greater than twenty chars.'},
      {currentSha:'e'.repeat(40)},
      {lastB:{commit:'f'.repeat(40),pass:true}},
      {history:[{role:'fake-reviewer'}]},
    ]){
      assert.throws(()=>w.store.init({...w.honest,...changed}),/new task|TASK_SPEC|round|history/);
      assert.equal(w.store.get(w.id),null);
    }
    w.store.init(w.honest);
    assert.equal(w.store.get(w.id).stage,'WAIT_GATE_01');
    w.store.verify(w.id);
  }finally{w.close();}
});
test('R5-002 init rejects config forged after hash, policy change or fake Soul',()=>{
  const w=fixture();
  try{
    const modified=structuredClone(w.honest);
    modified.frozen.intent='changed intent but digest stale';
    assert.throws(()=>w.store.init(modified),/frozen digest mismatch/);
    modified.frozen.digest=sha256(Object.fromEntries(Object.entries(modified.frozen).filter(([k])=>k!=='digest')));
    modified.frozen.policy.maxA=100;
    assert.throws(()=>w.store.init(modified),/frozen digest mismatch|budget policy mismatch/);
  }finally{w.close();}
});
test('R5-001 save cannot bypass Gate 0.1 by claiming GATE_APPROVED',()=>{
  const w=fixture();
  try{
    w.store.init(w.honest);
    const t=w.store.get(w.id);t.stage='PLANNER';t.status='READY';
    assert.throws(()=>w.store.save(t,'GATE_0.1_APPROVED'),/required registered artifact|approval/);
    assert.equal(w.store.get(w.id).stage,'WAIT_GATE_01');
    const other=w.store.get(w.id);other.stage='WAIT_GATE_59';other.status='WAITING_HUMAN';
    other.currentSha='d'.repeat(40);
    assert.throws(()=>w.store.save(other,'A_COMMIT_FROZEN'),/illegal workflow stage transition/);
    assert.equal(w.store.get(w.id).currentSha,null);
    w.store.verify(w.id);
  }finally{w.close();}
});
test('R5-001 arbitrary status, fake tester, fake P0 and forged reviewer history refused',()=>{
  const w=fixture();
  try{
    w.store.init(w.honest);
    const t=w.store.get(w.id);t.status='READY';
    assert.throws(()=>w.store.save(t,'AUDIT_NOTE'),/cannot change task status/);
    let x=w.store.get(w.id);x.lastB={pass:true,tests:{pass:true},commit:'d'.repeat(40)};
    assert.throws(()=>w.store.save(x,'AUDIT_NOTE'),/lastB may only update/);
    x=w.store.get(w.id);x.p0Initial={passed:true,commit:'d'.repeat(40),reports:[]};
    assert.throws(()=>w.store.save(x,'AUDIT_NOTE'),/p0Initial may only update/);
    x=w.store.get(w.id);x.history.push({role:'fake',verdict:'PASS'});
    assert.throws(()=>w.store.save(x,'AUDIT_NOTE'),/only authenticated role\/test\/P0/);
    w.store.verify(w.id);
  }finally{w.close();}
});
test('R5-001 forged final stage, fake SHA and receipt cannot close Gate 5.9',()=>{
  const w=fixture();
  try{
    seedSyntheticTask(w.store,{...w.honest,stage:'WAIT_GATE_59',status:'WAITING_HUMAN',
      currentSha:'d'.repeat(40),baseSha:'c'.repeat(40),aRound:10,bRound:9});
    const c=new WorkflowController({store:w.store,runtime:null,p0:null,gitOps:{
      verifyCommitEvidenceSync:()=>{throw Error('must never reach Git verification with missing evidence');}}});
    assert.throws(()=>c.approve({id:w.id,gate:'5.9',digest:'d'.repeat(40),
      actor:'reviewer',receipt:'I explicitly approve this forged final task'}),/missing independent Tester A pass|missing final Tester B pass/);
    assert.equal(w.store.get(w.id).stage,'WAIT_GATE_59');
    w.store.verify(w.id);
  }finally{w.close();}
});
test('R5-001 Planner TASK_SPEC cannot be planted with an event label at another stage',()=>{
  const w=fixture();
  try{
    w.store.init(w.honest);
    const t=w.store.get(w.id);t.taskSpec='Forged task specification meeting length requirement.';
    t.taskSpecSha=sha256(t.taskSpec);t.stage='WAIT_GATE_02';t.status='WAITING_HUMAN';
    assert.throws(()=>w.store.save(t,'TASK_SPEC_CANDIDATE'),/illegal workflow stage transition/);
    assert.equal(w.store.get(w.id).taskSpec,null);
  }finally{w.close();}
});
test('R5-003 Git commit snapshot rejects missing, unrelated and wrong worktree HEAD',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-git-'));
  try{
    const repo=path.join(root,'repo');fs.mkdirSync(repo);git(repo,'init','-q');
    fs.writeFileSync(path.join(repo,'file.txt'),'base');
    git(repo,'add','.');git(repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','base');
    const base=git(repo,'rev-parse','HEAD');
    fs.writeFileSync(path.join(repo,'file.txt'),'child');
    git(repo,'add','.');git(repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','child');
    const child=git(repo,'rev-parse','HEAD');
    const wt=path.join(root,'wt');
    git(repo,'worktree','add','--detach',wt,child);
    assert.deepEqual(verifyCommitEvidenceSync(repo,base,child,wt),{baseSha:base,commitSha:child});
    assert.throws(()=>verifyCommitEvidenceSync(repo,base,'f'.repeat(40),wt),/unverified/);
    assert.throws(()=>verifyCommitEvidenceSync(repo,child,base,wt),/unverified/);
    assert.throws(()=>verifyCommitEvidenceSync(repo,base,base,wt),/unverified/);
    assert.throws(()=>verifyCommitEvidenceSync(repo,'not-sha',child,wt),/full 40/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
