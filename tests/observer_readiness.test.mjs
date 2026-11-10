import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {verifyObserverReadiness,REQUIRED_OBSERVER_CAPABILITIES} from '../src/auth.mjs';
import {WorkflowController} from '../src/controller.mjs';
import {canonical,sha256,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../src/policy.mjs';

test('observer readiness requires an independent signed OS/Paseo capability statement for the exact fresh challenge',()=>{
 const pair=generateKeyPairSync('ed25519');
 const roots={execution:new Map([['independent-observer',pair.publicKey]])};
 const expected={taskId:'TASKOBS1',configSha:'a'.repeat(64),
   stateSha256:'b'.repeat(64),challenge:randomUUID()};
 const signed=changes=>{
   const statement={purpose:'P1_OBSERVER_READY_V1',...expected,outcome:'READY',
     capabilities:Object.fromEntries(REQUIRED_OBSERVER_CAPABILITIES.map(c=>[c,true])),
     nonce:randomUUID(),issuedAt:new Date().toISOString(),...changes};
   return {schema:1,keyId:'independent-observer',statement,
     signature:sign(null,Buffer.from(canonical(statement)),pair.privateKey).toString('base64')};
 };
 assert.equal(verifyObserverReadiness(roots,signed({}),expected).issuer,'independent-observer');
 assert.throws(()=>verifyObserverReadiness(roots,signed({challenge:randomUUID()}),expected),
   /observer did not independently attest/);
 assert.throws(()=>verifyObserverReadiness(roots,signed({outcome:'UNKNOWN'}),expected),
   /observer did not independently attest/);
 assert.throws(()=>verifyObserverReadiness(roots,signed({
   capabilities:{PASEO_AGENT_ORIGINAL_OUTPUT:true}}),expected),
   /observer did not independently attest/);
 assert.throws(()=>verifyObserverReadiness(roots,signed({
   issuedAt:new Date(Date.now()-3600000).toISOString()}),expected),
   /observer readiness expired/);
 const tampered=signed({});
 tampered.statement.capabilities.OS_READONLY_ISOLATION=false;
 assert.throws(()=>verifyObserverReadiness(roots,tampered,expected),
   /observer did not independently attest/);
 const forged=signed({});
 forged.statement.capabilities.OTHER_ASSERTION=true;
 assert.throws(()=>verifyObserverReadiness(roots,forged,expected),
   /observer readiness signature invalid/);
 assert.throws(()=>verifyObserverReadiness({execution:new Map()},signed({}),expected),
   /observer readiness signer not approved|independently pinned OS witness/);
});

test('paid Paseo path stops before any model when independent OS witness readiness is unavailable',async()=>{
 const frozen={schema:1,intent:'Synthetic approved user goal',
   policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS},
   p0:{transport:'paseo'},roles:{},souls:{},tests:{gateB:{
     smoke:[['node','--test']],canary:[['node','--test']],
     regression:[['node','--test']]}}};
 frozen.digest=sha256(frozen);
 const task={id:'TASKOBS2',frozen,trustRootSha256:'a'.repeat(64),
   stage:'PLANNER',aRound:0,bRound:0,taskSpec:null,taskSpecSha:null};
 let paid=0;
 const store={verify(){},trustRootDigest:()=>task.trustRootSha256,
   p0TrustRoots:()=>new Map([['5bao','a'],['9bao','b']]),
   verifyObserverReadiness:()=>{throw new Error('real observer signature absent');}};
 const previous={live:process.env.P1_LIVE_ALLOWED,isolated:process.env.P1_HOST_ISOLATION_ATTESTED};
 process.env.P1_LIVE_ALLOWED='YES';process.env.P1_HOST_ISOLATION_ATTESTED='YES';
 try{
   const controller=new WorkflowController({store,
     runtime:{client:{},execute:async()=>{paid++;throw Error('should not execute');}},
     p0:{validateInventory(){}},
     attestor:{attestReadiness:async()=>({schema:1,signature:'unauthenticated'})}});
   await assert.rejects(()=>controller.livePreflight(task),/real observer signature absent/);
   assert.equal(paid,0);
   controller.attestor={};
   await assert.rejects(()=>controller.livePreflight(task),
     /independent OS\/Paseo observer V1 capability preflight unavailable/);
   assert.equal(paid,0);
 }finally{
   if(previous.live===undefined)delete process.env.P1_LIVE_ALLOWED;else process.env.P1_LIVE_ALLOWED=previous.live;
   if(previous.isolated===undefined)delete process.env.P1_HOST_ISOLATION_ATTESTED;
   else process.env.P1_HOST_ISOLATION_ATTESTED=previous.isolated;
 }
});
