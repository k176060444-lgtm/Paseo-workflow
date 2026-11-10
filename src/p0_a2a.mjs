import {assert,sha256,PASS} from './policy.mjs';
import {verifyPaseoP0Envelope} from './p0_paseo.mjs';

// Hermes already owns peer authentication, Agent Card and A2A protocol semantics.
// This bridge intentionally delegates those operations to the existing Hermes
// A2A tool; it does NOT implement another A2A client or handle Bearer secrets.
export class HermesA2AP0Seat {
  constructor(node,{bridge=null,p0Roots=null,clock=()=>Date.now(),
    sleep=ms=>new Promise(r=>setTimeout(r,ms)),pollMs=60000,maxThirdMs=600000}={}){
    this.node=node;
    Object.assign(this,{bridge,p0Roots,clock,sleep,pollMs,maxThirdMs});
  }
  validate(){
    const n=this.node;
    assert(n?.transport==='a2a'&&n.peerName==='rustyhand'&&
      n.physicalId&&n.serverId&&n.harness&&n.model&&n.role,
      'rusty A2A inventory incomplete; BLOCKED');
    assert(this.bridge&&typeof this.bridge.submit==='function'&&
      typeof this.bridge.status==='function',
      'Hermes native A2A submit/status bridge not connected; BLOCKED');
    assert(this.p0Roots?.get(n.id),
      'independent rusty P0 signing public key not pinned; BLOCKED');
  }
  async review({task,commit,taskSpec,store,cycle}){
    this.validate();
    assert(/^(initial-A|final-B)\d+$/.test(cycle)&&/^[a-f0-9]{40}$/.test(commit),
      'invalid A2A blind-review cycle or Git commit');
    const n=this.node,soul=task.frozen.souls[n.role];
    assert(soul?.text,'frozen rusty Blind Reviewer Soul missing');
    const jobId=sha256(task.id+':'+cycle+':'+commit+':'+n.id).slice(0,40);
    const request={schema:1,jobId,taskId:task.id,cycle,commit,
      peerName:n.peerName,nodeId:n.id,physicalId:n.physicalId,
      harness:n.harness,model:n.model,soulSha256:soul.sha256,
      taskSpecSha256:sha256(taskSpec),originalIntent:task.frozen.intent,
      instructions:'Read-only independent review of the exact commit; return original evidence and independently signed report.'};
    store.artifact(task.id,'p0-'+cycle+'-'+n.id+'-request.json',request);
    store.recordIntent(task.id,'P0:'+cycle+':'+n.id,jobId);
    // A2A Task ID must be observable, not guessed from context or Agent text.
    // If ACK is missing, do not call submit a second time.
    const ack=await this.bridge.submit({peerName:n.peerName,request,soul:soul.text});
    assert(typeof ack?.taskId==='string'&&ack.taskId.length>0&&
      typeof ack?.agentId==='string'&&ack.agentId.length>0,
      'A2A ACK lacks independently traceable Task/Agent IDs; reconcile, no redispatch');
    store.recordAck(jobId,n.serverId+':'+ack.agentId);
    const started=this.clock();
    while(this.clock()-started<=this.maxThirdMs){
      const state=await this.bridge.status({peerName:n.peerName,taskId:ack.taskId});
      assert(state?.taskId===ack.taskId,'A2A Task identity mismatch; BLOCKED');
      if(state.status==='completed'){
        const body=verifyPaseoP0Envelope(this.p0Roots,n,state.envelope,
          {taskId:task.id,cycle,jobId,commit});
        assert(body.agentId===ack.agentId,
          'A2A report identity does not match original task receipt');
        const evidence=store.artifact(task.id,'p0-'+cycle+'-'+n.id+'-result.json',state.envelope);
        store.recordTerminal(jobId);
        return {...body,evidence};
      }
      assert(['submitted','working','queued'].includes(state.status),
        'rusty A2A task is failed, cancelled or unknown; manual reconciliation');
      await this.sleep(this.pollMs);
    }
    // Do not hide a paid remote task by pretending it was cancelled.
    throw new Error('rusty A2A exceeds third-seat budget; reconcile existing Task ID before further dispatch');
  }
}

export class OptionalRustyP0 {
  constructor({paseo,third=null}={}){
    assert(paseo&&typeof paseo.review==='function','Paseo primary P0 adapter required');
    this.paseo=paseo;this.third=third;
  }
  async review(args){
    // A disabled rusty seat does not block the two independently attested
    // Paseo machines. If enabled, verify bridge/pinned keys before any work.
    if(this.third)this.third.validate();
    const primary=await this.paseo.review(args);
    if(!this.third)return primary;
    const third=await this.third.review(args);
    const reports=[...primary.reports,third];
    assert(new Set(reports.map(r=>r.physicalId)).size===reports.length,
      'duplicate physical P0 identity across Paseo and A2A');
    return {...primary,reports,transport:'paseo+a2a',
      passed:reports.every(r=>PASS(r.verdict)&&r.findings.length===0),
      dispute:primary.dispute||
        (reports.some(r=>PASS(r.verdict))&&reports.some(r=>r.verdict==='FAIL')),
      findings:reports.flatMap(r=>r.findings)};
  }
}
