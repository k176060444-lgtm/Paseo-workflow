import fs from 'node:fs';
import path from 'node:path';
import {createPublicKey,verify} from 'node:crypto';
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
  const keys=new Map();
  for(const [id,pem] of Object.entries(manifest.human)){
    assert(/^[a-zA-Z0-9_-]{3,60}$/.test(id),'invalid approval key ID');
    assert(typeof pem==='string','invalid approval public key PEM');
    const pub=createPublicKey(pem);
    assert(pub.asymmetricKeyType==='ed25519','approval key must use Ed25519');
    keys.set(id,pub);
  }
  assert(keys.size>0,'no approved human signing keys');
  return {digest:expected,keys};
}

export function verifyHumanApproval(roots,envelope,{taskId,gate,digest,actor,receipt,evidenceSha256=null}){
  assert(roots&&roots.keys.size>0,'authenticated human approval not provisioned; BLOCKED');
  assert(envelope&&envelope.schema===1&&typeof envelope.keyId==='string',
    'human approval signature envelope missing');
  const key=roots.keys.get(envelope.keyId);
  assert(key,'unrecognized human approval signer');
  const s=envelope.statement;
  assert(s&&s.purpose==='P1_HUMAN_GATE_V1'&&s.taskId===taskId&&
    s.gate===gate&&s.digest===digest&&s.actor===actor&&s.receipt===receipt,
    'human approval signed statement mismatch');
  if(gate==='5.9')
    assert(typeof evidenceSha256==='string'&&/^[0-9a-f]{64}$/.test(evidenceSha256)&&
      s.evidenceSha256===evidenceSha256,
      'Gate 5.9 signature must bind final compliance evidence SHA-256');
  else assert(s.evidenceSha256===undefined,
    'only final Gate 5.9 can carry compliance artifact binding');
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
