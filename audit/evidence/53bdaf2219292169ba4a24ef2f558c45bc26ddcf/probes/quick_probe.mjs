import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../offline-copy/src/store.mjs';
import {WorkflowController} from '../offline-copy/src/controller.mjs';
import {porcelainPaths, commitWorktree} from '../offline-copy/src/git.mjs';
import {execFileSync} from 'node:child_process';

function mk(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-quick-'));
  const store=new Store(path.join(dir,'state'));
  const id='TASK9000';
  store.init({id,stage:'BLOCKED',status:'BLOCKED',frozen:{digest:'f'.repeat(64),policy:{maxA:10,maxB:10,permissions:{}}},aRound:10,bRound:9,currentSha:null,taskSpecSha:null,history:[],inflight:null});
  return {dir,store,id};
}
function tamper(store,id,fn){
  const t=store.get(id);fn(t);
  store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),id);
}

// 1) store.event after tamper
{
  const w=mk();
  tamper(w.store,w.id,t=>{t.aRound=0;t.bRound=0;});
  let rejected=false;
  try{w.store.verify(w.id);}catch(e){rejected=true;console.log('T1 verify after tamper REJECTED:',e.message);}
  try{
    w.store.event(w.id,'P0_OPTIONAL_NOT_DISPATCHED',{cycle:'x',nodeId:'y'});
    console.log('T1 store.event ACCEPTED (re-anchor possible)');
  }catch(e){console.log('T1 store.event REJECTED:',e.message);}
  try{w.store.verify(w.id);console.log('T1 verify after event ACCEPTED -> RE-ANCHORED');}catch(e){console.log('T1 verify after event STILL REJECTED:',e.message);}
  console.log('T1 state now aRound=',w.store.get(w.id).aRound,'bRound=',w.store.get(w.id).bRound);
  w.store.close();fs.rmSync(w.dir,{recursive:true,force:true});
}

// 2) leading-space sensitive path
{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-space-'));
  const g=(...a)=>execFileSync('git',['-C',dir,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  g('init','-q');
  fs.writeFileSync(path.join(dir,'ordinary.txt'),'baseline');
  g('add','.');g('-c','user.name=T','-c','user.email=t@l','commit','-qm','baseline');
  fs.writeFileSync(path.join(dir,' .env'),'SYNTHETIC_SECRET_VALUE');
  const raw=execFileSync('git',['-C',dir,'status','--porcelain','-z','--untracked-files=all'],{encoding:'buffer'}).toString('utf8');
  console.log('T2 raw status JSON=',JSON.stringify(raw));
  console.log('T2 porcelainPaths=',JSON.stringify(porcelainPaths(raw)));
  try{const sha=await commitWorktree(dir,'space-test');console.log('T2 commitWorktree ACCEPTED sha=',sha);}
  catch(e){console.log('T2 commitWorktree REJECTED:',e.message);}
  try{console.log('T2 committed files=',g('show','--name-only','--pretty=format:','HEAD'));}catch(e){console.log('T2 show failed',e.message);}
  fs.rmSync(dir,{recursive:true,force:true});
}
