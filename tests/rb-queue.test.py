"""Queue commands of tools/rb.py (claim, requeue-stuck, queue notes, list --since) and the night run notice.

No network: rb.session / rb.rest are replaced by an in-memory fake. Run: python3 -I tests/rb-queue.test.py
"""
import contextlib, importlib.util, io, json, os, pathlib, subprocess, time, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb", ROOT / "tools" / "rb.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

CFG = {"url": "https://x.supabase.co", "anon_key": "k", "access_token": "t", "user_id": "u"}


def iso(hours_ago):
    return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() - hours_ago * 3600))


class Fake:
    def __init__(self, requests):
        self.requests, self.calls = [dict(r) for r in requests], []

    def rest(self, cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
        params = params or {}
        self.calls.append((method, path, data, params))
        assert path == "requests"
        match = lambda r: all(r.get(k) == v[3:] for k, v in params.items() if k in ("id", "status"))
        if method == "GET":
            return [dict(r) for r in self.requests if match(r)]
        if method == "PATCH":
            hit = [r for r in self.requests if match(r)]
            for r in hit: r.update(data)
            return [dict(r) for r in hit]
        raise AssertionError(method)

    def patches(self):
        return [c for c in self.calls if c[0] == "PATCH"]


class Base(unittest.TestCase):
    def setUp(self):
        self._saved = (rb.session, rb.rest)

    def tearDown(self):
        rb.session, rb.rest = self._saved

    def use(self, requests):
        self.fake = Fake(requests)
        rb.session, rb.rest = (lambda: CFG), self.fake.rest
        return self.fake

    def run_cmd(self, fn, args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            fn(args)
        return out.getvalue(), err.getvalue()


class Claim(Base):
    def test_claim_stamps_the_claim_time_and_needs_a_queued_request(self):
        fake = self.use([{"id": "a", "status": "queued"}])
        self.run_cmd(rb.cmd_claim, ["a"])
        (_, _, data, params), = fake.patches()
        self.assertEqual(data["status"], "processing")
        self.assertRegex(data["processed_at"], r"^\d{4}-\d\d-\d\dT")
        self.assertEqual(params["status"], "eq.queued")


class RequeueStuck(Base):
    REQ = [
        # the 2026-11-01 case: claimed by the old rb.py (no processed_at), Mac asleep, never closed
        {"id": "old", "url": "https://ig/old", "status": "processing", "processed_at": None, "created_at": iso(24 * 8)},
        {"id": "dead", "url": "https://ig/dead", "status": "processing", "processed_at": iso(7), "created_at": iso(30)},
        {"id": "busy", "url": "https://ig/busy", "status": "processing", "processed_at": iso(1), "created_at": iso(50)},
        {"id": "q", "url": "https://ig/q", "status": "queued", "processed_at": None, "created_at": iso(100)},
        {"id": "done", "url": "https://ig/done", "status": "done", "processed_at": iso(90), "created_at": iso(100)},
    ]

    def test_requeues_only_requests_processing_for_more_than_6_hours(self):
        fake = self.use(self.REQ)
        out, err = self.run_cmd(rb.cmd_requeue_stuck, [])
        by_id = {r["id"]: r for r in fake.requests}
        self.assertEqual([by_id[i]["status"] for i in ("old", "dead", "busy", "q", "done")],
                         ["queued", "queued", "processing", "queued", "done"])
        self.assertIsNone(by_id["dead"]["processed_at"])
        self.assertIn("requeued after a run stopped mid-way", by_id["old"]["note"])
        for _, _, _, params in fake.patches():
            self.assertEqual(params["status"], "eq.processing", "a request closed meanwhile is left alone")
        self.assertIn("3 processing, 2 requeued", out)
        self.assertIn("keep busy", err)

    def test_dry_run_writes_nothing(self):
        fake = self.use(self.REQ)
        out, _ = self.run_cmd(rb.cmd_requeue_stuck, ["--dry-run"])
        self.assertEqual(fake.patches(), [])
        self.assertIn("would requeue old: https://ig/old", out)
        self.assertIn("2 to requeue (dry run", out)

    def test_hours_option(self):
        fake = self.use(self.REQ)
        self.run_cmd(rb.cmd_requeue_stuck, ["--hours", "0.5"])
        self.assertEqual(len(fake.patches()), 3)

    def test_nothing_processing(self):
        fake = self.use([r for r in self.REQ if r["status"] != "processing"])
        out, _ = self.run_cmd(rb.cmd_requeue_stuck, [])
        self.assertEqual(fake.patches(), [])
        self.assertIn("0 processing, 0 requeued", out)

    def test_postgres_timestamps_with_trimmed_fraction(self):
        # Postgres drops trailing zeros (« .12345 »): Python 3.9 / 3.10 fromisoformat refuses them,
        # and an unreadable stamp must not requeue a request claimed a minute ago
        stamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - 60))
        for frac in (".1", ".12", ".1234", ".12345", ".123456", ".1234567", ""):
            for tz in ("+00:00", "Z"):
                self.assertIsNotNone(rb._ts(stamp + frac + tz), frac + tz)
        self.assertAlmostEqual(rb._ts("2026-11-03T10:00:00.5+00:00") - rb._ts("2026-11-03T10:00:00+00:00"), 0.5)
        self.assertIsNone(rb._ts("not a date"))
        fake = self.use([{"id": "fresh", "url": "https://ig/fresh", "status": "processing",
                          "processed_at": stamp + ".12345+00:00", "created_at": stamp + ".1+00:00"}])
        out, err = self.run_cmd(rb.cmd_requeue_stuck, [])
        self.assertEqual(fake.patches(), [])
        self.assertIn("keep fresh", err)

    def test_bad_arguments(self):
        self.use([])
        for args in (["--hours"], ["--hours", "x"], ["--hours", "0"], ["--yes"]):
            with self.assertRaises(SystemExit, msg=args):
                self.run_cmd(rb.cmd_requeue_stuck, args)

    def test_a_correction_keeps_its_redo_note(self):
        fake = self.use([{"id": "fix", "url": "https://ig/fix", "status": "processing", "processed_at": iso(8),
                          "created_at": iso(9), "note": "Redo: the hands are reversed"}])
        self.run_cmd(rb.cmd_requeue_stuck, [])
        self.assertEqual(fake.requests[0]["status"], "queued")
        self.assertEqual(fake.requests[0]["note"], "Redo: the hands are reversed")


class Queue(Base):
    def use_queue(self, requests, sessions_table=True):
        calls = []
        def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            calls.append((method, path, data, params or {}))
            if path == "requests": return [dict(r) for r in requests]
            if path == "sessions" and not sessions_table: raise rb.RbHTTPError(404, "no table")
            hit = (params or {}).get("source->>url") == "eq.https://ig/r"
            return ([{"slug": "gsp-angel"}, {"slug": "gsp-press"}] if path == "sheets" else [{"slug": "gsp"}]) if hit else []
        rb.session, rb.rest = (lambda: CFG), rest
        return calls

    def test_queue_lines_carry_the_note_and_what_a_redo_republishes(self):
        calls = self.use_queue([{"id": "r", "url": "https://ig/r", "theme": "strength", "note": "Redo: correct the angle", "created_at": iso(1)},
                                {"id": "s", "url": "https://ig/s", "theme": None, "note": None, "created_at": iso(1)}])
        out, _ = self.run_cmd(rb.cmd_queue, [])
        self.assertIn("note", calls[0][3]["select"].split(","))
        redo, plain = [json.loads(line) for line in out.strip().split("\n")]
        self.assertEqual(redo["note"], "Redo: correct the angle")
        self.assertEqual(redo["redo_of"], {"sheets": ["gsp-angel", "gsp-press"], "sessions": ["gsp"]})
        self.assertNotIn("redo_of", plain)
        self.assertEqual(len(calls), 3, "only a Redo request looks up its published pages")

    def test_redo_on_a_backend_without_sessions(self):
        self.use_queue([{"id": "r", "url": "https://ig/r", "note": "Redo: x", "created_at": iso(1)}], sessions_table=False)
        out, _ = self.run_cmd(rb.cmd_queue, [])
        self.assertEqual(json.loads(out)["redo_of"]["sessions"], [])

    def test_error_keeps_the_redo_line_first(self):
        fake = self.use([{"id": "r", "status": "processing", "note": "Redo: correct the angle"},
                         {"id": "p", "status": "processing", "note": None}])
        self.run_cmd(rb.cmd_error, ["r", "--note", "Video", "unavailable"])
        self.run_cmd(rb.cmd_error, ["p", "--note", "Video unavailable"])
        by_id = {r["id"]: r for r in fake.requests}
        self.assertEqual(by_id["r"]["note"], "Redo: correct the angle\nVideo unavailable")
        self.assertEqual(by_id["p"]["note"], "Video unavailable")
        self.assertEqual(by_id["r"]["status"], "error")


class ListSince(Base):
    SHEETS = [{"slug": "curl", "kind": "sheet", "theme": "strength", "group": "Upper body", "title": "Curl marteau en 5 étapes"},
              {"slug": "gsp-floor-angel", "kind": "sheet", "theme": "strength", "group": "Shoulders", "title": "Floor angel"}]
    SESSIONS = [{"slug": "gsp", "theme": "strength", "title": "GSP shoulders", "items": [{"slug": "gsp-floor-angel", "dose": "30 s"}]}]

    def use_catalogue(self, sessions=SESSIONS):
        calls = []
        def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            calls.append((method, path, params or {}))
            if path == "sessions" and sessions is None: raise rb.RbHTTPError(404, "no table")
            return [dict(r) for r in (self.SHEETS if path == "sheets" else sessions)]
        rb.session, rb.rest = (lambda: CFG), rest
        return calls

    def test_since_filters_on_publication_time_and_folds_a_session_s_sheets(self):
        calls = self.use_catalogue()
        out, _ = self.run_cmd(rb.cmd_list, ["--since", "2026-11-03T02:00:00Z"])
        params = {path: p for _, path, p in calls}
        self.assertEqual(params["sheets"]["added_at"], "gte.2026-11-03T02:00:00Z")
        self.assertEqual(params["sessions"]["created_at"], "gte.2026-11-03T02:00:00Z")
        self.assertEqual(params["sessions"]["origin"], "eq.video", "a session made in the app meanwhile is not « new »")
        self.assertIn("Curl marteau en 5 étapes", out)
        self.assertIn("GSP shoulders", out)
        self.assertNotIn("Floor angel", out, "the session stands for its exercise sheets")

    def test_plain_list_is_unchanged(self):
        calls = self.use_catalogue()
        out, _ = self.run_cmd(rb.cmd_list, [])
        self.assertNotIn("added_at", calls[0][2])
        self.assertIn("Floor angel", out)

    def test_backend_without_sessions_table(self):
        self.use_catalogue(sessions=None)
        out, err = self.run_cmd(rb.cmd_list, ["--since", "2026-11-03T02:00:00Z"])
        self.assertIn("Floor angel", out)
        self.assertIn("no sessions table", err)

    def test_bad_arguments(self):
        self.use_catalogue()
        for args in (["--since"], ["--since", "yesterday"], ["--all"]):
            with self.assertRaises(SystemExit, msg=args):
                self.run_cmd(rb.cmd_list, args)


def night_notice(status, left, listing, app_url=None):
    """tools/nightly.sh night_notice → (message, url opened when the notice is tapped)."""
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": os.environ.get("HOME", "/tmp")}
    if app_url: env["REELBOOK_APP_URL"] = app_url
    r = subprocess.run(["bash", "-c", 'src="$1"; shift; source "$src"; night_notice "$@"', "bash", str(ROOT / "tools" / "nightly.sh"),
                        str(status), str(left), listing], capture_output=True, text=True, env=env, check=True)
    msg, url = r.stdout.rstrip("\n").split("\n")
    return msg, url


class NightNotice(unittest.TestCase):
    def line(self, kind, slug, title, group="Upper body"):
        return f"{'strength':9} {group:20} {kind:8} {slug:32} {title}"

    def test_lists_the_titles_and_opens_the_app(self):
        listing = "\n".join([self.line("sheet", "curl", "Curl marteau en 5 étapes"), self.line("session2", "gsp", "Backroll")])
        msg, url = night_notice(0, 0, listing)
        self.assertEqual(msg, "2 new sheets: Curl marteau en 5 étapes, Backroll")
        self.assertEqual(url, "https://lt20.github.io/reelbook/")

    def test_one_title_opens_its_page(self):
        self.assertEqual(night_notice(0, 0, self.line("sheet", "curl", "Curl"), "https://x.test/rb/"),
                         ("1 new sheet: Curl", "https://x.test/rb/#curl"))
        self.assertEqual(night_notice(0, 0, self.line("session2", "gsp", "GSP shoulders"))[1],
                         "https://lt20.github.io/reelbook/#session/gsp")

    def test_nothing_published_and_requests_left(self):
        msg, url = night_notice(1, 3, "")
        self.assertEqual(msg, "Night run: nothing published (claude exit 1) · 3 still queued")
        self.assertEqual(url, "https://lt20.github.io/reelbook/")
        self.assertEqual(night_notice(0, 2, self.line("sheet", "a", "A"))[0], "1 new sheet: A · 2 still queued")


if __name__ == "__main__":
    unittest.main()
