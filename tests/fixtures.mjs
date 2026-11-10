// TEST ONLY: construct adversarial persisted states without relaxing production
// Store.init(). This module is imported exclusively by offline test files.
// It intentionally rewrites SQLite rows/events; NEVER ship it as runtime code.
import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {canonical,sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../src/policy.mjs';

export function resealSyntheticState(store,state) {
  const id=state.id;
  const event=store.db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id);
  if(!event)throw Error('test fixture must first initialize an honest task');
  if(store.db.prepare('SELECT COUNT(*) AS n FROM events WHERE task_id=?').get(id).n!==1)
    throw Error('synthetic test reseal only permitted on single-creation-event fixtures');
  const prior=JSON.parse(event.payload);
  const body=canonical({...prior,_state_sha256:sha256(state)});
  const digest=sha256({id,type:event.type,body,previous:event.previous,at:event.at});
  store.db.exec('BEGIN IMMEDIATE');
  try{
    store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(canonical(state),id);
    store.db.prepare('UPDATE events SET payload=?,digest=? WHERE seq=?').run(body,digest,event.seq);
    store.db.exec('COMMIT');
  }catch(e){store.db.exec('ROLLBACK');throw e;}
  store.verify(id);
}
export function seedSyntheticTask(store,task) {
  const id=task.id;
  const frozen={...(task.frozen??{})};
  if(!frozen.schema)frozen.schema=1;
  if(!frozen.intent)frozen.intent='Synthetic fixture only; not a real work order.';
  frozen.policy={maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS};
  delete frozen.digest;
  frozen.digest=sha256(frozen);
  const boot={...task,id,frozen,trustRootSha256:store.trustRootDigest(),stage:'WAIT_GATE_01',status:'WAITING_HUMAN',
    aRound:0,bRound:0,taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,
    lastA:null,lastB:null,p0Initial:null,p0Final:null,history:[],inflight:null,
    pendingHuman:null,bFindings:[],changesInB:false};
  store.init(boot);
  const desired={...boot,...task,frozen};
  resealSyntheticState(store,desired);
  return desired;
}

export function syntheticHumanAuthority(dir,taskId) {
  const oldFile=process.env.P1_TRUST_ROOTS_FILE;
  const oldHash=process.env.P1_TRUST_ROOTS_SHA256;
  const pair=generateKeyPairSync('ed25519');
  const witness=generateKeyPairSync('ed25519');
  const procedure=generateKeyPairSync('ed25519');
  const file=path.join(dir,'synthetic-human-public.json');
  fs.writeFileSync(file,JSON.stringify({schema:1,human:{
    'synthetic-operator':pair.publicKey.export({format:'pem',type:'spki'})},
    execution:{'synthetic-witness':witness.publicKey.export({format:'pem',type:'spki'})},
    procedure:{'synthetic-process':procedure.publicKey.export({format:'pem',type:'spki'})}}));
  process.env.P1_TRUST_ROOTS_FILE=file;
  process.env.P1_TRUST_ROOTS_SHA256=sha256(fs.readFileSync(file,'utf8'));
  return {
    attest(role,phase,commit,agentId,dispatchId,bare,taskIdOverride=taskId){
      const statement={purpose:'P1_EXECUTION_ATTESTATION_V1',taskId:taskIdOverride,
        role,phase,commit,agentId,dispatchId,rawSha256:sha256(bare),
        nonce:randomUUID(),issuedAt:new Date().toISOString()};
      return {schema:1,keyId:'synthetic-witness',statement,
        signature:sign(null,Buffer.from(canonical(statement)),witness.privateKey).toString('base64')};
    },
    proof(gate,digest,actor,receipt,store=null){
      const isGate=['0.1','0.2','5.9'].includes(gate);
      assert(!isGate||store,'synthetic Gate process proof requires exact store snapshot');
      const pStatement=isGate?{purpose:'P1_PROCESS_GATE_V1',taskId,gate,digest,actor,
        receiptSha256:sha256(receipt),stateSha256:sha256(store.get(taskId)),
        evidenceRoot:store.evidenceRoot(taskId),scope:'PROCESS_ONLY',verdict:'COMPLIANT',
        checks:['GATE_BASIS','HUMAN_AUTHORITY','PROCESS_EVIDENCE'],
        nonce:randomUUID(),issuedAt:new Date().toISOString()}:null;
      const processProof=pStatement?{schema:1,keyId:'synthetic-process',
        statement:pStatement,signature:sign(null,Buffer.from(canonical(pStatement)),
          procedure.privateKey).toString('base64')}:null;
      const statement={purpose:'P1_HUMAN_GATE_V1',taskId,gate,digest,actor,
        receipt,...(processProof?{processProofSha256:sha256(processProof)}:{}),
        nonce:randomUUID(),issuedAt:new Date().toISOString()};
      return {schema:1,keyId:'synthetic-operator',statement,
        signature:sign(null,Buffer.from(canonical(statement)),pair.privateKey).toString('base64'),
        ...(processProof?{processProof}:{})};
    },
    restore(){
      if(oldFile===undefined)delete process.env.P1_TRUST_ROOTS_FILE;
      else process.env.P1_TRUST_ROOTS_FILE=oldFile;
      if(oldHash===undefined)delete process.env.P1_TRUST_ROOTS_SHA256;
      else process.env.P1_TRUST_ROOTS_SHA256=oldHash;
    }
  };
}
