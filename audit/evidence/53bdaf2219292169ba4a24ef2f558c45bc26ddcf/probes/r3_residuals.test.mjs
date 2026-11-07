import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../offline-copy/src/store.mjs';
import {WorkflowController} from '../offline-copy/src/controller.mjs';
import {ROLE_PERMISSIONS, MAX_A, MAX_B, sha256} from '../offline-copy/src/policy.mjs';

const REPO=path.resolve('../offline-copy');
function baseFrozen(){
  const f={schema:1,intent:'Synthetic audit intent with sufficient length.',intentSha256:sha256('Synthetic audit intent with sufficient length.'),
    roles:{},souls:{},tests:{commands:[['node','--test']]},project:{repo:'C:/nonexistent-repo',baseRef:'HEAD'},
    p0:{},policy:{maxA:MAX_A,maxB:MAX_B,permissions:JSON.parse(JSON.stringify(ROLE_PERMISSIONS))},
    runtime:{paseoUrl:'ws://127.0.0.1:6767/ws'},source:{configFile:'synthetic'}};
  f.digest=sha256(f);return f;
}
function mk(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r3res-'));
  const store=new Store(path.join(dir,'state'));
  const id='TASK9301';
  store.init({id,frozen:baseFrozen(),stage:'BLOCKED',status:'BLOCKED',aRound:10,bRound:9,currentSha:null,taskSpecSha:null,history:[],inflight:null});
  return {dir,store,id,dispose(){try{store.close()}catch{}for(let i=0;i<8;i++){try{fs.rmSync(dir,{recursive:true,force:true});return;}catch{}}}};
}

test('R3-001 residual: authorizeRecovery accepts a forged frozen digest after event() re-anchors',async()=>{
  const w=mk();
  try{
    const t=w.store.get(w.id);
    t.frozen.intent='FORGED INTENT THAT DOES NOT MATCH THE DIGEST';
    w.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),w.id);
    assert.throws(()=>w.store.verify(w.id),/state differs/);
    // p0.mjs uses this exact call in its legal probe-skip path.
    w.store.event(w.id,'P0_OPTIONAL_NOT_DISPATCHED',{cycle:'initial',nodeId:'5bao'});
    w.store.verify(w.id);
    const c=new WorkflowController({store:w.store,runtime:null,p0:null});
    const forged=w.store.get(w.id).frozen.digest;
    const r=c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit synthetic recovery approval receipt.',expectedBasis:forged});
    assert.equal(r.stage,'PLANNER');
    console.log('R3-001 CONFIRMED: recovery accepted the forged frozen digest as its basis');
    // The later live preflight still rejects the forged config, so this is not a
    // direct execution bypass, but it is a trusted-recovery evidence defect.
    process.env.P1_LIVE_ALLOWED='YES';process.env.P1_HOST_ISOLATION_ATTESTED='YES';
    let err=null;
    try{await c.run(w.id);}catch(e){err=e;}
    delete process.env.P1_LIVE_ALLOWED;delete process.env.P1_HOST_ISOLATION_ATTESTED;
    assert(err);
    assert.match(err.message,/frozen config digest mismatch/);
    console.log('R3-001 LATER-PREFLIGHT='+err.message);
  }finally{w.dispose();}
});

test('R3-002 static: p0.mjs calls store.event() directly with no verify/transaction wrapper',()=>{
  const src=fs.readFileSync(path.join(REPO,'src/p0.mjs'),'utf8');
  const lines=src.split('\n');
  const hits=lines.map((l,i)=>[i+1,l]).filter(([,l])=>/\bstore\.event\s*\(/.test(l));
  assert(hits.length>0,'expected a direct store.event call in p0.mjs');
  for(const [n,l] of hits){
    const window=lines.slice(Math.max(0,n-4),Math.min(lines.length,n+1)).join('\n');
    assert(!/store\.verify\s*\(/.test(window),`store.event at p0.mjs:${n} must not be preceded by verify`);
    assert(!/transaction\s*\(/.test(window),`store.event at p0.mjs:${n} must not be inside a transaction`);
    console.log(`R3-002 p0.mjs:${n} direct store.event: ${l.trim()}`);
  }
});

test('R3-003 static: taskkill spawn in git.mjs does not use childEnv',()=>{
  const src=fs.readFileSync(path.join(REPO,'src/git.mjs'),'utf8');
  const m=/spawn\('taskkill',\[[^\]]*\],\{([^}]*)\}/.exec(src);
  assert(m,'expected taskkill spawn');
  assert(!/env\s*:/.test(m[1]),'taskkill spawn currently inherits the full parent environment');
  console.log('R3-003 taskkill options: '+m[1].trim());
});

test('R3-004 static: p0_runner Popen for execute does not pass env',()=>{
  const src=fs.readFileSync(path.join(REPO,'remote/p0_runner.py'),'utf8');
  const idx=src.indexOf('subprocess.Popen(');
  assert(idx>=0);
  const block=src.slice(idx,idx+600);
  assert(!/env\s*=/.test(block),'Popen execute currently inherits the full runner environment');
  console.log('R3-004 Popen block head: '+block.split('\n').slice(0,3).join(' | '));
});

test('R3-005 static: CLI usage contains a literal backslash-n instead of a newline',()=>{
  const src=fs.readFileSync(path.join(REPO,'src/cli.mjs'),'utf8');
  const line=src.split(String.fromCharCode(10)).find(l=>l.includes('EXACT_COMMIT')&&l.includes('recover'));
  assert(line,'expected the recover usage line');
  assert(line.includes(String.fromCharCode(92)+'n'),'expected a literal backslash-n in the usage line');
  console.log('R3-005 CONFIRMED: '+line.trim().slice(0,140));
});
