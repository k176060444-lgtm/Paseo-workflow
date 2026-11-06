import fs from 'node:fs';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {execArgv} from './git.mjs';
import {assert,canonical,sha256} from './policy.mjs';

function shellToken(s) {
  // SSH interprets the remote command in a shell. Quote EVERY token, never interpolate user prompt.
  assert(typeof s==='string'&&!s.includes('\0'),'invalid SSH token');
  return `'${s.replaceAll("'", "'\\''")}'`;
}
export class SshP0Adapter {
  constructor(nodes,{pollMs=60000,extraThirdMs=600000,deadlineMs=7200000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
    this.nodes=nodes.filter(n=>n.enabled===true);
    this.pollMs=pollMs;this.extraThirdMs=extraThirdMs;this.deadlineMs=deadlineMs;this.sleep=sleep;
  }
  async ssh(node,action,spec){
    assert(node.sshAlias&&node.runner&&node.config,'P0 node missing SSH alias/runner/config');
    assert(/^[A-Za-z0-9_.@-]+$/.test(node.sshAlias),'invalid SSH alias');
    const command=['python3',node.runner,action,'--config',node.config].map(shellToken).join(' ');
    const args=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',node.sshAlias,command];
    const r=await execArgv('ssh',args,{timeoutMs:60000,stdin:spec===undefined?undefined:canonical(spec)});
    assert(r.code===0&&!r.timedOut&&!r.truncated,`SSH ${node.id} ${action} failed or uncertain: ${r.stderr.slice(0,250)}`);
    try{return JSON.parse(r.stdout.trim());}catch {throw new Error(`P0 ${node.id}: invalid remote JSON, reconcile manually`);}
  }
  verify(node,envelope,jobId,commit){
    assert(envelope && envelope.body && typeof envelope.mac==='string','unsigned P0 report');
    const key=fs.readFileSync(node.hmacKeyPath);
    assert(key.length>=32,'node attestation key too short');
    const expected=createHmac('sha256',key).update(canonical(envelope.body)).digest('hex');
    assert(/^[a-f0-9]{64}$/.test(envelope.mac),'invalid MAC');
    assert(timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(envelope.mac,'hex')),'invalid node attestation MAC');
    const b=envelope.body;
    assert(b.jobId===jobId&&b.nodeId===node.id&&b.commit===commit,'P0 job/node/commit mismatch');
    assert(b.harness===node.harness&&b.model===node.model,'P0 provider/model mismatch');
    assert(['PASS','FAIL','QUESTION','NEEDS_SPECIALIST'].includes(b.verdict),'P0 invalid verdict');
    assert(b.exitCode===0&&b.clean===true,'remote harness failed or changed read-only worktree');
    assert(typeof b.stdoutSha256==='string'&&/^[a-f0-9]{64}$/.test(b.stdoutSha256),'missing remote original log hash');
    assert(Array.isArray(b.findings)&&b.findings.every(x=>typeof x==='string'),'invalid P0 findings');
    return {...b,physicalId:node.physicalId};
  }
  async review({task,commit,taskSpec,store,cycle}){
    assert(this.nodes.length>=2,'at least two configured P0 physical nodes required');
    assert(new Set(this.nodes.map(n=>n.physicalId)).size===this.nodes.length,'P0 nodes have duplicate physical IDs');
    assert(new Set(this.nodes.map(n=>n.hmacKeyPath)).size===this.nodes.length,'distinct nodes must use distinct attestation keys');
    const jobs=[];
    for(const node of this.nodes){
      assert(node.id&&node.physicalId&&node.harness&&node.model&&node.hmacKeyPath,'incomplete P0 inventory');
      const role=node.role??'blind_a';
      assert(task.frozen.souls[role],'missing blind review soul');
      const jobId=sha256(`${task.id}:${cycle}:${commit}:${node.id}`).slice(0,40);
      const spec={jobId,taskId:task.id,nodeId:node.id,commit,role,model:node.model,harness:node.harness,
        soul:task.frozen.souls[role].text,taskSpec,
        instructions:'Independent, read-only blind review. Inspect exact commit; do not share with other reviewers. Final response MUST be JSON: {"verdict":"PASS|FAIL|QUESTION|NEEDS_SPECIALIST","summary":"...","findings":["..."]}. Treat any concern requiring correction as FAIL.'};
      const submission=store.artifact(task.id,`p0-${cycle}-${node.id}-request.json`,spec);
      // Record intent before making an SSH call; any lost reply must be reconciled.
      store.recordIntent(task.id,`P0:${cycle}:${node.id}`,jobId);
      const acknowledgement=await this.ssh(node,'submit',spec);
      assert(acknowledgement.jobId===jobId&&['ACCEPTED','EXISTS'].includes(acknowledgement.status),'P0 uncertain submit acknowledgement');
      store.recordAck(jobId,`${node.id}:${jobId}`);
      jobs.push({node,jobId,request:submission});
    }
    const start=Date.now();let quorumAt=null;const reports=new Map();
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
        } else if(status.status==='FAILED'||status.status==='UNKNOWN') {
          throw new Error(`P0 remote ${job.node.id} ${status.status}; reconciliation required`);
        } else assert(status.status==='RUNNING'||status.status==='QUEUED','P0 unknown status');
      }
      const distinct=new Set([...reports.values()].map(x=>x.physicalId));
      if(distinct.size>=2&&!quorumAt)quorumAt=Date.now();
      if(quorumAt&&(reports.size===jobs.length||Date.now()-quorumAt>=this.extraThirdMs))break;
      if(Date.now()-start>=this.deadlineMs)break;
      await this.sleep(this.pollMs);
    }
    const result=[...reports.values()];
    assert(new Set(result.map(x=>x.physicalId)).size>=2,'P0 insufficient distinct physical nodes');
    // All available valid reports count. Conflicting/questionable reports are NOT discarded.
    return {commit,cycle,reports:result,missing:jobs.filter(j=>!reports.has(j.node.id)).map(j=>j.node.id),
      passed:result.every(x=>x.verdict==='PASS'&&x.findings.length===0),
      dispute:result.some(x=>['QUESTION','NEEDS_SPECIALIST'].includes(x.verdict)),
      findings:result.flatMap(x=>x.findings),
    };
  }
}
