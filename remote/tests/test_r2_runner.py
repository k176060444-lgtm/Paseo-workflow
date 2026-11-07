import json
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from p0_runner import child_env,final_json,parse_output,run

class R2RemoteRunnerTests(unittest.TestCase):
    def test_remote_git_helper_excludes_unrelated_secret_environment(self):
        os.environ['P1_UNRELATED_SECRET_SENTINEL']='test-only-value'
        try:
            result=run([sys.executable,'-c',
                'import os; print(os.getenv("P1_UNRELATED_SECRET_SENTINEL","ABSENT"))'],{})
            self.assertEqual(result.returncode,0)
            self.assertEqual(result.stdout.strip(),'ABSENT')
            self.assertNotIn('P1_UNRELATED_SECRET_SENTINEL',child_env({}))
        finally:
            del os.environ['P1_UNRELATED_SECRET_SENTINEL']

    def test_explicit_env_allowlist_only_passes_whitelisted_names(self):
        os.environ['P1_TEST_PROXY']='synthetic-proxy'
        try:
            env=child_env({'envAllowList':['P1_TEST_PROXY']})
            self.assertEqual(env.get('P1_TEST_PROXY'),'synthetic-proxy')
            self.assertNotIn('P1_UNRELATED_SECRET_SENTINEL',env)
        finally:
            del os.environ['P1_TEST_PROXY']

    def test_legacy_verdict_and_markdown_final_envelope(self):
        self.assertEqual(parse_output(json.dumps({'verdict':'APPROVE','summary':'yes','findings':[]}))['verdict'],'PASS')
        text='## evidence\n' + json.dumps({'verdict':'REQUEST_CHANGES','summary':'bug','findings':['BLOCKER: test']})
        self.assertEqual(parse_output(text)['verdict'],'FAIL')
        fence=chr(96)*3
        fenced='## review\n'+fence+'json\n' + json.dumps({'verdict':'APPROVE','summary':'ok','findings':[]}) + '\n'+fence
        self.assertEqual(parse_output(fenced)['verdict'],'PASS')
        self.assertEqual(parse_output('report without a final envelope')['verdict'],'QUESTION')
        self.assertEqual(parse_output(json.dumps({'verdict':'PASS','summary':'unsafe','findings':['HIGH: flaw']}))['verdict'],'FAIL')

if __name__=='__main__':
    unittest.main()
