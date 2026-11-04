"""Quotas in tools/rb.py (L29): a publish refused by a limit of the backend says which limit and what to do, and with
--request flags that request as error with the same message. Checked before anything is sent (no photo left without
a sheet), photos the backend already holds are not sent again (a full account can still republish), photos added by
a publish refused midway are removed, and requeue-sessions queues what fits today.

No network: `session`, `rest` and `http` are replaced by fakes that record every call.
Run: python3 -I tests/rb-quota.test.py
"""
import contextlib, hashlib, importlib.util, io, json, pathlib, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb", ROOT / "tools" / "rb.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

CFG = {"url": "https://example.test", "anon_key": "k", "access_token": "t", "user_id": "u1"}
SHEETS_QUOTA = '{"code":"P0001","details":null,"hint":"Delete sheets you no longer need, or ask whoever runs this backend for more.","message":"quota: 300 sheets"}'
PHOTOS_QUOTA = '{"statusCode":"400","error":"DatabaseError","message":"quota: 200 MB of photos"}'
LINKS_QUOTA = '{"code":"P0001","message":"quota: 10 links per day"}'
RLS = '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}'
META = {"slug": "floor", "theme": "strength", "group": "Arms", "title": "Floor"}
MB = 1048576
MD5_A = hashlib.md5(b"jpg-a").hexdigest()


def quota(sheets=12, photos=10 * MB):
    return {"requests_today": 1, "max_requests_per_day": 10, "sheets": sheets, "max_sheets": 300,
            "storage_bytes": photos, "max_storage_mb": 200}


def run(fn):
    out, err = io.StringIO(), io.StringIO()
    code = None
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            fn()
        except SystemExit as e:
            code = e.code
    return code, out.getvalue(), err.getvalue()


class Base(unittest.TestCase):
    def setUp(self):
        self.calls, self.http_calls = [], []
        self.saved = (rb.rest, rb.http, rb.session, rb.REQUEST_ID)
        rb.session = lambda: CFG
        self.tmp = tempfile.TemporaryDirectory()
        d = pathlib.Path(self.tmp.name) / "floor"
        (d / "img").mkdir(parents=True)
        (d / "index.html").write_text("<p>Floor</p>")
        (d / "img" / "a.jpg").write_bytes(b"jpg-a")
        (d / "img" / "b.jpg").write_bytes(b"jpg-b")
        self.dir = d

    def tearDown(self):
        rb.rest, rb.http, rb.session, rb.REQUEST_ID = self.saved
        self.tmp.cleanup()

    def fake(self, upload=None, sheet=None, q=None, remote=None, existing=(), note="Redo: fix the title", requests=None):
        """upload: (code, body) the storage answers to an upload (a callable: per file name); sheet: (code, body) the
        sheet upsert answers; q: my_quota's answer (None: no such function); remote: [{name, metadata}] already stored;
        existing: slugs the account already has; requests: callable(row or list) -> error body or None."""
        def http(method, url, headers=None, data=None, raw=False, tolerate=()):
            self.http_calls.append((method, url.split("/storage/v1/")[-1], data if not raw else None, tolerate))
            if "object/list/sheets" in url: return remote or []
            if method == "POST" and upload:
                err = upload(url.rsplit("/", 1)[-1]) if callable(upload) else upload
                if err: raise rb.RbHTTPError(*err)
            return None
        def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            self.calls.append((method, path, data, dict(params or {})))
            if path == "rpc/my_quota":
                if q is None: raise rb.RbHTTPError(404, '{"code":"PGRST202"}')
                return q
            if path == "sheets" and method == "GET": return [{"slug": s} for s in existing if params.get("slug") == f"eq.{s}"]
            if path == "sheets" and method == "POST":
                if sheet: raise rb.RbHTTPError(*sheet)
                return [{"id": "row"}]
            if path == "requests" and method == "GET": return [{"note": note}]
            if path == "requests" and method == "PATCH": return [{"id": params["id"][3:], **data}]
            if path == "requests" and method == "POST" and requests:
                err = requests(data)
                if err: raise rb.RbHTTPError(400, err)
            return []
        rb.http, rb.rest = http, rest

    def uploads(self):
        return [c[1].rsplit("/", 1)[-1] for c in self.http_calls if c[0] == "POST" and c[1].startswith("object/sheets/")]

    def publish(self, q="ask"):
        q = rb._my_quota(CFG) if q == "ask" else q
        return run(lambda: rb._publish_sheet(CFG, self.dir, dict(META), q))


class SheetQuota(Base):
    def test_new_sheet_past_the_limit_stops_before_any_photo_is_sent(self):
        self.fake(q=quota(sheets=300))
        rb.REQUEST_ID = "r42"
        code, _, err = self.publish()
        self.assertEqual(code, 1)
        self.assertEqual(self.uploads(), [], "no photo left without a sheet")
        self.assertFalse([c for c in self.calls if c[:2] == ("POST", "sheets")])
        self.assertIn("quota reached on this backend: 300 sheets for this account.", err)
        for words in ("rb.py delete <slug>", "https://github.com/lt20/reelbook/issues", "Limits on a shared backend"):
            self.assertIn(words, err)
        patch = [c for c in self.calls if c[0] == "PATCH"]
        self.assertEqual(patch[0][3], {"id": "eq.r42"})
        self.assertEqual(patch[0][2]["status"], "error")
        self.assertEqual(patch[0][2]["note"], "Redo: fix the title\n" + rb.quota_message("300 sheets"), "a Redo keeps its first line")

    def test_existing_sheet_at_the_limit_is_republished(self):
        self.fake(q=quota(sheets=300), existing=("floor",))
        code, _, err = self.publish()
        self.assertIsNone(code, err)
        self.assertEqual(self.uploads(), ["a.jpg", "b.jpg"])
        self.assertIn("published floor: 2 image(s)", err)

    def test_refusal_by_the_database_removes_the_photos_this_publish_added(self):
        # a race (another device took the last slot): the trigger refuses the row after the photos went up
        self.fake(q=quota(sheets=299), sheet=(400, SHEETS_QUOTA), remote=[{"name": "b.jpg", "metadata": {"eTag": '"other"'}}])
        code, _, err = self.publish()
        self.assertEqual(code, 1)
        self.assertEqual(self.uploads(), ["a.jpg", "b.jpg"])
        deletes = [c for c in self.http_calls if c[0] == "DELETE"]
        self.assertEqual(deletes[0][2], {"prefixes": ["u1/floor/img/a.jpg"]}, "only the new photo; b.jpg was an overwrite")
        self.assertIn("quota reached on this backend: 300 sheets", err)
        self.assertNotIn("P0001", err, "no raw JSON")
        self.assertFalse([c for c in self.calls if c[1] == "requests"], "no request touched without --request")

    def test_backend_without_quotas_and_other_errors_unchanged(self):
        self.fake()
        self.assertIsNone(rb._my_quota(CFG))
        code, _, err = self.publish()
        self.assertIsNone(code)
        self.assertEqual([c for c in self.calls if c[0] == "GET" and c[1] == "sheets"], [], "no extra read without quotas")
        self.fake(sheet=(400, '{"message":"bad theme"}'))
        code, _, err = self.publish()
        self.assertEqual(code, 1)
        self.assertIn("POST sheets", err)
        self.assertNotIn("quota", err)
        self.assertEqual([c for c in self.http_calls if c[0] == "DELETE"], [])


class PhotoQuota(Base):
    def test_photos_already_stored_are_not_sent_again(self):
        self.fake(q=quota(photos=250 * MB), existing=("floor",),
                  remote=[{"name": "a.jpg", "metadata": {"eTag": f'"{MD5_A}"'}}, {"name": "b.jpg", "metadata": {"eTag": f'"{hashlib.md5(b"jpg-b").hexdigest()}"'}}])
        code, _, err = self.publish()
        self.assertIsNone(code, err)
        self.assertEqual(self.uploads(), [], "a full account republishes the same photos without writing to storage")
        self.assertIn("published floor: 2 image(s)", err)

    def test_changed_photo_on_a_full_account_stops_before_sending(self):
        self.fake(q=quota(photos=200 * MB), existing=("floor",), remote=[{"name": "a.jpg", "metadata": {"eTag": f'"{MD5_A}"'}}])
        rb.REQUEST_ID = "r7"
        code, _, err = self.publish()
        self.assertEqual(code, 1)
        self.assertEqual(self.uploads(), [])
        self.assertIn("quota reached on this backend: 200 MB of photos for this account.", err)
        self.assertEqual([c[2]["status"] for c in self.calls if c[0] == "PATCH"], ["error"])

    def test_storage_refusal_midway_names_the_limit_and_removes_what_was_added(self):
        self.fake(q=quota(photos=199 * MB), upload=lambda name: (400, PHOTOS_QUOTA) if name == "b.jpg" else None)
        code, _, err = self.publish()
        self.assertEqual(code, 1)
        self.assertIn("quota reached on this backend: 200 MB of photos for this account.", err)
        up = [c for c in self.http_calls if c[0] == "POST" and c[1].startswith("object/sheets/")]
        self.assertIn(403, up[0][3], "the upload tolerates the refusal codes to read them")
        self.assertFalse([c for c in self.calls if c[:2] == ("POST", "sheets")], "the sheet row is not written")
        self.assertEqual([c[2] for c in self.http_calls if c[0] == "DELETE"], [{"prefixes": ["u1/floor/img/a.jpg"]}])

    def test_bare_refusal_read_through_my_quota(self):
        answers = [quota(photos=150 * MB), quota(photos=201 * MB)]   # before the publish, then after the refusal
        self.fake(upload=(403, RLS))
        rest = rb.rest
        rb.rest = lambda cfg, m, path, *a, **k: answers.pop(0) if path == "rpc/my_quota" else rest(cfg, m, path, *a, **k)
        code, _, err = self.publish()
        self.assertEqual(code, 1)
        self.assertIn("200 MB of photos", err)

    def test_bare_refusal_under_the_limit_or_without_quotas_stays_the_raw_error(self):
        for q in (None, quota(photos=10)):
            self.calls.clear(); self.http_calls.clear()
            self.fake(upload=(403, RLS), q=q)
            code, _, err = self.publish()
            self.assertEqual(code, 1)
            self.assertIn("→ 403: " + RLS, err)
            self.assertNotIn("quota reached", err)


class RequeueSessions(Base):
    V1 = [{"slug": f"session-{i}", "kind": "session", "theme": "strength", "title": str(i), "source": {"url": f"https://v/{i}"}} for i in range(4)]

    def use(self, room):
        self.fake(requests=lambda data: LINKS_QUOTA if isinstance(data, list) or room.pop(0) is None else None)
        rest = rb.rest
        def wrapped(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            if method == "GET" and path == "sheets": return [dict(r) for r in self.V1]
            if method == "GET" and path == "requests": return []
            return rest(cfg, method, path, data, prefer, params, tolerate)
        rb.rest = wrapped

    def test_a_batch_refused_by_the_daily_quota_queues_what_fits(self):
        self.use(room=[1, 1, None])
        code, out, err = run(lambda: rb.cmd_requeue_sessions([]))
        self.assertIsNone(code, err)
        posts = [c for c in self.calls if c[:2] == ("POST", "requests")]
        self.assertEqual(len(posts), 1 + 3, "the batch, then one by one until the limit")
        self.assertIn("4 v1 session(s), 2 request(s) inserted", out)
        self.assertIn("quota reached on this backend: 10 links per day", err)
        self.assertIn("2 of 4 queued today", err)
        self.assertIn("run `rb.py requeue-sessions` again tomorrow", err)


class Args(Base):
    def test_request_option_is_read_and_removed(self):
        seen = []
        self.fake()
        saved = rb._read_sheet, rb._check_theme, rb._known_themes, rb._check_durations, rb._check_tags, rb._publish_sheet
        try:
            rb._read_sheet = lambda d: dict(META)
            rb._known_themes = lambda cfg: {"strength"}
            rb._check_theme = rb._check_durations = rb._check_tags = lambda *a: None
            rb._publish_sheet = lambda cfg, d, meta, q=None: seen.append((d, rb.REQUEST_ID))
            (self.dir / "meta.json").write_text(json.dumps(META))
            code, _, _ = run(lambda: rb.cmd_publish([str(self.dir), "--request", "abc"]))
            self.assertIsNone(code)
            self.assertEqual(seen, [(self.dir, "abc")])
            code, _, err = run(lambda: rb.cmd_publish([str(self.dir), "--request"]))
            self.assertEqual(code, 1)
            self.assertIn("usage: rb.py publish <dir> [--request <id>]", err)
        finally:
            rb._read_sheet, rb._check_theme, rb._known_themes, rb._check_durations, rb._check_tags, rb._publish_sheet = saved

    def test_quota_in(self):
        self.assertEqual(rb._quota_in(SHEETS_QUOTA), "300 sheets")
        self.assertEqual(rb._quota_in(LINKS_QUOTA), "10 links per day")
        self.assertIsNone(rb._quota_in(RLS))
        self.assertIn("midnight UTC", rb.quota_message("10 links per day"))


if __name__ == "__main__":
    unittest.main()
