#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {sha256,assert} from './policy.mjs';
import {Store} from './store.mjs';
import {WorkflowController} from './controller.mjs';
import {PaseoAgentRuntime} from './agents.mjs';
import {IndependentExecutionAttestor} from './attestor.mjs';
import {PaseoP0Adapter} from './p0_paseo.mjs';


function argsOf(argv){
  const a={_:[]};
  for(let i=0;i<argv.length;i++) {
    const v=argv[i];
    if(!v.startsWith('--'))a._.push(v);
    else {const k=v.slice(2);if(!/^[a-z][a-z0-9-]*$/.test(k)||i+1>=argv.length)throw new Error(`invalid option ${v}`);a[k]=argv[++i];}
  }
  return a;
}
function need(a,name){if(!a[name])throw new Error(`required --${name}`);return a[name];}
function receipt(a){return fs.readFileSync(need(a,'receipt'),'utf8');}
function approvalProof(a){return JSON.parse(fs.readFileSync(need(a,'approval-proof'),'utf8'));}
function processProof(a){return JSON.parse(fs.readFileSync(need(a,'process-proof'),'utf8'));}
const usage=`P1 Paseo workflow controller (no deployments, no automatic real calls)
Commands:
  init --id TASK1234 --matrix config/role-matrix.json --intent path/to/intent.md
  status --id TASK1234
  verify --id TASK1234
  p0-reconcile --id TASK1234 --cycle initial-A1|final-B1  # READ ONLY, historical original commit
  agent-reconcile --id TASK1234        # READ ONLY, local original dispatch labels
  approve --id TASK1234 --gate 0.1|0.2|5.9 --digest SHA --actor NAME --receipt FILE --approval-proof SIGNED_JSON --process-proof SEPARATELY_SIGNED_JSON
  run --id TASK1234                   # requires explicit safety environment and installed Paseo
  incident-close --id TASK1234 --actor NAME --receipt FILE --process-proof SIGNED_PROCESS_JSON --approval-proof SIGNED_INCIDENT --sha EXACT_COMMIT  # only fully attested original tasks
  recover --id TASK1234 --actor NAME --receipt FILE --approval-proof SIGNED_JSON --sha EXACT_COMMIT
  recover --id TASK1234 --actor NAME --receipt FILE --approval-proof SIGNED_JSON --basis FROZEN_SPEC_OR_CONFIG_SHA  # pre-commit only
State root: --state /secure/state (default .p1-state)
Environment required for run: P1_LIVE_ALLOWED=YES and P1_HOST_ISOLATION_ATTESTED=YES
Signed human gates require P1_TRUST_ROOTS_FILE plus independently pinned P1_TRUST_ROOTS_SHA256, a distinct procedure signer and a human countersignature of the procedure SHA.
Never store human private signing keys in the Controller state or Paseo profile.
Never run live until local independent review and node-specific test have passed.`;

function assertPaseoMode(task){
  if(task.frozen.p0?.transport!=='paseo')
    throw new Error('P0 must use native authenticated Paseo; SSH prohibited');
}
async function main(){
  const a=argsOf(process.argv.slice(2));const cmd=a._[0];
  if(!cmd||cmd==='help'){console.log(usage);return;}
  const root=path.resolve(a.state??'.p1-state');
  const store=new Store(root,{readOnly:['status','verify','p0-reconcile','agent-reconcile'].includes(cmd)});
  let runtime=null;
  try{
    const controller=new WorkflowController({store,runtime:null,p0:null});
    let result;
    if(cmd==='init')result=controller.create({id:need(a,'id'),configFile:need(a,'matrix'),intentFile:need(a,'intent')});
    else if(cmd==='status'||cmd==='verify')result=controller.inspect(need(a,'id'));
    else if(cmd==='agent-reconcile'){
      const task=controller.required(need(a,'id'));
      store.verify(task.id);
      runtime=new PaseoAgentRuntime(task.frozen.runtime.paseoUrl);
      await runtime.open(); // only connects and lists; no role execution
      result=await runtime.reconcileRecordedDispatches(task,store.dispatches(task.id));
    }
    else if(cmd==='p0-reconcile'){
      const task=controller.required(need(a,'id')),cycle=need(a,'cycle');
      assert(/^(?:initial-A|final-B)[1-9][0-9]*$/.test(cycle),
        'reconciliation requires exact original P0 cycle');
      assertPaseoMode(task);
      store.verify(task.id);
      // The active task may already have moved to another Git commit. Always
      // reconcile the *original* cycle's immutable request, not currentSha.
      const committed=new Map();
      for(const node of task.frozen.p0.nodes??[]){
        const name='p0-'+cycle+'-'+node.id+'-request.json';
        let request;
        try{
          const sha=store.evidenceDigest(task.id,name);
          request=JSON.parse(store.readEvidenceByDigest(task.id,sha).content);
        }catch(e){
          if(e.message!=='requested registered evidence digest unavailable')
            throw e;
          continue;
        }
        assert(request?.taskId===task.id&&request.cycle===cycle&&
          request.nodeId===node.id&&request.serverId===node.serverId&&
          /^[a-f0-9]{40}$/.test(request.commit??''),
          'P0 immutable request does not match approved node or cycle');
        committed.set(node.id,request);
      }
      assert(committed.size>0,'no original P0 request found for this cycle');
      const adapter=new PaseoP0Adapter(task.frozen.p0.nodes??[],{});
      const observations=[];
      for(const node of adapter.inventory){
        const original=committed.get(node.id);
        if(!original){
          observations.push({nodeId:node.id,serverId:node.serverId,
            state:'NO_REGISTERED_REQUEST',agentId:null});
          continue;
        }
        const commit=original.commit;
        const jobId=sha256(task.id+':'+cycle+':'+commit+':'+node.id).slice(0,40);
        assert(jobId===original.jobId,'original P0 job ID mismatches immutable request');
        const known=store.dispatches(task.id).find(d=>d.id===jobId&&
          d.phase==='P0:'+cycle+':'+node.id);
        if(!known){
          observations.push({nodeId:node.id,serverId:node.serverId,
            state:'NOT_DISPATCHED',agentId:null});
          continue;
        }
        // Read-only remote SDK enumeration: NEVER creates, cancels, archives or
        // marks a dispatch terminal, and never claims reconciliation is approved.
        if(!node.paseoUrl){
          observations.push({nodeId:node.id,serverId:node.serverId,
            originalCommit:commit,state:'LEGACY_CONNECTED_HOSTS_MANUAL_RECONCILIATION',
            agentId:known.agent_id??null,manualReconciliationRequired:true});
          continue;
        }
        const agents=await adapter.reconcileByLabels(node,{
          taskId:task.id,cycle,jobId,commit});
        assert(agents.length<=1,'duplicate remote Agents with same P0 job label; BLOCKED');
        observations.push({nodeId:node.id,serverId:node.serverId,
          originalCommit:commit,state:known.state,agentId:known.agent_id,
          remoteMatches:agents.map(agent=>({id:agent.id,status:agent.status})),
          consistent:known.agent_id===null?agents.length===0:
            agents.length===1&&known.agent_id===node.serverId+':'+agents[0].id});
      }
      result={taskId:task.id,cycle,mode:'READ_ONLY_NO_MUTATION',
        observations,manualReconciliationRequired:true};
    }
    else if(cmd==='approve')result=await store.withLock(need(a,'id'),()=>controller.approve({id:need(a,'id'),gate:need(a,'gate'),digest:need(a,'digest'),actor:need(a,'actor'),receipt:receipt(a),proof:approvalProof(a),processProof:processProof(a)}));
    else if(cmd==='incident-close')result=await store.withLock(need(a,'id'),()=>controller.certifyIncident({id:need(a,'id'),actor:need(a,'actor'),receipt:receipt(a),expectedSha:a.sha??null,expectedBasis:a.basis??null,proof:approvalProof(a),processProof:processProof(a)}));
    else if(cmd==='recover')result=await store.withLock(need(a,'id'),()=>controller.authorizeRecovery({id:need(a,'id'),actor:need(a,'actor'),receipt:receipt(a),expectedSha:a.sha??null,expectedBasis:a.basis??null,proof:approvalProof(a)}));
    else if(cmd==='run'){
      const task=controller.required(need(a,'id'));
      if(process.env.P1_LIVE_ALLOWED==='YES'&&process.env.P1_HOST_ISOLATION_ATTESTED==='YES'){
        const witness=new IndependentExecutionAttestor();
        runtime=new PaseoAgentRuntime(task.frozen.runtime.paseoUrl,{attestor:witness});
        await runtime.open();
        controller.attestor=witness;
        assertPaseoMode(task);
        controller.p0=new PaseoP0Adapter(task.frozen.p0.nodes??[],{
          client:runtime.client,attestor:witness,p0Roots:store.p0TrustRoots(),
          ...(task.frozen.p0.timing??{})});
      }
      controller.runtime=runtime;
      result=await controller.run(task.id);
    }else throw new Error(`unknown command ${cmd}`);
    console.log(JSON.stringify(result,null,2));
  }finally{if(runtime)await runtime.close();store.close();}
}
main().catch(e=>{console.error(`[P1 BLOCKED] ${e.message}`);process.exitCode=1;});
