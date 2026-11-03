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


if __name__ == "__main__":
    unittest.main()
