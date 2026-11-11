import {randomUUID} from 'node:crypto';
import {AGENT_SCHEMA,assert,parseAgentOutput,providerOptions} from './policy.mjs';

// Never import the SDK in simulation or contract tests: a missing daemon is not a test failure.
export class PaseoAgentRuntime {
  constructor(url,{attestor=null}={}) {this.url=url;this.client=null;this.attestor=attestor;}
  async open(){
    // 21bao live observation: daemon 0.15.3 accepts /ws; a bare host:port
    // can hang silently. Never try to connect to an unapproved remote target.
    const uri=new URL(this.url);
    assert(['ws:','wss:'].includes(uri.protocol)&&uri.pathname==='/ws'&&
      !uri.username&&!uri.password&&!uri.search&&!uri.hash,
      'Paseo endpoint must be an exact ws(s)://localhost:PORT/ws URL');
    assert(['127.0.0.1','localhost','[::1]'].includes(uri.hostname),
      'Paseo SDK must connect only to the local authenticated daemon');
    const {createPaseoClient}=await import('@getpaseo/client');
    this.client=createPaseoClient({url:this.url});
    await this.client.connect();
  }
  async findExistingAgent(agentId){
    assert(this.client&&typeof agentId==='string'&&agentId.length>0,
      'Paseo reconcile requires an existing Agent ID');
    // A new ref may have current() === null; refresh() fetches from daemon.
    const result=await this.client.agents.ref(agentId).refresh();
    return result?.agent??result;
  }
  async listAllAgents(){
    assert(this.client,'Paseo not connected');
    // In 0.15.3 background:true agents are omitted from default list().
    const response=await this.client.agents.list({includeBackground:true});
    const entries=Array.isArray(response)?response:response?.entries;
    assert(Array.isArray(entries),'unexpected Paseo background agent list shape');
    return entries.map(x=>x?.agent??x);
  }
  async reconcileRecordedDispatches(task,rows){
    assert(this.client&&task?.id&&Array.isArray(rows),
      'read-only original local dispatch reconciliation requires connected Paseo and ledger rows');
    const all=await this.listAllAgents();
    const scoped=all.filter(a=>a?.labels?.['p1-task']===task.id);
    const result=[];
    for(const d of rows){
      assert(d.task_id===task.id&&typeof d.id==='string'&&typeof d.phase==='string',
        'dispatch does not belong to the frozen task');
      if(d.phase.startsWith('P0:'))continue; // separate pinned remote P0 reconciliation
      const exact=scoped.filter(a=>a.labels?.['p1-dispatch']===d.id);
      for(const agent of exact)assert(agent.labels?.['p1-phase']===d.phase&&
        typeof agent.labels?.['p1-role']==='string',
        'remote Agent label contradicts persisted original dispatch phase');
      assert(exact.length<=1,'duplicate local Paseo Agent dispatch identity; BLOCKED');
      const ambiguous=scoped.filter(a=>a.labels?.['p1-phase']===d.phase&&
        !a.labels?.['p1-dispatch']);
      // Never assert "task absent" from an empty result: a missing/lost ACK
      // cannot be distinguished from an expired, renamed or inaccessible task.
      const found=exact[0];
      result.push({dispatchId:d.id,phase:d.phase,ledgerState:d.state,
        ledgerAgentId:d.agent_id??null,
        match:found?{id:found.id,status:found.status,role:found.labels?.['p1-role'],
          commit:found.labels?.['p1-commit']}:null,
        ambiguousLegacyAgents:ambiguous.map(a=>({id:a.id,status:a.status})),
        verdict:found&&d.agent_id!==null&&d.agent_id!==found.id?
          'IDENTITY_CONFLICT':found?'IDENTIFIED_NOT_RECOVERED':'UNKNOWN_NO_REDISPATCH'});
    }
    return {taskId:task.id,mode:'READ_ONLY_NO_SIDE_EFFECTS',
      observations:result,manualAttestationRequired:true};
  }
  async close(){if(this.client) await this.client.close();}
  async execute({task,role,phase,cwd,prompt,store,auditBinding=null}){
    assert(this.client,'Paseo not connected');
    const cfg=task.frozen.roles[role];assert(cfg,'missing role configuration');
    const soul=task.frozen.souls[role];assert(soul?.text,'missing frozen soul');
    const dispatchId=randomUUID();
    store.recordIntent(task.id,phase,dispatchId);
    // A create ACK is not proof that the provider ran. A lost ACK is UNCERTAIN, not retryable.
    const agent=await this.client.agents.create({
      config:{provider:cfg.model,systemPrompt:soul.text,options:providerOptions(role,cfg.harness,
            role==='tester_gate_b'?Object.values(task.frozen.tests?.gateB??{}).flat():
              task.frozen.tests?.commands??[])},
      cwd, title:`${task.id}:${phase}:${role}`, prompt,
      outputSchema:AGENT_SCHEMA,
      labels:{'p1-task':task.id,'p1-phase':phase,'p1-role':role,
        'p1-dispatch':dispatchId,'p1-commit':task.currentSha??'NOT_YET_ESTABLISHED',
        'p1-soul-sha':soul.sha256},
      background:true,
    });
    store.recordAck(dispatchId,agent.id);
    const result=await agent.waitForFinish(60*60*1000);
    assert(result.status==='idle',`Paseo role ${role} not terminal idle: ${result.status}; inspect Agent ${agent.id}`);
    const data=parseAgentOutput(result.lastMessage,role);
    const bare={role,phase,agentId:agent.id,dispatchId,verdict:data.verdict,
      summary:data.summary,findings:data.findings,taskSpec:data.taskSpec??null,
      userAlignment:data.userAlignment??null,
      disputeResolution:role==='arbitrator'?data.disputeResolution??null:null,
      model:cfg.model,harness:cfg.harness,soulSha256:soul.sha256,
      raw:result.lastMessage,...(auditBinding?{auditBinding}:{})};
    assert(this.attestor,'independent Paseo execution attestor not installed; BLOCKED');
    // No model or Controller key can sign this receipt. The IPC attestor must
    // independently observe the daemon and its final raw session.
    const attestation=await this.attestor.attestPaseo({
      task,role,phase,commit:task.currentSha??null,agentId:agent.id,dispatchId,raw:bare
    });
    store.recordTerminal(dispatchId);
    return {...bare,attestation};
  }
}
