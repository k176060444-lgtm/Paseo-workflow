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
    const incompleteDigest=store.evidenceDigest(task.id,'p0-initial-A1-incomplete.json');
    const incomplete=JSON.parse(store.readEvidenceByDigest(task.id,incompleteDigest).content);
    assert.equal(incomplete.quorum.established,false);
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

test('S0-R2 F9: stale lock allows only fail-closed quarantine, not redispatch',async()=>{
  await withStore(async({store,task})=>{
    const lock=path.join(store.dir(task.id),'controller.lock');
    const prior=JSON.stringify({pid:2147483647,created:new Date(Date.now()-120000).toISOString()});
    fs.writeFileSync(lock,prior,{mode:0o600});
    const result=store.quarantineCrashedTask(task.id,{
      actor:'local operator',receipt:'Independent crash incident registration receipt'
    });
    assert.equal(result.status,'NEEDS_RECONCILIATION');
    assert.equal(result.allowedToRedispatch,false);
    assert.equal(fs.existsSync(lock),false);
    assert.equal(fs.readFileSync(result.lockArchived,'utf8'),prior);
    const saved=store.get(task.id);
    assert.equal(saved.blockedStage,'P0_INITIAL');
    assert.equal(saved.inflight,null);
    assert.equal(store.verify(task.id).events>0,true);
    assert.equal(store.dispatches(task.id).length,0);
    const incidentEvidence=store.readEvidenceByDigest(task.id,result.evidenceSha256);
    assert.match(incidentEvidence.content,/OUTCOME_UNKNOWN/);
  });
});
test('S0-R2 F9: live lock owner cannot be declared stale',async()=>{
  await withStore(async({store,task})=>{
    const lock=path.join(store.dir(task.id),'controller.lock');
    fs.writeFileSync(lock,JSON.stringify({
      pid:process.pid,created:new Date(Date.now()-120000).toISOString()
    }),{mode:0o600});
    assert.throws(()=>store.quarantineCrashedTask(task.id,{
      actor:'local operator',receipt:'Deliberate negative test of active-owner handling'
    }),/current process/);
    assert.equal(store.get(task.id).status,'INFLIGHT');
    assert(fs.existsSync(lock));
    store.verify(task.id);
  });
});

test('S0-R2: independently signed cancellation without P0 quorum is recoverable evidence',async()=>{
  await withStore(async context=>{
    const {x,store,task}=context;
    const original=x.attestor.attestP0Result;
    x.attestor.attestP0Result=async args=>{
      const e=await original(args);
      if(args.node.id==='5bao')e.report.binding.intentSha256='0'.repeat(64);
      return e;
    };
    await assert.rejects(()=>collect(context),/physical quorum invalid/);
    assert.equal(store.dispatches(task.id).every(d=>d.state==='TERMINAL'),true);
    assert.doesNotThrow(()=>store.assertRecoverableDispatches(task.id),
      'signed cancellation must be recognized without inventing a P0 report');
  });
});
