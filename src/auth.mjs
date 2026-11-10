import fs from 'node:fs';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {assert,canonical,sha256} from './policy.mjs';

// Trusted public-key manifest is provisioned *outside* the worktree and
// protected by the service account. Controller never loads signing private keys.
// P1_TRUST_ROOTS_SHA256 must be pinned independently of the manifest path.
export function loadTrustRoots(){
  const file=process.env.P1_TRUST_ROOTS_FILE;
  const expected=process.env.P1_TRUST_ROOTS_SHA256;
  if(!file||!/^[0-9a-f]{64}$/.test(expected??''))return null;
  const target=path.resolve(file);
  const bytes=fs.readFileSync(target);
  assert(sha256(bytes.toString('utf8'))===expected,'trust roots manifest digest mismatch');
  const manifest=JSON.parse(bytes.toString('utf8'));
  assert(manifest.schema===1&&manifest.human&&typeof manifest.human==='object',
    'invalid trust roots: approved human keys are required');
  const keys=new Map(),fingerprints=new Set(),ids=new Set();
  const fp=key=>createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
  for(const [id,pem] of Object.entries(manifest.human)){
    assert(/^[a-zA-Z0-9_-]{3,60}$/.test(id),'invalid approval key ID');
    assert(typeof pem==='string','invalid approval public key PEM');
    const pub=createPublicKey(pem);
    assert(pub.asymmetricKeyType==='ed25519','approval key must use Ed25519');
    assert(!ids.has(id)&&!fingerprints.has(fp(pub)),'duplicate human approval key identity or material');
    ids.add(id);fingerprints.add(fp(pub));keys.set(id,pub);
  }
  assert(keys.size>0,'no approved human signing keys');
  const execution=new Map();
  for(const [id,pem] of Object.entries(manifest.execution??{})){
    assert(/^[a-zA-Z0-9_-]{3,60}$/.test(id),'invalid execution issuer ID');
    assert(typeof pem==='string','invalid execution issuer public PEM');
    const pub=createPublicKey(pem);
    assert(pub.asymmetricKeyType==='ed25519','execution issuer key must be Ed25519');
    assert(!ids.has(id)&&!fingerprints.has(fp(pub)),
      'human/execution key overlap forbidden: distinct issuers and private-key custody required');
    ids.add(id);fingerprints.add(fp(pub));execution.set(id,pub);
  }
  const procedure=new Map();
  for(const [id,pem] of Object.entries(manifest.procedure??{})){
    assert(/^[a-zA-Z0-9_-]{3,60}$/.test(id),'invalid independent Gate procedure signer ID');
    const pub=createPublicKey(pem);
    assert(pub.asymmetricKeyType==='ed25519','Gate procedure issuer must be Ed25519');
    assert(!ids.has(id)&&!fingerprints.has(fp(pub)),
      'Gate procedure signing key must be independent of human/execution keys');
    ids.add(id);fingerprints.add(fp(pub));procedure.set(id,pub);
  }
  const p0=new Map();
  for(const [id,pem] of Object.entries(manifest.p0??{})){
    assert(/^[A-Za-z0-9_-]{2,80}$/.test(id),'invalid independent P0 key ID');
    const pub=createPublicKey(pem);
    assert(pub.asymmetricKeyType==='ed25519','P0 witness key must be Ed25519');
    assert(!ids.has(id)&&!fingerprints.has(fp(pub)),
      'human/execution/P0 key overlap forbidden');
    ids.add(id);fingerprints.add(fp(pub));p0.set(id,pub);
  }
  return {digest:expected,keys,execution,p0,procedure};
}

// Procedural Gate proof is signed by an independent process issuer, not the
// Controller, model role, or human approver. It proves the process witness
// approved the exact waiting state, approval basis and evidence set.
export function verifyGateProcess(roots,envelope,{
  taskId,gate,digest,actor,receipt,stateSha256,evidenceRoot
}){
  assert(roots?.procedure?.size>0,
    'independent human-Gate process signer not provisioned; BLOCKED');
  assert(envelope?.schema===1&&typeof envelope.keyId==='string',
    'independent Gate procedure envelope required');
  const key=roots.procedure.get(envelope.keyId);
  assert(key,'unknown independent Gate process signer');
  const st=envelope.statement;
  assert(st?.purpose==='P1_PROCESS_GATE_V1'&&st.taskId===taskId&&
    st.gate===gate&&st.digest===digest&&st.actor===actor&&
    st.receiptSha256===sha256(receipt)&&st.stateSha256===stateSha256&&
    st.evidenceRoot===evidenceRoot&&st.scope==='PROCESS_ONLY'&&
    st.verdict==='COMPLIANT'&&Array.isArray(st.checks)&&
    ['GATE_BASIS','HUMAN_AUTHORITY','PROCESS_EVIDENCE'].every(x=>st.checks.includes(x)),
    'independent Gate procedural witness does not cover exact approved process');
  assert(typeof st.nonce==='string'&&/^[a-f0-9-]{36}$/i.test(st.nonce),
    'independent Gate process nonce missing');
  const issued=Date.parse(st.issuedAt);
  assert(Number.isFinite(issued)&&issued<=Date.now()+120000&&
    issued>=Date.now()-30*60000,'independent Gate process proof expired');
  assert(typeof envelope.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature),
    'invalid Gate process signature encoding');
  const sig=Buffer.from(envelope.signature,'base64');
  assert(sig.length===64&&verify(null,Buffer.from(canonical(st)),key,sig),
    'independent Gate procedure signature invalid');
  return {keyId:envelope.keyId,nonce:st.nonce};
}

export function verifyHumanApproval(roots,envelope,{
  taskId,gate,digest,actor,receipt,evidenceSha256=null,evidenceRoot=null,
  processProofSha256
}){
  assert(roots&&roots.keys.size>0,'authenticated human approval not provisioned; BLOCKED');
  assert(envelope&&envelope.schema===1&&typeof envelope.keyId==='string',
    'human approval signature envelope missing');
  const key=roots.keys.get(envelope.keyId);
  assert(key,'unrecognized human approval signer');
  const s=envelope.statement;
  assert(s&&s.purpose==='P1_HUMAN_GATE_V1'&&s.taskId===taskId&&
    s.gate===gate&&s.digest===digest&&s.actor===actor&&s.receipt===receipt&&
    (processProofSha256===undefined||s.processProofSha256===processProofSha256),
    'human approval signed statement mismatch');
  if(gate==='5.9')
    assert(typeof evidenceSha256==='string'&&/^[0-9a-f]{64}$/.test(evidenceSha256)&&
      s.evidenceSha256===evidenceSha256&&
      typeof evidenceRoot==='string'&&/^[0-9a-f]{64}$/.test(evidenceRoot)&&
      s.evidenceRoot===evidenceRoot,
      'Gate 5.9 signature must bind final compliance evidence SHA-256');
  else assert(s.evidenceSha256===undefined&&s.evidenceRoot===undefined,
    'only final Gate 5.9 can carry compliance evidence binding');
  assert(typeof s.nonce==='string'&&/^[a-f0-9-]{36}$/i.test(s.nonce),
    'human approval nonce missing');
  assert(typeof s.issuedAt==='string','human approval timestamp missing');
  const at=Date.parse(s.issuedAt),now=Date.now();
  assert(Number.isFinite(at)&&at<=now+2*60000&&at>=now-30*60000,
    'human approval signature stale or from the future');
  assert(typeof envelope.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature),
    'invalid Ed25519 approval signature encoding');
  const signature=Buffer.from(envelope.signature,'base64');
  assert(signature.length===64&&verify(null,Buffer.from(canonical(s)),key,signature),
    'invalid independent human approval signature');
  return {keyId:envelope.keyId,nonce:s.nonce,issuedAt:s.issuedAt};
}

// R7: Controller dispatch/ACK rows and locally written artifacts are NOT
// execution provenance. Only an independent signing service with its own
// protected Ed25519 key may attest a verified Paseo/OS execution. This
// module verifies; it intentionally has no private key or signing method.
export const REQUIRED_OBSERVER_CAPABILITIES=Object.freeze([
  'PASEO_AGENT_ORIGINAL_OUTPUT','OBSERVED_MODEL_HARNESS',
  'FROZEN_SOUL_DIGEST','OS_READONLY_ISOLATION','ORIGINAL_TEST_LOGS',
]);
export function verifyObserverReadiness(roots,envelope,expected){
  assert(roots?.execution?.size>0,'no independently pinned OS witness key; BLOCKED');
  assert(envelope?.schema===1&&typeof envelope.keyId==='string',
    'independent OS witness readiness signature required');
  const key=roots.execution.get(envelope.keyId);
  assert(key,'independent observer readiness signer not approved');
  const st=envelope.statement;
  assert(st?.purpose==='P1_OBSERVER_READY_V1'&&
    st.taskId===expected.taskId&&st.configSha===expected.configSha&&
    st.stateSha256===expected.stateSha256&&st.challenge===expected.challenge&&
    st.outcome==='READY'&&
    REQUIRED_OBSERVER_CAPABILITIES.every(c=>st.capabilities?.[c]===true),
    'observer did not independently attest required model/OS/Paseo capabilities');
  const at=Date.parse(st.issuedAt);
  assert(typeof st.nonce==='string'&&/^[a-f0-9-]{36}$/i.test(st.nonce)&&
    /^[a-f0-9-]{36}$/i.test(st.challenge)&&
    Number.isFinite(at)&&at<=Date.now()+120000&&at>=Date.now()-120000,
    'observer readiness expired or missing unique challenge');
  const sig=Buffer.from(envelope.signature??'','base64');
  assert(sig.length===64&&verify(null,Buffer.from(canonical(st)),key,sig),
    'independent observer readiness signature invalid');
  return {issuer:envelope.keyId,challenge:st.challenge};
}
export function verifyExecutionAttestation(roots,envelope,expected,{allowHistorical=false}={}){
  assert(roots?.execution?.size>0,
    'independent execution attestor not provisioned; BLOCKED');
  assert(envelope?.schema===1&&typeof envelope.keyId==='string',
    'independently signed execution attestation required');
  const key=roots.execution.get(envelope.keyId);
  assert(key,'execution issuer is not in independently pinned trust roots');
  const s=envelope.statement;
  const strictRole=typeof expected.model==='string';
  assert(s&&s.purpose===(strictRole?'P1_EXECUTION_ATTESTATION_V2':'P1_EXECUTION_ATTESTATION_V1'),
    'wrong execution attestation purpose');
  if(strictRole)for(const field of ['model','harness','soulSha256'])
    assert(s[field]===expected[field],`independent witness ${field} mismatch`);
  for(const field of ['taskId','role','phase','commit','agentId','dispatchId','rawSha256'])
    assert(s[field]===expected[field],`execution attestation ${field} mismatch`);
  assert(typeof s.rawSha256==='string'&&/^[a-f0-9]{64}$/.test(s.rawSha256),
    'invalid execution raw digest');
  assert(typeof s.nonce==='string'&&/^[a-f0-9-]{36}$/i.test(s.nonce),
    'execution attestation nonce invalid');
  const issued=Date.parse(s.issuedAt);
  assert(Number.isFinite(issued)&&issued<=Date.now()+120000&&
    (allowHistorical||issued>=Date.now()-30*60*1000),
    'execution attestation stale or future issuance time');
  assert(typeof envelope.signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature),
    'execution attestation signature malformed');
  const sig=Buffer.from(envelope.signature,'base64');
  assert(sig.length===64&&verify(null,Buffer.from(canonical(s)),key,sig),
    'execution attestation signature invalid');
  return {issuer:envelope.keyId,nonce:s.nonce};
}
