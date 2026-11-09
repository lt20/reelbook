"""Queue commands of tools/rb.py (claim, requeue-stuck, queue notes, list --since) and the night run notice.

No network: rb.session / rb.rest are replaced by an in-memory fake. Run: python3 -I tests/rb-queue.test.py
"""
import contextlib, importlib.util, io, json, os, pathlib, re, subprocess, time, unittest

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
        self.assertIn("slug", calls[0][3]["select"].split(","), "a Redo names the page flagged")
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


class ReasonFake(Fake):
    """A backend with or without requests.reason (P8 R3). With it, a read returns the columns selected (reason: null
    included); without it, a read naming it answers 42703 and a write naming it PGRST204, both HTTP 400."""
    def __init__(self, requests, column=True):
        super().__init__(requests)
        self.column = column

    def rest(self, cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
        params = params or {}
        cols = (params.get("select") or "").split(",")
        if not self.column and method == "GET" and "reason" in cols:
            self.calls.append((method, path, data, params))
            raise rb.RbHTTPError(400, '{"code":"42703","message":"column requests.reason does not exist"}')
        if not self.column and method == "PATCH" and "reason" in (data or {}):
            self.calls.append((method, path, data, params))
            raise rb.RbHTTPError(400, '{"code":"PGRST204","message":"Could not find the \'reason\' column of \'requests\' in the schema cache"}')
        rows = super().rest(cfg, method, path, data, prefer, params, tolerate)
        if method == "GET" and cols != [""]:
            rows = [{c: r.get(c) for c in cols} for r in rows]
        return rows


class ErrorReason(Base):
    def use_reason(self, requests, column=True):
        self.fake = ReasonFake(requests, column)
        rb.session, rb.rest = (lambda: CFG), self.fake.rest
        return self.fake

    def row(self, fake, rid="a"):
        return next(r for r in fake.requests if r["id"] == rid)

    def test_every_reason_of_the_column_is_accepted_and_written(self):
        sql = (ROOT / "supabase" / "schema.sql").read_text()
        check = sql.split("add constraint requests_reason_check", 1)[1].split(";", 1)[0]
        self.assertEqual(tuple(re.findall(r"'([a-z_]+)'", check)), rb.REASONS, "one list for the column and rb.py")
        for reason in ("signin_required", "private", "removed", "not_video", "other", "quota"):
            fake = self.use_reason([{"id": "a", "status": "processing", "note": None, "reason": None}])
            self.run_cmd(rb.cmd_error, ["a", "--reason", reason, "--note", "Login", "wall"])
            self.assertEqual({k: self.row(fake)[k] for k in ("status", "reason", "note")}, {"status": "error", "reason": reason, "note": "Login wall"})

    def test_the_reason_may_come_after_the_note(self):
        fake = self.use_reason([{"id": "a", "status": "processing", "note": None, "reason": None}])
        self.run_cmd(rb.cmd_error, ["a", "--note", "Private account", "--reason", "private"])
        self.assertEqual((self.row(fake)["reason"], self.row(fake)["note"]), ("private", "Private account"))

    def test_an_unknown_reason_or_a_missing_value_writes_nothing(self):
        for args in (["a", "--reason", "login", "--note", "x"], ["a", "--note", "x", "--reason"], ["a", "--reason", "private"]):
            fake = self.use_reason([{"id": "a", "status": "processing", "note": None, "reason": None}])
            with self.assertRaises(SystemExit, msg=args):
                self.run_cmd(rb.cmd_error, args)
            self.assertEqual(fake.patches(), [], args)

    def test_no_reason_clears_one_left_from_before(self):
        fake = self.use_reason([{"id": "a", "status": "processing", "note": None, "reason": "processing_failed"}])
        self.run_cmd(rb.cmd_error, ["a", "--note", "Video unavailable"])
        self.assertEqual((self.row(fake)["status"], self.row(fake)["reason"]), ("error", None), "no reason reads « other » in the app")

    def test_a_retry_reason_goes_back_in_the_queue_once_then_is_other(self):
        fake = self.use_reason([{"id": "a", "status": "processing", "note": None, "reason": None, "processed_at": iso(1)}])
        self.run_cmd(rb.cmd_error, ["a", "--reason", "processing_failed", "--note", "ffmpeg could not read the frames"])
        r = self.row(fake)
        self.assertEqual((r["status"], r["reason"], r["processed_at"]), ("queued", "processing_failed", None), "the next run tries it once more")
        r["status"] = "processing"
        self.run_cmd(rb.cmd_error, ["a", "--reason", "fetch_blocked", "--note", "blocked again"])
        r = self.row(fake)
        self.assertEqual((r["status"], r["reason"], r["note"]), ("error", "other", "blocked again"), "failed twice: the user sees it")

    def test_a_correction_keeps_its_redo_line_with_a_reason(self):
        fake = self.use_reason([{"id": "a", "status": "processing", "note": "Redo: the hands are reversed", "reason": None}])
        self.run_cmd(rb.cmd_error, ["a", "--reason", "signin_required", "--note", "Login wall"])
        self.assertEqual(self.row(fake)["note"], "Redo: the hands are reversed\nLogin wall")

    def test_a_backend_without_the_column_gets_the_error_without_its_reason(self):
        fake = self.use_reason([{"id": "a", "status": "processing", "note": "Redo: x"}], column=False)
        _, err = self.run_cmd(rb.cmd_error, ["a", "--reason", "private", "--note", "Private account"])
        self.assertEqual(self.row(fake), {"id": "a", "status": "error", "note": "Redo: x\nPrivate account", "processed_at": self.row(fake)["processed_at"]})
        gets = [c[3]["select"] for c in fake.calls if c[0] == "GET"]
        self.assertEqual(gets, ["note,reason", "note"], "the read is tried again without the column")
        patches = [c[2] for c in fake.patches()]
        self.assertEqual(len(patches), 2)
        self.assertIn("reason", patches[0]); self.assertNotIn("reason", patches[1])
        self.assertIn("no requests.reason column", err)

    def test_without_the_column_a_retry_reason_stays_an_error(self):
        fake = self.use_reason([{"id": "a", "status": "processing", "note": None}], column=False)
        self.run_cmd(rb.cmd_error, ["a", "--reason", "processing_failed", "--note", "no frames"])
        self.assertEqual(self.row(fake)["status"], "error", "no trace of a first try: it is not queued again forever")

    def test_a_quota_refusal_flags_its_request_with_the_quota_reason(self):
        fake = self.use_reason([{"id": "q", "status": "processing", "note": None, "reason": None}])
        saved, rb.REQUEST_ID = rb.REQUEST_ID, "q"
        try:
            with self.assertRaises(SystemExit):
                self.run_cmd(lambda a: rb._quota_stop(CFG, "300 sheets"), [])
        finally:
            rb.REQUEST_ID = saved
        self.assertEqual((self.row(fake, "q")["status"], self.row(fake, "q")["reason"]), ("error", "quota"))


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
    def line(self, kind, slug, title, group="Upper body"):   # as rb.py list --since prints it
        return "\t".join(["strength", group, kind, slug, title])

    def test_a_group_named_like_a_kind_is_not_misread(self):
        self.assertEqual(night_notice(0, 0, self.line("sheet", "curl", "Curl", group="Upper body session")),
                         ("1 new sheet: Curl", "https://lt20.github.io/reelbook/#curl"))

    def test_lines_without_tabs_are_read_word_by_word(self):
        self.assertEqual(night_notice(0, 0, f"{'strength':9} {'Arms':20} {'sheet':8} {'curl':32} Curl marteau"),
                         ("1 new sheet: Curl marteau", "https://lt20.github.io/reelbook/#curl"))

    def test_rb_list_since_output_feeds_the_notice(self):
        calls = []
        def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            calls.append(path)
            return [{"slug": "curl", "kind": "sheet", "theme": "strength", "group": "Upper body session", "title": "Curl marteau"}] if path == "sheets" else []
        saved = (rb.session, rb.rest)
        rb.session, rb.rest = (lambda: CFG), rest
        try:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                rb.cmd_list(["--since", "2026-11-03T02:00:00Z"])
        finally:
            rb.session, rb.rest = saved
        self.assertEqual(out.getvalue(), "strength\tUpper body session\tsheet\tcurl\tCurl marteau\n")
        self.assertEqual(night_notice(0, 0, out.getvalue())[1], "https://lt20.github.io/reelbook/#curl")

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
