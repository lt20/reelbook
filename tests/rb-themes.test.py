"""rb.py themes: each notebook line carries its profile (L16), read from the library of app/config.js by id.

No network: rb.session / rb.rest are replaced by an in-memory fake. Run: python3 -I tests/rb-themes.test.py
"""
import contextlib, importlib.util, io, json, pathlib, re, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb", ROOT / "tools" / "rb.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

CFG = {"url": "https://x.supabase.co", "anon_key": "k", "access_token": "t", "user_id": "u"}
CONFIG_JS = (ROOT / "app" / "config.js").read_text(encoding="utf-8")
ROWS = [
    {"id": "strength", "title": None, "description": "", "groups": None, "builtin": True},
    {"id": "kitesurf", "title": None, "description": "", "groups": None, "builtin": True},
    {"id": "fight", "title": None, "description": "", "groups": None, "builtin": True},
    {"id": "custom-1a2b", "title": "Parkour", "description": "Vaults, precision jumps, wall runs.", "groups": ["Vaults"], "builtin": False},
]


class Themes(unittest.TestCase):
    def setUp(self):
        self._saved = (rb.session, rb.rest, rb.LIBRARY_JS)
        self.calls = []

    def tearDown(self):
        rb.session, rb.rest, rb.LIBRARY_JS = self._saved

    def run_themes(self, rows):
        def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            self.calls.append((method, path, params))
            return [dict(r) for r in rows]
        rb.session, rb.rest = (lambda: CFG), rest
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rb.cmd_themes([])
        return [json.loads(l) for l in out.getvalue().splitlines()], err.getvalue()

    def test_each_line_keeps_its_fields_and_gains_the_profile_of_the_library(self):
        lines, err = self.run_themes(ROWS)
        self.assertEqual(err, "")
        self.assertEqual([(l["id"], l["profile"]) for l in lines],
                         [("strength", "gym"), ("kitesurf", "technique"), ("fight", "partner"), ("custom-1a2b", "gym")])
        # backward compatible: the same keys as before, in the same order, profile added last
        for row, line in zip(ROWS, lines):
            self.assertEqual(list(line), list(row) + ["profile"])
            self.assertEqual({k: v for k, v in line.items() if k != "profile"}, row)
        # still one read of user_themes, no new column asked from the backend
        self.assertEqual(self.calls, [("GET", "user_themes", {"select": "id,title,description,groups,builtin", "order": "position.asc,title.asc"})])

    def test_the_library_gives_a_known_profile_to_every_builtin_notebook(self):
        ids = re.findall(r"\{\s*id:\s*'([^']+)'", CONFIG_JS)
        self.assertEqual(len(ids), 29)
        profiles = rb.library_profiles()
        self.assertEqual(sorted(profiles), sorted(ids))
        self.assertTrue(set(profiles.values()) <= set(rb.PROFILES))
        # every library entry writes its profile (none left to the default by omission)
        self.assertEqual(len(re.findall(r"\bprofile:\s*'(gym|technique|partner)'", CONFIG_JS)), 29)
        for i in ("kitesurf", "kitefoil", "wingfoil", "wakeboard", "surf", "snow"):
            self.assertEqual(profiles[i], "technique", i)
        self.assertEqual(profiles["fight"], "partner")
        for i in ("strength", "yoga", "pilates", "cook"):
            self.assertEqual(profiles[i], "gym", i)

    def test_without_the_app_config_every_notebook_is_gym_and_nothing_fails(self):
        rb.LIBRARY_JS = ROOT / "no-such-dir" / "config.js"
        lines, _ = self.run_themes(ROWS)
        self.assertEqual({l["profile"] for l in lines}, {"gym"})

    def test_an_unknown_or_missing_profile_reads_as_gym(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "config.js"
            p.write_text("window.REELBOOK = {library: [\n"
                         "  { id: 'kitesurf', title: 'K', color: 3, profile: 'technique', groups: ['A'] },\n"
                         "  { id: 'odd', title: 'O', profile: 'weird' },\n"
                         "  { id: 'bare', title: 'B', groups: [] }\n]};\n", encoding="utf-8")
            self.assertEqual(rb.library_profiles(p), {"kitesurf": "technique", "odd": "gym", "bare": "gym"})

    def test_no_notebook_yet_keeps_its_message(self):
        lines, err = self.run_themes([])
        self.assertEqual(lines, [])
        self.assertIn("no notebook yet", err)


class AddTheme(unittest.TestCase):
    """rb.py library / add-theme: what lets the skill publish a video no notebook of the account fits."""
    ON = [{"id": "strength", "title": "Strength", "description": "", "groups": ["Arms"], "builtin": True, "position": 0},
          {"id": "custom-parkour", "title": "Parkour", "description": "Vaults and jumps", "groups": [], "builtin": False, "position": 4}]

    def setUp(self):
        self._saved = (rb.session, rb.rest, rb.LIBRARY_JS)
        self.posts = []

    def tearDown(self):
        rb.session, rb.rest, rb.LIBRARY_JS = self._saved

    def run_cmd(self, fn, args, rows=None):
        rows = self.ON if rows is None else rows
        def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
            self.assertEqual(path, "user_themes")
            if method == "POST":
                self.posts.append(data)
                return [{"description": "", **data}]
            return [dict(r) for r in rows]
        rb.session, rb.rest = (lambda: CFG), rest
        out, err, code = io.StringIO(), io.StringIO(), 0
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                fn(args)
            except SystemExit as e:
                code = e.code
        return [json.loads(l) for l in out.getvalue().splitlines()], err.getvalue(), code

    def test_the_library_lists_every_builtin_notebook_not_on_the_account(self):
        lines, _, _ = self.run_cmd(rb.cmd_library, [])
        self.assertEqual(len(lines), 28)
        self.assertNotIn("strength", [l["id"] for l in lines])
        cook = next(l for l in lines if l["id"] == "cook")
        self.assertEqual(cook["title"], "Cooking")
        self.assertIn("knife skills", cook["description"])
        self.assertIn("Mains", cook["groups"])
        self.assertEqual(next(l for l in lines if l["id"] == "surf")["profile"], "technique")

    def test_a_builtin_notebook_is_added_as_the_app_adds_it(self):
        lines, err, code = self.run_cmd(rb.cmd_add_theme, ["cook"])
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(len(self.posts), 1)
        row = self.posts[0]
        self.assertEqual((row["id"], row["title"], row["builtin"], row["position"]), ("cook", "Cooking", True, 5))
        self.assertIn("Mains", row["groups"])
        self.assertNotIn("user_id", row)  # the default auth.uid() and the RLS policy own it
        self.assertEqual((lines[0]["id"], lines[0]["profile"]), ("cook", "gym"))

    def test_the_profile_of_a_builtin_notebook_added_is_printed(self):
        lines, _, _ = self.run_cmd(rb.cmd_add_theme, ["kitesurf"])
        self.assertEqual(lines[0]["profile"], "technique")

    def test_a_custom_notebook_gets_the_id_the_app_would_give_it(self):
        lines, _, code = self.run_cmd(rb.cmd_add_theme, ["--title", "Équilibres & Échasses", "--description", "Handstands, stilts and balance drills of all levels."])
        self.assertEqual(code, 0)
        row = self.posts[0]
        self.assertEqual(row["id"], "custom-equilibres-echasses")
        self.assertEqual((row["title"], row["builtin"], row["groups"]), ("Équilibres & Échasses", False, []))
        self.assertEqual((lines[0]["description"], lines[0]["profile"]), ("Handstands, stilts and balance drills of all levels.", "gym"))

    def test_a_notebook_already_on_the_account_is_printed_not_added(self):
        for args in (["strength"], ["--title", "parkour", "--description", "A long enough description of parkour."]):
            lines, err, code = self.run_cmd(rb.cmd_add_theme, args)
            self.assertEqual(code, 0)
            self.assertIn("already on this account", err)
            self.assertEqual(len(lines), 1)
        self.assertEqual(self.posts, [])
        self.assertEqual(lines[0]["id"], "custom-parkour")

    def test_refused_and_nothing_written(self):
        for args in ([], ["nope"], ["--title", "Parkour"], ["--title", "Juggling", "--description", "too short"],
                     ["--title", "Cooking", "--description", "A long enough description of cooking."],
                     ["--title", "cook", "--description", "A long enough description of cooking."]):
            _, err, code = self.run_cmd(rb.cmd_add_theme, args)
            self.assertEqual(code, 1, args)
            self.assertTrue(err, args)
        self.assertEqual(self.posts, [])

    def test_a_custom_name_of_the_library_points_to_the_builtin_notebook(self):
        _, err, _ = self.run_cmd(rb.cmd_add_theme, ["--title", "Cooking", "--description", "A long enough description of cooking."])
        self.assertIn("rb.py add-theme cook", err)

    def test_an_account_without_notebooks_keeps_its_default_ones(self):
        _, err, code = self.run_cmd(rb.cmd_add_theme, ["cook"], rows=[])
        self.assertEqual(code, 1)
        self.assertIn("open the app once", err)
        self.assertEqual(self.posts, [])

    def test_slugify_is_the_one_of_the_app(self):
        self.assertIn(r"replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)", (ROOT / "app" / "index.html").read_text(encoding="utf-8"))
        self.assertEqual(rb._slugify("  Crêpes -- & Galettes! "), "crepes-galettes")
        self.assertEqual(rb._slugify("日本語"), "")
        self.assertEqual(rb._slugify("a" * 39 + " b c"), "a" * 39 + "-")

    def test_publish_points_to_the_command(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit):
            rb._check_theme("cook", {"strength"}, "meta.json")
        self.assertIn("rb.py add-theme", err.getvalue())


if __name__ == "__main__":
    unittest.main()
