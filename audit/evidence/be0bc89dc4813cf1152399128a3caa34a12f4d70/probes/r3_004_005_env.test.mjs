import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {childEnv,execArgv} from '../offline-copy/src/git.mjs';

const REPO=path.resolve('../offline-copy');

test('R3-004: childEnv omits an unrelated synthetic secret',()=>{
  process.env.P1_GATEWAY_SECRET_SENTINEL='NOT_FOR_CHILD';
  try{assert(!('P1_GATEWAY_SECRET_SENTINEL' in childEnv()));}
  finally{delete process.env.P1_GATEWAY_SECRET_SENTINEL;}
});

test('R3-004: a real child process cannot see the synthetic secret',async()=>{
  process.env.P1_GATEWAY_SECRET_SENTINEL='NOT_FOR_CHILD';
  try{
    const r=await execArgv(process.execPath,['-e','process.stdout.write(process.env.P1_GATEWAY_SECRET_SENTINEL||"ABSENT")'],{timeoutMs:30000});
    assert.equal(r.code,0);assert.equal(r.stdout,'ABSENT');
  }finally{delete process.env.P1_GATEWAY_SECRET_SENTINEL;}
});

test('R3-004: taskkill spawn source carries env:childEnv()',()=>{
  const src=fs.readFileSync(path.join(REPO,'src/git.mjs'),'utf8');
  const m=/spawn\('taskkill',\[[^\]]*\],\{([^}]*)\}/.exec(src);
  assert(m,'taskkill spawn not found');
  assert(/env\s*:\s*childEnv\(\)/.test(m[1]),'taskkill must pass env:childEnv()');
  console.log('R3-004 taskkill options: '+m[1].trim());
});

test('R3-004: timeout kill path still terminates a long child',async()=>{
  const r=await execArgv(process.execPath,['-e','setTimeout(()=>{},60000)'],{timeoutMs:300});
  assert.equal(r.timedOut,true);
  console.log('R3-004 timeout code='+String(r.code)+' signal='+String(r.signal));
});

test('R3-005: remote Popen source passes env=child_env(cfg)',()=>{
  const src=fs.readFileSync(path.join(REPO,'remote/p0_runner.py'),'utf8');
  const idx=src.indexOf('subprocess.Popen(');
  assert(idx>=0);
  const block=src.slice(idx,idx+700);
  assert(/env\s*=\s*child_env\(cfg\)/.test(block),'Popen must pass env=child_env(cfg)');
  console.log('R3-005 Popen block: '+block.split('\n').slice(0,3).join(' | '));
});