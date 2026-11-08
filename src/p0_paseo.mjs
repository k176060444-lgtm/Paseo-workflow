import {verify} from 'node:crypto';
import {assert,canonical,sha256,parseAgentOutput,PASS,providerOptions} from './policy.mjs';

function signed(roots,node,proof,expected){
  const key=roots instanceof Map?roots.get(node.id):roots?.p0?.get(node.id);
  assert(key,'P0 independently pinned public key missing');
  assert(proof?.schema===1&&proof.keyId===node.id&&proof.statement,
    'P0 signed remote witness required');
  for(const [k,v] of Object.entries(expected))
    assert(proof.statement[k]===v,'P0 signed '+k+' mismatch');
  const s=proof.statement;
  assert(/^[a-f0-9-]{36}$/i.test(s.nonce??''),'P0 witness nonce invalid');
  const age=Date.now()-Date.parse(s.issuedAt);
  assert(Number.isFinite(age)&&age>=-120000&&age<=30*60000,'P0 witness stale/future');
  const sig=Buffer.from(proof.signature??'','base64');
  assert(sig.length===64&&verify(null,Buffer.from(canonical(s)),key,sig),
    'P0 independent Ed25519 signature invalid');
}
export function verifyPaseoP0Preflight(roots,node,proof,taskId,commit){
  signed(roots,node,proof,{purpose:'P1_P0_WORKSPACE_PREFLIGHT_V1',taskId,
    nodeId:node.id,physicalId:node.physicalId,serverId:node.serverId,
    workspaceId:node.workspaceId,cwd:node.cwd,commit,head:commit,clean:true});
}
export function verifyPaseoP0Envelope(roots,node,envelope,{taskId,cycle,jobId,commit}){
  assert(envelope?.report&&envelope?.proof,'P0 signed original result missing');
  const r=envelope.report;
  assert(r.taskId===taskId&&r.cycle===cycle&&r.jobId===jobId&&r.commit===commit&&
    r.nodeId===node.id&&r.physicalId===node.physicalId&&r.serverId===node.serverId&&
    r.model===node.model&&r.harness===node.harness,
    'P0 physical node/Commit/Provider mismatch');
  assert(typeof r.agentId==='string'&&r.agentId.length>0&&
    typeof r.rawMessage==='string'&&r.stdoutSha256===sha256(r.rawMessage),
    'P0 original Paseo Agent raw output not bound');
  const parsed=parseAgentOutput(r.rawMessage,node.role??'blind_a');
  assert(parsed.verdict===r.verdict&&canonical(parsed.findings)===canonical(r.findings),
    'P0 verdict/finding cannot contradict raw Agent output');
  assert(r.exitCode===0&&r.clean===true,'P0 remote execution failed or altered checkout');
  assert(!(r.verdict==='PASS'&&r.findings.length>0),'P0 contradictory PASS/findings');
  if(r.verdict==='APPROVE_WITH_COMMENTS')
    assert(r.findings.every(f=>/^\s*(?:[-*]\s*)?\[?(LOW|MEDIUM|INFO|ADVISORY)\]?\s*[:：-]/i.test(f)),
      'P0 contains blocking or unclassified comments');
  signed(roots,node,envelope.proof,{purpose:'P1_P0_NODE_RESULT_V1',taskId,cycle,
    jobId,commit,nodeId:node.id,physicalId:node.physicalId,
    serverId:node.serverId,agentId:r.agentId,model:r.model,harness:r.harness,
    reportSha256:sha256(r)});
  return r;
}
export class PaseoP0Adapter{
  constructor(nodes,{client,attestor,p0Roots,pollMs=60000,extraThirdMs=600000,
    deadlineMs=7200000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),
    clock=()=>Date.now()}={}){
    this.nodes=nodes.filter(n=>n.enabled===true);
    Object.assign(this,{client,attestor,p0Roots,pollMs,extraThirdMs,deadlineMs,sleep,clock});
  }
  validateInventory(){
    assert(this.nodes.length>=2&&this.nodes.length<=3,'P0 requires 2–3 Paseo hosts');
    for(const key of ['id','physicalId','serverId','workspaceId','cwd'])
      assert(new Set(this.nodes.map(n=>n[key])).size===this.nodes.length,
        'P0 duplicate physical host attribute: '+key);
    for(const n of this.nodes)
      assert(n.transport==='direct'&&n.serverId&&n.registrationId&&
        n.workspaceId&&n.cwd&&n.model?.startsWith(n.harness+'/')&&
        ['opencode','codex'].includes(n.harness),
        'P0 only permits pinned direct Paseo hosts and provider');
    assert(this.client?.hosts?.client&&this.attestor?.attestP0Preflight&&
      this.attestor?.attestP0Result,
      'P0 Paseo Connected Hosts or independent witness not deployed; BLOCKED');
  }
  async connect(node,task,commit){
    const directory=await this.client.hosts.list();
    const host=(directory.hosts??[]).find(h=>h.serverId===node.serverId&&
      h.registrationId===node.registrationId&&h.enabled!==false&&
      h.metadata?.p1Transport==='direct');
    assert(host,'P0 host identity/direct transport not pinned; no SSH fallback');
    const target=JSON.stringify(host.target??host.connection??'');
    assert(!target.toLowerCase().includes('ssh://'),'SSH host connection forbidden for normal P0');
    const remote=await this.client.hosts.client(node.serverId);
    try{
      const x=await remote.workspaces.ref(node.workspaceId).refresh();
      const workspace=x?.workspace??x;
      assert(workspace&&(workspace.directory??workspace.cwd)===node.cwd,
        'remote Paseo workspace mismatch');
      const proof=await this.attestor.attestP0Preflight({node,task,commit});
      verifyPaseoP0Preflight(this.p0Roots,node,proof,task.id,commit);
      return remote;
    }catch(e){await remote.dispose();throw e;}
  }
  async review({task,commit,taskSpec,store,cycle}){
    this.validateInventory();
    assert(/^(initial-A|final-B)\d+$/.test(cycle),'P0 cycle invalid');
    const ready=[],skipped=[],jobs=[],reports=new Map();
    let quorumAt=null;const start=this.clock();
    for(const node of this.nodes){
      try{ready.push({node,remote:await this.connect(node,task,commit)});}
      catch(e){skipped.push({nodeId:node.id,reason:'Paseo/preflight unavailable'});
        store.event(task.id,'P0_OPTIONAL_NOT_DISPATCHED',{nodeId:node.id,cycle});}
    }
    try{
      assert(ready.length>=2,'P0 requires 2 authenticated Paseo hosts before paid dispatch');
      for(const {node,remote} of ready){
        const role=node.role??'blind_a',soul=task.frozen.souls[role];
        assert(soul?.text,'P0 frozen Soul missing');
        const jobId=sha256(task.id+':'+cycle+':'+commit+':'+node.id).slice(0,40);
        const prompt='Blind read-only review of EXACT commit '+commit+
          '. Independent of other nodes. TASK_SPEC:\n'+taskSpec+
          '\nReturn one JSON verdict/summary/findings.';
        const request={jobId,taskId:task.id,cycle,serverId:node.serverId,
          nodeId:node.id,workspaceId:node.workspaceId,commit,
          soulSha256:soul.sha256,promptSha256:sha256(prompt)};
        store.artifact(task.id,'p0-'+cycle+'-'+node.id+'-request.json',request);
        store.recordIntent(task.id,'P0:'+cycle+':'+node.id,jobId);
        // A lost create ACK is UNKNOWN. Do NOT re-create automatically.
        const handle=await remote.agents.create({
          config:{provider:node.model,systemPrompt:soul.text,
            options:providerOptions(role,node.harness)},
          cwd:node.cwd,title:'P0:'+task.id+':'+cycle+':'+node.id,
          prompt,background:true,labels:{'p0-job':jobId,'p0-task':task.id,
            'p0-cycle':cycle,'p0-commit':commit,'p0-node':node.id}
        });
        assert(handle.id,'P0 remote agent ACK identity missing');
        store.recordAck(jobId,node.serverId+':'+handle.id);
        jobs.push({node,remote,jobId,agentId:handle.id});
      }
      while(true){
        for(const job of jobs){
          if(reports.has(job.node.id))continue;
          const handle=job.remote.agents.ref(job.agentId);
          const snapshot=await handle.refresh();
          const state=snapshot?.agent??snapshot;
          assert(state?.id===job.agentId,'P0 remote agent identity uncertain');
          if(['idle','closed'].includes(state.status)){
            const result=await handle.waitForFinish(1500);
            assert(result.status==='idle'&&typeof result.lastMessage==='string',
              'P0 Agent did not finish with stable raw report');
            const envelope=await this.attestor.attestP0Result({
              node:job.node,task,cycle,commit,jobId:job.jobId,
              agentId:job.agentId,raw:result.lastMessage});
            const body=verifyPaseoP0Envelope(this.p0Roots,job.node,envelope,
              {taskId:task.id,cycle,jobId:job.jobId,commit});
            assert(body.agentId===job.agentId,'P0 signed Agent ID mismatched ACK');
            const ev=store.artifact(task.id,'p0-'+cycle+'-'+job.node.id+'-result.json',envelope);
            store.recordTerminal(job.jobId);
            reports.set(job.node.id,{...body,evidence:ev});
          }else assert(['running','queued','starting','busy'].includes(state.status),
            'P0 remote Agent nonterminal/failed; reconcile manually');
        }
        if(new Set([...reports.values()].map(x=>x.physicalId)).size>=2&&quorumAt===null)
          quorumAt=this.clock();
        if(quorumAt!==null&&(reports.size===jobs.length||
          this.clock()-quorumAt>=this.extraThirdMs))break;
        assert(this.clock()-start<this.deadlineMs,'P0 deadline; reconcile existing Agent');
        await this.sleep(this.pollMs);
      }
      const cancelled=[];
      for(const job of jobs.filter(j=>!reports.has(j.node.id))){
        const handle=job.remote.agents.ref(job.agentId);
        const ack=await handle.archive();
        assert(ack?.archivedAt,'P0 remote archive not confirmed');
        const x=await handle.refresh(),state=x?.agent??x;
        assert(state?.id===job.agentId&&state.status==='closed',
          'P0 remote cancellation uncertain; do not release');
        const ev=store.artifact(task.id,'p0-'+cycle+'-'+job.node.id+'-cancel.json',
          {jobId:job.jobId,agentId:job.agentId,serverId:job.node.serverId,
            archivedAt:ack.archivedAt,status:state.status});
        store.recordTerminal(job.jobId);
        cancelled.push({nodeId:job.node.id,evidenceSha256:ev.sha256});
      }
      const result=[...reports.values()];
      assert(new Set(result.map(r=>r.physicalId)).size>=2,'P0 physical quorum invalid');
      return {transport:'paseo',commit,cycle,reports:result,skipped,cancelled,
        missing:[...skipped.map(x=>x.nodeId),...cancelled.map(x=>x.nodeId)],
        passed:result.every(x=>PASS(x.verdict)&&x.findings.length===0),
        dispute:result.some(x=>['QUESTION','NEEDS_SPECIALIST'].includes(x.verdict))||
          result.some(x=>PASS(x.verdict))&&result.some(x=>x.verdict==='FAIL'),
        findings:result.flatMap(r=>r.findings)};
    }finally{await Promise.allSettled(ready.map(x=>x.remote.dispose()));}
  }
  async reconcileByLabels(node,{taskId,cycle,jobId,commit}){
    assert(this.client?.hosts?.client,'P0 Paseo connection unavailable');
    const remote=await this.client.hosts.client(node.serverId);
    try{
      const data=await remote.agents.list({includeBackground:true});
      const list=Array.isArray(data)?data:data?.entries??[];
      return list.map(x=>x?.agent??x).filter(a=>
        a?.labels?.['p0-job']===jobId&&a?.labels?.['p0-task']===taskId&&
        a?.labels?.['p0-cycle']===cycle&&a?.labels?.['p0-commit']===commit);
    }finally{await remote.dispose();}
  }
}
