#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {Store} from './store.mjs';
import {WorkflowController} from './controller.mjs';
import {PaseoAgentRuntime} from './agents.mjs';
import {SshP0Adapter} from './p0.mjs';

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
const usage=`P1 Paseo workflow controller (no deployments, no automatic real calls)
Commands:
  init --id TASK1234 --matrix config/role-matrix.json --intent path/to/intent.md
  status --id TASK1234
  verify --id TASK1234
  approve --id TASK1234 --gate 0.1|0.2|5.9 --digest SHA --actor NAME --receipt FILE --approval-proof SIGNED_JSON
  run --id TASK1234                   # requires explicit safety environment and installed Paseo
  recover --id TASK1234 --actor NAME --receipt FILE --sha EXACT_COMMIT
  recover --id TASK1234 --actor NAME --receipt FILE --basis FROZEN_SPEC_OR_CONFIG_SHA  # pre-commit only
State root: --state /secure/state (default .p1-state)
Environment required for run: P1_LIVE_ALLOWED=YES and P1_HOST_ISOLATION_ATTESTED=YES
Signed human gates require P1_TRUST_ROOTS_FILE plus independently pinned P1_TRUST_ROOTS_SHA256.
Never store human private signing keys in the Controller state or Paseo profile.
Never run live until local independent review and node-specific test have passed.`;

async function main(){
  const a=argsOf(process.argv.slice(2));const cmd=a._[0];
  if(!cmd||cmd==='help'){console.log(usage);return;}
  const root=path.resolve(a.state??'.p1-state');
  const store=new Store(root,{readOnly:cmd==='status'||cmd==='verify'});
  let runtime=null;
  try{
    const controller=new WorkflowController({store,runtime:null,p0:null});
    let result;
    if(cmd==='init')result=controller.create({id:need(a,'id'),configFile:need(a,'matrix'),intentFile:need(a,'intent')});
    else if(cmd==='status'||cmd==='verify')result=controller.inspect(need(a,'id'));
    else if(cmd==='approve')result=await store.withLock(need(a,'id'),()=>controller.approve({id:need(a,'id'),gate:need(a,'gate'),digest:need(a,'digest'),actor:need(a,'actor'),receipt:receipt(a),proof:approvalProof(a)}));
    else if(cmd==='recover')result=await store.withLock(need(a,'id'),()=>controller.authorizeRecovery({id:need(a,'id'),actor:need(a,'actor'),receipt:receipt(a),expectedSha:a.sha??null,expectedBasis:a.basis??null}));
    else if(cmd==='run'){
      const task=controller.required(need(a,'id'));
      if(process.env.P1_LIVE_ALLOWED==='YES'&&process.env.P1_HOST_ISOLATION_ATTESTED==='YES') {
        runtime=new PaseoAgentRuntime(task.frozen.runtime.paseoUrl);
        await runtime.open();
      }
      controller.runtime=runtime;
      controller.p0=new SshP0Adapter(task.frozen.p0.nodes??[],task.frozen.p0.timing??{});
      result=await controller.run(task.id);
    }else throw new Error(`unknown command ${cmd}`);
    console.log(JSON.stringify(result,null,2));
  }finally{if(runtime)await runtime.close();store.close();}
}
main().catch(e=>{console.error(`[P1 BLOCKED] ${e.message}`);process.exitCode=1;});
