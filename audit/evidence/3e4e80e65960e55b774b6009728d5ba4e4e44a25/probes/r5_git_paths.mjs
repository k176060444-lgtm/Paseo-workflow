import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {commitWorktree,prepare} from '../repo/src/git.mjs';

function git(dir,...args){return execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function repo(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-git-'));const dir=path.join(root,'repo');fs.mkdirSync(dir);
  git(dir,'init','-q');fs.writeFileSync(path.join(dir,'normal.txt'),'synthetic normal data');
  git(dir,'add','.');git(dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','base');
  return {root,dir,close(){fs.rmSync(root,{recursive:true,force:true});}};
}
const results=[];function rec(name,result,detail=''){results.push({name,result,detail});console.log(result,name,detail);}
async function reject(name,fn,re){try{await fn();rec(name,'NOT_CONFIRMED','accepted');}catch(e){const ok=re.test(e.message);rec(name,ok?'CONFIRMED':'WRONG_ERROR',e.message.slice(0,160));}}
async function accept(name,fn){try{await fn();rec(name,'CONFIRMED');}catch(e){rec(name,'NOT_CONFIRMED',e.message.slice(0,160));}}

// R4-006 invisible/deceptive prefixes rejected
for(const [tag,prefix] of [['U+00AD','\u00ad'],['U+034F','\u034f'],['U+180E','\u180e'],['U+3164','\u3164'],['U+2800','\u2800'],['U+200B','\u200b'],['U+200D','\u200d'],['U+2060','\u2060'],['U+FEFF','\ufeff'],['U+202E','\u202e'],['U+FFA0','\uffa0']]){
  const w=repo();try{const p=path.join(w.dir,prefix+'.env');fs.writeFileSync(p,'TEST DATA');await reject('R4-006 rejects '+tag+' prefix before .env',()=>commitWorktree(w.dir,'unicode'),/control\/format character|ambiguous/);}finally{w.close();}
}
// normal positives
for(const [tag,name] of [['ASCII foo.env','foo.env'],['ASCII env','env'],['normal.txt','normal.txt'],['.gitignore','.gitignore'],['Chinese file','中文.txt'],['Chinese path','中文目录/说明.md'],['Chinese non-reserved env name','环境.env']]){
  const w=repo();try{const p=path.join(w.dir,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'normal synthetic content');await accept('R4-006 accepts normal '+tag,()=>commitWorktree(w.dir,'normal'));}finally{w.close();}
}
// fullwidth .env rejected
{
  const w=repo();try{const p=path.join(w.dir,'．ｅｎｖ');fs.writeFileSync(p,'TEST DATA');await reject('R4-006 rejects fullwidth NFKC .env',()=>commitWorktree(w.dir,'nfkc'),/sensitive|control\/format/);}finally{w.close();}
}
// leading-space rename rejected
{
  const w=repo();try{const p=path.join(w.dir,' .env');fs.writeFileSync(p,'TEST DATA');await reject('R4-006 rejects leading-space .env',()=>commitWorktree(w.dir,'space'),/ambiguous whitespace|sensitive/);}finally{w.close();}
}
// U+2215 division slash: normal filename, not separator
{
  const w=repo();try{const p=path.join(w.dir,'sub∕.env');fs.writeFileSync(p,'normal synthetic content');await accept('R4-006 accepts U+2215 as normal filename (not a separator)',()=>commitWorktree(w.dir,'u2215'));}finally{w.close();}
}
// R4-007 inherited mode 120000 symlink in base index rejected by prepare
{
  const w=repo();try{
    const blob=execFileSync('git',['-C',w.dir,'hash-object','-w','--stdin'],{input:'.env\n',encoding:'utf8'}).trim();
    git(w.dir,'update-index','--add','--cacheinfo','120000,'+blob+',link');
    git(w.dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','inherit symlink');
    git(w.dir,'-c','core.symlinks=false','checkout','-f','--','link');
    await reject('R4-007 prepare rejects inherited 120000 symlink index',()=>prepare(w.dir,'HEAD',path.join(w.root,'wt-symlink')),/symlink|gitlink in index|symlink in change/);
  }finally{w.close();}
}
// R4-007 inherited 160000 gitlink in base index rejected by prepare
{
  const w=repo();try{
    const commit=git(w.dir,'rev-parse','HEAD');
    git(w.dir,'update-index','--add','--cacheinfo','160000,'+commit+',submodule');
    git(w.dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','inherit gitlink');
    git(w.dir,'checkout','-f','--','submodule');
    await reject('R4-007 prepare rejects inherited 160000 gitlink index',()=>prepare(w.dir,'HEAD',path.join(w.root,'wt-gitlink')),/symlink|gitlink in index|symlink in change/);
  }finally{w.close();}
}
// R4-007 clean worktree with inherited symlink rejected by commitWorktree even without change
{
  const w=repo();try{
    const blob=execFileSync('git',['-C',w.dir,'hash-object','-w','--stdin'],{input:'.env\n',encoding:'utf8'}).trim();
    git(w.dir,'update-index','--add','--cacheinfo','120000,'+blob+',link');
    git(w.dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','inherit symlink');
    const wt=path.join(w.root,'wt-clean');git(w.dir,'worktree','add','--detach',wt,'HEAD');
    await reject('R4-007 commitWorktree rejects clean worktree with inherited symlink',()=>commitWorktree(wt,'clean'),/symlink|gitlink in index/);
  }finally{w.close();}
}
// R4-007 sensitive inherited .env path in base index rejected by prepare
{
  const w=repo();try{
    const blob=execFileSync('git',['-C',w.dir,'hash-object','-w','--stdin'],{input:'TEST DATA',encoding:'utf8'}).trim();
    git(w.dir,'update-index','--add','--cacheinfo','100644,'+blob+',.env');
    git(w.dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','inherit env');
    git(w.dir,'checkout','-f','--','.env');
    await reject('R4-007 prepare rejects inherited .env path in full index',()=>prepare(w.dir,'HEAD',path.join(w.root,'wt-env')),/sensitive path|sensitive/);
  }finally{w.close();}
}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r7/logs/probe-r5-git.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length);