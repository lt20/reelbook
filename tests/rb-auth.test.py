"""A revoked session in tools/rb.py (F1): when the refresh token is refused (signed out everywhere, password changed),
rb.py says « signed out, run rb.py login » and exits 3 rather than printing the raw answer; tools/nightly.sh turns
that exit code into the phone notice.

No real backend: a fake auth server on 127.0.0.1 answers the refresh, the config is a temporary file.
Run: python3 -I tests/rb-auth.test.py
"""
import contextlib, http.server, importlib.util, io, json, os, pathlib, subprocess, tempfile, threading, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb", ROOT / "tools" / "rb.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

NOT_FOUND = '{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}'
INVALID_GRANT = '{"error":"invalid_grant","error_description":"Invalid Refresh Token: Already Used"}'
SIGNED_OUT = "Your computer was signed out of Reelbook (session revoked). Run: python3 ~/dev/reelbook/tools/rb.py login"


class FakeAuth:
    """POST /auth/v1/token answers (status, body); every request path is recorded."""
    def __init__(self, status, body):
        self.paths, outer = [], self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                outer.paths.append(self.path)
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                data = body.encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            do_GET = do_POST
            def log_message(self, *a): pass

        self.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown(); self.server.server_close()


def expired_cfg(tmp, url):
    p = pathlib.Path(tmp) / "config.json"
    p.write_text(json.dumps({"url": url, "anon_key": "k", "email": "user@example.test", "user_id": "u1",
                             "access_token": "old", "refresh_token": "revoked", "expires_at": 0}))
    return p


class RevokedSession(unittest.TestCase):
    def refresh(self, status, body):
        fake = FakeAuth(status, body)
        self.addCleanup(fake.close)
        with tempfile.TemporaryDirectory() as tmp:
            old = rb.CFG_PATH
            rb.CFG_PATH = expired_cfg(tmp, fake.url)
            err = io.StringIO()
            try:
                with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as ex:
                    rb.session()
            finally:
                rb.CFG_PATH = old
        self.assertEqual(fake.paths, ["/auth/v1/token?grant_type=refresh_token"])
        return ex.exception.code, err.getvalue()

    def test_refresh_token_not_found_says_signed_out(self):
        code, err = self.refresh(400, NOT_FOUND)
        self.assertEqual(code, 3)
        self.assertIn(SIGNED_OUT, err)
        self.assertNotIn("refresh_token_not_found", err, "the raw answer is not shown")

    def test_invalid_grant_says_signed_out(self):
        code, err = self.refresh(400, INVALID_GRANT)
        self.assertEqual(code, 3)
        self.assertIn(SIGNED_OUT, err)

    def test_another_refusal_keeps_the_raw_answer(self):
        code, err = self.refresh(400, '{"error_code":"validation_failed","msg":"bad apikey"}')
        self.assertEqual(code, 1)
        self.assertIn("400", err)
        self.assertIn("validation_failed", err)
        self.assertNotIn("signed out", err)

    def test_a_valid_session_does_not_refresh(self):
        fake = FakeAuth(400, NOT_FOUND)
        self.addCleanup(fake.close)
        with tempfile.TemporaryDirectory() as tmp:
            p = expired_cfg(tmp, fake.url)
            cfg = json.loads(p.read_text()); cfg["expires_at"] = 2 ** 40; p.write_text(json.dumps(cfg))
            old, rb.CFG_PATH = rb.CFG_PATH, p
            try:
                self.assertEqual(rb.session()["access_token"], "old")
            finally:
                rb.CFG_PATH = old
        self.assertEqual(fake.paths, [])


def bash(script, *args, env=None):
    return subprocess.run(["bash", "-c", 'src="$1"; shift; source "$src"; ' + script, "bash", str(ROOT / "tools" / "nightly.sh"), *args],
                          capture_output=True, text=True, env=env)


class NightlyNotice(unittest.TestCase):
    def test_exit_3_says_signed_out(self):
        self.assertEqual(bash('rb_failed_notice "$@"', "3").stdout.strip(), "Reelbook night run: signed out, run rb.py login")

    def test_another_exit_says_queue_failed(self):
        self.assertEqual(bash('rb_failed_notice "$@"', "1").stdout.strip(), "Night run: rb.py queue failed (exit 1)")

    def test_a_revoked_session_reaches_the_notice(self):
        """rb.py queue against the fake server, through nightly.sh's queued(): exit 3, then the signed-out notice."""
        fake = FakeAuth(400, NOT_FOUND)
        self.addCleanup(fake.close)
        with tempfile.TemporaryDirectory() as tmp:
            env = {**os.environ, "REELBOOK_CONFIG": str(expired_cfg(tmp, fake.url))}
            r = bash(f'REPO="{ROOT}"; n="$(queued)"; rc=$?; echo "$rc"; rb_failed_notice "$rc"', env=env)
        self.assertEqual(r.stdout.splitlines(), ["3", "Reelbook night run: signed out, run rb.py login"])
        self.assertEqual(fake.paths, ["/auth/v1/token?grant_type=refresh_token"])


if __name__ == "__main__":
    unittest.main()
