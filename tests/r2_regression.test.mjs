import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {parseAgentOutput} from '../src/policy.mjs';
import {commitWorktree,porcelainPaths} from '../src/git.mjs';

function sandbox(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r2-'));
  const store=new Store(path.join(dir,'state'));
  const id='TASK7777';
  store.init({id,stage:'BLOCKED',status:'BLOCKED',frozen:{digest:'f'.repeat(64)},
    aRound:0,bRound:9,currentSha:null,taskSpecSha:null,history:[],inflight:null});
  return {dir,store,id,dispose(){store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function git(dir,...args){return execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function repo(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-git-r2-'));
  git(dir,'init','-q');
  fs.writeFileSync(path.join(dir,'ordinary.txt'),'baseline');
  git(dir,'add','.');
  git(dir,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','baseline');
  return {dir,dispose(){fs.rmSync(dir,{recursive:true,force:true});}};
}
test('R2-001 tampered budget never re-anchored by run or recovery', async()=>{
  const w=sandbox();
  try {
    const t=w.store.get(w.id);t.bRound=0;
    w.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),w.id);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    await assert.rejects(()=>c.run(w.id),/state differs/);
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit audited recovery approval.',expectedBasis:'f'.repeat(64)}),/state differs/);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    assert.equal(w.store.get(w.id).bRound,0); // still corrupt, NOT trusted
  } finally {w.dispose();}
});
test('R2-002 orphan artifacts fail verification instead of silently accepting',()=>{
  const w=sandbox();
  try {
    const original=w.store.event.bind(w.store);
    w.store.event=(id,type,payload)=>{if(type==='ARTIFACT_REGISTERED')throw Error('injected event failure');return original(id,type,payload);};
    assert.throws(()=>w.store.artifact(w.id,'orphan.json',{proof:'demo'}),/injected/);
    w.store.event=original;
    assert.throws(()=>w.store.verify(w.id),/unregistered evidence/);
    assert.throws(()=>w.store.artifact(w.id,'orphan.json',{proof:'retry'}),/unregistered evidence/);
  }finally{w.dispose();}
});
test('R2-003 readSnapshot uses one SQLite version despite concurrent writer',()=>{
  const w=sandbox();
  const other=new Store(path.join(w.dir,'state'));
  try{
    w.store.readSnapshot(()=>{
      const before=w.store.get(w.id);
      const updated=other.get(w.id);updated.aRound=1;other.save(updated,'UPDATE');
      assert.equal(w.store.get(w.id).aRound,before.aRound);
      w.store.verify(w.id);
    });
    assert.equal(w.store.get(w.id).aRound,1);
    w.store.verify(w.id);
  }finally{other.close();w.dispose();}
});
test('R2-006 final Markdown plus bare/fenced JSON and alias',()=>{
  const raw='## Reviewer report\nEvidence checked\n'+JSON.stringify({verdict:'APPROVE',summary:'ok',findings:[]});
  assert.equal(parseAgentOutput(raw,'quality_reviewer').verdict,'PASS');
  const fence=String.fromCharCode(96).repeat(3);
  const fenced='## findings\n'+fence+'json\n'+JSON.stringify({verdict:'REQUEST_CHANGES',summary:'fail',findings:['BLOCKER: bug']})+'\n'+fence;
  assert.equal(parseAgentOutput(fenced,'spec_reviewer').verdict,'FAIL');
  assert.throws(()=>parseAgentOutput('## report without final envelope','spec_reviewer'),/final JSON/);
});
test('R2-008 early blocked task recovers only on matching frozen basis',()=>{
  const w=sandbox();
  try{
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    assert.throws(()=>c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit local approval to recover.',expectedBasis:'0'.repeat(64)}),/basis/);
    const r=c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit local approval to recover.',expectedBasis:'f'.repeat(64)});
    assert.equal(r.stage,'PLANNER');
    assert.equal(w.store.get(w.id).bRound,9);
    w.store.verify(w.id);
  }finally{w.dispose();}
});
test('R2-009 raw porcelain preserves leading status space and rename original',()=>{
  assert.deepEqual(porcelainPaths(' M .env\0'),['.env']);
  assert.deepEqual(porcelainPaths('R  .env.production\0ordinary.txt\0'),['.env.production','ordinary.txt']);
  assert.throws(()=>porcelainPaths('R  new.txt\0'),/missing rename/);
});
test('R2-009 tracked .env edit cannot be committed',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,'.env'),'synthetic-only');
    git(r.dir,'add','.env');
    git(r.dir,'-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','synthetic env baseline');
    fs.writeFileSync(path.join(r.dir,'.env'),'synthetic-updated');
    await assert.rejects(()=>commitWorktree(r.dir,'attack'),/sensitive-looking/);
  }finally{r.dispose();}
});
test('R2-009 staged rename to .env.production cannot be committed',async()=>{
  const r=repo();
  try{
    git(r.dir,'mv','ordinary.txt','.env.production');
    await assert.rejects(()=>commitWorktree(r.dir,'attack'),/sensitive-looking/);
  }finally{r.dispose();}
});
test('R2-010 successful reviewer report survives peer failure',async()=>{
  const w=sandbox();
  try{
    const c=new WorkflowController({store:w.store,runtime:{execute:async ({role})=>{
      if(role==='quality_reviewer')throw Error('simulated provider loss');
      return {role,agentId:'spec-agent-id',verdict:'PASS',findings:[],summary:'Verified simulation'};
    }},p0:null,gitOps:{assertUnchanged:async()=>{}}});
    const t=w.store.get(w.id);t.stage='A_REVIEW';t.status='READY';t.worktree=w.dir;
    w.store.save(t,'READY_FOR_REVIEW');
    await assert.rejects(()=>c.invokePair(t,'A1-review','a'.repeat(40)),/reconcile/);
    const after=w.store.get(w.id);
    assert.equal(after.status,'NEEDS_RECONCILIATION');
    assert.equal(after.history.filter(h=>h.role==='spec_reviewer').length,1);
    const items=w.store.db.prepare('SELECT name FROM artifacts WHERE task_id=?').all(w.id);
    assert(items.some(x=>x.name.includes('spec_reviewer')));
    w.store.verify(w.id);
  }finally{w.dispose();}
});
