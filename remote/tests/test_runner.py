import hashlib
import hmac
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT=Path(__file__).parents[1]

class RemoteRunnerTests(unittest.TestCase):
    def test_native_harness_durable_job_and_hmac(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            repo=root/'repo';repo.mkdir()
            def git(*args):
                return subprocess.run(['git','-C',str(repo),*args],capture_output=True,text=True,check=True).stdout.strip()
            git('init');(repo/'file.txt').write_text('original source')
            git('add','.');subprocess.run(['git','-C',str(repo),'-c','user.email=test@localhost',
              '-c','user.name=Test','commit','-m','init'],check=True,capture_output=True)
            sha=git('rev-parse','HEAD')
            secret=root/'node.key';secret.write_bytes(b'X'*40)
            script=root/'mock_native.py'
            script.write_text('import sys,json\nassert "TASK_SPEC" in sys.stdin.read()\nprint(json.dumps({"verdict":"PASS","summary":"Reviewed exact commit","findings":[]}))\n')
            conf=root/'cfg.json';conf.write_text(json.dumps({'nodeId':'rusty','harness':'rusty','model':'rusty/local-review',
              'repo':str(repo),'spool':str(root/'jobs'),'hmacKeyPath':str(secret),
              'command':[sys.executable,str(script)],'timeoutSec':30}))
            job='f'*40
            spec={'jobId':job,'taskId':'TASK1234','nodeId':'rusty','commit':sha,'role':'blind_c',
              'model':'rusty/local-review','harness':'rusty','soul':'read-only audit','taskSpec':'test content',
              'instructions':'Review exact commit'}
            base=[sys.executable,str(ROOT/'p0_runner.py')]
            cmd=base+['submit','--config',str(conf)]
            ack=subprocess.run(cmd,input=json.dumps(spec),text=True,capture_output=True,check=True)
            self.assertEqual(json.loads(ack.stdout)['status'],'ACCEPTED')
            again=subprocess.run(cmd,input=json.dumps(spec),text=True,capture_output=True,check=True)
            self.assertEqual(json.loads(again.stdout)['status'],'EXISTS')
            result=None
            for _ in range(100):
                resp=subprocess.run(base+['status','--config',str(conf)],input=json.dumps({'jobId':job}),text=True,capture_output=True,check=True)
                r=json.loads(resp.stdout)
                if r['status']=='FINISHED':result=r['result'];break
                time.sleep(.05)
            self.assertIsNotNone(result)
            body=result['body']
            self.assertEqual(body['commit'],sha);self.assertEqual(body['verdict'],'PASS')
            self.assertEqual(body['exitCode'],0);self.assertTrue(body['clean'])
            mac=hmac.new(secret.read_bytes(),json.dumps(body,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode(),'sha256').hexdigest()
            self.assertEqual(mac,result['mac'])

if __name__=='__main__':unittest.main()
