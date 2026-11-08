import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../offline-copy/src/store.mjs';
import {WorkflowController} from '../offline-copy/src/controller.mjs';
import {sha256,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../offline-copy/src/policy.mjs';

function makeFrozen(intent='Synthetic trust-root probe'){
  const f={schema:1,intent,project:{repo:'C:/nonexistent',baseRef:'HEAD'},tests:{commands:[]},policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS}};
  f.digest=sha256(f);return f;
}
function setup(overrides={}){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-trust-'));
  const store=new Store(path.join(tmp,'state')),id='TASKR5U';
  const task={id,frozen:makeFrozen(),stage:'BLOCKED',status:'BLOCKED',aRound:0,bRound:0,taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,history:[],pendingHuman:'incident',created:'2026-11-08T00:00:00.000Z',...overrides};
  store.init(task);
  const c=new WorkflowController({store,runtime:null,p0:null});
  return {tmp,store,id,c,close(){store.close();fs.rmSync(tmp,{recursive:true,force:true});}};
}
const results=[];function rec(name,result,detail=''){results.push({name,result,detail});console.log(result,name,detail);}

// 1. init accepts a forged frozen snapshot + recomputed digest as the initial trust root
{
  const forged=makeFrozen('Forged initial intent with no user approval');
  const w=setup({frozen:forged});try{
    w.store.verify(w.id);
    const r=w.c.authorizeRecovery({id:w.id,actor:'fake-human',receipt:'Fake recovery receipt long enough to pass.',expectedBasis:forged.digest});
    assert.equal(r.stage,'PLANNER');
    assert.equal(w.store.get(w.id).frozen.intent,'Forged initial intent with no user approval');
    w.store.verify(w.id);
    rec('R4-002 init() accepts forged frozen snapshot/digest as initial trust root; recovery proceeds','CONFIRMED');
  }finally{w.close();}
}

// 2. init accepts a pre-set TASK_SPEC pair without a Planner event
{
  const spec='A sufficiently long pre-set task specification with no Planner event.';
  const w=setup({taskSpec:spec,taskSpecSha:sha256(spec)});try{
    w.store.verify(w.id);
    const r=w.c.authorizeRecovery({id:w.id,actor:'fake-human',receipt:'Fake recovery receipt long enough to pass.',expectedBasis:sha256(spec)});
    assert.equal(r.stage,'PREPARE');
    w.store.verify(w.id);
    rec('R4-002 init() accepts pre-set TASK_SPEC pair without TASK_SPEC_CANDIDATE; recovery proceeds','CONFIRMED');
  }finally{w.close();}
}

// 3. init accepts an incomplete TASK_SPEC pair (stored invalid, later gate rejects)
{
  const spec='A sufficiently long pre-set task specification without its digest.';
  const w=setup({taskSpec:spec,taskSpecSha:null});try{
    w.store.verify(w.id);
    let threw=false,msg='';try{w.c.assertFrozenIntegrity(w.store.get(w.id));}catch(e){threw=true;msg=e.message;}
    assert(threw);assert.match(msg,/both be present or absent/);
    rec('R4-002 init() stores incomplete TASK_SPEC pair; only later integrity check rejects','CONFIRMED');
  }finally{w.close();}
}

// 4. save can set TASK_SPEC at BLOCKED stage, then recovery accepts it
{
  const w=setup();try{
    const spec='A sufficiently long task specification frozen from BLOCKED state.';
    const t=w.store.get(w.id);t.taskSpec=spec;t.taskSpecSha=sha256(spec);
    w.store.save(t,'TASK_SPEC_CANDIDATE');
    w.store.verify(w.id);
    const r=w.c.authorizeRecovery({id:w.id,actor:'fake-human',receipt:'Fake recovery receipt long enough to pass.',expectedBasis:sha256(spec)});
    assert.equal(r.stage,'PREPARE');
    rec('R4-002 save() can freeze TASK_SPEC at BLOCKED stage; recovery accepts forged basis','CONFIRMED');
  }finally{w.close();}
}

// 5. wrong basis is rejected (positive)
{
  const w=setup();try{
    let threw=false,msg='';try{w.c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit human recovery receipt long enough.',expectedBasis:'f'.repeat(64)});}catch(e){threw=true;msg=e.message;}
    assert(threw);assert.match(msg,/explicit basis|frozen task\/spec digest/);
    rec('R4-002 wrong recovery basis rejected','CONFIRMED');
  }finally{w.close();}
}

// 6. outstanding dispatch blocks recovery (positive)
{
  const w=setup();try{
    w.store.recordIntent(w.id,'A_WORKER','DISPATCH-R5-1');
    let threw=false,msg='';try{w.c.authorizeRecovery({id:w.id,actor:'human',receipt:'Explicit human recovery receipt long enough.',expectedBasis:w.store.get(w.id).frozen.digest});}catch(e){threw=true;msg=e.message;}
    assert(threw);assert.match(msg,/outstanding dispatch/);
    rec('R4-002 outstanding dispatch blocks recovery','CONFIRMED');
  }finally{w.close();}
}

// 7. arbitrary currentSha is accepted as recovery basis without Git verification
{
  const sha='7'.repeat(40);const w=setup({currentSha:sha});try{
    w.store.verify(w.id);
    const r=w.c.authorizeRecovery({id:w.id,actor:'fake-human',receipt:'Fake recovery receipt long enough to pass.',expectedSha:sha});
    assert.equal(r.stage,'PLANNER');
    rec('R4-002 init() arbitrary currentSha accepted as recovery basis with no Git check','CONFIRMED');
  }finally{w.close();}
}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r4/logs/probe-r5-trust.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length);