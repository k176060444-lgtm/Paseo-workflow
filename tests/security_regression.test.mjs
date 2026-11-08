import {seedSyntheticTask,resealSyntheticState,syntheticHumanAuthority} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {parseAgentOutput,hasBlockingFinding} from '../src/policy.mjs';
import {PaseoAgentRuntime} from '../src/agents.mjs';
import {childEnv} from '../src/git.mjs';

function work(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-regression-'));
  const authority=syntheticHumanAuthority(dir,'TASK1234');
  const store=new Store(dir);
  seedSyntheticTask(store,{id:'TASK1234',stage:'A_REVIEW',status:'READY',frozen:{digest:'x'.repeat(64)},
    history:[],worktree:'/synthetic',currentSha:'a'.repeat(40)});
  return {dir,store,attest:authority.attest,close(){store.close();authority.restore();fs.rmSync(dir,{recursive:true,force:true});}};}

test('F1: legacy verdict normalization and PASS with BLOCKER finding fail closed',()=>{
  assert.equal(parseAgentOutput(JSON.stringify({verdict:'APPROVE',summary:'ok',findings:[]}), 'quality_reviewer').verdict,'PASS');
  assert.equal(parseAgentOutput(JSON.stringify({verdict:'REQUEST_CHANGES',summary:'defect',findings:['BLOCKER: bug']}),'spec_reviewer').verdict,'FAIL');
  assert.throws(()=>parseAgentOutput(JSON.stringify({verdict:'PASS',summary:'wrong',findings:['BLOCKER: exploit']}),'spec_reviewer'),/inconsistent PASS|contradictory PASS/);
  assert(hasBlockingFinding(['[HIGH]: Important issue']));
});

test('F1: synthetic alternative runtime cannot pass a review pair with BLOCKER finding', async()=>{
  const w=work();try{
    let n=0;
    const runtime={execute:async x=>{
      const role=x.role,phase=x.phase,agentId=`a${++n}`,dispatchId=`signed-review-${n}`;
      x.store.recordIntent('TASK1234',phase,dispatchId);
      x.store.recordAck(dispatchId,agentId);
      x.store.recordTerminal(dispatchId);
      const bare={role,phase,agentId,dispatchId,verdict:'PASS',
        findings:role==='spec_reviewer'?['BLOCKER: escape path']:[],
        summary:'signed synthetic reviewer with blocking issue',taskSpec:null};
      return {...bare,attestation:w.attest(role,phase,'a'.repeat(40),agentId,dispatchId,bare)};
    }};
    const gitOps={assertUnchanged:async()=>{}};
    const c=new WorkflowController({store:w.store,runtime,gitOps,p0:null});
    const t=w.store.get('TASK1234');t.worktree='/synthetic';
    const r=await c.invokePair(t,'A1-review','a'.repeat(40));
    assert.equal(r.pass,false);
    assert.equal(r.findings.length,1);
  }finally{w.close();}
});

test('F7: ledger detects an altered dispatch row and evidence file',()=>{
  const w=work();try{
    w.store.recordIntent('TASK1234','PLANNER','dispatch-one');
    w.store.recordAck('dispatch-one','agent-1');
    w.store.recordTerminal('dispatch-one');
    const f=w.store.artifact('TASK1234','report.json',{result:'PASS'});
    w.store.verify('TASK1234');
    fs.writeFileSync(f.path,'mutated');
    assert.throws(()=>w.store.verify('TASK1234'),/artifact hash mismatch/);
    fs.writeFileSync(f.path,'{"result":"PASS"}');
    w.store.db.prepare('UPDATE dispatches SET agent_id=? WHERE id=?').run('impostor','dispatch-one');
    assert.throws(()=>w.store.verify('TASK1234'),/dispatch ledger mismatch/);
  }finally{w.close();}
});

test('F7: dispatch intent and ledger event write together (rollback on duplicate)',()=>{
  const w=work();try{
    w.store.recordIntent('TASK1234','P0','dup-id');
    assert.throws(()=>w.store.recordIntent('TASK1234','P0','dup-id'));
    assert.equal(w.store.dispatches('TASK1234').length,1);
    w.store.verify('TASK1234');
  }finally{w.close();}
});

test('F10: read-only store refuses to create missing state directory or database',()=>{
  const root=path.join(os.tmpdir(),`p1-nonexistent-${process.pid}-${Date.now()}`);
  assert(!fs.existsSync(root));
  assert.throws(()=>new Store(root,{readOnly:true}),/database not found/);
  assert(!fs.existsSync(root));
});

test('F4: exact SDK waitForFinish API receives numeric timeout',async()=>{
  const w=work();try{
    let timeout;
    const runtime=new PaseoAgentRuntime('ws://localhost/ws');
    runtime.client={agents:{create:async()=>({id:'agent-id',waitForFinish:async arg=>{
      timeout=arg;return{status:'idle',lastMessage:JSON.stringify({verdict:'PASS',summary:'ok',findings:[],taskSpec:'Workable plan with tests'})};
    }})}};
    const task={id:'TASK1234',frozen:{roles:{planner:{model:'codex/approved',harness:'codex'}},souls:{planner:{text:'This is a frozen test Soul',sha256:'a'.repeat(64)}}}};
    await runtime.execute({task,role:'planner',phase:'planner',cwd:w.dir,prompt:'plan',store:w.store});
    assert.equal(timeout,3600000);
    w.store.verify('TASK1234');
  }finally{w.close();}
});

test('F9: Git/test child process env omits arbitrary gateway secrets',()=>{
  process.env.P1_TEST_FAKE_API_KEY='unrelated-secret';
  try{const env=childEnv();assert(!('P1_TEST_FAKE_API_KEY' in env));}
  finally{delete process.env.P1_TEST_FAKE_API_KEY;}
});
