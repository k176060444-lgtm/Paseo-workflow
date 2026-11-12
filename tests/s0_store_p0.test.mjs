import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../src/store.mjs';
import {sha256} from '../src/policy.mjs';
import {seedSyntheticTask,syntheticHumanAuthority,resealSyntheticState} from './fixtures.mjs';
import {mock,adapter} from './s0_p0_fixtures.mjs';

// Exercise production Store checks with ephemeral synthetic keys/SDK only.
// This does not attest to an actual PRE/POST, OS sandbox, provider or live P0.
async function withStore(run){
  const x=mock(),root=fs.mkdtempSync(path.join(os.tmpdir(),'s0-store-p0-'));
  x.nodes[2].eligibility={status:'P0_INELIGIBLE'};
  const authority=syntheticHumanAuthority(root,x.task.id);
  const file=process.env.P1_TRUST_ROOTS_FILE;
  const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  manifest.p0=Object.fromEntries([...x.roots].map(([id,key])=>[id,key.export({format:'pem',type:'spki'})]));
  fs.writeFileSync(file,JSON.stringify(manifest));
  process.env.P1_TRUST_ROOTS_SHA256=sha256(fs.readFileSync(file,'utf8'));
  const store=new Store(path.join(root,'state'));
  const spec='Frozen synthetic scope for the public Store evidence boundary';
  const alignment='Synthetic plain-language alignment for Store transition tests only; no live acceptance claim.';
  const task=seedSyntheticTask(store,{id:x.task.id,frozen:{...x.task.frozen,p0:{transport:'paseo',nodes:x.nodes}},
    stage:'P0_INITIAL',status:'READY',currentSha:'a'.repeat(40),baseSha:'a'.repeat(40),
    aRound:1,bRound:0,taskSpec:spec,taskSpecSha:sha256(spec)});
  Object.assign(task,{userAlignment:alignment,alignmentSha:sha256(alignment),
    alignmentApprovalSha:sha256({alignmentSha:sha256(alignment),taskSpecSha:sha256(spec)})});
  resealSyntheticState(store,task);
  task.status='INFLIGHT';task.inflight={role:'P0',phase:'initial-A1',sha:task.currentSha};
  store.save(task,'P0_STARTED',{cycle:'initial-A1',sha:task.currentSha});
  try{await run({x,store,task,spec});}
  finally{store.close();authority.restore();fs.rmSync(root,{recursive:true,force:true});}
}
async function collect({x,store,task,spec}){
  return adapter(x).review({task,commit:task.currentSha,cycle:'initial-A1',taskSpec:spec,store});
}
function complete({store,task},summary){
  const ev=store.artifact(task.id,'p0-initial-A1-summary.json',summary);
  task.status='READY';task.inflight=null;
  task.history.push({role:'P0',phase:'initial-A1',sha:task.currentSha,evidenceSha256:ev.sha256});
  store.save(task,'P0_COMPLETE',{cycle:'initial-A1',sha:task.currentSha,evidenceSha256:ev.sha256});
}
test('S0 Store: native two-seat result is accepted only with pinned preflight, signed originals and closed dispatches',async()=>{
  await withStore(async context=>{
    const {store,task}=context,summary=await collect(context);complete(context,summary);
    task.p0Initial=summary;task.stage='B_ENTER';
    store.save(task,'P0_INITIAL_COLLECTED',{pass:summary.passed,dispute:summary.dispute});
    assert.equal(store.get(task.id).stage,'B_ENTER');
    assert.equal(store.dispatches(task.id).every(d=>d.state==='TERMINAL'),true);store.verify(task.id);
  });
});
for(const attack of ['invalid-signature','wrong-serverId','wrong-Workspace','wrong-Commit','missing-isolation'])
test('S0 Store: rejected '+attack+' closes paid Agent without forming a quorum',async()=>{
  await withStore(async context=>{
    const {x,store,task}=context;
    const original=x.attestor.attestP0Result;
    // Build a bad, freshly signed report where possible, not just a stale checksum.
    x.attestor.attestP0Result=async args=>{
      const e=await original(args);
      if(args.node.id==='5bao'){
        if(attack==='wrong-serverId')e.report.serverId='wrong';
        if(attack==='wrong-Workspace')e.report.binding.workspaceId='wrong';
        if(attack==='wrong-Commit')e.report.commit='b'.repeat(40);
        if(attack==='missing-isolation')e.report.osReadonlyIsolation=false;
        e.proof=x.signed(args.node,{...e.proof.statement,reportSha256:sha256(e.report)});
        if(attack==='invalid-signature')e.proof.signature=Buffer.alloc(64).toString('base64');
      }
      return e;
    };
    // Adapter must reject the malicious report before it can form a quorum.
    await assert.rejects(()=>collect(context),/physical quorum invalid/);
    assert.equal(store.dispatches(task.id).find(d=>d.agent_id==='srv_5bao:agent-5bao').state,'TERMINAL');
    assert.equal(x.seen.created.length,2);
    assert.equal(x.seen.terminal.length,2);
    assert.equal(x.seen.payloads['p0-initial-A1-incomplete.json'].quorum.established,false);
    assert.equal(store.get(task.id).status,'INFLIGHT');store.verify(task.id);
  });
});
test('S0 Store: public P0_COMPLETE cannot declare CLOSED while an extra dispatch remains outstanding',async()=>{
  await withStore(async context=>{
    const {store,task}=context,summary=await collect(context);
    store.recordIntent(task.id,'P0:initial-A1:rusty','unresolved-original');
    const original=store.get(task.id);
    assert.throws(()=>complete(context,summary),/outstanding dispatches/);
    assert.deepEqual(store.get(task.id),original);store.verify(task.id);
  });
});
test('S0 Store: forged valid-report count cannot replace signed node evidence',async()=>{
  await withStore(async context=>{
    const summary=await collect(context);summary.quorum.validReportCount=3;
    assert.throws(()=>complete(context,summary),/quorum count/);
    assert.equal(context.store.get(context.task.id).status,'INFLIGHT');
  });
});

for(const field of ['serverId','commit','workspace','isolation'])
test('S0 Store: public completion rejects a summary that changes signed '+field,async()=>{
  await withStore(async context=>{
    const summary=await collect(context),r=summary.reports[0];
    if(field==='workspace')r.binding.workspaceId='wrong';
    else if(field==='isolation')r.osReadonlyIsolation=false;
    else r[field]='wrong';
    assert.throws(()=>complete(context,summary),/summary mismatch/);
    assert.equal(context.store.get(context.task.id).status,'INFLIGHT');
    context.store.verify(context.task.id);
  });
});
