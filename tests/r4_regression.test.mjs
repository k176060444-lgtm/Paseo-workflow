import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {parseAgentOutput,sha256,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../src/policy.mjs';
import {commitWorktree,prepare} from '../src/git.mjs';

function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r4-store-'));
  const store=new Store(path.join(dir,'state')),id='TASKR400';
  const frozen={schema:1,intent:'Synthetic task for security regression tests',
    policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  frozen.digest=sha256(frozen);
  store.init({id,frozen,stage:'BLOCKED',status:'BLOCKED',aRound:10,bRound:9,
    taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,history:[],pendingHuman:'Prior incident'});
  return {dir,store,id,close(){store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function git(dir,...args) {
  return execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
}
function repo() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r4-git-'));
  const dir=path.join(root,'repo');
  fs.mkdirSync(dir);
  git(dir,'init','-q');
  fs.writeFileSync(path.join(dir,'normal.txt'),'synthetic normal data');
  git(dir,'add','.');
  git(dir,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','base');
  return {root,dir,close(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('R4-001 public save refuses round-budget reset with atomic ledger unchanged',()=>{
  const w=fixture();
  try{
    const baseline=w.store.verify(w.id);
    const t=w.store.get(w.id);t.aRound=0;t.bRound=0;
    assert.throws(()=>w.store.save(t,'BUDGET_RESET'),/budget cannot reset/);
    assert.equal(w.store.get(w.id).aRound,10);
    assert.equal(w.store.get(w.id).bRound,9);
    assert.deepEqual(w.store.verify(w.id),baseline);
  }finally{w.close();}
});
test('R4-001 public save refuses budget jumps beyond one or limit',()=>{
  const w=fixture();
  try{
    const t=w.store.get(w.id);t.bRound=11;
    assert.throws(()=>w.store.save(t,'GATE_B_ROUND_START'),/budget cannot reset/);
    assert.equal(w.store.get(w.id).bRound,9);
    t.bRound=10;
    assert.doesNotThrow(()=>w.store.save(t,'GATE_B_ROUND_START'));
    assert.equal(w.store.get(w.id).bRound,10);
    w.store.verify(w.id);
  }finally{w.close();}
});
test('R4-002 frozen snapshot and digest cannot be replaced together',()=>{
  const w=fixture();
  try{
    const old=w.store.get(w.id);
    const t=w.store.get(w.id);
    t.frozen.intent='Forged intent';t.frozen.digest=sha256(Object.fromEntries(Object.entries(t.frozen).filter(([k])=>k!=='digest')));
    assert.throws(()=>w.store.save(t,'FORGED_FREEZE'),/frozen config is immutable/);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    const r=c.authorizeRecovery({id:w.id,actor:'human',
      receipt:'Human explicitly permits recovery of original task basis',
      expectedBasis:old.frozen.digest});
    assert.equal(r.stage,'PLANNER');
    assert.equal(w.store.get(w.id).frozen.digest,old.frozen.digest);
  }finally{w.close();}
});
test('R4-002 requires complete TASK_SPEC pair and forbids any replacement after first candidate',()=>{
  const w=fixture();
  try{
    let t=w.store.get(w.id);
    t.taskSpec='Sufficiently long approved and frozen task specification.';
    assert.throws(()=>w.store.save(t,'TASK_SPEC_CANDIDATE'),/both be present or absent/);
    t.taskSpecSha='f'.repeat(64);
    assert.throws(()=>w.store.save(t,'TASK_SPEC_CANDIDATE'),/TASK_SPEC digest mismatch/);
    t.taskSpecSha=sha256(t.taskSpec);
    assert.throws(()=>w.store.save(t,'UNAUTHORIZED_EDIT'),/Planner candidate/);
    w.store.save(t,'TASK_SPEC_CANDIDATE');
    const frozen=w.store.get(w.id);
    const changed=w.store.get(w.id);
    changed.taskSpec='Altered after approval, no legal permission to do so.';
    changed.taskSpecSha=sha256(changed.taskSpec);
    assert.throws(()=>w.store.save(changed,'TASK_SPEC_CANDIDATE'),/TASK_SPEC is immutable/);
    assert.equal(w.store.get(w.id).taskSpec,frozen.taskSpec);
    w.store.verify(w.id);
  }finally{w.close();}
});
test('R4-001 history is append-only and base/current SHA changes need freezing transitions',()=>{
  const w=fixture();
  try{
    let t=w.store.get(w.id);
    t.history.push({role:'spec_reviewer',verdict:'FAIL'});
    w.store.save(t,'REVIEW_SEAT_RECORDED');
    t=w.store.get(w.id);
    t.history=[];
    assert.throws(()=>w.store.save(t,'HISTORY_WIPE'),/history cannot be truncated/);
    t=w.store.get(w.id);
    t.currentSha='a'.repeat(40);
    assert.throws(()=>w.store.save(t,'FORGED_COMMIT'),/currentSha may only change/);
    w.store.verify(w.id);
  }finally{w.close();}
});
test('R4-003 state modified inside fsync cannot be trusted/reanchored by artifact',()=>{
  const w=fixture();
  const original=fs.writeFileSync;
  try{
    let injected=false;
    fs.writeFileSync=function(target,...rest){
      const result=original.call(fs,target,...rest);
      if(typeof target==='number'&&!injected){
        injected=true;
        const altered=w.store.get(w.id);altered.aRound=0;altered.bRound=0;
        w.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(altered),w.id);
      }
      return result;
    };
    assert.throws(()=>w.store.artifact(w.id,'fsync-race.json',{synthetic:true}),/task state changed during evidence fsync/);
    assert(injected);
    assert.equal(w.store.get(w.id).aRound,10); // transaction rollback
    assert.equal(w.store.get(w.id).bRound,9);
    assert.throws(()=>w.store.verify(w.id),/unregistered evidence/); // orphan fail-closed
    assert(!w.store.db.prepare('SELECT name FROM artifacts WHERE task_id=?').all(w.id).length);
  }finally{fs.writeFileSync=original;w.close();}
});
test('R4-005 a standalone FAIL followed by PASS can NEVER become PASS',()=>{
  const fail={verdict:'FAIL',summary:'Real blocker',findings:['BLOCKER: breaks gate']};
  const pass={verdict:'PASS',summary:'Example verdict',findings:[]};
  assert.throws(()=>parseAgentOutput('## audit\n'+JSON.stringify(fail)+'\n'+JSON.stringify(pass),'spec_reviewer'),/ambiguous or missing/);
  const tick=String.fromCharCode(96).repeat(3);
  assert.throws(()=>parseAgentOutput('Example:\n'+tick+'json\n'+JSON.stringify(pass)+'\n'+tick+'\n'+tick+'json\n'+JSON.stringify(fail)+'\n'+tick,'spec_reviewer'),/ambiguous or missing/);
  assert.equal(parseAgentOutput('## audit\n  '+JSON.stringify(fail),'spec_reviewer').verdict,'FAIL');
  assert.throws(()=>parseAgentOutput('## audit\n'+JSON.stringify(pass)+'\nTrailing instructions','spec_reviewer'),/terminal/);
});
test('R4-006 invisible and deceptive Unicode prefixes cannot be committed',async()=>{
  const w=repo();
  try{
    const prefixes=['\u00ad','\u034f','\u180e','\u3164','\u2800'];
    for(const prefix of prefixes){
      const filename=prefix+'.env',p=path.join(w.dir,filename);
      fs.writeFileSync(p,'TEST DATA, NOT SECRET');
      await assert.rejects(()=>commitWorktree(w.dir,'unicode security'),/control\/format character/);
      fs.rmSync(p);
    }
    assert.equal(git(w.dir,'rev-list','--count','HEAD'),'1');
  }finally{w.close();}
});
test('R4-007 inherited symlink index is rejected even without staged symlink diff',async(t)=>{
  const w=repo();
  try{
    try{fs.symlinkSync('normal.txt',path.join(w.dir,'existing-link'));}
    catch(e){if(e.code==='EPERM'||e.code==='EACCES'){t.skip('Windows symlink permission unavailable');return;}throw e;}
    git(w.dir,'add','existing-link');
    git(w.dir,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','inherit symlink');
    assert.equal(git(w.dir,'status','--porcelain'),'');
    const target=path.join(w.root,'worktree');
    await assert.rejects(()=>prepare(w.dir,'HEAD',target),/symlink in change|symlink\/gitlink in index/);
  }finally{w.close();}
});
