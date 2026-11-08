import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {commitWorktree, porcelainPaths} from '../offline-copy/src/git.mjs';

function git(dir,...args){
  return execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
}
function repo(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r3path-'));
  git(dir,'init','-q');
  fs.writeFileSync(path.join(dir,'normal.txt'),'synthetic baseline');
  git(dir,'add','.');git(dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','baseline');
  return {dir,dispose(){for(let i=0;i<8;i++){try{fs.rmSync(dir,{recursive:true,force:true});return;}catch{}}}};
}
async function attempt(dir,tag){
  try{const sha=await commitWorktree(dir,tag);return {accepted:true,sha};}
  catch(e){return {accepted:false,error:e.message};}
}
function committed(dir){return git(dir,'show','--name-only','--pretty=format:','HEAD').split('\n').filter(Boolean);}

const REJECT=[
  '.env','.ENV','.env.production','.env.local','.env.example',
  'sub/.env','sub\\.env','.ssh/id_rsa','.aws/credentials',
  'server.pem','server.key','server.p12','server.pfx','id_rsa','id_ed25519',
  ' .env','  .env','sub/ .env','\t.env','.env ','.env.','.env..',
  '\u00a0.env','\u2003.env','\u200b.env','\ufeff.env','\u202a.env','\u2060.env',
  '\u0001.env','\u007f.env','\u009f.env',
  '．ｅｎｖ','\uFF0Eenv','\u2024env','\uFE52env',
];
const ACCEPT=['foo.env','env','normal.txt','.gitignore','sub/normal.txt','sub\\normal.txt','my.env.txt'];

for(const name of REJECT){
  test(`R2-009 rejects ${JSON.stringify(name)}`,async()=>{
    const r=repo();
    try{
      let created=true;let createErr=null;
      try{const target=path.join(r.dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'SYNTHETIC_ONLY');}catch(e){created=false;createErr=e.code;}
      if(!created){console.log('R2-009 CREATE_FAILED '+JSON.stringify(name)+' '+createErr);return;}
      const a=await attempt(r.dir,'probe');
      assert.equal(a.accepted,false,`${JSON.stringify(name)} was accepted`);
      console.log(`R2-009 REJECTED ${JSON.stringify(name)} :: ${a.error.slice(0,100)}`);
    }finally{r.dispose();}
  });
}
for(const name of ACCEPT){
  test(`R2-009 accepts normal ${JSON.stringify(name)}`,async()=>{
    const r=repo();
    try{
      let created=true;
      try{fs.writeFileSync(path.join(r.dir,name),'synthetic normal');}catch{created=false;}
      if(!created)return;
      const a=await attempt(r.dir,'normal-probe');
      assert.equal(a.accepted,true,`${JSON.stringify(name)} was rejected: ${a.error}`);
      assert(committed(r.dir).includes(name.replace(/\\/g,'/')),'file must be in the commit');
    }finally{r.dispose();}
  });
}

test('R2-009 rename destination with a leading-space sensitive name is rejected',async()=>{
  const r=repo();
  try{
    git(r.dir,'mv','normal.txt',' .env');
    const a=await attempt(r.dir,'rename-space');
    assert.equal(a.accepted,false);assert.match(a.error,/ambiguous whitespace/);
  }finally{r.dispose();}
});

test('R2-009 rename source with a leading-space sensitive name is rejected',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,' .env'),'synthetic');
    git(r.dir,'add','--',' .env');git(r.dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','tracked-space');
    git(r.dir,'mv',' .env','renamed.txt');
    const a=await attempt(r.dir,'rename-from-space');
    assert.equal(a.accepted,false);assert.match(a.error,/ambiguous whitespace/);
  }finally{r.dispose();}
});

test('R2-009 staged sensitive path with clean worktree is rejected',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,'.env'),'synthetic');
    git(r.dir,'add','--','.env');
    const a=await attempt(r.dir,'prestaged');
    assert.equal(a.accepted,false);assert.match(a.error,/sensitive-looking/);
  }finally{r.dispose();}
});

test('R2-009 porcelain parser preserves all unusual path bytes',()=>{
  assert.deepEqual(porcelainPaths(''),[]);
  assert.deepEqual(porcelainPaths(' M .env\0'),['.env']);
  assert.deepEqual(porcelainPaths('R  .env.production\0ordinary.txt\0'),['.env.production','ordinary.txt']);
  assert.deepEqual(porcelainPaths('C  copy.txt\0source.txt\0'),['copy.txt','source.txt']);
  assert.deepEqual(porcelainPaths('?? a b.txt\0'),['a b.txt']);
  assert.deepEqual(porcelainPaths('?? " .env"\0'),['" .env"']);
  assert.deepEqual(porcelainPaths('?? line\nname.txt\0'),['line\nname.txt']);
  assert.throws(()=>porcelainPaths('R  new.txt\0'),/missing rename/);
  assert.throws(()=>porcelainPaths('M .env'),/incomplete/);
});

test('R2-009 path traversal index entry is rejected if Git accepts it',async()=>{
  const r=repo();
  try{
    fs.writeFileSync(path.join(r.dir,'normal.txt'),'changed');
    const blob=git(r.dir,'hash-object','-w','--stdin');
    let staged=true;
    try{git(r.dir,'update-index','--add','--cacheinfo',`100644,${blob},../escape`);}
    catch(e){staged=false;console.log('R2-009 TRAVERSAL_INDEX_REFUSED_BY_GIT');}
    if(!staged)return;
    const a=await attempt(r.dir,'traversal');
    assert.equal(a.accepted,false);
    console.log('R2-009 TRAVERSAL_RESULT='+a.error.slice(0,120));
  }finally{r.dispose();}
});

test('R2-009 real symlink is rejected if Windows permits creating one',async()=>{
  const r=repo();
  try{
    let created=true;
    try{fs.symlinkSync('normal.txt',path.join(r.dir,'link'),'file');}
    catch(e){created=false;console.log('R2-009 SYMLINK_NOT_VERIFIED_WINDOWS '+e.code);}
    if(!created)return;
    const a=await attempt(r.dir,'symlink');
    assert.equal(a.accepted,false);assert.match(a.error,/symlink/);
  }finally{r.dispose();}
});

test('R2-009 real local submodule gitlink is rejected',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r3-gitlink-'));
  const sub=path.join(root,'subrepo'),dir=path.join(root,'main');
  fs.mkdirSync(sub);fs.mkdirSync(dir);
  const run=(cwd,...a)=>execFileSync('git',['-C',cwd,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  try{
    run(sub,'init','-q');fs.writeFileSync(path.join(sub,'f.txt'),'sub');run(sub,'add','.');run(sub,'-c','user.name=T','-c','user.email=t@l','commit','-qm','sub');
    run(dir,'init','-q');fs.writeFileSync(path.join(dir,'normal.txt'),'base');run(dir,'add','.');run(dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','base');
    let added=true;
    try{run(dir,'-c','protocol.file.allow=always','submodule','add','../subrepo','submodule');}
    catch(e){added=false;console.log('R2-009 GITLINK_NOT_VERIFIED_SUBMODULE_ADD '+String(e.stderr||e.message).slice(0,160));}
    if(!added)return;
    const a=await attempt(dir,'gitlink-real');
    console.log('R2-009 GITLINK_REAL='+(a.accepted?'ACCEPTED':a.error.slice(0,120)));
    assert.equal(a.accepted,false);
    assert.match(a.error,/symlink\/gitlink/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('R2-009 U+2215 division slash is a normal filename, not a path separator',async()=>{
  const r=repo();
  try{
    const name='sub'+String.fromCharCode(0x2215)+'.env';
    fs.writeFileSync(path.join(r.dir,name),'synthetic normal');
    const a=await attempt(r.dir,'u2215-normal');
    console.log('R2-009 U2215_RESULT='+(a.accepted?'ACCEPTED_AS_NORMAL_FILENAME':a.error.slice(0,120)));
    assert.equal(a.accepted,true,'U+2215 is not a path separator; this is not .env');
  }finally{r.dispose();}
});
