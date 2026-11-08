import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../offline-copy/src/store.mjs';
import {sha256,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../offline-copy/src/policy.mjs';

function frozen(){const f={schema:1,intent:'Synthetic artifact probe',policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};f.digest=sha256(f);return f;}
function setup(){const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-art-'));const root=path.join(tmp,'state');const store=new Store(root),id='TASKR5T';store.init({id,frozen:frozen(),stage:'BLOCKED',status:'BLOCKED',aRound:10,bRound:9,taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,history:[],pendingHuman:'incident',created:'2026-11-08T00:00:00.000Z'});return {tmp,root,store,id,close(){store.close();fs.rmSync(tmp,{recursive:true,force:true});}};}
const results=[];function record(name,result,detail=''){results.push({name,result,detail});console.log(result,name,detail);}

// 1. same-connection tamper during fsync
{
  const w=setup();const original=fs.writeFileSync;
  try{
    let injected=false;
    fs.writeFileSync=function(target,...rest){const r=original.call(fs,target,...rest);if(typeof target==='number'&&!injected){injected=true;const t=w.store.get(w.id);t.aRound=0;t.bRound=0;w.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),w.id);}return r;};
    let threw=false,msg='';
    try{w.store.artifact(w.id,'fsync-race.json',{probe:1});}catch(e){threw=true;msg=e.message;}
    assert(threw);assert.match(msg,/task state changed during evidence fsync/);
    assert.equal(w.store.get(w.id).aRound,10);assert.equal(w.store.get(w.id).bRound,9);
    assert.equal(w.store.db.prepare('SELECT COUNT(*) c FROM artifacts WHERE task_id=?').get(w.id).c,0);
    let verifyFailed=false;try{w.store.verify(w.id);}catch(e){verifyFailed=/unregistered evidence/.test(e.message);}
    assert(verifyFailed);
    record('R4-003 same-connection fsync tamper rejected + DB rollback + orphan fail-closed','CONFIRMED');
  }finally{fs.writeFileSync=original;w.close();}
}

// 2. second SQLite connection competition
{
  const w=setup();const original=fs.writeFileSync;const store2=new Store(w.root);let busy=false;let otherError='';
  try{
    fs.writeFileSync=function(target,...rest){const r=original.call(fs,target,...rest);
      if(typeof target==='number'){try{store2.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(store2.get(w.id)),w.id);}catch(e){if(/locked|busy/i.test(e.message))busy=true;else otherError=e.message;}}
      return r;};
    const out=w.store.artifact(w.id,'second-conn.json',{probe:2});
    assert(out.sha256);assert(busy);assert.equal(otherError,'');
    assert.equal(store2.get(w.id).aRound,10);assert.equal(store2.get(w.id).bRound,9);
    w.store.verify(w.id);record('R4-003 second SQLite writer blocked by BEGIN IMMEDIATE; artifact committed','CONFIRMED');
  }finally{fs.writeFileSync=original;store2.close();w.close();}
}

// 3. registration event failure leaves orphan and rolls back manifest
{
  const w=setup();
  try{
    const originalEvent=w.store.event.bind(w.store);w.store.event=()=>{throw new Error('synthetic registration event failure');};
    let threw=false,msg='';try{w.store.artifact(w.id,'registration-fail.json',{probe:3});}catch(e){threw=true;msg=e.message;}
    assert(threw);assert.match(msg,/synthetic registration event failure/);
    assert.equal(w.store.db.prepare('SELECT COUNT(*) c FROM artifacts WHERE task_id=?').get(w.id).c,0);
    const file=path.join(w.store.dir(w.id),'evidence','registration-fail.json');assert(fs.existsSync(file));
    let verifyFailed=false;try{w.store.verify(w.id);}catch(e){verifyFailed=/unregistered evidence/.test(e.message);}
    assert(verifyFailed);
    record('R4-003 registration failure rolls back DB, leaves orphan, verify fail-closed','CONFIRMED');
  }finally{w.close();}
}

// 4. pre-existing orphan injection blocks artifact before write
{
  const w=setup();
  try{
    const dir=path.join(w.store.dir(w.id),'evidence');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'injected.json'),'orphan');
    let threw=false,msg='';try{w.store.artifact(w.id,'new.json',{probe:4});}catch(e){threw=true;msg=e.message;}
    assert(threw);assert.match(msg,/unregistered evidence/);
    assert(!fs.existsSync(path.join(dir,'new.json')));
    record('R4-003 pre-existing orphan blocks artifact before write','CONFIRMED');
  }finally{w.close();}
}

// 5. duplicate registered filename fails and does not duplicate row
{
  const w=setup();
  try{
    const a=w.store.artifact(w.id,'dup.json',{probe:5});assert(a.sha256);
    let threw=false,msg='';try{w.store.artifact(w.id,'dup.json',{probe:5});}catch(e){threw=true;msg=e.message;}
    assert(threw);assert.match(msg,/EEXIST|file already exists/i);
    assert.equal(w.store.db.prepare('SELECT COUNT(*) c FROM artifacts WHERE task_id=? AND name=?').get(w.id,'dup.json').c,1);
    w.store.verify(w.id);record('R4-003 duplicate artifact filename rejected, single manifest row','CONFIRMED');
  }finally{w.close();}
}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r4/logs/probe-r5-artifact.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length);