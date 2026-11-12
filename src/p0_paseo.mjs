import {verify,randomUUID} from 'node:crypto';
import {withDeadline} from './deadline.mjs';
import {assert,canonical,sha256,parseAgentOutput,normalizeVerdict,PASS,providerOptions,deriveP0Verdict} from './policy.mjs';

function signed(roots,node,proof,expected,{allowHistorical=false}={}){
  const key=roots instanceof Map?roots.get(node.id):roots?.p0?.get(node.id);
  assert(key,'P0 independently pinned public key missing');
  assert(proof?.schema===1&&proof.keyId===node.id&&proof.statement,
    'P0 signed remote witness required');
  for(const [k,v] of Object.entries(expected))
    assert(proof.statement[k]===v,'P0 signed '+k+' mismatch');
  const s=proof.statement;
  assert(/^[a-f0-9-]{36}$/i.test(s.nonce??''),'P0 witness nonce invalid');
  const age=Date.now()-Date.parse(s.issuedAt);
  // Freshness is enforced at first receipt/registration. Historical replay
  // validates immutable signed content and ledger linkage, not current age.
  // Historical replay may exceed the original 30-minute receipt window,
  // but it must never accept a timestamp beyond the same bounded clock-skew
  // tolerance used for first receipt.
  assert(Number.isFinite(age)&&age>=-120000&&
    (allowHistorical||age<=30*60000),'P0 witness stale/future');
  const sig=Buffer.from(proof.signature??'','base64');
  assert(sig.length===64&&verify(null,Buffer.from(canonical(s)),key,sig),
    'P0 independent Ed25519 signature invalid');
}
export function verifyPaseoP0Preflight(roots,node,proof,taskId,commit,{allowHistorical=false}={}){
  signed(roots,node,proof,{purpose:'P1_P0_WORKSPACE_PREFLIGHT_V2',taskId,
    nodeId:node.id,physicalId:node.physicalId,serverId:node.serverId,
    workspaceId:node.workspaceId,cwd:node.cwd,commit,head:commit,clean:true,
    independentSession:true,osReadonlyIsolation:true,nativeTaskIdentity:true},
    {allowHistorical});
}
export function verifyPaseoP0Envelope(roots,node,envelope,{taskId,cycle,jobId,commit,binding=null,allowHistorical=false}){
  assert(envelope?.report&&envelope?.proof,'P0 signed original result missing');
  const r=envelope.report;
  assert(r.taskId===taskId&&r.cycle===cycle&&r.jobId===jobId&&r.commit===commit&&
    r.nodeId===node.id&&r.physicalId===node.physicalId&&r.serverId===node.serverId&&
    r.model===node.model&&r.harness===node.harness,
    'P0 physical node/Commit/Provider mismatch');
  if(binding?.preflightSha256)
    assert(r.independentSession===true&&r.osReadonlyIsolation===true&&
      typeof r.nativeTaskId==='string'&&r.nativeTaskId.length>0,
      'P0 result lacks independent session/OS isolation/native task witness');
  if(binding){
    assert(binding.role===node.role&&binding.workspaceId===node.workspaceId&&
      binding.cwd===node.cwd&&typeof binding.soulSha256==='string'&&
      typeof binding.promptSha256==='string'&&
      typeof binding.taskSpecSha256==='string'&&
      typeof binding.intentSha256==='string'&&
      canonical(r.binding)===canonical(binding),
      'signed P0 result does not bind approved role/Soul/prompt/intent/workspace');
  }
  assert(typeof r.agentId==='string'&&r.agentId.length>0&&
    typeof r.rawMessage==='string'&&r.stdoutSha256===sha256(r.rawMessage),
    'P0 original Paseo Agent raw output not bound');
  const parsed=parseAgentOutput(r.rawMessage,node.role??'blind_a');
  assert(parsed.verdict===normalizeVerdict(r.verdict,node.role??'blind_a')&&
    canonical(parsed.findings)===canonical(r.findings),
    'P0 verdict/finding cannot contradict raw Agent output');
  assert(r.exitCode===0&&r.clean===true,'P0 remote execution failed or altered checkout');
  assert(!(parsed.verdict==='PASS'&&r.findings.length>0),'P0 contradictory PASS/findings');
  if(r.verdict==='APPROVE_WITH_COMMENTS')
    assert(r.findings.every(f=>/^\s*(?:[-*]\s*)?\[?(LOW|MEDIUM|INFO|ADVISORY)\]?\s*[:：-]/i.test(f)),
      'P0 contains blocking or unclassified comments');
  signed(roots,node,envelope.proof,{purpose:binding?'P1_P0_NODE_RESULT_V2':'P1_P0_NODE_RESULT_V1',taskId,cycle,
    jobId,commit,nodeId:node.id,physicalId:node.physicalId,
    serverId:node.serverId,agentId:r.agentId,model:r.model,harness:r.harness,
    ...(binding?{bindingSha256:sha256(binding)}:{}),reportSha256:sha256(r)},
    {allowHistorical});
  return {...r,verdict:parsed.verdict};
}
// Configuration declares candidacy; only the independent signed preflight proves it.
export function p0Eligibility(node){
  if(node.enabled!==true)return {status:'NOT_DISPATCHED',reason:'disabled'};
  if(node.eligibility?.status&&node.eligibility.status!=='P0_ELIGIBLE')
    return {status:'P0_INELIGIBLE',reason:'independent eligibility not approved'};
  if(!['opencode','codex'].includes(node.harness))
    return {status:'P0_INELIGIBLE',reason:'provider lacks approved permission/session/native-task adapter'};
  if(!node.id||!node.physicalId||!node.serverId||node.transport!=='direct'||!node.workspaceId||!node.cwd)
    return {status:'P0_INELIGIBLE',reason:'native Paseo workspace contract incomplete'};
  return {status:'PREFLIGHT_REQUIRED',reason:null};
}
export function verifyPaseoP0Termination(roots,node,proof,{taskId,cycle,jobId,commit,agentId,allowHistorical=false}){
  signed(roots,node,proof,{purpose:'P1_P0_TERMINATION_V1',taskId,cycle,jobId,commit,
    nodeId:node.id,physicalId:node.physicalId,serverId:node.serverId,
    workspaceId:node.workspaceId,agentId,terminated:true,nativeExecutionState:'TERMINAL'},
    {allowHistorical});
  assert(typeof proof.statement.nativeTaskId==='string'&&proof.statement.nativeTaskId.length>0,
    'termination witness lacks original native task identity');
}
async function makeDirectClient({url,password,signal,timeoutMs}) {
  const {createPaseoApi}=await import('@getpaseo/client');
  const {DaemonClient}=await import('@getpaseo/client/internal/daemon-client');
  const driver=new DaemonClient({url,password,clientId:'p1-controller-'+randomUUID(),connectTimeoutMs:timeoutMs,
    reconnect:{enabled:false},logger:{debug(){},info(){},warn(){},error(){}}});
  const abort=()=>{Promise.resolve(driver.close()).catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  try{
    if(signal.aborted)throw new Error('connection deadline expired');
    await driver.connect();
    if(signal.aborted)throw new Error('connection deadline expired');
    const api=createPaseoApi(driver),dispose=api.dispose.bind(api);
    return Object.assign(api,{
      cancelAgent:id=>driver.cancelAgent(id),
      dispose:async()=>{try{await dispose();}finally{await driver.close();}},
    });
  }catch(e){abort();throw e;}
  finally{signal.removeEventListener('abort',abort);}
}
async function closeClient(client){
  if(typeof client.dispose==='function')await client.dispose();
  else if(typeof client.close==='function')await client.close();
}
export function validatedEndpoint(node){
  assert(typeof node.paseoUrl==='string'&&typeof node.passwordEnv==='string'&&
    /^PASEO_[A-Z0-9_]+_PASSWORD$/.test(node.passwordEnv),
    'direct Paseo URL and approved environment password alias required');
  const uri=new URL(node.paseoUrl);
  assert(['ws:','wss:'].includes(uri.protocol)&&uri.pathname==='/ws'&&
    !uri.username&&!uri.password&&!uri.search&&!uri.hash,
    'invalid authenticated direct Paseo daemon endpoint');
  const host=uri.hostname.replace(/^\[|\]$/g,'');
  const a=host.split('.').map(Number);
  const privateIp=a.length===4&&a.every(v=>Number.isInteger(v)&&v>=0&&v<=255)&&
    (a[0]===10||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168));
  const tailscale=a.length===4&&a.every(v=>Number.isInteger(v)&&v>=0&&v<=255)&&
    a[0]===100&&a[1]>=64&&a[1]<=127;
  const approved=node.network?.transport==='tailscale'&&node.network.encrypted===true&&
    node.network.approvedEndpoint===uri.toString()&&node.network.applicationPassword===true;
  if(tailscale)assert(approved,
    'Tailscale requires an explicitly approved encrypted endpoint and application password');
  assert(uri.protocol==='wss:'||privateIp||(tailscale&&approved),
    'unencrypted Paseo WebSocket forbidden outside trusted private LAN or explicitly approved encrypted Tailscale endpoint');
  return uri.toString();
}
const optional=node=>node.optional===true||node.role==='blind_c';
export class PaseoP0Adapter{
  constructor(nodes,{client,attestor,p0Roots,pollMs=60000,extraThirdMs=600000,
    deadlineMs=7200000,callTimeoutMs=15000,
    sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>Date.now(),
    directClientFactory=makeDirectClient}={}){
    this.inventory=nodes;
    this.nodes=nodes.filter(n=>n.enabled===true);
    Object.assign(this,{client,attestor,p0Roots,pollMs,extraThirdMs,deadlineMs,
      callTimeoutMs,sleep,clock,directClientFactory});
    assert(Number.isFinite(extraThirdMs)&&extraThirdMs>=0&&extraThirdMs<=600000,
      'P0 third-seat wait must not exceed 600000ms');
    assert(Number.isFinite(deadlineMs)&&deadlineMs>0&&Number.isFinite(callTimeoutMs)&&
      callTimeoutMs>0&&Number.isFinite(pollMs)&&pollMs>=0,'invalid P0 deadlines');
    this.preflights=new Map();this.cutoff=Infinity;
  }
  call(label,operation,{collection=true,timeoutMs=this.callTimeoutMs}={}){
    const remaining=collection?this.cutoff-this.clock():Infinity;
    assert(remaining>0,'P0 collection deadline; outcome UNKNOWN');
    return withDeadline(operation,Math.min(timeoutMs,remaining),label);
  }
  close(remote){return this.call('close',()=>closeClient(remote),{collection:false});}
  validateInventory(){
    assert(this.nodes.length>=2&&this.nodes.length<=3,'P0 requires 2–3 Paseo hosts');
    // A directory or Workspace ID is scoped to its daemon, never globally unique.
    assert(this.nodes.every(n=>typeof n.id==='string'&&n.id.length>0)&&
      new Set(this.nodes.map(n=>n.id)).size===this.nodes.length,'P0 duplicate physical host attribute: id');
    this.inventoryRejections=new Map();
    const accepted=[];
    for(const n of [...this.nodes].sort((a,b)=>Number(optional(a))-Number(optional(b)))){
      if(optional(n)&&p0Eligibility(n).status!=='PREFLIGHT_REQUIRED')continue;
      const collision=['physicalId','serverId'].find(key=>!n[key]||accepted.some(a=>a[key]===n[key]));
      if(collision&&optional(n)){this.inventoryRejections.set(n.id,'optional physical/daemon identity collision');continue;}
      assert(!collision,'P0 duplicate physical host attribute: '+collision);accepted.push(n);
    }
    for(const n of this.nodes){
      if(optional(n)&&p0Eligibility(n).status!=='PREFLIGHT_REQUIRED')continue;
      assert(['blind_a','blind_b','blind_c'].includes(n.role)&&
        n.transport==='direct'&&((n.paseoUrl&&n.passwordEnv)||n.registrationId)&&
        n.workspaceId&&n.cwd&&n.model?.startsWith(n.harness+'/')&&
        ['opencode','codex'].includes(n.harness),
        'P0 only permits pinned direct Paseo hosts and provider');
    }
    assert(this.attestor?.attestP0Preflight&&this.attestor?.attestP0Result,
      'independent remote witness not deployed; BLOCKED');
  }
  async open(node){
    if(node.paseoUrl){
      const url=validatedEndpoint(node),password=process.env[node.passwordEnv];
      assert(typeof password==='string'&&password.length>0,
        'approved remote Paseo credential unavailable; BLOCKED');
      let timedOut=false;
      try{return await this.call('connect',signal=>
        Promise.resolve(this.directClientFactory({url,password,node,signal,
          timeoutMs:this.callTimeoutMs})).then(remote=>{
          // A late connection is never returned to a timed-out caller.
          if(timedOut||signal.aborted){this.close(remote).catch(()=>{});throw new Error('late connection');}
          return remote;
        }));}
      catch(e){timedOut=true;throw e;}
    }
    const directory=await this.call('host-directory',()=>this.client.hosts.list());
    const host=(directory.hosts??[]).find(h=>h.serverId===node.serverId&&
      h.registrationId===node.registrationId&&h.enabled!==false&&h.metadata?.p1Transport==='direct');
    assert(host,'P0 Host registration mismatch; no SSH fallback');
    const target=JSON.stringify(host.target??host.connection??'');
    assert(!target.toLowerCase().includes('ssh://'),'SSH host connection forbidden');
    return this.call('host-client',()=>this.client.hosts.client(node.serverId));
  }
  async connect(node,task,commit){
    const remote=await this.open(node);
    try{
      if(node.paseoUrl){
        const identity=await this.call('identity',()=>remote.hosts.list());
        assert(identity?.self?.serverId===node.serverId,'remote Paseo daemon serverId mismatch; BLOCKED');
        const available=await this.call('providers',()=>remote.providers.listAvailable());
        assert(Array.isArray(available?.providers)&&available.providers.some(p=>
          p?.provider===node.harness&&p.available===true),'remote approved Harness unavailable; BLOCKED');
      }
      const x=await this.call('workspace',()=>remote.workspaces.ref(node.workspaceId).refresh());
      const workspace=x?.workspace??x;
      assert(workspace&&(workspace.id??workspace.workspaceId)===node.workspaceId&&
        (workspace.workspaceDirectory??workspace.directory??workspace.cwd)===node.cwd,
        'remote Paseo workspace mismatch');
      const proof=await this.call('preflight-witness',()=>this.attestor.attestP0Preflight({node,task,commit}));
      verifyPaseoP0Preflight(this.p0Roots,node,proof,task.id,commit);
      this.preflights.set(node.id,proof);
      return remote;
    }catch(e){await this.close(remote).catch(()=>{});throw e;}
  }
  async terminate(job,task,cycle,commit,store){
    let cancelAck='ACKNOWLEDGED';
    try{await this.call('cancel',()=>job.remote.cancelAgent(job.agentId),{collection:false});}
    catch{cancelAck='UNKNOWN';}
    // A cancel ACK, idle state or archive flag alone never proves termination.
    const snapshot=await this.call('cancel-readback',()=>job.remote.agents.ref(job.agentId).refresh(),{collection:false});
    const state=snapshot?.agent??snapshot;
    assert(state?.id===job.agentId&&['idle','closed'].includes(state.status)&&
      state.activeTurn==null,'P0 cancellation readback is not terminal');
    const proof=await this.call('termination-witness',()=>this.attestor.attestP0Termination({
      node:job.node,task,cycle,commit,jobId:job.jobId,agentId:job.agentId}),{collection:false});
    verifyPaseoP0Termination(this.p0Roots,job.node,proof,{
      taskId:task.id,cycle,jobId:job.jobId,commit,agentId:job.agentId});
    const evidence=store.artifact(task.id,'p0-'+cycle+'-'+job.node.id+'-cancel.json',proof);
    store.recordTerminal(job.jobId);job.state='CANCELLED';
    return {nodeId:job.node.id,jobId:job.jobId,agentId:job.agentId,
      cancelAck,evidenceSha256:evidence.sha256};
  }
  async review({task,commit,taskSpec,store,cycle}){
    this.validateInventory();
    assert(/^(initial-A|final-B)\d+$/.test(cycle),'P0 cycle invalid');
    assert(!this.reviewing,'P0 adapter already collecting another cycle');
    this.reviewing=true;this.preflights.clear();
    const ready=[],skipped=[],jobs=[],reports=new Map(),cancelled=[];
    let quorumAt=null;const start=this.clock();this.cutoff=start+this.deadlineMs;
    const updateQuorum=()=>{
      if(reports.size>=2&&quorumAt===null){
        quorumAt=this.clock();this.cutoff=Math.min(this.cutoff,quorumAt+this.extraThirdMs);
      }
    };
    try{
      for(const node of [...this.inventory].sort((a,b)=>Number(optional(a))-Number(optional(b)))){
        const eligibility=this.inventoryRejections.has(node.id)
          ?{status:'P0_INELIGIBLE',reason:this.inventoryRejections.get(node.id)}:p0Eligibility(node);
        let reason=eligibility.reason;
        if(eligibility.status==='PREFLIGHT_REQUIRED'){
          try{
            const remote=await this.connect(node,task,commit),proof=this.preflights.get(node.id);
            const canTerminate=proof.statement.verifiedTermination===true&&
              typeof remote.cancelAgent==='function'&&typeof this.attestor.attestP0Termination==='function';
            if(optional(node)&&!canTerminate){reason='verified termination unavailable; paid optional dispatch prohibited';await this.close(remote).catch(()=>{});}
            else {ready.push({node,remote,proof,canTerminate});continue;}
          }catch{reason='Paseo/preflight unavailable';}
        }
        skipped.push({nodeId:node.id,status:'NOT_DISPATCHED',eligibility:eligibility.status,reason});
        store.event(task.id,'P0_OPTIONAL_NOT_DISPATCHED',{nodeId:node.id,cycle,reason});
      }
      assert(ready.length>=2,'P0 requires 2 authenticated Paseo hosts before paid dispatch');
      // All paid seats require independently witnessed cancellation capability.
      assert(ready.every(seat=>seat.canTerminate),
        'P0 paid primary lacks independently verified termination capability; BLOCKED');
      let collectionError=null;
      try{
      for(const seat of ready){
        const {node,remote,proof}=seat,role=node.role,soul=task.frozen.souls[role];
        assert(soul?.text,'P0 frozen Soul missing');
        const jobId=sha256(task.id+':'+cycle+':'+commit+':'+node.id).slice(0,40);
        assert(!(store.dispatches?.(task.id)??[]).some(d=>d.id===jobId),
          'existing P0 dispatch requires reconciliation; no automatic recreate');
        const prompt='Blind read-only review of EXACT commit '+commit+
          '. Independent of other nodes. ORIGINAL USER INTENT:\n'+task.frozen.intent+
          '\nAPPROVED TASK_SPEC SHA256: '+sha256(taskSpec)+'\nTASK_SPEC:\n'+taskSpec+
          '\nReturn terminal JSON verdict PASS/FAIL/QUESTION/NEEDS_SPECIALIST, summary and findings; identify specific code evidence.';
        const preflight=store.artifact(task.id,'p0-'+cycle+'-'+node.id+'-preflight.json',proof);
        const binding={role,soulSha256:soul.sha256,promptSha256:sha256(prompt),
          taskSpecSha256:sha256(taskSpec),intentSha256:task.frozen.intentSha256??sha256(task.frozen.intent),
          workspaceId:node.workspaceId,cwd:node.cwd,preflightSha256:preflight.sha256};
        const request={jobId,taskId:task.id,cycle,serverId:node.serverId,
          nodeId:node.id,physicalId:node.physicalId,workspaceId:node.workspaceId,cwd:node.cwd,commit,
          soulSha256:soul.sha256,promptSha256:sha256(prompt),binding};
        store.artifact(task.id,'p0-'+cycle+'-'+node.id+'-request.json',request);
        store.recordIntent(task.id,'P0:'+cycle+':'+node.id,jobId);
        const job={...seat,jobId,agentId:null,binding,state:'UNKNOWN'};jobs.push(job);
        try{
          const handle=await this.call('create',()=>remote.agents.create({
            config:{provider:node.model,systemPrompt:soul.text,options:providerOptions(role,node.harness)},
            cwd:node.cwd,title:'P0:'+task.id+':'+cycle+':'+node.id,prompt,background:true,
            labels:{'p0-job':jobId,'p0-task':task.id,'p0-cycle':cycle,'p0-commit':commit,'p0-node':node.id}}));
          assert(handle.id,'P0 remote agent ACK identity missing');
          job.agentId=handle.id;store.recordAck(jobId,node.serverId+':'+handle.id);job.state='ACKNOWLEDGED';
        }catch(e){if(!optional(node))throw e;}
      }
      while(true){
        for(const job of jobs){
          if(job.state!=='ACKNOWLEDGED')continue;
          if(quorumAt!==null&&this.clock()>=this.cutoff)break;
          try{
            const handle=job.remote.agents.ref(job.agentId);
            const snapshot=await this.call('status',()=>handle.refresh());
            const state=snapshot?.agent??snapshot;
            assert(state?.id===job.agentId,'P0 remote agent identity uncertain');
            if(['idle','closed'].includes(state.status)){
              const result=await this.call('finish',()=>handle.waitForFinish(1500));
              assert(result.status==='idle'&&typeof result.lastMessage==='string',
                'P0 Agent did not finish with stable raw report');
              const envelope=await this.call('result-witness',()=>this.attestor.attestP0Result({
                node:job.node,task,cycle,commit,jobId:job.jobId,agentId:job.agentId,
                raw:result.lastMessage,binding:job.binding}));
              // Preserve the exact witness response even when verification fails.
              const ev=store.artifact(task.id,'p0-'+cycle+'-'+job.node.id+'-result.json',envelope);
              const body=verifyPaseoP0Envelope(this.p0Roots,job.node,envelope,
                {taskId:task.id,cycle,jobId:job.jobId,commit,binding:job.binding});
              assert(body.agentId===job.agentId,'P0 signed Agent ID mismatched ACK');
              store.recordTerminal(job.jobId);job.state='TERMINAL';
              reports.set(job.node.id,{...body,evidence:ev});updateQuorum();
            }else assert(['initializing','running'].includes(state.status),
              'P0 remote Agent nonterminal/failed; reconcile manually');
          }catch(e){job.state='UNKNOWN';job.reason=e.code==='P0_DEADLINE'?'DEADLINE':'INVALID_OR_UNKNOWN_RESULT';}
        }
        if(!jobs.some(j=>j.state==='ACKNOWLEDGED')||this.clock()>=this.cutoff)break;
        const delay=Math.min(this.pollMs,Math.max(0,this.cutoff-this.clock()));
        try{await this.call('poll',()=>this.sleep(delay),{timeoutMs:Math.max(this.callTimeoutMs,delay+1000)});}
        catch{break;} // Preserve an established quorum and close existing execution separately.
      }
      }catch(e){collectionError=e;}
      // Cleanup also runs when a later primary create fails after an earlier
      // primary has already started a paid execution.
      for(const job of jobs.filter(j=>!['TERMINAL','CANCELLED'].includes(j.state))){
        if(job.agentId&&job.canTerminate){
          try{cancelled.push(await this.terminate(job,task,cycle,commit,store));continue;}catch{}
        }
        job.state='UNKNOWN';
      }
      const result=[...reports.values()],physicalIds=[...new Set(result.map(r=>r.physicalId))];
      const execution={state:jobs.every(j=>['TERMINAL','CANCELLED'].includes(j.state))?'CLOSED':'NEEDS_RECONCILIATION',
        jobs:jobs.map(j=>({nodeId:j.node.id,jobId:j.jobId,agentId:j.agentId,state:j.state}))};
      const quorum={established:physicalIds.length>=2,validReportCount:result.length,physicalIds,
        establishedAt:quorumAt,extraThirdMs:this.extraThirdMs};
      if(collectionError||!quorum.established){
        store.artifact(task.id,'p0-'+cycle+'-incomplete.json',{
          quorum,execution,skipped,reports:result,
          cause:collectionError?String(collectionError.message):'insufficient physical quorum'});
        if(collectionError)throw collectionError;
        throw new Error('P0 physical quorum invalid; retain original dispatches; no automatic retry');
      }
      const derived=deriveP0Verdict(result);
      return {transport:'paseo',commit,cycle,reports:result,skipped,cancelled,
        missing:[...skipped.map(x=>x.nodeId),...cancelled.map(x=>x.nodeId)],
        quorum,execution,technical:{passed:derived.passed,requiresArbitrator:true},
        requiresArbitrator:result.some(r=>!PASS(r.verdict)),...derived};
    }finally{
      await Promise.allSettled(ready.map(x=>this.close(x.remote)));
      this.cutoff=Infinity;this.reviewing=false;
    }
  }
  async reconcileByLabels(node,{taskId,cycle,jobId,commit}){
    let remote=null;
    try{
      remote=await this.open(node);
      if(node.paseoUrl){
        const identity=await this.call('reconcile-identity',()=>remote.hosts.list());
        assert(identity?.self?.serverId===node.serverId,'remote identity drift during read-only reconciliation');
      }
      const matches=[],cursors=new Set();let cursor;
      for(let page=0;page<100;page++){
        const data=await this.call('reconcile-list',()=>remote.agents.list({includeBackground:true,
          filter:{includeArchived:true,includeBackground:true,includeInternal:true},
          page:{limit:200,...(cursor?{cursor}:{})}}));
        assert(Array.isArray(data?.entries)||Array.isArray(data),
          'remote Paseo Agent listing shape unknown; do not assume no task exists');
        matches.push(...(Array.isArray(data)?data:data.entries).map(x=>x?.agent??x).filter(a=>
          a?.labels?.['p0-job']===jobId&&a?.labels?.['p0-task']===taskId&&
          a?.labels?.['p0-cycle']===cycle&&a?.labels?.['p0-commit']===commit));
        if(!data.pageInfo?.hasMore)return matches;
        cursor=data.pageInfo.nextCursor;
        assert(cursor&&!cursors.has(cursor),'incomplete reconciliation pagination');cursors.add(cursor);
      }
      throw new Error('reconciliation page bound exceeded; outcome UNKNOWN');
    }finally{if(remote)await this.close(remote).catch(()=>{});}
  }
}
