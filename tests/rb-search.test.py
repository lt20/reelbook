"""Full-text search in tools/rb.py (L14): search_text from a sheet's HTML, publish on a backend without the
column, backfill-search paging and its refusal before the column exists.

No network: `session` and `rest` are replaced by fakes that record every call.
Run: python3 -I -m unittest discover -s tests -p 'rb-*.test.py'
"""
import contextlib, importlib.util, io, json, pathlib, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb", ROOT / "tools" / "rb.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

CFG = {"url": "https://example.test", "anon_key": "k", "access_token": "t", "user_id": "u1"}
NO_COLUMN = '{"code":"PGRST204","message":"Could not find the \'search_text\' column of \'sheets\' in the schema cache"}'
SHEET = """<!doctype html><html><head><title>Floor angel</title><style>.kit{color:red}</style></head><body>
<header><p class="eyebrow">Strength &middot; Shoulders</p><img src="img/a.jpg" alt="a man on a mat"></header>
<p class="lead">Lie face&nbsp;down,<br>arms long.</p>
<div class="kit"><span>2 cans</span><span>un tapis</span></div>
<div class="step"><figure><span class="k">1</span></figure><h3>Départ</h3><p>Bras <b>tendus</b>, le dos plat.</p></div>
<script>var hidden = 1;</script></body></html>"""


def run(fn, args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        fn(args)
    return out.getvalue(), err.getvalue()


class SearchText(unittest.TestCase):
    def test_visible_text_kit_first(self):
        t = rb.search_text(SHEET)
        self.assertTrue(t.startswith("2 cans un tapis "), t)
        self.assertEqual(t.count("un tapis"), 1, "the kit is not repeated")
        for word in ("Strength · Shoulders", "Lie face down, arms long.", "Départ", "Bras tendus, le dos plat."):
            self.assertIn(word, t)
        for hidden in ("Floor angel", "color:red", "hidden", "a man on a mat", "<", "\xa0"):
            self.assertNotIn(hidden, t)
        self.assertNotIn("  ", t)

    def test_cap_cuts_at_a_word(self):
        t = rb.search_text("<p>" + "mot " * 1500 + "</p>")
        self.assertLessEqual(len(t), rb.SEARCH_MAX)
        self.assertTrue(t.endswith("mot"), t[-10:])
        self.assertEqual(rb.search_text(""), "")
        self.assertEqual(rb.search_text("<p>unclosed <div>tags"), "unclosed tags")


class Publish(unittest.TestCase):
    def folder(self, root):
        d = pathlib.Path(root) / "floor"
        d.mkdir()
        (d / "index.html").write_text(SHEET)
        return d

    def test_backend_without_the_column_still_publishes(self):
        calls = []

        def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            calls.append(dict(data))
            if "search_text" in data:
                self.assertIn(400, tolerate)
                raise rb.RbHTTPError(400, NO_COLUMN)
            return [{"id": "saved"}]
        rb.rest = rest
        with tempfile.TemporaryDirectory() as root:
            _, err = run(lambda a: rb._publish_sheet(CFG, self.folder(root), {"slug": "floor", "theme": "strength", "group": "Arms", "title": "Floor"}), [])
        self.assertEqual(len(calls), 2)
        self.assertIn("un tapis", calls[0]["search_text"])
        self.assertNotIn("search_text", calls[1])
        self.assertIn("no sheets.search_text column", err)

    def test_other_errors_still_stop(self):
        def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            raise rb.RbHTTPError(400, '{"message":"bad theme"}')
        rb.rest = rest
        with tempfile.TemporaryDirectory() as root, self.assertRaises(SystemExit):
            run(lambda a: rb._publish_sheet(CFG, self.folder(root), {"slug": "floor", "theme": "strength", "group": "Arms", "title": "Floor"}), [])


class Backfill(unittest.TestCase):
    def setUp(self):
        rb.session = lambda: CFG

    def test_pages_by_slug_and_writes_each_empty_sheet(self):
        rows = [{"slug": f"s{i:03}", "html": f"<p>sheet {i}</p>", "search_text": ""} for i in range(120)]
        rows.append({"slug": "s999", "html": "<script>x</script>", "search_text": ""})   # nothing visible: skipped
        calls = []

        def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            calls.append((method, dict(params or {}), data))
            if method == "GET":
                self.assertEqual((params["user_id"], params["search_text"], params["order"]), ("eq.u1", "eq.", "slug"))
                after = (params.get("slug") or "gt.").split(".", 1)[1]
                return [r for r in rows if r["slug"] > after][: int(params["limit"])]
            return None
        rb.rest = rest
        out, _ = run(rb.COMMANDS["backfill-search"], [])
        gets = [c for c in calls if c[0] == "GET"]
        patches = [c for c in calls if c[0] == "PATCH"]
        self.assertEqual([g[1].get("slug") for g in gets], [None, "gt.s049", "gt.s099"])
        self.assertEqual(len(patches), 120)
        self.assertEqual(patches[0][1], {"slug": "eq.s000", "user_id": "eq.u1"})
        self.assertEqual(patches[0][2], {"search_text": "sheet 0"})
        self.assertIn("121 sheet(s) without search text, 120 filled", out)

    def test_refuses_before_the_column_exists(self):
        def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            self.assertEqual(method, "GET")
            raise rb.RbHTTPError(400, '{"code":"42703","message":"column sheets.search_text does not exist"}')
        rb.rest = rest
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit):
            rb.COMMANDS["backfill-search"](["--dry-run"])
        self.assertIn("re-run supabase/schema.sql", err.getvalue())

    def test_usage(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            rb.COMMANDS["backfill-search"](["--force"])


if __name__ == "__main__":
    unittest.main()
