import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(r"C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r3/offline-copy")
sys.path.insert(0, str(ROOT / "remote"))
import p0_runner

RUNNER = ROOT / "remote" / "p0_runner.py"


def write_json(path, obj):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False), encoding="utf8")


class RemoteR3Probe(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="p1-r3-remote-")
        self.root = Path(self.tmp)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        (self.repo / "f.txt").write_text("synthetic")
        self.git("add", ".")
        self.git("-c", "user.name=T", "-c", "user.email=t@l", "commit", "-qm", "init")
        self.commit = self.git("rev-parse", "HEAD")
        self.key = self.root / "node.key"
        self.key.write_bytes(b"K" * 40)
        self.spool = self.root / "spool"
        self.spool.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def git(self, *args):
        r = subprocess.run(["git", "-C", str(self.repo), *args], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    # R3-005
    def test_child_env_omits_sentinel(self):
        os.environ["P1_GATEWAY_SECRET_SENTINEL"] = "NOT_FOR_CHILD"
        try:
            self.assertNotIn("P1_GATEWAY_SECRET_SENTINEL", p0_runner.child_env({}))
        finally:
            del os.environ["P1_GATEWAY_SECRET_SENTINEL"]

    def test_run_helper_omits_sentinel(self):
        os.environ["P1_GATEWAY_SECRET_SENTINEL"] = "NOT_FOR_CHILD"
        try:
            r = p0_runner.run([sys.executable, "-c",
                               "import os;print(os.getenv('P1_GATEWAY_SECRET_SENTINEL','ABSENT'))"], {})
            self.assertEqual(r.returncode, 0)
            self.assertEqual(r.stdout.strip(), "ABSENT")
        finally:
            del os.environ["P1_GATEWAY_SECRET_SENTINEL"]

    def test_popen_kwargs_env_filters_sentinel(self):
        cfg = self.root / "cfg.json"
        write_json(cfg, {"nodeId": "5bao", "physicalId": "host5",
                         "harness": "opencode", "model": "opencode/approved",
                         "spool": str(self.spool)})
        job = "a" * 40
        spec = {"jobId": job, "nodeId": "5bao", "harness": "opencode",
                "model": "opencode/approved", "commit": self.commit}
        argv = ["p0_runner.py", "submit", "--config", str(cfg)]
        with patch.dict(os.environ, {"P1_GATEWAY_SECRET_SENTINEL": "NOT_FOR_CHILD"}):
            with patch.object(sys, "argv", argv), patch.object(sys, "stdin", io.StringIO(json.dumps(spec))):
                with patch.object(p0_runner.subprocess, "Popen") as worker, redirect_stdout(io.StringIO()):
                    worker.return_value.pid = 12345
                    p0_runner.main()
                    self.assertTrue(worker.called)
                    env = worker.call_args.kwargs["env"]
                    self.assertNotIn("P1_GATEWAY_SECRET_SENTINEL", env)
                    self.assertIn("PATH", env)
                    worker.call_args.kwargs["stderr"].close()

    def test_real_submit_execute_harness_env_filters_sentinel(self):
        script = self.root / "fake_harness.py"
        script.write_text(
            "import os,sys\n"
            "print('SENTINEL='+os.getenv('P1_GATEWAY_SECRET_SENTINEL','ABSENT'))\n"
            "print(__import__('json').dumps({'verdict':'PASS','summary':'checked','findings':[]}))\n",
            encoding="utf8")
        cfg = self.root / "cfg.json"
        write_json(cfg, {"nodeId": "rusty", "physicalId": "host-rusty",
                         "harness": "rusty", "model": "rusty/x",
                         "repo": str(self.repo), "spool": str(self.spool),
                         "hmacKeyPath": str(self.key),
                         "command": [sys.executable, str(script)], "timeoutSec": 30})
        job = "b" * 40
        spec = {"jobId": job, "nodeId": "rusty", "harness": "rusty",
                "model": "rusty/x", "commit": self.commit, "role": "blind_c",
                "soul": "read-only", "taskSpec": "synthetic", "instructions": "review"}
        os.environ["P1_GATEWAY_SECRET_SENTINEL"] = "NOT_FOR_CHILD"
        try:
            r = subprocess.run([sys.executable, str(RUNNER), "submit", "--config", str(cfg)],
                               input=json.dumps(spec), text=True, capture_output=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
            ack = json.loads(r.stdout)
            self.assertEqual(ack["status"], "ACCEPTED")
            result = None
            for _ in range(200):
                s = subprocess.run([sys.executable, str(RUNNER), "status", "--config", str(cfg)],
                                   input=json.dumps({"jobId": job}), text=True, capture_output=True, timeout=30)
                self.assertEqual(s.returncode, 0, s.stderr)
                out = json.loads(s.stdout)
                if out["status"] == "FINISHED":
                    result = out["result"]
                    break
                time.sleep(0.05)
            self.assertIsNotNone(result, "job did not finish")
            self.assertEqual(result["body"]["verdict"], "PASS")
            self.assertTrue(result["body"]["clean"])
            stdout_log = (self.spool / job / "stdout.log").read_text(encoding="utf8")
            self.assertIn("SENTINEL=ABSENT", stdout_log)
            self.assertNotIn("SENTINEL=NOT_FOR_CHILD", stdout_log)
        finally:
            del os.environ["P1_GATEWAY_SECRET_SENTINEL"]
            time.sleep(0.5)

    # R3-007 / R3-008 parser
    def test_parser_markdown_indented_and_pretty_json(self):
        obj = {"verdict": "APPROVE", "summary": "checked", "findings": []}
        for text in ("## r\n  " + json.dumps(obj),
                     "## r\n  " + json.dumps(obj, indent=2),
                     "## r\r\n  " + json.dumps(obj)):
            self.assertEqual(p0_runner.parse_output(text)["verdict"], "PASS")

    def test_parser_fenced_terminal_json(self):
        fence = chr(96) * 3
        obj = {"verdict": "REQUEST_CHANGES", "summary": "bug", "findings": ["BLOCKER: x"]}
        text = "## r\n" + fence + "json\n" + json.dumps(obj) + "\n" + fence
        self.assertEqual(p0_runner.parse_output(text)["verdict"], "FAIL")

    def test_parser_trailing_text_and_truncation_rejected(self):
        obj = {"verdict": "APPROVE", "summary": "checked", "findings": []}
        self.assertEqual(p0_runner.parse_output("## r\n" + json.dumps(obj) + "\nTrailing text")["verdict"], "QUESTION")
        self.assertEqual(p0_runner.parse_output("## r\n" + json.dumps(obj)[:-5])["verdict"], "QUESTION")
        self.assertEqual(p0_runner.parse_output("## r\n" + '{"verdict":"PASS","summary":""}')["verdict"], "QUESTION")
        self.assertEqual(p0_runner.parse_output("## r\n" + '{"verdict":"PASS","summary":"x","findings":[1]}')["verdict"], "QUESTION")

    def test_parser_pass_with_any_finding_fails(self):
        for findings in (["LOW: nit"], ["HIGH: x"], ["unclassified issue"]):
            out = p0_runner.parse_output(json.dumps({"verdict": "PASS", "summary": "x", "findings": findings}))
            self.assertEqual(out["verdict"], "FAIL")

    def test_parser_approve_with_comments_severity(self):
        low = p0_runner.parse_output(json.dumps({"verdict": "APPROVE_WITH_COMMENTS", "summary": "x", "findings": ["LOW: nit"]}))
        self.assertEqual(low["verdict"], "APPROVE_WITH_COMMENTS")
        med = p0_runner.parse_output(json.dumps({"verdict": "APPROVE_WITH_COMMENTS", "summary": "x", "findings": ["MEDIUM: issue"]}))
        self.assertEqual(med["verdict"], "APPROVE_WITH_COMMENTS")
        high = p0_runner.parse_output(json.dumps({"verdict": "APPROVE_WITH_COMMENTS", "summary": "x", "findings": ["HIGH: x"]}))
        self.assertEqual(high["verdict"], "FAIL")
        none = p0_runner.parse_output(json.dumps({"verdict": "APPROVE_WITH_COMMENTS", "summary": "x", "findings": []}))
        self.assertEqual(none["verdict"], "APPROVE_WITH_COMMENTS")

    def test_parser_legacy_aliases(self):
        self.assertEqual(p0_runner.parse_output(json.dumps({"verdict": "APPROVE", "summary": "x", "findings": []}))["verdict"], "PASS")
        self.assertEqual(p0_runner.parse_output(json.dumps({"verdict": "REQUEST_CHANGES", "summary": "x", "findings": []}))["verdict"], "FAIL")


if __name__ == "__main__":
    unittest.main(verbosity=2)