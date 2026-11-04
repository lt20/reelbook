"""Quotas in tools/rb.py (L29): a publish refused by a limit of the backend says which limit and what to do, and with
--request flags that request as error with the same message. Republishing and other errors are unchanged.

No network: `session`, `rest` and `http` are replaced by fakes that record every call.
Run: python3 -I tests/rb-quota.test.py
"""
import contextlib, importlib.util, io, json, pathlib, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb", ROOT / "tools" / "rb.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

CFG = {"url": "https://example.test", "anon_key": "k", "access_token": "t", "user_id": "u1"}
SHEETS_QUOTA = '{"code":"P0001","details":null,"hint":"Delete sheets you no longer need, or ask whoever runs this backend for more.","message":"quota: 300 sheets"}'
PHOTOS_QUOTA = '{"statusCode":"400","error":"DatabaseError","message":"quota: 200 MB of photos"}'
RLS = '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}'
META = {"slug": "floor", "theme": "strength", "group": "Arms", "title": "Floor"}


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
        self.calls, self.uploads = [], []
        self.saved = (rb.rest, rb.http, rb.session, rb.REQUEST_ID)
        rb.session = lambda: CFG
        self.tmp = tempfile.TemporaryDirectory()
        d = pathlib.Path(self.tmp.name) / "floor"
        (d / "img").mkdir(parents=True)
        (d / "index.html").write_text("<p>Floor</p>")
        (d / "img" / "a.jpg").write_bytes(b"jpg")
        self.dir = d

    def tearDown(self):
        rb.rest, rb.http, rb.session, rb.REQUEST_ID = self.saved
        self.tmp.cleanup()

    def fake(self, upload=None, sheet=None, quota=None, note="Redo: fix the title"):
        def http(method, url, headers=None, data=None, raw=False, tolerate=()):
            self.uploads.append((url, tolerate))
            if upload: raise rb.RbHTTPError(*upload)
        def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            self.calls.append((method, path, data, dict(params or {})))
            if path == "rpc/my_quota":
                if quota is None: raise rb.RbHTTPError(404, '{"code":"PGRST202"}')
                return quota
            if path == "sheets" and method == "POST":
                if sheet: raise rb.RbHTTPError(*sheet)
                return [{"id": "row"}]
            if path == "requests" and method == "GET": return [{"note": note}]
            if path == "requests" and method == "PATCH": return [{"id": params["id"][3:], **data}]
            return []
        rb.http, rb.rest = http, rest


class SheetQuota(Base):
    def test_sheet_count_refusal_is_said_in_plain_words(self):
        self.fake(sheet=(400, SHEETS_QUOTA))
        code, _, err = run(lambda: rb._publish_sheet(CFG, self.dir, dict(META)))
        self.assertEqual(code, 1)
        self.assertIn("quota reached on this backend: 300 sheets for this account.", err)
        self.assertIn("rb.py delete <slug>", err)
        self.assertIn("https://github.com/lt20/reelbook/issues", err)
        self.assertIn("Limits on a shared backend", err)
        self.assertNotIn("P0001", err, "no raw JSON")
        self.assertFalse([c for c in self.calls if c[1] == "requests"], "no request touched without --request")

    def test_with_request_the_item_goes_to_error_with_the_message(self):
        self.fake(sheet=(400, SHEETS_QUOTA))
        rb.REQUEST_ID = "r42"
        code, out, err = run(lambda: rb._publish_sheet(CFG, self.dir, dict(META)))
        self.assertEqual(code, 1)
        patch = [c for c in self.calls if c[0] == "PATCH"]
        self.assertEqual(len(patch), 1)
        self.assertEqual(patch[0][3], {"id": "eq.r42"})
        self.assertEqual(patch[0][2]["status"], "error")
        self.assertEqual(patch[0][2]["note"], "Redo: fix the title\n" + rb.quota_message("300 sheets"), "a Redo keeps its first line")
        self.assertIn(rb.quota_message("300 sheets"), err)

    def test_republish_and_other_errors_unchanged(self):
        self.fake()
        code, _, err = run(lambda: rb._publish_sheet(CFG, self.dir, dict(META)))
        self.assertIsNone(code)
        self.assertIn("published floor: 1 image(s)", err)
        self.fake(sheet=(400, '{"message":"bad theme"}'))
        code, _, err = run(lambda: rb._publish_sheet(CFG, self.dir, dict(META)))
        self.assertEqual(code, 1)
        self.assertIn("POST sheets", err)
        self.assertNotIn("quota", err)


class PhotoQuota(Base):
    def test_storage_message_names_the_photo_limit(self):
        self.fake(upload=(400, PHOTOS_QUOTA))
        rb.REQUEST_ID = "r7"
        code, _, err = run(lambda: rb._publish_sheet(CFG, self.dir, dict(META)))
        self.assertEqual(code, 1)
        self.assertIn("quota reached on this backend: 200 MB of photos for this account.", err)
        self.assertIn(403, self.uploads[0][1], "the upload tolerates the refusal codes to read them")
        self.assertFalse([c for c in self.calls if c[1] == "sheets"], "the sheet row is not written")
        self.assertEqual([c[2]["status"] for c in self.calls if c[0] == "PATCH"], ["error"])

    def test_bare_refusal_read_through_my_quota(self):
        self.fake(upload=(403, RLS), quota={"requests_today": 1, "max_requests_per_day": 10, "sheets": 12, "max_sheets": 300,
                                            "storage_bytes": 201 * 1048576, "max_storage_mb": 200})
        code, _, err = run(lambda: rb._publish_sheet(CFG, self.dir, dict(META)))
        self.assertEqual(code, 1)
        self.assertIn("200 MB of photos", err)
        self.assertIn(("POST", "rpc/my_quota", {}, {}), self.calls)

    def test_bare_refusal_under_the_limit_or_without_quotas_stays_the_raw_error(self):
        for quota in (None, {"storage_bytes": 10, "max_storage_mb": 200}):
            self.calls.clear()
            self.fake(upload=(403, RLS), quota=quota)
            code, _, err = run(lambda: rb._publish_sheet(CFG, self.dir, dict(META)))
            self.assertEqual(code, 1)
            self.assertIn("→ 403: " + RLS, err)
            self.assertNotIn("quota reached", err)


class Args(Base):
    def test_request_option_is_read_and_removed(self):
        seen = []
        saved = rb._read_sheet, rb._check_theme, rb._known_themes, rb._check_durations, rb._check_tags, rb._publish_sheet
        try:
            rb._read_sheet = lambda d: dict(META)
            rb._known_themes = lambda cfg: {"strength"}
            rb._check_theme = rb._check_durations = rb._check_tags = lambda *a: None
            rb._publish_sheet = lambda cfg, d, meta: seen.append((d, rb.REQUEST_ID))
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
        self.assertEqual(rb._quota_in('{"message":"quota: 10 links per day"}'), "10 links per day")
        self.assertIsNone(rb._quota_in(RLS))
        self.assertIn("midnight UTC", rb.quota_message("10 links per day"))


if __name__ == "__main__":
    unittest.main()
