import http from 'node:http';
import path from 'node:path';
import {assert,canonical,sha256} from './policy.mjs';

// R8-001: Producer interface only. The independent OS/Paseo observer owns
// the PRIVATE signing key; Controller only sends an ID to request observation.
// The witness MUST independently read Paseo/OS state and original test logs.
// It MUST NOT blindly sign the supplied fields. No HTTP/TCP/cloud fallback.
export class IndependentExecutionAttestor {
  constructor(socketPath=process.env.P1_ATTESTOR_SOCKET) {
    const isWindowsPipe=process.platform==='win32'&&typeof socketPath==='string'&&
      socketPath.startsWith('\\\\.\\pipe\\p1-')&&!socketPath.includes('..');
    const isUnix=process.platform!=='win32'&&typeof socketPath==='string'&&
      path.isAbsolute(socketPath)&&!socketPath.includes('..');
    assert(isWindowsPipe||isUnix,
      'independent execution witness IPC socket is unconfigured or unsafe; BLOCKED');
    this.socketPath=socketPath;
  }
  async #ask(request){
    const data=Buffer.from(JSON.stringify(request)); // JSON wire format omits optional undefined fields
    assert(data.length<65536,'witness request too large');
    return await new Promise((resolve,reject)=>{
      const req=http.request({socketPath:this.socketPath,path:'/v1/observe-and-attest',
        method:'POST',headers:{'content-type':'application/json',
          'content-length':data.length},timeout:15000},res=>{
        let size=0,chunks=[];
        res.on('data',chunk=>{
          size+=chunk.length;
          if(size>256000){req.destroy(new Error('witness response oversized'));return;}
          chunks.push(chunk);
        });
        res.on('end',()=>{
          if(res.statusCode!==200){reject(new Error('independent execution witness refused or unavailable; BLOCKED'));return;}
          try{
            const obj=JSON.parse(Buffer.concat(chunks).toString('utf8'));
            assert(obj?.schema===1&&obj?.statement&&obj?.signature,
              'independent witness returned unsigned response');
            resolve(obj);
          }catch(e){reject(e);}
        });
      });
      req.on('timeout',()=>req.destroy(new Error('independent witness timed out; outcome unknown')));
      req.on('error',reject);
      req.end(data);
    });
  }
  async attestReadiness({task,stateSha256,challenge}){
    assert(task?.id&&task?.frozen?.digest&&
      /^[a-f0-9-]{36}$/i.test(challenge)&&/^[a-f0-9]{64}$/.test(stateSha256),
      'observer capability probe lacks original task/challenge identity');
    // Independent OS observer must verify locally, rather than trusting
    // claims in this request. It may refuse any unsupported capability.
    return this.#ask({schema:1,source:'observer-readiness',
      requiredProtocol:'P1_OBSERVER_READY_V1',taskId:task.id,
      configSha:task.frozen.digest,stateSha256,challenge,
      capabilities:['PASEO_AGENT_ORIGINAL_OUTPUT','OBSERVED_MODEL_HARNESS',
        'FROZEN_SOUL_DIGEST','OS_READONLY_ISOLATION','ORIGINAL_TEST_LOGS'],
      requestedAt:new Date().toISOString()});
  }
  async attestPaseo({task,role,phase,commit,agentId,dispatchId,raw,serverId=null}){
    // The server must cross-check all these against the ACTUAL daemon session
    // and fetch raw result itself before signing. These values alone are untrusted.
    assert(typeof agentId==='string'&&agentId.length>0&&
      typeof dispatchId==='string'&&dispatchId.length>0,'missing Paseo identity');
    return this.#ask({schema:1,source:'paseo-agent',taskId:task.id,
      role,phase,commit:commit??null,serverId,agentId,dispatchId,
      claimedRawSha256:sha256(raw),
      requiredProtocol:'P1_EXECUTION_ATTESTATION_V2',
      expectedModel:task.frozen.roles[role]?.model,
      expectedHarness:task.frozen.roles[role]?.harness,
      expectedSoulSha256:task.frozen.souls[role]?.sha256,
      requestedAt:new Date().toISOString()});
  }
  async attestP0Preflight({node,task,commit}){
    // The independent remote-node witness must inspect the actual checkout
    // via the authorized Paseo host and sign exact HEAD/clean state.
    return this.#ask({schema:1,source:'paseo-p0-workspace',
      taskId:task.id,nodeId:node.id,serverId:node.serverId,
      physicalId:node.physicalId,workspaceId:node.workspaceId,
      cwd:node.cwd,commit,requiredProtocol:'P1_P0_WORKSPACE_PREFLIGHT_V2',
      requiredCapabilities:['INDEPENDENT_SESSION','OS_READONLY_ISOLATION','NATIVE_TASK_IDENTITY'],
      requestedAt:new Date().toISOString()});
  }
  async attestP0Result({node,task,cycle,commit,jobId,agentId,raw,binding}){
    // A trusted per-node signer must independently retrieve this Agent's
    // original Paseo output. The Controller's supplied raw is merely a hint.
    return this.#ask({schema:1,source:'paseo-p0-agent',
      taskId:task.id,cycle,commit,jobId,nodeId:node.id,
      serverId:node.serverId,physicalId:node.physicalId,
      model:node.model,harness:node.harness,agentId,binding,
      requiredProtocol:'P1_P0_NODE_RESULT_V2',
      claimedRawSha256:sha256(raw),requestedAt:new Date().toISOString()});
  }
  async attestP0Termination({node,task,cycle,commit,jobId,agentId}){
    return this.#ask({schema:1,source:'paseo-p0-termination',taskId:task.id,
      cycle,commit,jobId,agentId,nodeId:node.id,physicalId:node.physicalId,
      serverId:node.serverId,workspaceId:node.workspaceId,
      requiredProtocol:'P1_P0_TERMINATION_V1',requestedAt:new Date().toISOString()});
  }
  async attestTests({task,phase,commit,sha,tests,cwd}){
    const {attestation,...bare}=tests;
    assert(sha===commit&&Array.isArray(bare.receipts)&&typeof cwd==='string',
      'invalid local Tester receipts for witness');
    return this.#ask({schema:1,source:'os-tests',taskId:task.id,role:'test_executor',
      phase,commit,agentId:'',dispatchId:'',cwd,
      claimedRawSha256:sha256({sha,tests:bare}),
      receipts:bare.receipts.map(({argv,code,logSha256,ok,logPath})=>
        ({argv,code,logSha256,ok,logPath})),requestedAt:new Date().toISOString()});
  }
}
