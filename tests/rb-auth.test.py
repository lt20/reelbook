"""A revoked session in tools/rb.py (F1): when the refresh token is refused (signed out everywhere, password changed),
rb.py says « signed out, run rb.py login » and exits 3 rather than printing the raw answer; tools/nightly.sh turns
that exit code into the phone notice.

No real backend: a fake auth server on 127.0.0.1 answers the refresh, the config is a temporary file.
Run: python3 -I tests/rb-auth.test.py
"""
import contextlib, http.server, importlib.util, io, json, os, pathlib, subprocess, sys, tempfile, threading, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb", ROOT / "tools" / "rb.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

NOT_FOUND = '{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}'
INVALID_GRANT = '{"error":"invalid_grant","error_description":"Invalid Refresh Token: Already Used"}'
SIGNED_OUT = "Your computer was signed out of Reelbook (session revoked). Run: python3 "
RB = (ROOT / "tools" / "rb.py").resolve()


def login_command(err):
    """The rb.py path the message gives, checked to be this very script (wherever it was installed)."""
    line = next(l for l in err.splitlines() if SIGNED_OUT in l)
    assert line.endswith(" login"), line
    return pathlib.Path(os.path.expanduser(line.split(SIGNED_OUT, 1)[1][:-len(" login")])).resolve()


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
        self.assertEqual(login_command(err), RB, "the login command names this rb.py, wherever it lives")
        self.assertNotIn("refresh_token_not_found", err, "the raw answer is not shown")

    def test_invalid_grant_says_signed_out(self):
        code, err = self.refresh(400, INVALID_GRANT)
        self.assertEqual(code, 3)
        self.assertEqual(login_command(err), RB, "the login command names this rb.py, wherever it lives")

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


class LoginMarksTheComputer(unittest.TestCase):
    """L43: rb.py login writes reelbook_cli_at in user_metadata (read by #welcome). A failure never blocks the login."""
    TOKEN = {"access_token": "at", "refresh_token": "rt", "expires_in": 3600, "user": {"id": "u1"}}

    def login(self, put):
        seen = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def answer(self, status, body):
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                seen.append(("POST", self.path, None, None))
                self.answer(200, json.dumps(LoginMarksTheComputer.TOKEN).encode())

            def do_PUT(self):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                seen.append(("PUT", self.path, json.loads(body), {k.lower(): v for k, v in self.headers.items()}))
                if put is None:  # the connection drops, no answer at all
                    self.close_connection = True
                    return
                self.answer(put, b'{"msg":"nope"}')

            def log_message(self, *a): pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}"
        return self.run_login(url), seen

    def run_login(self, url):
        out, err = io.StringIO(), io.StringIO()
        old_env = {k: os.environ.get(k) for k in ("REELBOOK_EMAIL", "REELBOOK_PASSWORD")}
        os.environ.update(REELBOOK_EMAIL="user@example.test", REELBOOK_PASSWORD="pw")
        old = rb.CFG_PATH
        with tempfile.TemporaryDirectory() as tmp:
            rb.CFG_PATH = pathlib.Path(tmp) / "config.json"
            try:
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    rb.cmd_login(["--url", url, "--key", "the-key"])
                cfg = json.loads(rb.CFG_PATH.read_text())
            finally:
                rb.CFG_PATH = old
                for k, v in old_env.items():
                    if v is None: os.environ.pop(k, None)
                    else: os.environ[k] = v
        return out.getvalue(), err.getvalue(), cfg

    def test_success_writes_the_date_with_the_session(self):
        (out, err, cfg), seen = self.login(200)
        self.assertEqual([s[:2] for s in seen], [("POST", "/auth/v1/token?grant_type=password"), ("PUT", "/auth/v1/user")])
        body, headers = seen[1][2], seen[1][3]
        self.assertEqual(list(body), ["data"])
        self.assertEqual(list(body["data"]), ["reelbook_cli_at"], "merged by GoTrue: nothing else in the metadata is touched")
        self.assertRegex(body["data"]["reelbook_cli_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(headers["apikey"], "the-key")
        self.assertEqual(headers["authorization"], "Bearer at")
        self.assertIn("signed in as user@example.test", out)
        self.assertEqual(err, "")
        self.assertEqual(cfg["access_token"], "at")

    def test_a_refused_write_is_silent_and_the_login_stands(self):
        for status in (401, 403, 404, 500):
            (out, err, cfg), seen = self.login(status)
            self.assertEqual(seen[-1][:2], ("PUT", "/auth/v1/user"))
            self.assertEqual(out.strip().count("\n"), 0, "one line: signed in")
            self.assertIn("signed in as user@example.test", out)
            self.assertEqual(err, "")
            self.assertEqual(cfg["refresh_token"], "rt")

    def test_a_dropped_connection_is_silent_and_the_login_stands(self):
        (out, err, cfg), seen = self.login(None)
        self.assertIn("signed in as user@example.test", out)
        self.assertEqual(err, "")
        self.assertEqual(cfg["user_id"], "u1")

    def test_an_unreachable_server_is_silent(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rb.mark_cli_login("http://127.0.0.1:9", "k", "t")
        self.assertEqual((out.getvalue(), err.getvalue()), ("", ""))


class LoginFallsBackToCliLogin(LoginMarksTheComputer):
    """L42a: the direct password grant first; on `captcha_failed` only (Turnstile on), the project's cli-login function.
    A backend without a captcha never calls it. Answers as measured on a local Auth with Turnstile on."""
    CAPTCHA = b'{"code":400,"error_code":"captcha_failed","msg":"captcha protection: request disallowed (no captcha response)"}'
    WRONG = b'{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}'

    def serve(self, token_answer, relay_answer):
        seen = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def answer(self, status, body):
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"null")
                seen.append(("POST", self.path, body, {k.lower(): v for k, v in self.headers.items()}))
                if self.path.startswith("/auth/v1/token"): self.answer(*token_answer)
                elif self.path == "/functions/v1/cli-login": self.answer(*relay_answer)
                else: self.answer(404, b"{}")

            def do_PUT(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                seen.append(("PUT", self.path, None, None))
                self.answer(200, b"{}")

            def log_message(self, *a): pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_port}", seen

    def attempt(self, token_answer, relay_answer):
        url, seen = self.serve(token_answer, relay_answer)
        real_die, said = rb.die, io.StringIO()
        def die(msg, code=1):   # rb.die, its line kept (run_login swallows stderr)
            print(f"rb: {msg}", file=said); raise SystemExit(code)
        rb.die = die
        try:
            return self.run_login(url), None, seen
        except SystemExit as e:
            sys.stderr.write(said.getvalue())
            return None, e.code, seen
        finally:
            rb.die = real_die

    def test_captcha_failed_goes_through_cli_login(self):
        relay = (200, json.dumps({**self.TOKEN, "expires_at": 1, "token_type": "bearer"}).encode())
        (out, err, cfg), code, seen = self.attempt((400, self.CAPTCHA), relay)
        self.assertEqual([s[:2] for s in seen], [("POST", "/auth/v1/token?grant_type=password"),
                                                 ("POST", "/functions/v1/cli-login"), ("PUT", "/auth/v1/user")])
        self.assertEqual(seen[1][2], {"email": "user@example.test", "password": "pw"})
        self.assertEqual(seen[1][3]["apikey"], "the-key")
        self.assertEqual((cfg["user_id"], cfg["access_token"], cfg["refresh_token"]), ("u1", "at", "rt"))
        self.assertIn("signed in as user@example.test", out)
        self.assertEqual(err, "")

    def test_a_backend_without_captcha_never_calls_it(self):
        _, _, seen = self.attempt((200, json.dumps(self.TOKEN).encode()), (500, b"{}"))
        self.assertNotIn("/functions/v1/cli-login", [s[1] for s in seen])
        with contextlib.redirect_stderr(io.StringIO()) as err:
            _, code, seen = self.attempt((400, self.WRONG), (500, b"{}"))
        self.assertEqual(code, 1)
        self.assertEqual([s[1] for s in seen], ["/auth/v1/token?grant_type=password"], "a wrong password is not a captcha")
        self.assertIn("invalid_credentials", err.getvalue())

    def test_the_function_s_refusals_are_one_plain_line(self):
        cases = [((401, b'{"error":"invalid_credentials","message":"Wrong email or password."}'), "rb: Wrong email or password."),
                 ((429, b'{"error":"too_many_attempts","message":"Too many sign-in attempts. Try again in 15 minutes."}'),
                  "rb: Too many sign-in attempts. Try again in 15 minutes."),
                 ((404, b'{"msg":"Function not found"}'), "rb: this backend asks a captcha to sign in, and its cli-login function is not deployed")]
        for relay, line in cases:
            with contextlib.redirect_stderr(io.StringIO()) as err:
                _, code, _ = self.attempt((400, self.CAPTCHA), relay)
            self.assertEqual(code, 1)
            self.assertTrue(err.getvalue().startswith(line), err.getvalue())
            self.assertNotIn("pw", err.getvalue().replace("password", ""), "the password never shows")


if __name__ == "__main__":
    unittest.main()
