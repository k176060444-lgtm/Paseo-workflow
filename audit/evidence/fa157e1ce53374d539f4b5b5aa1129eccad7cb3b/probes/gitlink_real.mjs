import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {commitWorktree} from '../offline-copy/src/git.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-gitlink-real-'));
const sub=path.join(root,'subrepo'),dir=path.join(root,'main');
fs.mkdirSync(sub);fs.mkdirSync(dir);
const run=(cwd,...a)=>execFileSync('git',['-C',cwd,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
run(sub,'init','-q');fs.writeFileSync(path.join(sub,'f.txt'),'sub');run(sub,'add','.');run(sub,'-c','user.name=T','-c','user.email=t@l','commit','-qm','sub');
run(dir,'init','-q');fs.writeFileSync(path.join(dir,'normal.txt'),'base');run(dir,'add','.');run(dir,'-c','user.name=T','-c','user.email=t@l','commit','-qm','base');
const url='../subrepo';
try{console.log('submodule add=',run(dir,'-c','protocol.file.allow=always','submodule','add',url,'submodule').toString());}
catch(e){console.log('SUBMODULE_ADD_FAILED',String(e.stderr||e.message).slice(0,300));fs.rmSync(root,{recursive:true,force:true});process.exit(0);}
console.log('status=',JSON.stringify(run(dir,'status','--porcelain','-z','--untracked-files=all').toString()));
console.log('ls-files=',JSON.stringify(run(dir,'ls-files','--stage','-z').toString()));
try{const sha=await commitWorktree(dir,'gitlink-real');console.log('ACCEPTED',sha);console.log('show=',JSON.stringify(run(dir,'show','--raw','--pretty=format:','HEAD').toString()));}
catch(e){console.log('REJECTED',e.message);}
fs.rmSync(root,{recursive:true,force:true});
