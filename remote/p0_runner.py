#!/usr/bin/env python3
"""P0 remote node runner: durable, idempotent jobs over SSH stdin/stdout.
No Paseo installation required. Requires Python 3.10+, git and OpenCode.
Local node HMAC key never leaves the machine. Provision SAME unique key on controller
and this specific node through a private channel. Never commit it to Git.
This adapter is NOT a physical hardware attestation or OS security sandbox.
"""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

JOB_RE = re.compile(r"^[a-f0-9]{40}$")

def encode(data):
    return json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

def sha(b):
    return hashlib.sha256(b).hexdigest()

def atomic(path, data):
    tmp = path.with_suffix(path.suffix + ".tmp-" + str(os.getpid()))
    with open(tmp, "xb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

def jload(path):
    return json.loads(path.read_text(encoding="utf8"))

def run(cmd, **kwargs):
    return subprocess.run(cmd, shell=False, capture_output=True, text=True, **kwargs)

def response(obj):
    print(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), flush=True)

def parse_output(text):
    parts=[]
    for line in text.splitlines():
        try:
            obj=json.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(obj, dict):
            part=obj.get('part')
            if obj.get('type')=='text' and isinstance(part,dict) and isinstance(part.get('text'),str):
                parts.append(part['text'])
            elif obj.get('type')=='text' and isinstance(obj.get('text'),str):
                parts.append(obj['text'])
    for candidate in ["".join(parts), "\n".join(parts), text]:
        try:
            result=json.loads(candidate.strip())
            if result.get('verdict') in ('PASS','FAIL','QUESTION','NEEDS_SPECIALIST') and isinstance(result.get('findings'),list) and isinstance(result.get('summary'),str):
                return result
        except (ValueError, AttributeError, TypeError):
            pass
    return {'verdict':'QUESTION','summary':'Unverified OpenCode final JSON output','findings':['Cannot parse structured final report from raw event stream; human reconciliation required.']}

def execute(config, spool, job_id):
    jobdir=spool / job_id
    spec=jload(jobdir / 'spec.json')
    marker=jobdir / 'result.json'
    if marker.exists():
        return
    work=jobdir / 'checkout'
    exit_code=255
    clean=False
    final={'verdict':'QUESTION','summary':'P0 execution did not finish','findings':['No verified report']}
    raw=b''
    stderr=b''
    try:
        repo=Path(config['repo']).resolve(strict=True)
        target_commit=spec['commit']
        if not re.fullmatch('[0-9a-f]{40}',target_commit):
            raise RuntimeError('invalid commit SHA')
        check=run(['git','-C',str(repo),'cat-file','-e',target_commit+'^{commit}'])
        if check.returncode!=0:
            raise RuntimeError('exact commit unavailable on remote: provision repository first')
        worktree=run(['git','-C',str(repo),'worktree','add','--detach',str(work),target_commit])
        if worktree.returncode!=0:
            raise RuntimeError('git worktree add failed: '+worktree.stderr[:300])
        baseline=run(['git','-C',str(work),'rev-parse','HEAD'])
        if baseline.returncode!=0 or baseline.stdout.strip()!=target_commit:
            raise RuntimeError('worktree commit mismatch')
        prompt='\n'.join([spec['instructions'],'TASK_SPEC:\n'+spec['taskSpec'],
            'Exact commit SHA: '+target_commit, 'You must NOT edit any files.',
            'Return only the specified JSON object.'])
        env=os.environ.copy()
        # The default OpenCode profile is not trusted as a read-only role. Force a
        # dedicated, tool-denied agent via native OPENCODE_CONFIG_CONTENT.
        agent_name='p1-blind'
        env['OPENCODE_CONFIG_CONTENT']=json.dumps({'agent':{agent_name:{
            'description':'P1 strictly read-only blind reviewer',
            'mode':'primary',
            'prompt':spec['soul'],
            'permission':{'*':'deny','read':'allow','glob':'allow','grep':'allow','list':'allow'}
        }}},ensure_ascii=False)
        if config.get('harness','opencode')=='opencode':
            cmd=[config['opencode'],'run','--format','json','--agent',agent_name,
                 '--model',spec['model'],'--dir',str(work),prompt]
            stdin_data=None
        else:
            # The optional rusty native harness is an explicit local argv adapter.
            # It MUST accept a prompt via stdin and return the final JSON on stdout.
            cmd=config.get('command')
            if not isinstance(cmd,list) or not cmd or not all(isinstance(x,str) for x in cmd):
                raise RuntimeError('non-OpenCode harness requires pinned command argv')
            stdin_data=prompt.encode('utf8')
        try:
            completed=subprocess.run(cmd,input=stdin_data,shell=False,capture_output=True,timeout=int(config.get('timeoutSec',3600)),env=env,cwd=work)
            exit_code=completed.returncode
            raw=completed.stdout
            stderr=completed.stderr
        except subprocess.TimeoutExpired as e:
            exit_code=124;raw=e.stdout or b'';stderr=e.stderr or b''
        final=parse_output(raw.decode('utf8',errors='replace'))
        clean=(run(['git','-C',str(work),'status','--porcelain','--untracked-files=all']).stdout.strip()==''
               and run(['git','-C',str(work),'rev-parse','HEAD']).stdout.strip()==target_commit)
    except Exception as exc:
        final={'verdict':'QUESTION','summary':'P0 runner infrastructure failure', 'findings':[str(exc)[:500]]}
    atomic(jobdir/'stdout.log',raw)
    atomic(jobdir/'stderr.log',stderr)
    body={'jobId':job_id,'nodeId':config['nodeId'],'commit':spec['commit'],
          'harness':spec['harness'],'model':spec['model'], 'exitCode':exit_code,
          'stdoutSha256':sha(raw),'stderrSha256':sha(stderr),'clean':clean,
          'verdict':final['verdict'],'summary':final['summary'],'findings':final['findings'],
          'finishedAt':int(time.time())}
    key=Path(config['hmacKeyPath']).read_bytes()
    if len(key)<32:
        raise RuntimeError('P0 HMAC key too short')
    envelope={'body':body,'mac':hmac.new(key,encode(body),'sha256').hexdigest()}
    atomic(marker,encode(envelope))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action', choices=['submit','status','execute'])
    parser.add_argument('--config',required=True)
    parser.add_argument('--job')
    args=parser.parse_args()
    cfg=jload(Path(args.config))
    spool=Path(cfg['spool']).resolve()
    spool.mkdir(mode=0o700,parents=True,exist_ok=True)
    if args.action=='execute':
        if not args.job or not JOB_RE.fullmatch(args.job):
            raise RuntimeError('invalid job ID')
        execute(cfg,spool,args.job)
        return
    payload=json.load(sys.stdin)
    job_id=payload.get('jobId')
    if not isinstance(job_id,str) or not JOB_RE.fullmatch(job_id):
        raise RuntimeError('invalid job ID')
    jobdir=spool / job_id
    if args.action=='submit':
        if payload.get('nodeId')!=cfg['nodeId'] or payload.get('model')!=cfg['model'] or payload.get('harness')!=cfg.get('harness','opencode'):
            raise RuntimeError('node identity/provider mismatch')
        if not re.fullmatch('[0-9a-f]{40}',payload.get('commit','')):
            raise RuntimeError('commit invalid')
        if not jobdir.exists():
            jobdir.mkdir(mode=0o700)
            atomic(jobdir/'spec.json',encode(payload))
            p=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'execute','--config',str(Path(args.config).resolve()),'--job',job_id],
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=(jobdir/'runner.log').open('ab'),start_new_session=True)
            atomic(jobdir/'pid',str(p.pid).encode('ascii'))
            response({'jobId':job_id,'status':'ACCEPTED'})
        else:
            if (jobdir/'spec.json').read_bytes()!=encode(payload):
                raise RuntimeError('job ID reuse with different payload')
            response({'jobId':job_id,'status':'EXISTS'})
        return
    if not jobdir.is_dir():
        response({'jobId':job_id,'status':'UNKNOWN'})
    elif (jobdir/'result.json').exists():
        response({'jobId':job_id,'status':'FINISHED','result':jload(jobdir/'result.json')})
    elif (jobdir/'pid').exists():
        pid=int((jobdir/'pid').read_text())
        try:
            os.kill(pid,0)
            response({'jobId':job_id,'status':'RUNNING'})
        except ProcessLookupError:
            response({'jobId':job_id,'status':'UNKNOWN'})
    else:
        response({'jobId':job_id,'status':'QUEUED'})

if __name__=='__main__':
    try:main()
    except Exception as e:
        print('P0 remote runner error: '+str(e),file=sys.stderr)
        sys.exit(1)
