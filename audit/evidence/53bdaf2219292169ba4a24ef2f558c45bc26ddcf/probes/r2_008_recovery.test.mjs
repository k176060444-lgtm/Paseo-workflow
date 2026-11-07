import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Store} from '../offline-copy/src/store.mjs';
import {WorkflowController} from '../offline-copy/src/controller.mjs';
import {ROLE_PERMISSIONS, MAX_A, MAX_B, sha256} from '../offline-copy/src/policy.mjs';

const REPO=path.resolve('../offline-copy');
const CLI=path.join(REPO,'src','cli.mjs');
function baseFrozen(){
  const f={schema:1,intent:'Synthetic audit intent with sufficient length.',intentSha256:sha256('Synthetic audit intent with sufficient length.'),
    roles:{},souls:{},tests:{commands:[['node','--test']]},project:{repo:'C:/nonexistent-repo',baseRef:'HEAD'},
    p0:{},policy:{maxA:MAX_A,maxB:MAX_B,permissions:JSON.parse(JSON.stringify(ROLE_PERMISSIONS))},
    runtime:{paseoUrl:'ws://127.0.0.1:6767/ws'},source:{configFile:'synthetic'}};
  f.digest=sha256(f);return f;
}
function mk({stage='BLOCKED',status='BLOCKED',currentSha=null,taskSpecSha=null,baseSha=null,aRound=0,bRound=0,dispatch=null}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r2008-'));
  const state=path.join(dir,'state');
  const store=new Store(state);
  const id='TASK9008';
  store.init({id,frozen:baseFrozen(),stage,status,aRound,bRound,baseSha,currentSha,taskSpecSha,
    taskSpec:taskSpecSha?'synthetic task spec':null,history:[],inflight:null});
  if(dispatch){store.recordIntent(id,'P0:synthetic',dispatch);store.recordAck(dispatch,'agent-x');}
  store.close();
  return {dir,state,id,dispose(){
    for(let i=0;i<8;i++){
      try{fs.rmSync(dir,{recursive:true,force:true});return;}
      catch(e){if(i===7)console.log('CLEANUP-WARNING '+e.code+' '+dir);}
    }
  }};
}
function open(state){
  const store=new Store(state);const id='TASK9008';
  const c=new WorkflowController({store,runtime:null,p0:null});
  return {store,c,id,close(){store.close();}};
}
function receipt(dir){
  const p=path.join(dir,'receipt.txt');
  fs.writeFileSync(p,'Explicit synthetic human recovery approval receipt.');
  return p;
}

test('R2-008 pre-spec BLOCKED recovers with frozen config digest as basis',()=>{
  const w=mk({taskSpecSha:null});
  try{
    const {store,c,id,close}=open(w.state);
    const basis=store.get(id).frozen.digest;
    const r=c.authorizeRecovery({id,actor:'human',receipt:'Explicit synthetic human recovery approval receipt.',expectedBasis:basis});
    assert.equal(r.stage,'PLANNER');
    assert.equal(store.verify(id).events>0,true);
    close();
  }finally{w.dispose();}
});

test('R2-008 post-spec pre-worktree BLOCKED recovers to PREPARE with taskSpecSha',()=>{
  const spec='a'.repeat(64);
  const w=mk({taskSpecSha:spec,baseSha:null});
  try{
    const {store,c,id,close}=open(w.state);
    const r=c.authorizeRecovery({id,actor:'human',receipt:'Explicit synthetic human recovery approval receipt.',expectedBasis:spec});
    assert.equal(r.stage,'PREPARE');
    close();
  }finally{w.dispose();}
});

test('R2-008 post-worktree BLOCKED recovers to A_WORKER with taskSpecSha',()=>{
  const spec='a'.repeat(64);
  const w=mk({taskSpecSha:spec,baseSha:'c'.repeat(40)});
  try{
    const {store,c,id,close}=open(w.state);
    const r=c.authorizeRecovery({id,actor:'human',receipt:'Explicit synthetic human recovery approval receipt.',expectedBasis:spec});
    assert.equal(r.stage,'A_WORKER');
    close();
  }finally{w.dispose();}
});

test('R2-008 wrong basis is rejected and state stays BLOCKED',()=>{
  const w=mk({taskSpecSha:null});
  try{
    const {store,c,id,close}=open(w.state);
    assert.throws(()=>c.authorizeRecovery({id,actor:'human',receipt:'Explicit synthetic human recovery approval receipt.',expectedBasis:'0'.repeat(64)}),/basis/);
    assert.equal(store.get(id).stage,'BLOCKED');
    assert.equal(store.get(id).status,'BLOCKED');
    store.verify(id);
    close();
  }finally{w.dispose();}
});

test('R2-008 pre-commit recovery must not invent a Git SHA',()=>{
  const w=mk({taskSpecSha:null});
  try{
    const {store,c,id,close}=open(w.state);
    assert.throws(()=>c.authorizeRecovery({id,actor:'human',receipt:'Explicit synthetic human recovery approval receipt.',expectedSha:'a'.repeat(40),expectedBasis:store.get(id).frozen.digest}),/must not invent/);
    close();
  }finally{w.dispose();}
});

test('R2-008 outstanding dispatch blocks recovery',()=>{
  const w=mk({taskSpecSha:null,dispatch:'d'.repeat(40)});
  try{
    const {store,c,id,close}=open(w.state);
    assert.throws(()=>c.authorizeRecovery({id,actor:'human',receipt:'Explicit synthetic human recovery approval receipt.',expectedBasis:store.get(id).frozen.digest}),/outstanding dispatch/);
    close();
  }finally{w.dispose();}
});

test('R2-008 corrupted ledger blocks recovery',()=>{
  const w=mk({taskSpecSha:null});
  try{
    const store=new Store(w.state);
    const t=store.get(w.id);t.bRound=9;
    store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),w.id);
    store.close();
    const {c,id,close}=open(w.state);
    assert.throws(()=>c.authorizeRecovery({id,actor:'human',receipt:'Explicit synthetic human recovery approval receipt.',expectedBasis:'f'.repeat(64)}),/state differs/);
    close();
  }finally{w.dispose();}
});

test('R2-008 non-BLOCKED task cannot be recovered',()=>{
  const w=mk({stage:'A_WORKER',status:'READY',taskSpecSha:'a'.repeat(64),baseSha:'c'.repeat(40)});
  try{
    const {store,c,id,close}=open(w.state);
    assert.throws(()=>c.authorizeRecovery({id,actor:'human',receipt:'Explicit synthetic human recovery approval receipt.',expectedBasis:'a'.repeat(64)}),/definitely blocked/);
    close();
  }finally{w.dispose();}
});

test('R2-008 CLI recover --basis succeeds for a pre-commit BLOCKED task',()=>{
  const w=mk({taskSpecSha:null});
  try{
    const store=new Store(w.state);const basis=store.get(w.id).frozen.digest;store.close();
    const r=spawnSync(process.execPath,[CLI,'recover','--id',w.id,'--state',w.state,'--actor','human','--receipt',receipt(w.dir),'--basis',basis],{cwd:REPO,encoding:'utf8'});
    assert.equal(r.status,0,`stdout=${r.stdout}\nstderr=${r.stderr}`);
    const out=JSON.parse(r.stdout);
    assert.equal(out.stage,'PLANNER');
  }finally{w.dispose();}
});

test('R2-008 CLI recover without sha or basis fails closed',()=>{
  const w=mk({taskSpecSha:null});
  try{
    const r=spawnSync(process.execPath,[CLI,'recover','--id',w.id,'--state',w.state,'--actor','human','--receipt',receipt(w.dir)],{cwd:REPO,encoding:'utf8'});
    assert.notEqual(r.status,0);
    assert(/P1 BLOCKED/.test(r.stderr));
  }finally{w.dispose();}
});

test('R2-008 CLI recover with wrong basis fails closed',()=>{
  const w=mk({taskSpecSha:null});
  try{
    const r=spawnSync(process.execPath,[CLI,'recover','--id',w.id,'--state',w.state,'--actor','human','--receipt',receipt(w.dir),'--basis','0'.repeat(64)],{cwd:REPO,encoding:'utf8'});
    assert.notEqual(r.status,0);
    assert(/basis/.test(r.stderr));
  }finally{w.dispose();}
});
