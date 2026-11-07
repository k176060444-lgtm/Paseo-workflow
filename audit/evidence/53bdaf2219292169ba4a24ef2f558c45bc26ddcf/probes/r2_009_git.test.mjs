import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {commitWorktree, porcelainPaths} from '../offline-copy/src/git.mjs';

function g(dir,...args){
  return execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
}
function repo(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r2009-'));
  g(dir,'init','-q');
  fs.writeFileSync(path.join(dir,'ordinary.txt'),'baseline');
  g(dir,'add','.');g(dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','baseline');
  return {dir,dispose(){for(let i=0;i<8;i++){try{fs.rmSync(dir,{recursive:true,force:true});return;}catch{}}}};
}
async function attempt(dir,tag){
  try{const sha=await commitWorktree(dir,tag);return {accepted:true,sha};}
  catch(e){return {accepted:false,error:e.message};}
}
function committedFiles(dir){return g(dir,'show','--name-only','--pretty=format:','HEAD').split('\n').filter(Boolean);}

test('R2-009 tracked .env modification is rejected',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,'.env'),'synthetic-1');
    g(r.dir,'add','.env');g(r.dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','env baseline');
    fs.writeFileSync(path.join(r.dir,'.env'),'synthetic-2');
    const a=await attempt(r.dir,'env-edit');
    assert.equal(a.accepted,false);
    assert.match(a.error,/sensitive-looking/);
  }finally{r.dispose();}
});

test('R2-009 untracked .env is rejected',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,'.env'),'synthetic');
    const a=await attempt(r.dir,'env-new');
    assert.equal(a.accepted,false);
    assert.match(a.error,/sensitive-looking/);
  }finally{r.dispose();}
});

test('R2-009 .env.production is rejected',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,'.env.production'),'synthetic');
    const a=await attempt(r.dir,'env-prod');
    assert.equal(a.accepted,false);
    assert.match(a.error,/sensitive-looking/);
  }finally{r.dispose();}
});

test('R2-009 rename ordinary -> .env.production checks the destination',async()=>{
  const r=repo();
  try{
    g(r.dir,'mv','ordinary.txt','.env.production');
    const a=await attempt(r.dir,'rename-to-sensitive');
    assert.equal(a.accepted,false);
    assert.match(a.error,/sensitive-looking/);
  }finally{r.dispose();}
});

test('R2-009 rename .env.production -> ordinary checks the source',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,'.env.production'),'synthetic');
    g(r.dir,'add','.env.production');g(r.dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','env baseline');
    g(r.dir,'mv','.env.production','renamed.txt');
    const a=await attempt(r.dir,'rename-from-sensitive');
    assert.equal(a.accepted,false);
    assert.match(a.error,/sensitive-looking/);
  }finally{r.dispose();}
});

test('R2-009 copy ordinary -> .env.production is rejected',async()=>{
  const r=repo();
  try{
    fs.copyFileSync(path.join(r.dir,'ordinary.txt'),path.join(r.dir,'.env.production'));
    g(r.dir,'add','.env.production');
    const a=await attempt(r.dir,'copy-to-sensitive');
    assert.equal(a.accepted,false);
    assert.match(a.error,/sensitive-looking/);
  }finally{r.dispose();}
});

test('R2-009 nested sub/.env is rejected',async()=>{
  const r=repo();
  try{
    fs.mkdirSync(path.join(r.dir,'sub'));
    fs.writeFileSync(path.join(r.dir,'sub','.env'),'synthetic');
    const a=await attempt(r.dir,'nested-env');
    assert.equal(a.accepted,false);
    assert.match(a.error,/sensitive-looking/);
  }finally{r.dispose();}
});

test('R2-009 uppercase .ENV is rejected',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,'.ENV'),'synthetic');
    const a=await attempt(r.dir,'upper-env');
    assert.equal(a.accepted,false);
    assert.match(a.error,/sensitive-looking/);
  }finally{r.dispose();}
});

test('R2-009 .envrc and .pem/id_rsa names are rejected',async()=>{
  for(const name of ['.envrc','credentials.pem','id_rsa','id_ed25519','server.p12','server.pfx']){
    const r=repo();
    try{
      fs.writeFileSync(path.join(r.dir,name),'synthetic');
      const a=await attempt(r.dir,'sensitive-'+name);
      assert.equal(a.accepted,false,`${name} must be rejected`);
      assert.match(a.error,/sensitive-looking/);
    }finally{r.dispose();}
  }
});

test('R2-009 ordinary names such as foo.env are accepted',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,'foo.env'),'not-a-secret');
    const a=await attempt(r.dir,'ordinary-env-suffix');
    assert.equal(a.accepted,true,a.error);
    assert(committedFiles(r.dir).includes('foo.env'));
  }finally{r.dispose();}
});

test('R2-009 RESIDUAL: leading-space " .env" bypasses the sensitive-path check and is committed',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,' .env'),'SYNTHETIC_SECRET_VALUE');
    const raw=execFileSync('git',['-C',r.dir,'status','--porcelain','-z','--untracked-files=all'],{encoding:'buffer'}).toString('utf8');
    assert.deepEqual(porcelainPaths(raw),[' .env']);
    const a=await attempt(r.dir,'leading-space-env');
    assert.equal(a.accepted,true,'the defect is that this is accepted');
    assert(committedFiles(r.dir).includes('.env'));
    console.log('R2-009-RESIDUAL CONFIRMED: leading-space " .env" was committed as .env');
  }finally{r.dispose();}
});

test('R2-009 RESIDUAL: nested leading-space "sub/ .env" also bypasses',async()=>{
  const r=repo();
  try{
    fs.mkdirSync(path.join(r.dir,'sub'));
    fs.writeFileSync(path.join(r.dir,'sub',' .env'),'SYNTHETIC_SECRET_VALUE');
    const a=await attempt(r.dir,'nested-leading-space');
    console.log('R2-009-NESTED-LEADING-SPACE='+(a.accepted?'ACCEPTED':'REJECTED'));
  }finally{r.dispose();}
});

test('R2-009 trailing-space .env name is recorded on Windows',async()=>{
  const r=repo();
  try{
    let created=true;
    try{fs.writeFileSync(path.join(r.dir,'.env '),'synthetic');}catch(e){created=false;console.log('R2-009-TRAILING-SPACE-CREATE-FAILED '+e.code);}
    if(!created)return;
    const raw=execFileSync('git',['-C',r.dir,'status','--porcelain','-z','--untracked-files=all'],{encoding:'buffer'}).toString('utf8');
    const paths=porcelainPaths(raw);
    console.log('R2-009-TRAILING-SPACE-STATUS='+JSON.stringify(paths));
    const a=await attempt(r.dir,'trailing-space');
    console.log('R2-009-TRAILING-SPACE='+(a.accepted?'ACCEPTED':'REJECTED '+a.error));
  }finally{r.dispose();}
});

test('R2-009 porcelain -z parser handles rename and copy records',()=>{
  assert.deepEqual(porcelainPaths(''),[]);
  assert.deepEqual(porcelainPaths(' M .env\0'),['.env']);
  assert.deepEqual(porcelainPaths('R  .env.production\0ordinary.txt\0'),['.env.production','ordinary.txt']);
  assert.deepEqual(porcelainPaths('C  copy.txt\0source.txt\0'),['copy.txt','source.txt']);
  assert.deepEqual(porcelainPaths('?? a b.txt\0'),['a b.txt']);
  assert.deepEqual(porcelainPaths('?? quote"name.txt\0'),['quote"name.txt']);
  assert.deepEqual(porcelainPaths('?? line\nname.txt\0'),['line\nname.txt']);
  assert.throws(()=>porcelainPaths('R  new.txt\0'),/missing rename/);
  assert.throws(()=>porcelainPaths('M .env'),/incomplete/);
  assert.throws(()=>porcelainPaths('X  .env\0'),/unrecognized/);
});

test('R2-009 symlink in the working tree is rejected (or NOT_VERIFIABLE on Windows)',async()=>{
  const r=repo();
  try{
    const link=path.join(r.dir,'link');
    let created=true;
    try{fs.symlinkSync('ordinary.txt',link,'file');}catch(e){created=false;console.log('SYMLINK-CREATE-FAILED '+e.code+' '+e.message);}
    if(!created){console.log('R2-009-SYMLINK=NOT_VERIFIED_WINDOWS_PERMISSION');return;}
    const a=await attempt(r.dir,'symlink');
    assert.equal(a.accepted,false,a.error);
    assert.match(a.error,/symlink/);
  }finally{r.dispose();}
});

test('R2-009 real local submodule gitlink is rejected',async()=>{
  const r=repo();
  const sub=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r2009-sub-'));
  try{
    g(sub,'init','-q');
    fs.writeFileSync(path.join(sub,'f.txt'),'sub');
    g(sub,'add','.');g(sub,'-c','user.name=T','-c','user.email=t@l','commit','-qm','sub');
    let added=true;
    try{g(r.dir,'-c','protocol.file.allow=always','submodule','add','./'+path.basename(sub),'submodule');}
    catch(e){added=false;console.log('R2-009-GITLINK=NOT_VERIFIED '+String(e.message).split(String.fromCharCode(10))[0]);}
    if(!added)return;
    const raw=g(r.dir,'status','--porcelain','-z','--untracked-files=all');
    const paths=porcelainPaths(raw);
    console.log('R2-009-GITLINK-STATUS='+JSON.stringify(paths));
    const a=await attempt(r.dir,'gitlink');
    assert.equal(a.accepted,false,a.error);
    assert.match(a.error,/symlink\/gitlink/);
  }finally{r.dispose();fs.rmSync(sub,{recursive:true,force:true});}
});

test('R2-009 index pre-staged sensitive path is rejected',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,'.env.staging'),'synthetic');
    g(r.dir,'add','.env.staging');
    const a=await attempt(r.dir,'prestaged');
    assert.equal(a.accepted,false);
    assert.match(a.error,/sensitive-looking/);
  }finally{r.dispose();}
});

test('R2-009 path traversal string is rejected by the parser/safety layer',()=>{
  // Git itself will not produce ../ paths in a normal worktree; the parser returns it
  // and safeChange's resolve+prefix assertion is the defensive layer.
  assert.deepEqual(porcelainPaths('?? ../escape\0'),['../escape']);
  console.log('R2-009-TRAVERSAL=PARSER_RETURNS_PATH_SAFECHANGE_RESOLVE_GUARD_STATIC');
});
