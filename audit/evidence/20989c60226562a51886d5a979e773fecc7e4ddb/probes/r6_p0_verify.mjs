import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {SshP0Adapter} from '../offline-copy/src/p0.mjs';
import {canonical,sha256} from '../offline-copy/src/policy.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r6-p0-'));
function key(name){const p=path.join(dir,name);fs.writeFileSync(p,Buffer.alloc(32,name.charCodeAt(0)));return p;}
const nodes=[
 {id:'node-a',physicalId:'phys-A',harness:'codex',model:'group/qwen-3.8-flash',hmacKeyPath:key('a.key'),enabled:true,sshAlias:'a',runner:'r.py',config:'a.json'},
 {id:'node-b',physicalId:'phys-B',harness:'opencode',model:'magpie/opencode-zen-free/deepseek-v4.1-flash-free',hmacKeyPath:key('b.key'),enabled:true,sshAlias:'b',runner:'r.py',config:'b.json'},
];
const adapter=new SshP0Adapter(nodes);
const jobId='job-123',commit='d'.repeat(40);
const base={jobId,nodeId:'node-a',commit,physicalId:'phys-A',harness:'codex',model:'group/qwen-3.8-flash',verdict:'PASS',exitCode:0,clean:true,stdoutSha256:'a'.repeat(64),findings:[]};
function env(body,node=nodes[0]){return {body,mac:createHmac('sha256',fs.readFileSync(node.hmacKeyPath)).update(canonical(body)).digest('hex')};}
const results=[];function rec(name,result,detail=''){results.push({name,result,detail});console.log(result,name,detail);}
function reject(name,fn,re){try{fn();rec(name,'NOT_CONFIRMED','accepted');}catch(e){const ok=re.test(e.message);rec(name,ok?'CONFIRMED':'WRONG_ERROR',e.message.slice(0,140));}}
function accept(name,fn){try{fn();rec(name,'CONFIRMED');}catch(e){rec(name,'NOT_CONFIRMED',e.message.slice(0,140));}}
accept('R6-004 P0 valid HMAC/job/commit/physicalId/model passes',()=>{const r=adapter.verify(nodes[0],env(base),jobId,commit);assert.equal(r.verdict,'PASS');});
reject('R6-004 P0 tampered MAC rejected',()=>{const e=env(base);e.mac='a'.repeat(64);adapter.verify(nodes[0],e,jobId,commit);},/invalid node attestation MAC/);
for(const [name,body] of [
 ['wrong jobId',{...base,jobId:'other'}],
 ['wrong commit',{...base,commit:'e'.repeat(40)}],
 ['wrong physicalId',{...base,physicalId:'phys-B'}],
 ['wrong model',{...base,model:'other'}],
 ['wrong harness',{...base,harness:'opencode'}],
 ['exitCode',{...base,exitCode:1}],
 ['dirty worktree',{...base,clean:false}],
 ['missing stdout hash',{...base,stdoutSha256:'bad'}],
 ['PASS with findings',{...base,findings:['BLOCKER: x']}],
 ['APPROVE_WITH_COMMENTS HIGH',{...base,verdict:'APPROVE_WITH_COMMENTS',findings:['HIGH: x']}],
])reject('R6-004 P0 rejects '+name,()=>adapter.verify(nodes[0],env(body),jobId,commit),/P0|invalid|mismatch|remote harness|missing remote/);
accept('R6-004 P0 distinct inventory accepted',()=>adapter.validateInventory());
reject('R6-004 P0 duplicate physicalId rejected',()=>{const bad=[...nodes];bad[1]={...bad[1],physicalId:'phys-A'};new SshP0Adapter(bad).validateInventory();},/duplicate physical/);
reject('R6-004 P0 duplicate key content rejected',()=>{const bad=[...nodes];const k=key('same.key');bad[0]={...bad[0],hmacKeyPath:k};bad[1]={...bad[1],hmacKeyPath:k};new SshP0Adapter(bad).validateInventory();},/duplicate P0 attestation key/);
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r6/logs/probe-r6-p0.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length);
fs.rmSync(dir,{recursive:true,force:true});