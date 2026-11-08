import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p0_runner

class R3RemoteRunnerTests(unittest.TestCase):
    def test_indented_final_json_and_no_false_terminal_verdict(self):
        obj={'verdict':'APPROVE','summary':'checked','findings':[]}
        bare='## reviewed\n  '+json.dumps(obj,ensure_ascii=False)
        self.assertEqual(p0_runner.parse_output(bare)['verdict'],'PASS')
        pretty='## reviewed\n  '+json.dumps(obj,indent=2)
        self.assertEqual(p0_runner.parse_output(pretty)['verdict'],'PASS')
        fence=chr(96)*3
        fenced='## reviewed\n  '+fence+'json\n'+json.dumps(obj)+'\n  '+fence
        self.assertEqual(p0_runner.parse_output(fenced)['verdict'],'PASS')
        self.assertEqual(p0_runner.parse_output(bare+'\nTrailing text')['verdict'],'QUESTION')

    def test_low_comments_match_local_advisory_verdict_contract(self):
        base={'verdict':'APPROVE_WITH_COMMENTS','summary':'checked','findings':['LOW: nit']}
        self.assertEqual(p0_runner.parse_output(json.dumps(base))['verdict'],'APPROVE_WITH_COMMENTS')
        base['findings']=['HIGH: code defect']
        self.assertEqual(p0_runner.parse_output(json.dumps(base))['verdict'],'FAIL')
        base['verdict']='PASS'
        self.assertEqual(p0_runner.parse_output(json.dumps(base))['verdict'],'FAIL')

    def test_submit_process_env_does_not_inherit_gateway_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            cfg=root/'node.json'
            cfg.write_text(json.dumps({'nodeId':'5bao','physicalId':'host5',
                'harness':'opencode','model':'opencode/approved',
                'spool':str(root/'spool')}),encoding='utf8')
            job='a'*40
            spec={'jobId':job,'nodeId':'5bao','harness':'opencode',
                'model':'opencode/approved','commit':'b'*40}
            argv=['p0_runner.py','submit','--config',str(cfg)]
            with patch.dict(os.environ,{'P1_GATEWAY_SECRET_SENTINEL':'NOT_FOR_CHILD'}):
                with patch.object(sys,'argv',argv), patch.object(sys,'stdin',io.StringIO(json.dumps(spec))):
                    with patch.object(p0_runner.subprocess,'Popen') as worker, redirect_stdout(io.StringIO()):
                        worker.return_value.pid=12345
                        p0_runner.main()
                        self.assertTrue(worker.called)
                        env=worker.call_args.kwargs['env']
                        self.assertNotIn('P1_GATEWAY_SECRET_SENTINEL',env)
                        self.assertIn('PATH',env)
                        worker.call_args.kwargs['stderr'].close()

if __name__=='__main__':
    unittest.main()
