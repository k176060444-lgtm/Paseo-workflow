import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {commitWorktree} from '../offline-copy/src/git.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p1-gitlink-diag-'));
const g=(...a)=>execFileSync('git',['-C',dir,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
g('init','-q');fs.writeFileSync(path.join(dir,'normal.txt'),'base');g('add','.');g('-c','user.name=T','-c','user.email=t@l','commit','-qm','base');
fs.writeFileSync(path.join(dir,'normal.txt'),'changed');
g('update-index','--add','--cacheinfo',`160000,${'1'.repeat(40)},submodule`);
console.log('status=',JSON.stringify(g('status','--porcelain','-z','--untracked-files=all')));
console.log('ls-files-stage=',JSON.stringify(g('ls-files','--stage','-z')));
console.log('diff-cached=',JSON.stringify(g('diff','--cached','--name-only','-z')));
try{const sha=await commitWorktree(dir,'gitlink-diag');console.log('ACCEPTED',sha);console.log('show=',JSON.stringify(g('show','--raw','--pretty=format:','HEAD')));}catch(e){console.log('REJECTED',e.message);}
fs.rmSync(dir,{recursive:true,force:true});
