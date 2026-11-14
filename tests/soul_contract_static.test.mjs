import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {freezeConfig} from '../src/policy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(path.join(root,'souls/SOUL_MANIFEST.json'),'utf8'));
const matrix=JSON.parse(readFileSync(path.join(root,'config/role-matrix.example.json'),'utf8'));
const sha=t=>createHash('sha256').update(t).digest('hex');
const locals=['planner','worker','spec_reviewer','quality_reviewer','tester_gate_a','worker_remediation','tester_gate_b','arbitrator','pro_audit'];
const blind=['blind_a','blind_b','blind_c'];
test('12 Soul inventory and exact sha, versions, matrix paths',()=>{
 assert.equal(manifest.roles.length,12);assert.deepEqual(Object.keys(matrix.roles).sort(),[...locals,...blind].sort());
 for(const r of manifest.roles){const c=readFileSync(path.join(root,r.path),'utf8');assert(c.trim().length>100);assert.equal(r.path,'souls/'+r.role_id+'.md');assert.equal(sha(c),r.sha256);assert.equal(r.version,c.match(/(?:Soul-)?Version:\s*(\S+)/)[1]);assert.equal(path.resolve(root,'config',matrix.roles[r.role_id].soul),path.join(root,r.path));}
});
test('12 final machine JSON statements and transport, arbitration, Pro-Audit boundaries',()=>{
 for(const r of manifest.roles){const c=readFileSync(path.join(root,r.path),'utf8');for(const term of ['"verdict"','"summary"','"findings"'])assert(c.includes(term),r.role_id+': missing '+term);}
 for(const n of ['blind_a','blind_b']){const c=readFileSync(path.join(root,'souls',n+'.md'),'utf8');assert(c.includes('Paseo 原生 SDK'));assert(c.includes('不是 A2A'));}
 const c=readFileSync(path.join(root,'souls/blind_c.md'),'utf8');assert(c.includes('Hermes 原生 A2A')&&c.includes('可选第三席'));
 const arb=readFileSync(path.join(root,'souls/arbitrator.md'),'utf8');assert(arb.includes('实质技术争议')&&!arb.includes('无争议也不得跳过'));
 const audit=readFileSync(path.join(root,'souls/pro_audit.md'),'utf8');assert(audit.includes('PRE / POST')&&audit.includes('OPTIONAL TELEMETRY')&&audit.includes('不对代码质量或技术正确性作裁决'));
});
test('freezeConfig snapshots bytes/sha for new task and does not alter prior frozen version',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'paseo-soul-offline-'));try{const cfgdir=path.join(dir,'config'),souldir=path.join(dir,'souls');mkdirSync(cfgdir);mkdirSync(souldir);const cfg=structuredClone(matrix);cfg.project.repo=dir;for(const [n,item] of Object.entries(cfg.roles)){writeFileSync(path.join(souldir,n+'.md'),readFileSync(path.join(root,'souls',n+'.md')));item.soul='../souls/'+n+'.md';}
 const cfgpath=path.join(cfgdir,'role-matrix.json'),intent=path.join(dir,'intent.md');writeFileSync(cfgpath,JSON.stringify(cfg));writeFileSync(intent,'This is a static test task only; no model and no real pipeline run.');
 const older=freezeConfig(cfgpath,intent),original=older.souls.worker.text;assert.equal(older.souls.worker.sha256,sha(original));writeFileSync(path.join(souldir,'worker.md'),original+'\n# future edit');const newer=freezeConfig(cfgpath,intent);assert.notEqual(older.souls.worker.sha256,newer.souls.worker.sha256);assert.equal(older.souls.worker.text,original);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('hard runtime interface gaps are explicit; not falsely certified',()=>{
 const ctl=readFileSync(path.join(root,'src/controller.mjs'),'utf8'),store=readFileSync(path.join(root,'src/store.mjs'),'utf8'),gaps=readFileSync(path.join(root,'docs/SOUL_CONTRACT_GAPS.md'),'utf8');assert(ctl.includes('MANDATORY FINAL TECHNICAL ACCEPTANCE'));assert(store.includes('finalArbitration'));assert(gaps.includes('GAP-ARB-01')&&gaps.includes('GAP-P0-C-01'));assert.equal(matrix.p0.nodes.find(n=>n.id==='rusty').eligibility.status,'P0_INELIGIBLE');
});
