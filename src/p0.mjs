import fs from 'node:fs';
import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {execArgv} from './git.mjs';
import {assert,canonical,sha256,hasBlockingFinding} from './policy.mjs';

function shellToken(s) {
  assert(typeof s==='string'&&!s.includes('\0'),'invalid SSH token');
  return `'${s.replaceAll("'", "'\\''")}'`;
}
export class SshP0Adapter {
  constructor(nodes,{pollMs=60000,extraThirdMs=600000,deadlineMs=7200000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>Date.now()}={}){
    this.nodes=nodes.filter(n=>n.enabled===true);
    this.pollMs=pollMs;this.extraThirdMs=extraThirdMs;this.deadlineMs=deadlineMs;
    this.sleep=sleep;this.clock=clock;
    assert(this.nodes.length<=3,'P0 accepts at most three distinct physical seats');
  }
  async ssh(node,action,spec) {
    assert(node.sshAlias&&node.runner&&node.config,'P0 node missing SSH alias/runner/config');
    assert(/^[A-Za-z0-9_.@-]+$/.test(node.sshAlias),'invalid SSH alias');
    const command=['python3',node.runner,action,'--config',node.config].map(shellToken).join(' ');
    const args=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',node.sshAlias,command];
    const r=await execArgv('ssh',args,{timeoutMs:60000,stdin:spec===undefined?undefined:canonical(spec)});
    assert(r.code===0&&!r.timedOut&&!r.truncated,`SSH ${node.id} ${action} failed or uncertain: ${r.stderr.slice(0,250)}`);
    try{return JSON.parse(r.stdout.trim());}catch{throw new Error(`P0 ${node.id}: invalid remote JSON; reconcile manually`);}
  }
  // Keys are compared by content, not path. Hashes are never persisted or logged.
  validateInventory() {
    assert(this.nodes.length>=2,'at least two configured P0 physical nodes required');
    assert(new Set(this.nodes.map(n=>n.physicalId)).size===this.nodes.length,'P0 nodes have duplicate physical IDs');
    assert(new Set(this.nodes.map(n=>n.sshAlias)).size===this.nodes.length,'P0 nodes share an SSH target');
    const digests=new Set();
    for(const n of this.nodes){
      assert(n.id&&n.physicalId&&n.harness&&n.model&&n.hmacKeyPath,'incomplete P0 inventory');
      const key=fs.readFileSync(n.hmacKeyPath);
      assert(key.length>=32,'P0 authentication key too short');
      const fingerprint=createHash('sha256').update(key).digest('hex');
      assert(!digests.has(fingerprint),'duplicate P0 attestation key content');
      digests.add(fingerprint);
    }
  }
  verify(node,envelope,jobId,commit) {
    assert(envelope?.body&&typeof envelope.mac==='string','unsigned P0 report');
    const key=fs.readFileSync(node.hmacKeyPath);
    assert(key.length>=32,'node attestation key too short');
    const expected=createHmac('sha256',key).update(canonical(envelope.body)).digest('hex');
    assert(/^[a-f0-9]{64}$/.test(envelope.mac),'invalid MAC');
    assert(timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(envelope.mac,'hex')),'invalid node attestation MAC');
    const b=envelope.body;
    assert(b.jobId===jobId&&b.nodeId===node.id&&b.commit===commit,'P0 job/node/commit mismatch');
    assert(b.physicalId===node.physicalId,'P0 signed physical inventory mismatch');
    assert(b.harness===node.harness&&b.model===node.model,'P0 provider/model mismatch');
    assert(['PASS','FAIL','QUESTION','NEEDS_SPECIALIST'].includes(b.verdict),'P0 invalid verdict');
    assert(b.exitCode===0&&b.clean===true,'remote harness failed or changed read-only worktree');
    assert(typeof b.stdoutSha256==='string'&&/^[a-f0-9]{64}$/.test(b.stdoutSha256),'missing remote original log hash');
    assert(Array.isArray(b.findings)&&b.findings.every(x=>typeof x==='string'),'invalid P0 findings');
    assert(!(b.verdict==='PASS'&&hasBlockingFinding(b.findings)),'P0 contradictory PASS/blocking findings');
    // physicalId is only an identity claim bound to an authenticated key, not hardware attestation.
    return {...b,physicalId:node.physicalId};
  }
  async review({task,commit,taskSpec,store,cycle}) {
    this.validateInventory();
    const active=[];const skipped=[];
    // Probe before any paid dispatch. An optional node unavailable at this point
    // can be excluded without a lost-ACK risk. After submit, uncertainty blocks.
    for(let i=0;i<this.nodes.length;i++){
      const node=this.nodes[i], optional=i>=2;
      let probe;
      try { probe=await this.ssh(node,'probe'); }
      catch(e) {
        if(!optional) throw new Error(`mandatory P0 ${node.id} unavailable before dispatch: ${e.message}`);
        skipped.push({nodeId:node.id,reason:'optional preflight unavailable; no dispatch attempted'});
        store.event(task.id,'P0_OPTIONAL_NOT_DISPATCHED',{cycle,nodeId:node.id});
        continue;
      }
      assert(probe.status==='READY'&&probe.nodeId===node.id&&probe.physicalId===node.physicalId,
        `P0 ${node.id} preflight inventory mismatch`);
      active.push(node);
    }
    assert(active.length>=2,'P0 preflight did not retain two mandatory nodes');
    const jobs=[];
    for(const node of active){
      const role=node.role??'blind_a';
      assert(task.frozen.souls[role],'missing blind review soul');
      const jobId=sha256(`${task.id}:${cycle}:${commit}:${node.id}`).slice(0,40);
      const spec={jobId,taskId:task.id,nodeId:node.id,commit,role,model:node.model,harness:node.harness,
        soul:task.frozen.souls[role].text,taskSpec,
        instructions:'Independent read-only blind review. Inspect exact commit; do not share findings. Return JSON verdict/summary/findings. Any issue requiring correction is FAIL.'};
      const submission=store.artifact(task.id,`p0-${cycle}-${node.id}-request.json`,spec);
      store.recordIntent(task.id,`P0:${cycle}:${node.id}`,jobId);
      // Failure here is ALWAYS uncertain, including for an optional node.
      const ack=await this.ssh(node,'submit',spec);
      assert(ack.jobId===jobId&&['ACCEPTED','EXISTS'].includes(ack.status),'P0 uncertain submit acknowledgement');
      store.recordAck(jobId,`${node.id}:${jobId}`);
      jobs.push({node,jobId,request:submission});
    }
    const start=this.clock(),reports=new Map();let quorumAt=null;
    while(true){
      for(const job of jobs){
        if(reports.has(job.node.id))continue;
        const status=await this.ssh(job.node,'status',{jobId:job.jobId});
        assert(status.jobId===job.jobId,'P0 status ID mismatch');
        if(status.status==='FINISHED'){
          const b=this.verify(job.node,status.result,job.jobId,commit);
          const evidence=store.artifact(task.id,`p0-${cycle}-${job.node.id}-result.json`,status.result);
          reports.set(job.node.id,{...b,evidence});
          store.recordTerminal(job.jobId);
        }else if(status.status==='FAILED'||status.status==='UNKNOWN'||status.status==='CANCEL_REQUESTED'){
          throw new Error(`P0 remote ${job.node.id} ${status.status}; reconcile job before continuing`);
        }else assert(['RUNNING','QUEUED'].includes(status.status),'P0 unknown status');
      }
      const distinct=new Set([...reports.values()].map(x=>x.physicalId));
      if(distinct.size>=2&&quorumAt===null)quorumAt=this.clock();
      if(quorumAt!==null&&(reports.size===jobs.length||this.clock()-quorumAt>=this.extraThirdMs))break;
      assert(this.clock()-start<this.deadlineMs,'P0 collection deadline; reconcile accepted jobs');
      await this.sleep(this.pollMs);
    }
    const cancelled=[];
    for(const job of jobs.filter(j=>!reports.has(j.node.id))){
      // Cancel leftover optional execution. An ambiguous cancellation blocks Gate.
      const ack=await this.ssh(job.node,'cancel',{jobId:job.jobId});
      assert(ack.jobId===job.jobId,'P0 cancellation ACK mismatch');
      if(ack.status==='FINISHED'){
        const b=this.verify(job.node,ack.result,job.jobId,commit);
        const evidence=store.artifact(task.id,`p0-${cycle}-${job.node.id}-result.json`,ack.result);
        reports.set(job.node.id,{...b,evidence});store.recordTerminal(job.jobId);
      }else {
        assert(ack.status==='CANCELLED'&&ack.nodeId===job.node.id,
          'P0 cancel uncertain; do not release with an unaccounted paid agent');
        // Cancellation itself is terminal; preserve it as a separate receipt.
        const ev=store.artifact(task.id,`p0-${cycle}-${job.node.id}-cancel.json`,ack);
        store.recordTerminal(job.jobId);cancelled.push({nodeId:job.node.id,evidenceSha256:ev.sha256});
      }
    }
    const result=[...reports.values()];
    assert(new Set(result.map(x=>x.physicalId)).size>=2,'P0 insufficient distinct physical nodes');
    return {commit,cycle,reports:result,skipped,cancelled,
      missing:[...skipped.map(x=>x.nodeId),...cancelled.map(x=>x.nodeId)],
      passed:result.every(x=>x.verdict==='PASS'&&x.findings.length===0),
      dispute:result.some(x=>['QUESTION','NEEDS_SPECIALIST'].includes(x.verdict))||result.some(x=>x.verdict==='PASS')&&result.some(x=>x.verdict==='FAIL'),
      findings:result.flatMap(x=>x.findings)};
  }
}
