import {randomUUID} from 'node:crypto';
import {AGENT_SCHEMA,assert,parseAgentOutput,providerOptions} from './policy.mjs';

// Never import the SDK in simulation or contract tests: a missing daemon is not a test failure.
export class PaseoAgentRuntime {
  constructor(url) {this.url=url;this.client=null;}
  async open(){
    const {createPaseoClient}=await import('@getpaseo/client');
    this.client=createPaseoClient({url:this.url});
    await this.client.connect();
  }
  async close(){if(this.client) await this.client.close();}
  async execute({task,role,phase,cwd,prompt,store}){
    assert(this.client,'Paseo not connected');
    const cfg=task.frozen.roles[role];assert(cfg,'missing role configuration');
    const soul=task.frozen.souls[role];assert(soul?.text,'missing frozen soul');
    const dispatchId=randomUUID();
    store.recordIntent(task.id,phase,dispatchId);
    // A create ACK is not proof that the provider ran. A lost ACK is UNCERTAIN, not retryable.
    const agent=await this.client.agents.create({
      config:{provider:cfg.model,systemPrompt:soul.text,options:providerOptions(role,cfg.harness)},
      cwd, title:`${task.id}:${phase}:${role}`, prompt,
      outputSchema:AGENT_SCHEMA,
      labels:{'p1-task':task.id,'p1-phase':phase,'p1-role':role,'p1-soul-sha':soul.sha256},
      background:true,
    });
    store.recordAck(dispatchId,agent.id);
    const result=await agent.waitForFinish({timeoutMs:60*60*1000});
    assert(result.status==='idle',`Paseo role ${role} not terminal idle: ${result.status}; inspect Agent ${agent.id}`);
    const data=parseAgentOutput(result.lastMessage,role);
    store.recordTerminal(dispatchId);
    return {role,phase,agentId:agent.id,dispatchId,verdict:data.verdict,summary:data.summary,findings:data.findings,taskSpec:data.taskSpec??null,raw:result.lastMessage};
  }
}
