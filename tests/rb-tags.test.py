"""Faceted library in tools/rb.py (L23): the vocabulary read from app/config.js, tags checked and sent by publish,
minutes from a duration, and backfill-tags (derived without Claude, paging, refusal before the column exists).

No network: `session` and `rest` are replaced by fakes that record every call.
Run: python3 -I tests/rb-tags.test.py
"""
import contextlib, importlib.util, io, json, pathlib, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb", ROOT / "tools" / "rb.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

CFG = {"url": "https://example.test", "anon_key": "k", "access_token": "t", "user_id": "u1"}
NO_COLUMN = '{"code":"PGRST204","message":"Could not find the \'%s\' column of \'sheets\' in the schema cache"}'
TAGS = {"zone": ["shoulders"], "gear": ["band"], "minutes": 8, "type": "mobility"}


def run(fn, args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        fn(args)
    return out.getvalue(), err.getvalue()


def sheet_dir(root, slug="sheet", **meta):
    d = pathlib.Path(root) / slug
    d.mkdir()
    m = {"slug": slug, "kind": "sheet", "theme": "strength", "group": "Shoulders", "title": "Band rotation", "duration": "8 min"}
    m.update(meta)
    (d / "meta.json").write_text(json.dumps(m))
    (d / "index.html").write_text("<p>Band rotation</p>")
    return d


class Fake:
    """rest() stand-in: GET answers `gets[table]`; POST raises for the columns in `missing`, else one row."""
    def __init__(self, gets=None, missing=()):
        self.calls, self.gets, self.missing = [], gets or {}, set(missing)

    def __call__(self, cfg, method, table, data=None, prefer=None, params=None, tolerate=()):
        self.calls.append((method, table, data, params))
        if method == "GET":
            sel = (params or {}).get("select", "")
            gone = [c for c in self.missing if c in sel.split(",")]
            if gone: raise rb.RbHTTPError(400, '{"code":"42703","message":"column sheets.%s does not exist"}' % gone[0])
            return self.gets.get(table, [])
        if method == "POST":
            gone = [c for c in self.missing if c in data]
            if gone: raise rb.RbHTTPError(400, NO_COLUMN % gone[0])
            return [{"id": "saved"}]
        return []

    def writes(self):
        return [c for c in self.calls if c[0] != "GET"]


class Base(unittest.TestCase):
    def setUp(self):
        self._saved = rb.session, rb.rest, rb._known_themes
        rb.session = lambda: CFG
        rb._known_themes = lambda cfg: {"strength"}

    def tearDown(self):
        rb.session, rb.rest, rb._known_themes = self._saved


class Vocabulary(unittest.TestCase):
    def test_read_from_app_config(self):
        v = rb.facets_vocab()
        self.assertIn("full body", v["zone"])
        self.assertIn("foam roller", v["gear"])
        self.assertIn("warm-up", v["type"])
        self.assertNotIn("time", v)

    def test_unreadable_config_means_no_vocabulary(self):
        self.assertEqual(rb.facets_vocab("/nonexistent/config.js"), {})
        self.assertEqual(rb._tag_problems({"zone": ["elbow"]}, {}), ([], []))

    def test_malformed_and_unknown(self):
        v = rb.facets_vocab()
        errors, unknown = rb._tag_problems({"zone": "shoulders", "minutes": "8", "type": 3}, v)
        self.assertEqual(len(errors), 3, errors)
        errors, unknown = rb._tag_problems({"zone": ["elbow"], "gear": ["band"], "type": "yoga", "colour": "red"}, v)
        self.assertEqual(errors, [])
        self.assertEqual(len(unknown), 3, unknown)
        self.assertEqual(rb._tag_problems({"zone": [], "gear": [], "minutes": None, "type": ""}, v), ([], []))


class Minutes(unittest.TestCase):
    def test_durations(self):
        for text, n in [("8 min", 8), ("10–15 min", 15), ("10 to 15 minutes", 15), ("1 h", 60), ("1 h 30 min", 90),
                        ("45 s", 1), ("20", None), ("", None), ("3 sets", None), ("4 rounds, 5 min", 5), ("2,5 min", 3)]:
            self.assertEqual(rb._minutes(text), n, text)


class Publish(Base):
    def test_meta_without_tags_sends_no_tags(self):
        fake = rb.rest = Fake()
        with tempfile.TemporaryDirectory() as root:
            run(rb.cmd_publish, [str(sheet_dir(root))])
        post = [c for c in fake.writes() if c[:2] == ("POST", "sheets")][0]
        self.assertNotIn("tags", post[2], "an update keeps the tags the sheet had")

    def test_minutes_from_duration_when_left_out(self):
        fake = rb.rest = Fake()
        with tempfile.TemporaryDirectory() as root:
            run(rb.cmd_publish, [str(sheet_dir(root, tags={"zone": ["shoulders"], "gear": [], "type": ""}))])
        post = [c for c in fake.writes() if c[:2] == ("POST", "sheets")][0]
        self.assertEqual(post[2]["tags"]["minutes"], 8)

    def test_malformed_tags_refused_even_on_an_existing_sheet(self):
        fake = rb.rest = Fake(gets={"sheets": [{"slug": "sheet"}]})
        with tempfile.TemporaryDirectory() as root:
            d = sheet_dir(root, tags={"zone": "shoulders"})
            with self.assertRaises(SystemExit):
                run(rb.cmd_publish, [str(d)])
        self.assertEqual(fake.writes(), [])

    def test_backend_without_either_column(self):
        fake = rb.rest = Fake(missing=("search_text", "tags"))
        with tempfile.TemporaryDirectory() as root:
            _, err = run(rb.cmd_publish, [str(sheet_dir(root, tags=TAGS))])
        posts = [c[2] for c in fake.writes() if c[:2] == ("POST", "sheets")]
        self.assertEqual(len(posts), 3)
        self.assertFalse({"search_text", "tags"} & set(posts[-1]))
        self.assertIn("sheets.tags", err)

    def test_session_sheets_are_checked_before_any_write(self):
        fake = rb.rest = Fake(gets={"sessions": []})
        with tempfile.TemporaryDirectory() as root:
            d = pathlib.Path(root) / "session-x"
            d.mkdir()
            sheet_dir(d, "session-x-a", tags={"zone": ["elbow"]})
            (d / "meta.json").write_text(json.dumps({"slug": "session-x", "kind": "session", "theme": "strength",
                                                     "title": "X", "items": [{"slug": "session-x-a", "dose": "30 s"}]}))
            with self.assertRaises(SystemExit):
                run(rb.cmd_publish, [str(d)])
        self.assertEqual(fake.writes(), [])


class Derive(unittest.TestCase):
    def test_keywords(self):
        v = rb.facets_vocab()
        t = rb.derive_tags({"group": "Ankles & feet", "title": "Wall calf stretch", "search_text": "", "duration": ""}, v)
        self.assertEqual(t, {"zone": ["ankles"], "gear": ["wall"], "minutes": None, "type": "stretch"})
        t = rb.derive_tags({"group": "Mobility", "title": "Épaules au tapis", "search_text": "Échauffement au poids du corps", "duration": "5 min"}, v)
        self.assertEqual(t["zone"], ["shoulders"])
        self.assertEqual(t["gear"], ["mat"])
        self.assertEqual(t["type"], "mobility", "the group names the type before the text")
        t = rb.derive_tags({"group": "Kite control", "title": "Body drag", "search_text": "Keep the kite at 12. No equipment besides the kite.", "duration": ""}, v)
        self.assertEqual(t["gear"], ["kite"])
        self.assertEqual(t["zone"], [])
        t = rb.derive_tags({"group": "Core", "title": "Hollow hold", "search_text": "Bodyweight only.", "duration": ""}, v)
        self.assertEqual(t["gear"], ["none"])
        self.assertEqual(rb.derive_tags({"group": "Arms", "title": "Barbell curl", "search_text": "", "duration": ""}, v)["gear"], ["barbell"])


class Backfill(Base):
    ROW = {"slug": "a", "theme": "strength", "group": "Knees", "title": "Mat stretch", "search_text": "", "duration": "4 min", "tags": {}}

    def test_refused_before_the_column_exists(self):
        fake = rb.rest = Fake(missing=("tags",))
        err = io.StringIO()
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(err):
            rb.cmd_backfill_tags([])
        self.assertIn("sheets.tags", err.getvalue())
        self.assertEqual(fake.writes(), [])

    def test_without_search_text_column_reads_without_it(self):
        fake = rb.rest = Fake(gets={"sheets": [dict(self.ROW)]}, missing=("search_text",))
        run(rb.cmd_backfill_tags, [])
        self.assertEqual(len([c for c in fake.calls if c[0] == "PATCH"]), 1)

    def test_skips_tagged_and_empty_and_guards_the_write(self):
        rows = [dict(self.ROW), dict(self.ROW, slug="b", tags={"zone": ["knees"]}),
                dict(self.ROW, slug="c", group="Breathing", title="Box breathing", duration="")]
        fake = rb.rest = Fake(gets={"sheets": rows})
        out, _ = run(rb.cmd_backfill_tags, [])
        patches = [c for c in fake.calls if c[0] == "PATCH"]
        self.assertEqual([p[3]["slug"] for p in patches], ["eq.a"])
        self.assertEqual(patches[0][3]["tags"], "eq.{}", "a sheet republished since the read keeps its tags")
        get = fake.calls[0][3]
        self.assertEqual(get["tags"], "eq.{}")
        self.assertIn("2 sheet(s) without tags, 1 tagged", out)

    def test_pages_by_slug(self):
        page = [dict(self.ROW, slug=f"s{i:03d}") for i in range(200)]
        answers = [page, [dict(self.ROW, slug="s999")]]
        calls = []
        def rest(cfg, method, table, data=None, prefer=None, params=None, tolerate=()):
            calls.append((method, params))
            return answers.pop(0) if method == "GET" else []
        rb.rest = rest
        run(rb.cmd_backfill_tags, ["--dry-run"])
        gets = [p for m, p in calls if m == "GET"]
        self.assertEqual(len(gets), 2)
        self.assertEqual(gets[1]["slug"], "gt.s199")
        self.assertEqual([m for m, _ in calls if m != "GET"], [])

    def test_usage(self):
        with self.assertRaises(SystemExit):
            run(rb.cmd_backfill_tags, ["--force"])


if __name__ == "__main__":
    unittest.main()
