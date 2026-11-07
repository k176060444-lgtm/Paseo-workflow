import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {assert} from './policy.mjs';

// Explicit minimum environment for Git, tests and SSH. Do not inherit the Hermes
// gateway process (which may contain provider tokens and SSH/API credentials).
export function childEnv(extra={}) {
  const names=['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT','USERPROFILE',
    'HOME','TMP','TEMP','TMPDIR','LANG','LC_ALL','XDG_CONFIG_HOME','XDG_CACHE_HOME'];
  const result={};
  for(const name of names) if(typeof process.env[name]==='string')result[name]=process.env[name];
  return {...result,...extra};
}
export function execArgv(bin,args,{cwd,timeoutMs=120000,stdin,env}={}) {
  return new Promise((resolve,reject)=>{
    const proc=spawn(bin,args,{cwd,env:childEnv(env),shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
    const out=[],err=[];let bytes=0;let timedOut=false;let truncated=false;let settled=false;
    const killTree=()=>{
      if(process.platform==='win32'){const killer=spawn('taskkill',['/PID',String(proc.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});killer.on('error',()=>proc.kill());}
      else {try{process.kill(-proc.pid,'SIGKILL');}catch{proc.kill('SIGKILL');}}
    };
    const timer=setTimeout(()=>{timedOut=true;killTree();
      // OS process group termination requires separate Windows Job Object audit;
      // never wait forever for a descendant holding stdout/stderr open.
      setTimeout(()=>{if(!settled){settled=true;reject(new Error('process tree exit unverified after kill; reconcile manually'));}},10000).unref();
    },timeoutMs);
    proc.stdout.on('data',x=>{bytes+=x.length;if(bytes>16*1024*1024){truncated=true;killTree();}else out.push(x);});
    proc.stderr.on('data',x=>{bytes+=x.length;if(bytes>16*1024*1024){truncated=true;killTree();}else err.push(x);});
    proc.on('error',e=>{clearTimeout(timer);if(!settled){settled=true;reject(e);}});
    proc.on('close',(code,signal)=>{clearTimeout(timer);if(!settled){settled=true;resolve({code,signal,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8'),timedOut,truncated});}});
    if(stdin!==undefined)proc.stdin.end(stdin);else proc.stdin.end();
  });
}
export async function must(bin,args,opts={}) {
  const r=await execArgv(bin,args,opts);
  assert(r.code===0&&!r.timedOut&&!r.truncated,`${bin} ${args[0]??''} failed (${r.code}): ${r.stderr.slice(0,500)}`);
  return opts.raw === true ? r.stdout : r.stdout.trim();
}
export async function git(cwd,...args) {return must('git',args,{cwd});}
export async function head(cwd){return git(cwd,'rev-parse','HEAD');}
export async function isClean(cwd){return (await git(cwd,'status','--porcelain','--untracked-files=all')).length===0;}
export async function prepare(repo,base,worktree){
  assert(fs.existsSync(repo),'repository does not exist');
  assert(await isClean(repo),'repository must be clean before workspace creation');
  const baseSha=await git(repo,'rev-parse',`${base}^{commit}`);
  assert(/^[a-f0-9]{40}$/.test(baseSha),'invalid base Git SHA');
  assert(!fs.existsSync(worktree),'worktree already exists');
  fs.mkdirSync(path.dirname(worktree),{recursive:true,mode:0o700});
  await git(repo,'worktree','add','--detach',worktree,baseSha);
  assert(await head(worktree)===baseSha,'worktree base mismatch');
  return baseSha;
}
const SENSITIVE_PATH=/(^|[\\/])(\.env(?:[.\w-]*)|\.ssh|\.aws|.*\.(?:pem|key|p12|pfx)|id_rsa|id_ed25519)([\\/]|$)/i;

// Parse Git porcelain v1 -z without trimming raw stdout. A rename/copy emits
// TWO NUL-terminated names; both are security-sensitive (R2-009).
export function porcelainPaths(raw){
  if(raw==='')return [];
  assert(raw.endsWith('\0'),'incomplete git porcelain -z output');
  const fields=raw.slice(0,-1).split('\0'), paths=[];
  for(let i=0;i<fields.length;i++){
    const field=fields[i];
    assert(field.length>=4&&field[2]===' ','malformed git porcelain record');
    const xy=field.slice(0,2);
    assert(/^[ MADRCU?!]{2}$/.test(xy),'unrecognized git status');
    paths.push(field.slice(3));
    if(/[RC]/.test(xy)){assert(i+1<fields.length,'missing rename/copy source path');paths.push(fields[++i]);}
  }
  return paths;
}
function safeChange(dir,p){
  assert(typeof p==='string'&&p.length>0&&!p.includes('\0'),'invalid git path');
  assert(!SENSITIVE_PATH.test(p),`refusing to commit sensitive-looking file: ${p}`);
  const root=path.resolve(dir), file=path.resolve(root,p);
  assert(file.startsWith(root+path.sep),'git change outside worktree');
  if(fs.existsSync(file))assert(!fs.lstatSync(file).isSymbolicLink(),`symlink in change: ${p}`);
}
async function validateStaged(dir){
  const diff=await must('git',['diff','--cached','--name-only','-z'],{cwd:dir,raw:true});
  for(const p of diff.split('\0').filter(Boolean))safeChange(dir,p);
  const entries=await must('git',['ls-files','--stage','-z'],{cwd:dir,raw:true});
  for(const item of entries.split('\0').filter(Boolean)){
    const match=/^(\d{6}) [0-9a-f]{40,64} [0-3]\t([\s\S]*)$/.exec(item);
    assert(match,'malformed git index record');
    if(match[1]==='120000'||match[1]==='160000')
      assert(!diff.split('\0').includes(match[2]),`symlink/gitlink staged: ${match[2]}`);
  }
}
export async function commitWorktree(dir,tag) {
  const raw=await must('git',['status','--porcelain','-z','--untracked-files=all'],{cwd:dir,raw:true});
  for(const p of porcelainPaths(raw))safeChange(dir,p);
  if(raw) {
    await git(dir,'add','--all');
    // Inspect the actual index before commit. A rename's source and destination
    // were validated above, and the post-add scan detects newly staged paths.
    const after=await must('git',['status','--porcelain','-z','--untracked-files=all'],{cwd:dir,raw:true});
    for(const p of porcelainPaths(after))safeChange(dir,p);
    await validateStaged(dir);
    await must('git',['-c','user.name=P1 Controller','-c','user.email=p1@localhost','commit','-m',`P1 ${tag}`],{cwd:dir});
  }
  assert(await isClean(dir),'worktree remains dirty after freeze');
  return head(dir);
}
export async function assertUnchanged(dir,sha){
  assert(await head(dir)===sha,'commit changed during read-only/test stage');
  assert(await isClean(dir),'worktree changed during read-only/test stage');
}
export async function testRun(dir,commands,taskStore,taskId,prefix){
  const all=[];
  for (let i=0;i<commands.length;i++) {
    const argv=commands[i];
    assert(Array.isArray(argv)&&argv.length>0,'invalid test command');
    const result=await execArgv(argv[0],argv.slice(1),{cwd:dir,timeoutMs:15*60*1000});
    const log=taskStore.artifact(taskId,`${prefix}-test-${i+1}.json`,{argv,code:result.code,stdout:result.stdout,stderr:result.stderr,timedOut:result.timedOut,truncated:result.truncated});
    all.push({argv,code:result.code,logSha256:log.sha256,logPath:log.path,ok:result.code===0&&!result.timedOut&&!result.truncated});
    if(!all.at(-1).ok)break;
  }
  return {pass:all.length===commands.length&&all.every(x=>x.ok),receipts:all};
}
export async function makeTestCheckout(repo,sha,dir) {
  assert(!fs.existsSync(dir),'test checkout already exists');
  fs.mkdirSync(path.dirname(dir),{recursive:true,mode:0o700});
  await git(repo,'worktree','add','--detach',dir,sha);
  assert(await head(dir)===sha,'test checkout SHA mismatch');
  return dir;
}
