import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../offline-copy/src/store.mjs';
import {WorkflowController} from '../offline-copy/src/controller.mjs';
import {ROLE_PERMISSIONS, MAX_A, MAX_B, sha256} from '../offline-copy/src/policy.mjs';
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function baseFrozen(){
  const f={schema:1,intent:'Synthetic audit intent with sufficient length.',intentSha256:sha256('Synthetic audit intent with sufficient length.'),
    roles:{},souls:{},tests:{commands:[['node','--test']]},project:{repo:'C:/nonexistent-repo',baseRef:'HEAD'},
    p0:{},policy:{maxA:MAX_A,maxB:MAX_B,permissions:JSON.parse(JSON.stringify(ROLE_PERMISSIONS))},
    runtime:{paseoUrl:'ws://127.0.0.1:6767/ws'},source:{configFile:'synthetic'}};
  f.digest=sha256(f);return f;
}
function mk(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r2002-'));
  const store=new Store(path.join(dir,'state'));
  const id='TASK9002';
  store.init({id,frozen:baseFrozen(),stage:'BLOCKED',status:'BLOCKED',aRound:3,bRound:2,currentSha:null,taskSpecSha:null,history:[],inflight:null});
  return {dir,store,id,dispose(){try{store.close()}catch{}fs.rmSync(dir,{recursive:true,force:true});}};
}

test('R2-002 injected registration failure leaves an orphan and verify fails closed',()=>{
  const w=mk();
  try{
    const original=w.store.event.bind(w.store);
    w.store.event=(id,type,payload)=>{if(type==='ARTIFACT_REGISTERED')throw new Error('injected event failure');return original(id,type,payload);};
    assert.throws(()=>w.store.artifact(w.id,'orphan.json',{proof:'synthetic'}),/injected event failure/);
    w.store.event=original;
    const ev=path.join(w.store.dir(w.id),'evidence','orphan.json');
    assert(fs.existsSync(ev),'orphan file must remain for manual reconciliation');
    assert.throws(()=>w.store.verify(w.id),/unregistered evidence file requires reconciliation/);
    assert.throws(()=>w.store.artifact(w.id,'orphan.json',{proof:'retry'}),/unregistered evidence file requires reconciliation/);
    // No automatic repair API exists: the only way forward is external reconciliation.
    assert.equal(typeof w.store.repair,'undefined');
    assert.equal(typeof w.store.reconcile,'undefined');
  }finally{w.dispose();}
});

test('R2-002 evidence directory replaced by a regular file fails closed',()=>{
  const w=mk();
  try{
    const evidence=path.join(w.store.dir(w.id),'evidence');
    fs.rmSync(evidence,{recursive:true,force:true});
    fs.writeFileSync(evidence,'not a directory');
    assert.throws(()=>w.store.verify(w.id),/ENOTDIR|not a directory|EISDIR/i);
  }finally{w.dispose();}
});

test('R2-002 non-regular entry inside evidence fails closed',()=>{
  const w=mk();
  try{
    const evidence=path.join(w.store.dir(w.id),'evidence');
    fs.mkdirSync(path.join(evidence,'subdir'),{recursive:true});
    assert.throws(()=>w.store.verify(w.id),/unregistered evidence file requires reconciliation: subdir/);
  }finally{w.dispose();}
});

test('R2-002 missing registered artifact fails closed',()=>{
  const w=mk();
  try{
    const a=w.store.artifact(w.id,'a.json',{x:1});
    fs.rmSync(a.path);
    assert.throws(()=>w.store.verify(w.id),/missing registered evidence artifact/);
  }finally{w.dispose();}
});

test('R2-002 altered registered artifact fails closed',()=>{
  const w=mk();
  try{
    const a=w.store.artifact(w.id,'a.json',{x:1});
    fs.writeFileSync(a.path,'mutated');
    assert.throws(()=>w.store.verify(w.id),/evidence artifact hash mismatch/);
  }finally{w.dispose();}
});

test('R2-002 same-name registered retry is rejected by exclusive create',()=>{
  const w=mk();
  try{
    w.store.artifact(w.id,'a.json',{x:1});
    assert.throws(()=>w.store.artifact(w.id,'a.json',{x:2}),/EEXIST|file already exists/i);
    // The failed retry must not alter the already-registered artifact.
    w.store.verify(w.id);
  }finally{w.dispose();}
});

test('R2-003 readSnapshot keeps one SQLite version across a concurrent writer',()=>{
  const w=mk();
  const other=new Store(path.join(w.dir,'state'));
  try{
    let observed=null,duringVerify=null;
    w.store.readSnapshot(()=>{
      const before=w.store.get(w.id);
      const updated=other.get(w.id);updated.aRound=1;other.save(updated,'CONCURRENT_UPDATE');
      const during=w.store.get(w.id);
      observed={before:before.aRound,during:during.aRound};
      duringVerify=w.store.verify(w.id);
    });
    assert.equal(observed.before,3);
    assert.equal(observed.during,3,'same snapshot must not see the concurrent writer');
    assert(duringVerify.events>0);
    assert.equal(w.store.get(w.id).aRound,1,'new transaction sees the committed writer');
    w.store.verify(w.id);
  }finally{other.close();w.dispose();}
});

test('R2-003 readSnapshot rolls back cleanly when verification fails',()=>{
  const w=mk();
  try{
    const t=w.store.get(w.id);t.aRound=0;
    w.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),w.id);
    assert.throws(()=>w.store.readSnapshot(()=>w.store.verify(w.id)),/state differs/);
    // A subsequent read transaction still works and still detects corruption.
    assert.throws(()=>w.store.readSnapshot(()=>w.store.verify(w.id)),/state differs/);
    assert.equal(w.store.get(w.id).aRound,0);
  }finally{w.dispose();}
});

test('R2-003 inspect returns a self-consistent snapshot object',()=>{
  const w=mk();
  try{
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    const snap=c.inspect(w.id);
    assert.equal(snap.aRound,3);
    assert.equal(snap.bRound,2);
    assert.equal(snap.ledger.events>0,true);
    assert.equal(snap.stage,'BLOCKED');
  }finally{w.dispose();}
});

test('R2-004 read-only verification of an existing WAL database records companion files',()=>{
  const w=mk();
  try{
    w.store.artifact(w.id,'wal-probe.json',{x:1});
    const stateDir=path.join(w.dir,'state');
    w.store.close();
    const main=path.join(stateDir,'workflow.sqlite');
    const beforeFiles=fs.readdirSync(stateDir).sort();
    const beforeHash=fileHash(main);
    const ro=new Store(stateDir,{readOnly:true});
    try{
      const ledger=ro.verify(w.id);
      assert(ledger.events>0);
      const duringFiles=fs.readdirSync(stateDir).sort();
      const afterHash=fileHash(main);
      console.log('R2-004 beforeFiles='+JSON.stringify(beforeFiles));
      console.log('R2-004 duringFiles='+JSON.stringify(duringFiles));
      console.log('R2-004 mainHashUnchanged='+(beforeHash===afterHash));
      console.log('R2-004 walExistsDuring='+fs.existsSync(main+'-wal'));
      console.log('R2-004 shmExistsDuring='+fs.existsSync(main+'-shm'));
    }finally{ro.close();}
    const afterFiles=fs.readdirSync(stateDir).sort();
    console.log('R2-004 afterFiles='+JSON.stringify(afterFiles));
    console.log('R2-004 mainHashAfter='+fileHash(main));
    assert.equal(fileHash(main),beforeHash,'main database bytes must not change');
  }finally{try{w.store.close()}catch{}fs.rmSync(w.dir,{recursive:true,force:true});}
});
