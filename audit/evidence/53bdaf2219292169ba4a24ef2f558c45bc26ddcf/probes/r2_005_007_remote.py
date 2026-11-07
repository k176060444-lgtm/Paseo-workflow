import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(r"C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r2/offline-copy")
sys.path.insert(0, str(ROOT / "remote"))
import p0_runner

RUNNER = ROOT / "remote" / "p0_runner.py"


def write_json(path, obj):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False), encoding="utf8")


class RemoteProbe(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.spool = self.root / "spool"
        self.spool.mkdir()
        self.key = self.root / "key"
        self.key.write_bytes(b"K" * 40)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.cfg = self.root / "cfg.json"
        write_json(self.cfg, {
            "nodeId": "synthetic-node", "physicalId": "synthetic-physical",
            "spool": str(self.spool), "repo": str(self.repo),
            "hmacKeyPath": str(self.key), "harness": "opencode",
            "model": "opencode/synthetic", "opencode": "opencode",
        })

    def tearDown(self):
        self.tmp.cleanup()

    # R2-005
    def test_child_env_omits_unrelated_sentinel(self):
        os.environ["P1_UNRELATED_SECRET_SENTINEL"] = "test-only-value"
        try:
            env = p0_runner.child_env({})
            self.assertNotIn("P1_UNRELATED_SECRET_SENTINEL", env)
        finally:
            del os.environ["P1_UNRELATED_SECRET_SENTINEL"]

    def test_run_helper_omits_unrelated_sentinel(self):
        os.environ["P1_UNRELATED_SECRET_SENTINEL"] = "test-only-value"
        try:
            r = p0_runner.run([sys.executable, "-c",
                               "import os;print(os.getenv('P1_UNRELATED_SECRET_SENTINEL','ABSENT'))"], {})
            self.assertEqual(r.returncode, 0)
            self.assertEqual(r.stdout.strip(), "ABSENT")
        finally:
            del os.environ["P1_UNRELATED_SECRET_SENTINEL"]

    def test_env_allowlist_valid_name_passes(self):
        os.environ["P1_TEST_PROXY"] = "synthetic-proxy"
        try:
            env = p0_runner.child_env({"envAllowList": ["P1_TEST_PROXY"]})
            self.assertEqual(env.get("P1_TEST_PROXY"), "synthetic-proxy")
        finally:
            del os.environ["P1_TEST_PROXY"]

    def test_env_allowlist_rejects_invalid_names(self):
        for bad in ["P1-BAD", "1BAD", "A=B", "", "A B", "A;B"]:
            with self.assertRaises(RuntimeError):
                p0_runner.child_env({"envAllowList": [bad]})

    def test_run_helper_only_gets_allowlisted_extra(self):
        os.environ["P1_ALLOWED_EXTRA"] = "ok"
        try:
            r = p0_runner.run([sys.executable, "-c",
                               "import os;print(os.getenv('P1_ALLOWED_EXTRA','ABSENT'))"],
                              {"envAllowList": ["P1_ALLOWED_EXTRA"]})
            self.assertEqual(r.returncode, 0)
            self.assertEqual(r.stdout.strip(), "ok")
        finally:
            del os.environ["P1_ALLOWED_EXTRA"]

    # R2-006 remote parser
    def test_parse_output_markdown_then_bare_json(self):
        text = "## evidence\n" + json.dumps({"verdict": "APPROVE", "summary": "ok", "findings": []})
        out = p0_runner.parse_output(text)
        self.assertEqual(out["verdict"], "PASS")

    def test_parse_output_fenced_json(self):
        fence = chr(96) * 3
        text = "## review\n" + fence + "json\n" + json.dumps(
            {"verdict": "REQUEST_CHANGES", "summary": "bug", "findings": ["BLOCKER: x"]}) + "\n" + fence
        out = p0_runner.parse_output(text)
        self.assertEqual(out["verdict"], "FAIL")

    def test_parse_output_legacy_request_changes(self):
        out = p0_runner.parse_output(json.dumps(
            {"verdict": "REQUEST_CHANGES", "summary": "bug", "findings": []}))
        self.assertEqual(out["verdict"], "FAIL")

    def test_parse_output_pass_with_finding_becomes_fail(self):
        out = p0_runner.parse_output(json.dumps(
            {"verdict": "PASS", "summary": "unsafe", "findings": ["HIGH: flaw"]}))
        self.assertEqual(out["verdict"], "FAIL")

    def test_parse_output_approve_with_comments_low_becomes_fail_remotely(self):
        # Remote is stricter than local: any finding downgrades APPROVE_WITH_COMMENTS.
        out = p0_runner.parse_output(json.dumps(
            {"verdict": "APPROVE_WITH_COMMENTS", "summary": "ok", "findings": ["[LOW]: nit"]}))
        self.assertEqual(out["verdict"], "FAIL")

    def test_parse_output_no_envelope_returns_question(self):
        out = p0_runner.parse_output("report without a final envelope")
        self.assertEqual(out["verdict"], "QUESTION")

    def test_parse_output_indented_json_after_markdown(self):
        text = "## report\n  " + json.dumps({"verdict": "PASS", "summary": "ok", "findings": []})
        out = p0_runner.parse_output(text)
        print("REMOTE-INDENTED-VERDICT=" + out["verdict"])
        # Record actual behavior; do not assert a preferred contract.

    def test_parse_output_multiline_json_after_markdown(self):
        obj = {"verdict": "PASS", "summary": "ok", "findings": [],
               "nested": {"a": 1}}
        text = "## report\n" + json.dumps(obj, indent=2)
        out = p0_runner.parse_output(text)
        print("REMOTE-MULTILINE-VERDICT=" + out["verdict"])

    # R2-007 Windows liveness
    def test_process_alive_self_true(self):
        self.assertTrue(p0_runner.process_alive(os.getpid()))

    def test_process_alive_dead_false(self):
        p = subprocess.Popen([sys.executable, "-c", "pass"])
        p.wait(timeout=20)
        time.sleep(0.2)
        self.assertFalse(p0_runner.process_alive(p.pid))

    def test_process_alive_nonexistent_false(self):
        self.assertFalse(p0_runner.process_alive(999999))

    def test_process_alive_system_pid_no_crash(self):
        got = p0_runner.process_alive(4)
        print("PROCESS-ALIVE-PID4=" + str(got))

    def test_cancel_on_windows_is_uncertain(self):
        job = "a" * 40
        jd = self.spool / job
        jd.mkdir()
        (jd / "pid").write_text(str(os.getpid()))
        out = p0_runner.cancel_job({"nodeId": "synthetic-node"}, self.spool, job)
        self.assertEqual(out["status"], "CANCEL_UNCERTAIN")

    # status action paths
    def _status(self, job):
        r = subprocess.run([sys.executable, str(RUNNER), "status", "--config", str(self.cfg)],
                           input=json.dumps({"jobId": job}), text=True, capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_status_unknown(self):
        self.assertEqual(self._status("b" * 40)["status"], "UNKNOWN")

    def test_status_queued(self):
        (self.spool / ("c" * 40)).mkdir()
        self.assertEqual(self._status("c" * 40)["status"], "QUEUED")

    def test_status_finished(self):
        jd = self.spool / ("d" * 40); jd.mkdir()
        write_json(jd / "result.json", {"body": {}, "mac": "0" * 64})
        self.assertEqual(self._status("d" * 40)["status"], "FINISHED")

    def test_status_cancelled(self):
        jd = self.spool / ("e" * 40); jd.mkdir()
        write_json(jd / "cancelled.json", {"at": 1})
        self.assertEqual(self._status("e" * 40)["status"], "CANCELLED")

    def test_status_cancel_requested(self):
        jd = self.spool / ("f" * 40); jd.mkdir()
        write_json(jd / "cancel-requested.json", {"requestedAt": 1})
        self.assertEqual(self._status("f" * 40)["status"], "CANCEL_REQUESTED")

    def test_status_running_for_current_process(self):
        jd = self.spool / ("1" * 40); jd.mkdir()
        (jd / "pid").write_text(str(os.getpid()))
        self.assertEqual(self._status("1" * 40)["status"], "RUNNING")

    def test_status_unknown_for_dead_pid(self):
        p = subprocess.Popen([sys.executable, "-c", "pass"]); p.wait(timeout=20)
        jd = self.spool / ("2" * 40); jd.mkdir()
        (jd / "pid").write_text(str(p.pid))
        self.assertEqual(self._status("2" * 40)["status"], "UNKNOWN")

    def test_atomic_replace_is_atomic_and_complete(self):
        target = self.root / "x.json"
        p0_runner.atomic(target, b"one")
        self.assertEqual(target.read_bytes(), b"one")
        p0_runner.atomic(target, b"two")
        self.assertEqual(target.read_bytes(), b"two")
        self.assertEqual([p.name for p in self.root.glob("x.json.tmp-*")], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
