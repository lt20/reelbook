"""rb.py glossary (P11 G1): get, sheets and put on the table glossary_words: each check of put, the merge rules, two
commands writing at once, a backend without the table. Contract: docs/audit-design/P11-glossary.md › Data contract.
P11 G2a: which sheets the pass has read (table glossary_passes): `put` records the file's "passed", `sheets --pending`
and `pending` say what is left: the republished sheet, the sheet without any word, a backend without that table.
P11 G2b (Codex pass 1): `put` reconciles the sheets of "passed": a word the file no longer gives for a sheet read again
is taken off that sheet.

No network: rb.session / rb.rest are replaced by an in-memory backend that records every call. Every sheet and word
below is made up. Run: python3 -I tests/rb-glossary.test.py
"""
import contextlib, copy, datetime, importlib.util, inspect, io, json, os, pathlib, re, tempfile, time, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb", ROOT / "tools" / "rb.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

CFG = {"url": "https://example.test", "anon_key": "k", "access_token": "t", "user_id": "u1"}
NO_TABLE = '{"code":"PGRST205","message":"Could not find the table \'public.glossary_words\' in the schema cache"}'
DUPLICATE = '{"code":"23505","message":"duplicate key value violates unique constraint \\"glossary_words_one_entry_ci\\""}'
T0 = "2026-01-01T00:00:00+00:00"   # updated_at as PostgREST prints it: a `+` and colons the filter has to carry
NO_PASSES_TABLE = '{"code":"PGRST205","message":"Could not find the table \'public.glossary_passes\' in the schema cache"}'
T1 = "2026-02-01T08:30:00.5+00:00"         # sheets.updated_at as PostgREST prints it (trailing zeros dropped)
T2 = "2026-03-01T09:00:00.123456+00:00"    # the same sheet, published again
NO_FAMILY = '{"code":"42703","message":"column user_themes.family does not exist"}'

THEMES = [
    {"id": "kitesurf", "title": "", "description": "", "family": None},
    {"id": "strength", "title": "Strength", "description": "Weights and bands.", "family": "technique"},
    {"id": "custom-parkour", "title": "Parkour", "description": "Vaults, precision jumps, wall runs.", "family": None, "builtin": False},
]
WATER = """<!doctype html><html><head><title>Hidden title</title><style>.kit{color:red}</style></head><body>
<header><p class="eyebrow">Départ · 10 min</p><h1>Le départ plage</h1>
<img src="img/thumb.jpg" alt="Un rider debout au bord de l'eau" width="112" height="112"></header>
<p class="lead">Pour partir, il faut <b>border</b>&nbsp;la barre
   doucement, puis choquer dès que la planche glisse.</p>
<div class="kit"><span>twin-tip</span><span>harnais</span></div>
<div class="step"><figure><img src="img/01-bord.jpg" alt="Le rider tient la barre bordée à fond" loading="lazy"><span class="k">1</span></figure>
<h3>Mise en tension</h3><p>Garde le kite à midi, les bras souples.</p></div>
<script>var secret = "border le script";</script></body></html>"""
JUMP = """<header><h1>Le saut droit</h1><img src="img/thumb.jpg" alt="Un saut"></header>
<p class="lead">Avant de sauter, il faut border fort et garder le crantage jusqu'au bout.</p>
<div class="step"><figure><img src="img/01-crantage.jpg" alt="La planche sur la carre"></figure><h3>Crantage</h3><p>Pousse sur les talons.</p></div>"""
SHEETS = [
    {"slug": "kite-jump", "kind": "sheet", "theme": "kitesurf", "title": "Le saut droit", "html": JUMP, "updated_at": T1},
    {"slug": "kite-water-start", "kind": "sheet", "theme": "kitesurf", "title": "Le départ plage", "html": WATER, "updated_at": T1},
    {"slug": "kite-old-session", "kind": "session", "theme": "kitesurf", "title": "A v1 session page", "html": "<p>border</p>", "updated_at": T1},
    {"slug": "push-up", "kind": "sheet", "theme": "strength", "title": "Push-up", "html": "<p>Border is not a word here.</p>", "updated_at": T1},
]


def read(slug, at=T1, theme="kitesurf"):
    """A row of glossary_passes: the pass read that sheet when its updated_at was `at`."""
    return {"user_id": "u1", "theme": theme, "slug": slug, "sheet_updated_at": at, "passed_at": "2026-02-02T03:00:00+00:00"}


def entry(**over):
    e = {"term": "border", "sense": None, "forms": ["border", "bordée", "bordé"], "kind": "action",
         "definition": "Tirer la barre vers toi pour donner de la puissance au kite.", "confidence": "sure", "doubt": None,
         "spelling": None, "photo": {"slug": "kite-water-start", "file": "img/01-bord.jpg", "why": "the bar pulled in"},
         "related": ["choquer"],
         "sheets": [{"slug": "kite-water-start", "quote": "il faut border la barre doucement", "where": "text"},
                    {"slug": "kite-jump", "quote": "il faut border fort et garder le crantage", "where": "text"}]}
    e.update(over)
    return e


def stored(**over):
    """An entry as the table holds it."""
    r = {"id": "w1", "user_id": "u1", "theme": "kitesurf", "term": "border", "sense": None, "forms": ["border"], "kind": "action",
         "definition": "The first definition.", "confidence": "unsure", "doubt": "Peut-être un mot propre à ce coach.",
         "spelling": None, "photo": {"slug": "kite-jump", "file": "01-crantage.jpg"}, "related": [],
         "sheets": [{"slug": "kite-water-start", "quote": "border la barre", "where": "text"}], "updated_at": T0}
    r.update(over)
    return r


def when(v):
    """A timestamp as Postgres compares it (not rb's own reading of it)."""
    v = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6], v.replace("Z", "+00:00"), count=1)
    return datetime.datetime.fromisoformat(v)


class Backend:
    """What PostgREST would answer for the three tables the command reads and the one it writes."""
    def __init__(self, words=(), table=True, themes=THEMES, sheets=SHEETS, family_column=True, passes=(), passes_table=True):
        self.words, self.table, self.themes, self.sheets = [dict({"updated_at": T0}, **w) for w in words], table, themes, sheets
        self.passes, self.passes_table = [dict(p) for p in passes], passes_table   # glossary_passes (P11 G2a)
        self.family_column, self.calls, self.clock = family_column, [], 0
        # before_write(method, data): what another command does between this one's reading and its write landing
        self.before_write, self._meanwhile = None, False

    def tick(self):
        """What the table's trigger (and the column's default) does: a new updated_at at each write."""
        self.clock += 1
        return f"2026-01-01T00:00:00.{self.clock:06d}+00:00"

    def index_key(self, w):
        """The unique index glossary_words_one_entry_ci: (user_id, theme, lower(term), lower(coalesce(sense, '')))."""
        return (w["theme"], w["term"].lower(), (w.get("sense") or "").lower())

    def rest(self, cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
        params = dict(params or {})
        self.calls.append((method, path, params, copy.deepcopy(data)))
        eq = lambda col: params[col].split(".", 1)[1] if params.get(col, "").startswith("eq.") else None
        gt = lambda col: params[col].split(".", 1)[1] if params.get(col, "").startswith("gt.") else None
        if path == "glossary_words":
            if not self.table:
                if 404 in tolerate: raise rb.RbHTTPError(404, NO_TABLE)
                raise AssertionError(f"{method} on a backend without the table")
            if method == "GET":
                assert params["user_id"] == "eq.u1" and params["order"] == "id", params
                rows = sorted((w for w in self.words if w["theme"] == eq("theme") and w["id"] > (gt("id") or "")), key=lambda w: w["id"])
                cols = params["select"].split(",")
                return copy.deepcopy([{c: w.get(c) for c in cols} for w in rows][: int(params["limit"])])
            if self.before_write and not self._meanwhile:
                self._meanwhile = True
                try: self.before_write(method, data)
                finally: self._meanwhile = False
            if method == "POST":
                assert isinstance(data, list) and len({tuple(sorted(r)) for r in data}) == 1, "one statement, the same keys in every row"
                keys = [self.index_key(r) for r in data]
                if len(set(keys)) < len(keys) or set(keys) & {self.index_key(w) for w in self.words}:   # all of them or none
                    if 409 in tolerate: raise rb.RbHTTPError(409, DUPLICATE)
                    raise AssertionError("an insert the unique index refuses, not tolerated")
                for r in data:
                    self.words.append(dict(copy.deepcopy(r), id=f"n{len(self.words)}", user_id="u1", updated_at=self.tick()))
                return None
            if method == "PATCH":
                # an update names the updated_at it read and asks for the rows it changed: none = it was overtaken
                assert params["user_id"] == "eq.u1" and eq("updated_at") and prefer == "return=representation", (params, prefer)
                hit = [w for w in self.words if w["id"] == eq("id") and w["updated_at"] == eq("updated_at")]
                for w in hit: w.update(copy.deepcopy(data), updated_at=self.tick())
                return [{c: w.get(c) for c in params["select"].split(",")} for w in hit]
        if path == "glossary_passes":
            if not self.passes_table:
                if 404 in tolerate: raise rb.RbHTTPError(404, NO_PASSES_TABLE)
                raise AssertionError(f"{method} glossary_passes on a backend without the table, not tolerated")
            if method == "GET":
                assert params["user_id"] == "eq.u1" and params["order"] == "slug" and eq("theme"), params
                rows = sorted((p for p in self.passes if p["theme"] == eq("theme") and p["slug"] > (gt("slug") or "")), key=lambda p: p["slug"])
                return copy.deepcopy([{c: p.get(c) for c in params["select"].split(",")} for p in rows][: int(params["limit"])])
            if self.before_write and not self._meanwhile:
                self._meanwhile = True
                try: self.before_write(method, data)
                finally: self._meanwhile = False
            if method == "POST":
                # an insert on the primary key (user_id, theme, slug) that leaves the existing rows alone (on conflict do
                # nothing), one statement; it answers the rows it inserted
                assert prefer == "resolution=ignore-duplicates,return=representation", prefer
                assert params == {"on_conflict": "user_id,theme,slug", "select": "slug"}, params
                assert isinstance(data, list) and data and len({tuple(sorted(r)) for r in data}) == 1, "one statement, the same keys in every row"
                keys = [(r["theme"], r["slug"]) for r in data]
                assert len(set(keys)) == len(keys), "the same sheet twice in one statement"
                assert all(r.get("sheet_updated_at") for r in data), "sheet_updated_at is not null"
                new = []
                for r in data:
                    if any((p["theme"], p["slug"]) == (r["theme"], r["slug"]) for p in self.passes): continue
                    self.passes.append(dict({"user_id": "u1", "passed_at": "the column's default"}, **copy.deepcopy(r)))
                    new.append({"slug": r["slug"]})
                return new
            if method == "PATCH":
                # the row of one sheet, only where the stored date is not later than the one sent (compared as dates, as
                # Postgres does); it answers the rows it changed: none = a later version was recorded
                assert prefer == "return=representation" and params["user_id"] == "eq.u1" and params["select"] == "slug", (prefer, params)
                assert eq("theme") and eq("slug") and params["sheet_updated_at"].startswith("lte."), params
                assert sorted(data) == ["passed_at", "sheet_updated_at"] and params["sheet_updated_at"] == "lte." + data["sheet_updated_at"], (params, data)
                hit = [p for p in self.passes if (p["theme"], p["slug"]) == (eq("theme"), eq("slug"))
                       and when(p["sheet_updated_at"]) <= when(data["sheet_updated_at"])]
                for p in hit: p.update(copy.deepcopy(data))
                return [{"slug": p["slug"]} for p in hit]
        if path == "user_themes" and method == "GET":
            if "family" in params["select"] and not self.family_column:
                if 400 in tolerate: raise rb.RbHTTPError(400, NO_FAMILY)
                raise AssertionError("the family column was asked without tolerating its absence")
            cols = params["select"].split(",")
            return [{c: t.get(c) for c in cols} for t in self.themes if eq("id") in (None, t["id"])]
        if path == "sheets" and method == "GET":
            assert params["user_id"] == "eq.u1" and params["kind"] == "eq.sheet" and params["order"] == "slug", params
            rows = sorted((s for s in self.sheets if s["theme"] == eq("theme") and s["kind"] == "sheet" and s["slug"] > (gt("slug") or "")),
                          key=lambda s: s["slug"])
            cols = params["select"].split(",")
            if params.get("slug", "").startswith("in."):   # in.("a","b"): the named sheets, quoted as PostgREST reads a list
                named = json.loads("[" + params["slug"][4:-1] + "]")
                assert params["slug"].endswith(")") and len(named) <= 50, params["slug"]
                return [{c: s.get(c) for c in cols} for s in rows if s["slug"] in named]
            return [{c: s.get(c) for c in cols} for s in rows][: int(params["limit"])]
        raise AssertionError(f"unexpected call: {method} {path} {params}")

    def writes(self):
        return [c for c in self.calls if c[0] != "GET"]


class Case(unittest.TestCase):
    def setUp(self):
        self._saved = (rb.session, rb.rest, rb.now)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

    def tearDown(self):
        rb.session, rb.rest, rb.now = self._saved

    def run_cmd(self, args, backend=None):
        self.backend = backend or Backend()
        rb.session, rb.rest = (lambda: CFG), self.backend.rest
        rb.now = lambda: "2026-04-01T03:00:00Z"   # passed_at, sent by `put`
        out, err, code = io.StringIO(), io.StringIO(), 0
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                rb.COMMANDS["glossary"](args)
            except SystemExit as e:
                code = e.code
        return out.getvalue(), err.getvalue(), code

    def file(self, terms, notebook="kitesurf", **more):
        p = pathlib.Path(self._tmp.name) / "glossary.json"
        doc = dict({"language": "fr", "terms": terms, "rejected": [{"word": "bras", "why": "everyday"}]}, **more)
        if notebook is not None: doc["notebook"] = notebook
        p.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        return str(p)

    def put(self, terms, *flags, backend=None, theme="kitesurf", **file_args):
        return self.run_cmd(["put", theme, self.file(terms, **file_args), *flags], backend)


class Get(Case):
    def test_prints_the_entries_of_the_notebook_in_the_shape_of_a_pass_output(self):
        words = [stored(id="w1", term="choquer", sheets=[{"slug": "kite-jump", "quote": "choquer", "where": "text"}]),
                 stored(id="w2", term="border", sheets=entry()["sheets"]),
                 stored(id="w3", term="aile", sense="le kite", sheets=[]),
                 stored(id="w4", term="aile", sense="du foil", sheets=[]),
                 stored(id="w5", theme="strength", term="gainage")]
        out, err, code = self.run_cmd(["get", "kitesurf"], Backend(words))
        self.assertEqual((err, code), ("", 0))
        doc = json.loads(out)
        self.assertEqual(list(doc), ["notebook", "terms"])
        self.assertEqual(doc["notebook"], "kitesurf")
        # by how many sheets use the entry, then alphabetically; only this notebook
        self.assertEqual([(t["term"], t["sense"]) for t in doc["terms"]],
                         [("border", None), ("choquer", None), ("aile", "du foil"), ("aile", "le kite")])
        for t in doc["terms"]:
            self.assertEqual(list(t), list(rb.GLOSSARY_FIELDS))   # no id, no user_id, no dates
        self.assertEqual(doc["terms"][0]["photo"], {"slug": "kite-jump", "file": "01-crantage.jpg"})
        self.assertEqual(self.backend.writes(), [])

    def test_a_backend_without_the_table_prints_an_empty_glossary(self):
        out, err, code = self.run_cmd(["get", "kitesurf"], Backend(table=False))
        self.assertEqual((json.loads(out), err, code), ({"notebook": "kitesurf", "terms": []}, "", 0))

    def test_a_notebook_without_words_prints_an_empty_glossary(self):
        out, _, code = self.run_cmd(["get", "strength"], Backend([stored()]))
        self.assertEqual((json.loads(out), code), ({"notebook": "strength", "terms": []}, 0))

    def test_a_long_glossary_is_read_page_by_page(self):
        saved, rb.LIST_PAGE = rb.LIST_PAGE, 2
        self.addCleanup(setattr, rb, "LIST_PAGE", saved)
        out, _, _ = self.run_cmd(["get", "kitesurf"], Backend([stored(id=f"w{i}", term=f"mot {i}") for i in range(5)]))
        self.assertEqual(len(json.loads(out)["terms"]), 5)
        self.assertEqual([c[2].get("id") for c in self.backend.calls], [None, "gt.w1", "gt.w3"])


class Sheets(Case):
    def test_prints_the_notebook_and_its_sheets_with_their_photos(self):
        out, err, code = self.run_cmd(["sheets", "kitesurf"])
        self.assertEqual((err, code), ("", 0))
        doc = json.loads(out)
        self.assertEqual(list(doc), ["notebook", "sheets"])
        # a built-in notebook: what its row leaves empty comes from the library of app/config.js
        self.assertEqual(doc["notebook"], {"id": "kitesurf", "title": "Kitesurf", "family": "technique",
                                           "description": "Kite control, water start, riding, jumps, transitions."})
        self.assertEqual([list(s) for s in doc["sheets"]], [["slug", "title", "html", "photos"]] * 2)
        self.assertEqual([(s["slug"], s["title"], s["photos"]) for s in doc["sheets"]],
                         [("kite-jump", "Le saut droit", ["thumb.jpg", "01-crantage.jpg"]),
                          ("kite-water-start", "Le départ plage", ["thumb.jpg", "01-bord.jpg"])])
        self.assertEqual(doc["sheets"][1]["html"], WATER)
        # sessions are not sheets: the v1 session page of this notebook is left out, and no session is read
        self.assertNotIn("kite-old-session", out)
        self.assertEqual({c[1] for c in self.backend.calls}, {"glossary_words", "user_themes", "sheets"})
        self.assertEqual(self.backend.writes(), [])

    def test_the_family_is_the_account_s_choice_else_the_library_s_else_repetition(self):
        family = lambda theme, **kw: json.loads(self.run_cmd(["sheets", theme], Backend(**kw))[0])["notebook"]["family"]
        self.assertEqual(family("strength"), "technique")          # chosen by the account (the library says repetition)
        self.assertEqual(family("kitesurf"), "technique")          # the library's default
        self.assertEqual(family("custom-parkour"), "repetition")   # a custom notebook
        self.assertEqual(rb.library_families()["strength"], "repetition")
        self.assertEqual(sorted(rb.library_families()), sorted(rb.library_notebooks()))
        self.assertEqual(rb.library_families(ROOT / "no-such-dir" / "config.js"), {})

    def test_a_backend_without_the_family_column_still_answers(self):
        out, err, code = self.run_cmd(["sheets", "strength"], Backend(family_column=False))
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(json.loads(out)["notebook"], {"id": "strength", "title": "Strength", "description": "Weights and bands.", "family": "repetition"})

    def test_a_notebook_that_is_not_the_account_s_is_refused(self):
        out, err, code = self.run_cmd(["sheets", "yoga"])
        self.assertEqual((out, code), ("", 1))
        self.assertIn("'yoga' is not one of this account's notebooks", err)

    def test_a_backend_without_the_table_says_so_in_one_line_and_exits_1(self):
        # exit 1 as `put`: the skill stops there instead of running a pass that has nowhere to write
        out, err, code = self.run_cmd(["sheets", "kitesurf"], Backend(table=False))
        self.assertEqual((out, code), ("", 1))
        self.assertEqual(err, f"rb: {rb.NO_GLOSSARY}\n")
        self.assertIn("re-run supabase/schema.sql", err)
        self.assertEqual({c[1] for c in self.backend.calls}, {"glossary_words"})   # the sheets are not even read

    def test_the_sheets_are_read_fifty_at_a_time(self):
        sheets = [{"slug": f"s{i:03}", "kind": "sheet", "theme": "kitesurf", "title": f"S {i}", "html": "<p>x</p>"} for i in range(120)]
        out, _, _ = self.run_cmd(["sheets", "kitesurf"], Backend(sheets=sheets))
        self.assertEqual(len(json.loads(out)["sheets"]), 120)
        self.assertEqual([c[2].get("slug") for c in self.backend.calls if c[1] == "sheets"], [None, "gt.s049", "gt.s099"])


class SheetText(unittest.TestCase):
    def test_tags_removed_whitespace_collapsed_case_ignored_alt_texts_included(self):
        text, photos = rb._sheet_text(WATER)
        for part in ("départ · 10 min le départ plage", "il faut border la barre doucement, puis choquer",
                     "twin-tip harnais", "le rider tient la barre bordée à fond", "mise en tension garde le kite à midi"):
            self.assertIn(part, text)
        for hidden in ("hidden title", "color:red", "secret", "<", "\xa0", "  ", "thumb.jpg"):
            self.assertNotIn(hidden, text)
        self.assertEqual(photos, ["thumb.jpg", "01-bord.jpg"])
        self.assertEqual(rb._sheet_text(None), ("", []))
        self.assertEqual(rb._sheet_text("<p>unclosed <div>tags <img src='https://example.test/a.jpg' alt=''>"), ("unclosed tags", []))


class PutChecks(Case):
    BAD = [   # (what is wrong, the terms of the file, a part of the message)
        ("no term", [entry(term="  ")], "terms[0]: term is missing"),
        ("no definition", [entry(definition="")], "terms[0] « border »: definition is missing"),
        ("no forms", [entry(forms=[])], "forms must be a list of at least one string"),
        ("forms that are not strings", [entry(forms=["border", 3])], "forms must be a list of at least one string"),
        ("an unknown confidence", [entry(confidence="maybe")], "confidence must be one of sure, unsure"),
        ("no confidence", [{k: v for k, v in entry().items() if k != "confidence"}], "confidence must be one of sure, unsure"),
        ("a doubt on a sure entry", [entry(doubt="Peut-être un mot propre à ce coach.")], "doubt goes only with confidence « unsure »"),
        ("the same term and sense twice", [entry(), entry(term="Border", sense="")], "terms[1] « Border »: same term and sense as terms[0]"),
        ("the same term and sense twice, case ignored", [entry(sense="le kite"), entry(sense="Le Kite")], "same term and sense as terms[0]"),
        ("a sheet of another notebook", [entry(sheets=[{"slug": "push-up", "quote": "border is not a word", "where": "text"}])],
         "sheets[0]: 'push-up' is not a sheet of this notebook"),
        ("a session named as a sheet", [entry(sheets=[{"slug": "kite-old-session", "quote": "border", "where": "text"}])],
         "'kite-old-session' is not a sheet of this notebook"),
        ("a quote that is not in the sheet", [entry(sheets=[{"slug": "kite-jump", "quote": "il faut border la barre doucement", "where": "text"}])],
         "sheets[0]: the quote is not found in the text of sheet 'kite-jump'"),
        ("a quote found only in a script", [entry(sheets=[{"slug": "kite-water-start", "quote": "border le script", "where": "text"}])],
         "the quote is not found in the text of sheet 'kite-water-start'"),
        ("a quote without any of the forms", [entry(sheets=[{"slug": "kite-water-start", "quote": "garde le kite à midi", "where": "text"}])],
         "sheets[0]: the quote holds none of the entry's forms"),
        ("no quote", [entry(sheets=[{"slug": "kite-jump", "where": "text"}])], "sheets[0]: quote is missing"),
        ("an unknown where", [entry(sheets=[{"slug": "kite-jump", "quote": "il faut border fort", "where": "footer"}])],
         "sheets[0]: where must be one of text, title, caption, chip"),
        ("no where", [entry(sheets=[{"slug": "kite-jump", "quote": "il faut border fort"}])], "where must be one of"),
        ("a photo of another notebook", [entry(photo={"slug": "push-up", "file": "01.jpg"})], "photo: 'push-up' is not a sheet of this notebook"),
        ("a photo without a file", [entry(photo={"slug": "kite-jump"})], "photo must be null or {slug, file}"),
        ("an entry that is not an object", ["border"], "terms[0]: not an object"),
        ("related that is not a list", [entry(related="choquer")], "related must be a list of strings"),
    ]

    def test_each_check_refuses_the_file_and_writes_nothing(self):
        for what, terms, message in self.BAD:
            with self.subTest(what):
                out, err, code = self.put(terms)
                self.assertEqual((out, code), ("", 1))
                self.assertIn(message, err)
                self.assertIn("1 problem(s), nothing written", err)
                self.assertEqual(self.backend.writes(), [])
                self.assertEqual(self.backend.words, [])

    def test_a_notebook_that_is_not_the_account_s(self):
        out, err, code = self.put([entry()], theme="yoga", notebook="yoga")
        self.assertEqual((out, code), ("", 1))
        self.assertIn("'yoga' is not one of this account's notebooks", err)
        self.assertIn("1 problem(s), nothing written", err)   # what names a sheet is not checked against a missing notebook
        self.assertEqual(self.backend.writes(), [])

    def test_a_file_made_for_another_notebook(self):
        _, err, code = self.put([entry()], notebook="kitefoil")
        self.assertEqual(code, 1)
        self.assertIn("the file is the glossary of notebook 'kitefoil', not of 'kitesurf'", err)
        self.assertEqual(self.backend.writes(), [])
        self.assertEqual(self.put([entry()], notebook=None)[2], 0)   # a file that names no notebook is taken for <theme>

    def test_all_problems_are_reported_at_once(self):
        good = entry(term="choquer", forms=["choquer"], photo=None, sheets=[{"slug": "kite-water-start", "quote": "puis choquer dès que la planche glisse", "where": "text"}])
        terms = [entry(definition=" ", confidence="?"), good, entry(sheets=[{"slug": "nope", "quote": "zzz", "where": "x"}]), entry(term="")]
        out, err, code = self.put(terms)
        self.assertEqual((out, code), ("", 1))
        lines = err.splitlines()
        self.assertEqual(len(lines), 8, err)
        self.assertTrue(lines[-1].endswith("7 problem(s), nothing written"))
        for part in ("terms[0] « border »: definition is missing", "terms[0] « border »: confidence must be", "terms[2] « border »: same term and sense as terms[0]",
                     "terms[2] « border »: sheets[0]: where must be", "terms[2] « border »: sheets[0]: the quote holds none",
                     "terms[2] « border »: sheets[0]: 'nope' is not a sheet", "terms[3]: term is missing"):
            self.assertIn(part, err)
        self.assertEqual(self.backend.writes(), [])   # not even the entry that had nothing wrong

    def test_a_quote_is_matched_as_the_text_reads(self):
        ok = lambda slug, quote, where="text", forms=("border", "bordée", "midi", "départ", "harnais"): self.put(
            [entry(forms=list(forms), photo=None, sheets=[{"slug": slug, "quote": quote, "where": where}])])[2]
        self.assertEqual(ok("kite-water-start", "il faut border la barre doucement"), 0)        # a tag and &nbsp; inside the place
        self.assertEqual(ok("kite-water-start", "  IL FAUT   Border\nla barre "), 0)             # whitespace and case
        self.assertEqual(ok("kite-water-start", "Le départ plage", "title"), 0)                  # the title
        self.assertEqual(ok("kite-water-start", "Le rider tient la barre bordée à fond", "caption"), 0)   # an alt text
        self.assertEqual(ok("kite-water-start", "harnais", "chip"), 0)                           # a kit chip
        self.assertEqual(ok("kite-water-start", "il faut border la barre doucement", forms=("BORDER",)), 0)   # forms: case ignored
        self.assertEqual(ok("kite-water-start", "il faut border le barre doucement"), 1)         # not verbatim

    def test_what_is_not_a_pass_output_is_refused_before_any_call(self):
        p = pathlib.Path(self._tmp.name)
        (p / "list.json").write_text("[]")
        (p / "no-terms.json").write_text('{"notebook": "kitesurf"}')
        (p / "broken.json").write_text("{")
        for name in ("list.json", "no-terms.json", "broken.json", "missing.json"):
            out, err, code = self.run_cmd(["put", "kitesurf", str(p / name)])
            self.assertEqual((out, code), ("", 1), name)
            self.assertIn(name, err)
            self.assertEqual(self.backend.calls, [], name)

    def test_a_backend_without_the_table_says_so_in_one_line_and_exits_1(self):
        out, err, code = self.put([entry()], backend=Backend(table=False))
        self.assertEqual((out, code), ("", 1))
        self.assertEqual(err, f"rb: {rb.NO_GLOSSARY}, then run this again\n")
        self.assertIn("no glossary yet: re-run supabase/schema.sql", err)
        self.assertEqual(self.backend.writes(), [])


class PutWrites(Case):
    def test_new_entries_are_inserted_as_the_contract_stores_them(self):
        second = entry(term=" Aile ", sense="le kite", forms=["aile"], kind=None, photo=None, related=[], confidence="unsure",
                       doubt="Se dit aussi de l'aile du foil.", spelling="aille", sheets=[])
        out, err, code = self.put([entry(sense=""), second])
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(out, "glossary kitesurf: 2 inserted, 0 updated, 0 unchanged\n")
        self.assertEqual([(c[0], c[1], c[2]) for c in self.backend.writes()], [("POST", "glossary_words", {})])
        rows = self.backend.writes()[0][3]
        self.assertEqual(list(rows[0]), list(rb.GLOSSARY_FIELDS) + ["theme"])   # no user_id: the default auth.uid() and RLS own it
        self.assertEqual(rows[0], {"theme": "kitesurf", "term": "border", "sense": None, "forms": ["border", "bordée", "bordé"], "kind": "action",
                                   "definition": "Tirer la barre vers toi pour donner de la puissance au kite.", "confidence": "sure",
                                   "doubt": None, "spelling": None, "related": ["choquer"],
                                   "photo": {"slug": "kite-water-start", "file": "01-bord.jpg"},   # the name under img/, without the pass's `why`
                                   "sheets": entry()["sheets"]})
        self.assertEqual((rows[1]["term"], rows[1]["sense"], rows[1]["photo"], rows[1]["sheets"], rows[1]["doubt"], rows[1]["spelling"]),
                         ("Aile", "le kite", None, [], "Se dit aussi de l'aile du foil.", "aille"))

    def test_an_entry_that_exists_keeps_its_text_and_gets_the_new_forms_and_sheets(self):
        old = stored(term="Border", sense=None)
        out, _, code = self.put([entry(term="border", sense="")], backend=Backend([old]))
        self.assertEqual((out, code), ("glossary kitesurf: 0 inserted, 1 updated, 0 unchanged\n", 0))
        (method, path, params, data), = self.backend.writes()
        self.assertEqual((method, path), ("PATCH", "glossary_words"))
        self.assertEqual(params, {"id": "eq.w1", "user_id": "eq.u1", "updated_at": f"eq.{T0}", "select": "id"})   # only if nobody wrote it since
        # `forms`: the stored ones first, then the file's new ones; `sheets`: the item for a slug already listed
        # replaces it in place, the new slug is added after. Nothing else.
        self.assertEqual(data, {"forms": ["border", "bordée", "bordé"],
                                "sheets": [{"slug": "kite-water-start", "quote": "il faut border la barre doucement", "where": "text"},
                                           {"slug": "kite-jump", "quote": "il faut border fort et garder le crantage", "where": "text"}]})
        row = self.backend.words[0]
        for k in ("term", "definition", "confidence", "doubt", "photo", "related", "kind"):
            self.assertEqual(row[k], old[k], k)

    def test_a_quote_that_holds_a_form_of_the_file_only_is_stored_with_that_form(self):
        # Codex pass 1 on #138: stored forms ["border"], the file brings ["bordée"] and a quote that holds only « bordée »
        bar = {"slug": "kite-bar", "kind": "sheet", "theme": "kitesurf", "title": "La barre", "html": "<p>Garde la barre bien bordée.</p>"}
        quote = {"slug": "kite-bar", "quote": "Garde la barre bien bordée.", "where": "text"}
        for case, before in (("a new sheet", stored()["sheets"]), ("a sheet already listed", [dict(quote, quote="border la barre")])):
            with self.subTest(case):
                out, err, code = self.put([entry(forms=["bordée"], photo=None, sheets=[quote])],
                                          backend=Backend([stored(forms=["border"], sheets=before)], sheets=SHEETS + [bar]))
                self.assertEqual((out, err, code), ("glossary kitesurf: 0 inserted, 1 updated, 0 unchanged\n", "", 0))
                row = self.backend.words[0]
                self.assertEqual(row["forms"], ["border", "bordée"])
                self.assertIn(quote, row["sheets"])
                # what the app relies on: every stored quote holds one of the stored forms
                for it in row["sheets"]:
                    self.assertTrue(any(f in it["quote"].lower() for f in row["forms"]), it)
                self.assertEqual((row["definition"], row["doubt"], row["photo"]), ("The first definition.", stored()["doubt"], stored()["photo"]))

    def test_the_forms_are_merged_whatever_their_case_the_stored_ones_first(self):
        self.put([entry()], backend=Backend([stored(forms=["Border", "BORDÉE"])]))
        self.assertEqual(self.backend.words[0]["forms"], ["Border", "BORDÉE", "bordé"])
        # nothing new among the forms: `forms` is not written
        self.put([entry(forms=["BORDER"])], backend=Backend([stored(forms=["border", "bordée"])]))
        self.assertEqual(list(self.backend.writes()[0][3]), ["sheets"])

    def test_a_merge_that_would_keep_a_quote_without_any_form_writes_nothing(self):
        # every quote of the merged entry is checked, the stored ones too, before any write (the new entry is not inserted)
        old = stored(forms=["choquer"], sheets=[{"slug": "kite-water-start", "quote": "puis choquer dès que la planche glisse", "where": "text"},
                                                {"slug": "kite-jump", "quote": "Pousse sur les talons.", "where": "text"}])
        fresh = entry(term="kite à midi", forms=["kite à midi"], photo=None, sheets=[])
        b = Backend([old])
        out, err, code = self.put([entry(sheets=[entry()["sheets"][0]]), fresh], backend=b)
        self.assertEqual((out, code), ("", 1))
        self.assertIn("« border »: the quote already stored for sheet 'kite-jump' holds none of the forms of the merged entry "
                      "(choquer, border, bordée, bordé)", err)
        self.assertIn("1 problem(s), nothing written", err)
        self.assertEqual((b.writes(), b.words), ([], [old]))

    def test_the_sheets_already_listed_stay_when_the_file_names_others(self):
        old = stored(sheets=[{"slug": "kite-gone", "quote": "border, on a sheet deleted since", "where": "text"},
                             {"slug": "kite-water-start", "quote": "border la barre", "where": "text"}])
        self.put([entry(sheets=[{"slug": "kite-jump", "quote": "il faut border fort", "where": "text"}])], backend=Backend([old]))
        self.assertEqual([i["slug"] for i in self.backend.words[0]["sheets"]], ["kite-gone", "kite-water-start", "kite-jump"])
        self.assertEqual(self.backend.words[0]["sheets"][1]["quote"], "border la barre")

    def test_nothing_new_is_unchanged_and_nothing_is_written(self):
        b = Backend()
        self.put([entry()], backend=b)
        b.calls.clear()
        out, _, code = self.put([entry(definition="Another wording.", photo=None)], backend=b)
        self.assertEqual((out, code), ("glossary kitesurf: 0 inserted, 0 updated, 1 unchanged\n", 0))
        self.assertEqual(b.writes(), [])
        self.assertEqual(b.words[0]["definition"], entry()["definition"])

    def test_replace_overwrites_the_whole_entry(self):
        new = entry(term="border", definition="A better definition.", photo=None,
                    sheets=[{"slug": "kite-jump", "quote": "il faut border fort", "where": "text"}])
        out, _, code = self.put([new], "--replace", backend=Backend([stored(term="Border")]))
        self.assertEqual((out, code), ("glossary kitesurf: 0 inserted, 1 updated, 0 unchanged\n", 0))
        (method, _, params, data), = self.backend.writes()
        self.assertEqual((method, params), ("PATCH", {"id": "eq.w1", "user_id": "eq.u1", "updated_at": f"eq.{T0}", "select": "id"}))
        row = self.backend.words[0]
        self.assertEqual((row["term"], row["definition"], row["forms"], row["confidence"], row["doubt"], row["photo"], row["related"]),
                         ("border", "A better definition.", ["border", "bordée", "bordé"], "sure", None, None, ["choquer"]))
        self.assertEqual(row["sheets"], new["sheets"])   # the sheets too: the item of kite-water-start is gone
        self.assertEqual((row["id"], row["theme"], row["user_id"]), ("w1", "kitesurf", "u1"))
        self.assertNotIn("theme", data)

    def test_replace_with_the_same_entry_is_unchanged(self):
        b = Backend()
        self.put([entry()], backend=b)
        b.calls.clear()
        out, _, _ = self.put([entry()], "--replace", backend=b)
        self.assertEqual(out, "glossary kitesurf: 0 inserted, 0 updated, 1 unchanged\n")
        self.assertEqual(b.writes(), [])

    def test_inserted_updated_and_unchanged_in_one_run_and_nothing_is_ever_deleted(self):
        water = {"slug": "kite-water-start", "quote": "puis choquer dès que la planche glisse", "where": "text"}
        same = entry(term="choquer", forms=["choquer"], photo=None, sheets=[water])   # stored as the file has it
        words = [stored(id="w1"), dict(rb._glossary_row(same), id="w2", user_id="u1", theme="kitesurf"),
                 stored(id="w3", term="crantage"), stored(id="w4", theme="strength", term="border")]
        terms = [entry(), same,
                 entry(term="kite à midi", forms=["kite à midi"], photo=None, sheets=[{"slug": "kite-water-start", "quote": "Garde le kite à midi, les bras souples.", "where": "text"}])]
        for flags in ((), ("--replace",)):
            with self.subTest(flags):
                out, _, code = self.put(terms, *flags, backend=Backend(words))
                self.assertEqual((out, code), ("glossary kitesurf: 1 inserted, 1 updated, 1 unchanged\n", 0))
                self.assertEqual(sorted({c[0] for c in self.backend.calls}), ["GET", "PATCH", "POST"])   # never DELETE
                # the entry the file does not name and the other notebook's word are still there, untouched
                self.assertEqual(len(self.backend.words), 5)
                self.assertEqual([w for w in self.backend.words if w["id"] in ("w3", "w4")], [words[2], words[3]])

    def test_a_sheet_listed_twice_in_one_entry_counts_once(self):
        twice = [{"slug": "kite-jump", "quote": "il faut border fort", "where": "text"},
                 {"slug": "kite-jump", "quote": "border fort et garder le crantage", "where": "text"}]
        self.put([entry(photo=None, sheets=twice)])
        self.assertEqual(self.backend.words[0]["sheets"], [twice[1]])


class PutAtTheSameTime(Case):
    """Two `glossary put` of the same account at once (Codex pass 1 on #138): no write of one is lost to the other."""
    S = [{"slug": s, "kind": "sheet", "theme": "kitesurf", "title": s, "html": f"<p>Sur la fiche {s}, il faut border fort.</p>"}
         for s in ("s1", "s2", "s3")]

    def item(self, slug):
        return {"slug": slug, "quote": f"Sur la fiche {slug}, il faut border fort.", "where": "text"}

    def word(self, *slugs, **over):
        return entry(photo=None, sheets=[self.item(s) for s in slugs], **over)

    def once(self, fn, method=None):
        """A before_write that runs `fn` a single time, before the first write (of that method)."""
        left = [fn]
        return lambda m, data: left.pop()() if left and method in (None, m) else None

    def other_put(self, b, terms, *flags):
        """Another command, run to its end on the same backend; the result of the command under test is kept."""
        def run():
            mine = self.put(terms, *flags, backend=b)
            self.assertEqual((mine[1], mine[2]), ("", 0), "the other command")
        return run

    def test_two_puts_that_read_the_same_entry_both_keep_their_sheet(self):
        # A and B read the entry (s1); A adds s2, B adds s3; B's update lands first: A's names an updated_at that is
        # gone, changes nothing, reads again and merges s2 into what B stored
        b = Backend([stored(sheets=[self.item("s1")])], sheets=self.S)
        b.before_write = self.once(self.other_put(b, [self.word("s3")]))
        out, err, code = self.put([self.word("s2")], backend=b)
        self.assertEqual((out, err, code), ("glossary kitesurf: 0 inserted, 1 updated, 0 unchanged\n", "", 0))
        self.assertEqual(b.words[0]["sheets"], [self.item("s1"), self.item("s3"), self.item("s2")])
        patches = [c for c in b.calls if c[0] == "PATCH"]
        self.assertEqual([[i["slug"] for i in c[3]["sheets"]] for c in patches], [["s1", "s2"], ["s1", "s3"], ["s1", "s3", "s2"]])
        self.assertEqual(patches[0][2]["updated_at"], f"eq.{T0}")                         # A, overtaken: no row changed
        self.assertEqual(patches[2][2]["updated_at"], "eq.2026-01-01T00:00:00.000001+00:00")   # A again, on what B wrote

    def test_the_update_filter_reaches_the_server_as_the_date_read(self):
        # a `+` left as it is in a query string is read as a space: the filter would never match
        seen = []
        saved, rb.http = rb.http, lambda method, url, headers=None, data=None, raw=False, tolerate=(): seen.append((url, headers)) or []
        try:
            self._saved[1](CFG, "PATCH", "glossary_words", {"sheets": []}, prefer="return=representation",
                           params={"id": "eq.w1", "updated_at": "eq.2026-01-01T00:00:00.000001+00:00"})
        finally:
            rb.http = saved
        self.assertEqual(seen[0][0], "https://example.test/rest/v1/glossary_words?id=eq.w1&updated_at=eq.2026-01-01T00%3A00%3A00.000001%2B00%3A00")
        self.assertEqual(seen[0][1]["Prefer"], "return=representation")

    def test_replace_overtaken_reads_again_and_overwrites(self):
        b = Backend([stored(sheets=[self.item("s1")])], sheets=self.S)
        b.before_write = self.once(self.other_put(b, [self.word("s3")]))
        out, _, code = self.put([self.word("s2", definition="A better definition.")], "--replace", backend=b)
        self.assertEqual((out, code), ("glossary kitesurf: 0 inserted, 1 updated, 0 unchanged\n", 0))
        self.assertEqual((b.words[0]["sheets"], b.words[0]["definition"]), ([self.item("s2")], "A better definition."))

    def test_two_puts_that_insert_the_same_word_end_as_one_entry_with_both_sheets(self):
        # the unique index refuses A's insert (one statement: the other new word is not inserted either); A reads
        # again: the word exists now and is merged, the other one is inserted
        b = Backend(sheets=self.S)
        b.before_write = self.once(self.other_put(b, [self.word("s3", term="Border", definition="B's definition.")]), "POST")
        out, err, code = self.put([self.word("s2"), self.word("s1", term="choquer", forms=["border"])], backend=b)
        self.assertEqual((out, err, code), ("glossary kitesurf: 1 inserted, 1 updated, 0 unchanged\n", "", 0))
        self.assertEqual([(w["term"], w["definition"][:3], [i["slug"] for i in w["sheets"]]) for w in b.words],
                         [("Border", "B's", ["s3", "s2"]), ("choquer", "Tir", ["s1"])])
        # A's insert of two (refused), B's insert, then A again: the other word inserted, the same word merged
        self.assertEqual([(c[0], [r["term"] for r in c[3]] if c[0] == "POST" else list(c[3])) for c in b.writes()],
                         [("POST", ["border", "choquer"]), ("POST", ["Border"]), ("POST", ["choquer"]), ("PATCH", ["sheets"])])

    def test_two_puts_that_insert_the_same_word_with_the_sense_in_another_case_end_as_one_entry(self):
        # Codex pass 2 on #138: « aile » with the sense « le kite » (A, s1) and « Le Kite » (B, s2). The index ignores
        # the case of the sense as the command does: A's insert is refused, A reads again and merges into B's row
        b = Backend(sheets=self.S)
        aile = lambda slug, sense: self.word(slug, term="aile", sense=sense, forms=["border"])
        self.assertEqual(b.index_key(dict(aile("s1", "le kite"), theme="kitesurf")), b.index_key(dict(aile("s2", "Le Kite"), theme="kitesurf")))
        b.before_write = self.once(self.other_put(b, [aile("s2", "Le Kite")]), "POST")
        out, err, code = self.put([aile("s1", "le kite")], backend=b)
        self.assertEqual((out, err, code), ("glossary kitesurf: 0 inserted, 1 updated, 0 unchanged\n", "", 0))
        self.assertEqual([(w["term"], w["sense"], [i["slug"] for i in w["sheets"]]) for w in b.words], [("aile", "Le Kite", ["s2", "s1"])])
        # A's insert (refused), B's insert, then A again: one conditional update of B's row, no second insert
        self.assertEqual([(c[0], [r["sense"] for r in c[3]] if c[0] == "POST" else list(c[3])) for c in b.writes()],
                         [("POST", ["le kite"]), ("POST", ["Le Kite"]), ("PATCH", ["sheets"])])

    def test_another_refusal_of_the_insert_is_an_error(self):
        b = Backend(sheets=self.S)
        def refuse(method, data): raise rb.RbHTTPError(409, '{"code":"23503","message":"violates foreign key constraint"}')
        b.before_write = refuse
        out, err, code = self.put([self.word("s2")], backend=b)
        self.assertEqual((out, code, b.words), ("", 1, []))
        self.assertIn("POST glossary_words → 409", err)
        self.assertEqual(len(b.writes()), 1)   # not tried again

    def test_an_entry_that_keeps_changing_stops_after_three_more_tries_and_says_what_was_written(self):
        b = Backend([stored(sheets=[self.item("s1")])], sheets=self.S)
        def touch(method, data):   # someone writes the entry just before each of this command's updates
            if method == "PATCH": b.words[0]["updated_at"] = b.tick()
        b.before_write = touch
        out, err, code = self.put([self.word("s2"), self.word("s3", term="choquer", forms=["border"])], backend=b)
        self.assertEqual((out, code), ("", 1))
        self.assertEqual(err.count("\n"), 1)   # one line
        self.assertIn("glossary kitesurf: 1 entry not written (border): another command kept writing the same words (4 tries)", err)
        self.assertIn("already written: 1 inserted, 0 updated; run this again", err)
        self.assertEqual([c[0] for c in b.writes()], ["POST"] + ["PATCH"] * (1 + rb.GLOSSARY_RETRIES))
        self.assertEqual(rb.GLOSSARY_RETRIES, 3)
        self.assertEqual(([i["slug"] for i in b.words[0]["sheets"]], b.words[1]["term"]), (["s1"], "choquer"))

    def test_a_merge_that_fails_on_the_second_reading_says_what_was_written(self):
        b = Backend([stored(sheets=[self.item("s1")])], sheets=self.S)
        def spoil():   # stored meanwhile: a quote that holds none of the forms
            b.words[0].update(sheets=[dict(self.item("s1"), quote="Sur la fiche s1.")], updated_at=b.tick())
        b.before_write = self.once(spoil, "PATCH")
        out, err, code = self.put([self.word("s2"), self.word("s3", term="choquer", forms=["border"])], backend=b)
        self.assertEqual((out, code), ("", 1))
        self.assertIn("the quote already stored for sheet 's1' holds none of the forms", err)
        self.assertIn("1 problem(s), after another command changed the glossary; already written: 1 inserted, 0 updated", err)
        self.assertEqual([i["quote"] for i in b.words[0]["sheets"]], ["Sur la fiche s1."])   # not overwritten


def republished(*slugs, at=T2):
    """The fixture sheets, those published again since (their updated_at moved)."""
    return [dict(s, updated_at=at) if s["slug"] in slugs else dict(s) for s in SHEETS]


def recorded(b):
    return sorted((p["theme"], p["slug"], p["sheet_updated_at"]) for p in b.passes)


NOT_AN_INSTANT = " is not a full date-time with its time zone, as `sheets --pending` prints it (2026-02-01T23:30:00+00:00, or …Z)\n"
UTC = datetime.timezone.utc


class PutPassed(Case):
    """P11 G2a: `put` records the sheets the pass read (the file's "passed") in glossary_passes, after the entries."""
    NOW = "2026-04-01T03:00:00Z"

    def test_each_sheet_read_gets_its_row_after_the_entries_with_the_sheet_s_updated_at(self):
        out, err, code = self.put([entry()], passed=["kite-water-start", "kite-jump"])
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(out, "glossary kitesurf: 1 inserted, 0 updated, 0 unchanged\nglossary kitesurf: 2 sheets recorded as read\n")
        self.assertEqual([(c[0], c[1]) for c in self.backend.writes()], [("POST", "glossary_words"), ("POST", "glossary_passes")])
        # one upsert; the date is the one read with the text the quotes were checked against, sent back as printed;
        # no user_id, as the entries: the column's default and RLS own it
        self.assertEqual(self.backend.writes()[1][3],
                         [{"theme": "kitesurf", "slug": "kite-water-start", "sheet_updated_at": T1, "passed_at": self.NOW},
                          {"theme": "kitesurf", "slug": "kite-jump", "sheet_updated_at": T1, "passed_at": self.NOW}])
        self.assertEqual(recorded(self.backend), [("kitesurf", "kite-jump", T1), ("kitesurf", "kite-water-start", T1)])

    def test_a_sheet_where_the_pass_found_no_word_gets_its_row_and_is_not_asked_again(self):
        out, err, code = self.put([], passed=["kite-jump"])
        self.assertEqual((out, err, code), ("glossary kitesurf: 0 inserted, 0 updated, 0 unchanged\nglossary kitesurf: 1 sheet recorded as read\n", "", 0))
        self.assertEqual([(c[0], c[1]) for c in self.backend.writes()], [("POST", "glossary_passes")])
        self.assertEqual(recorded(self.backend), [("kitesurf", "kite-jump", T1)])
        out, _, _ = self.run_cmd(["sheets", "kitesurf", "--pending"], self.backend)
        self.assertEqual([s["slug"] for s in json.loads(out)["sheets"]], ["kite-water-start"])

    def test_a_file_without_passed_records_nothing(self):
        for more in ({}, {"passed": []}, {"passed": None}):
            out, err, code = self.put([entry()], **more)
            self.assertEqual((out, err, code), ("glossary kitesurf: 1 inserted, 0 updated, 0 unchanged\n", "", 0), more)
            self.assertEqual({c[1] for c in self.backend.calls}, {"glossary_words", "user_themes", "sheets"}, more)   # the table is not even asked

    def test_a_slug_that_is_not_a_sheet_of_the_notebook_fails_the_checks_before_any_write(self):
        for slug, why in (("no-such-sheet", "unknown"), ("kite-old-session", "a session"), ("push-up", "a sheet of another notebook")):
            out, err, code = self.put([entry()], passed=["kite-jump", slug])
            self.assertEqual((out, code), ("", 1), why)
            self.assertIn(f"rb: passed[1]: '{slug}' is not a sheet of this notebook\n", err)
            self.assertIn("1 problem(s), nothing written", err)
            self.assertEqual(self.backend.writes(), [], why)   # neither the entries nor the sheets read
            self.assertEqual((self.backend.words, self.backend.passes), ([], []))

    def test_passed_is_checked_with_the_entries_all_problems_at_once(self):
        out, err, code = self.put([entry(definition="")], passed=["nope", "kite-jump"])
        self.assertEqual((out, code), ("", 1))
        self.assertIn("terms[0] « border »: definition is missing", err)
        self.assertIn("passed[0]: 'nope' is not a sheet of this notebook", err)
        self.assertIn("2 problem(s), nothing written", err)
        self.assertEqual(self.backend.writes(), [])

    def test_passed_must_be_a_list_of_slugs(self):
        for bad in ("kite-jump", ["kite-jump", 3], [""], {"kite-jump": True}, [None], 0, [{"updated_at": T1}], [{"slug": 3, "updated_at": T1}]):
            out, err, code = self.put([entry()], passed=bad)
            self.assertEqual((out, code), ("", 1), bad)
            self.assertIn('rb: passed must be a list of {"slug": "…", "updated_at": "…"} (or of sheet slugs)\n', err)
            self.assertEqual(self.backend.writes(), [], bad)

    def test_a_sheet_listed_twice_counts_once(self):
        # the fake backend refuses the same key twice in one upsert, as Postgres does
        out, err, code = self.put([], passed=["kite-jump", "kite-jump"])
        self.assertEqual((err, code), ("", 0))
        self.assertIn("glossary kitesurf: 1 sheet recorded as read\n", out)
        self.assertEqual(recorded(self.backend), [("kitesurf", "kite-jump", T1)])

    def test_a_sheet_published_again_and_read_again_keeps_one_row_with_the_new_date(self):
        b = Backend(passes=[read("kite-jump"), read("kite-water-start")], sheets=republished("kite-jump"))
        out, err, code = self.put([], passed=["kite-jump"], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(recorded(b), [("kitesurf", "kite-jump", T2), ("kitesurf", "kite-water-start", T1)])
        self.assertEqual([p["passed_at"] for p in b.passes], [self.NOW, read("x")["passed_at"]])   # read again: the new time

    def test_a_backend_that_does_not_record_the_passes_writes_the_entries_and_says_so_in_one_line(self):
        out, err, code = self.put([entry()], passed=["kite-jump"], backend=Backend(passes_table=False))
        self.assertEqual((out, code), ("glossary kitesurf: 1 inserted, 0 updated, 0 unchanged\n", 0))
        self.assertEqual(err, f"rb: {rb.NO_PASSES}\n")
        self.assertIn("passes not recorded", err)
        self.assertIn("re-run supabase/schema.sql", err)
        self.assertEqual([w["term"] for w in self.backend.words], ["border"])

    def test_entries_that_were_not_written_leave_their_sheets_to_be_read_again(self):
        item = lambda slug: {"slug": slug, "quote": f"Sur la fiche {slug}, il faut border fort.", "where": "text"}
        b = Backend([stored(sheets=[item("s1")])], sheets=[dict(s, updated_at=T1) for s in PutAtTheSameTime.S])
        def touch(method, data):   # someone writes the entry just before each of this command's updates
            if method == "PATCH": b.words[0]["updated_at"] = b.tick()
        b.before_write = touch
        out, err, code = self.put([entry(photo=None, sheets=[item("s2")])], passed=["s2"], backend=b)
        self.assertEqual((out, code), ("", 1))
        self.assertIn("1 entry not written (border)", err)
        self.assertEqual([c[1] for c in b.writes()], ["glossary_words"] * (1 + rb.GLOSSARY_RETRIES))
        self.assertEqual(b.passes, [])

    def test_two_puts_that_read_the_same_sheet_leave_one_row(self):
        # the computer and the hosted worker at once: B's upsert lands between A's reading and A's upsert
        b = Backend()
        left = [lambda: self.put([], passed=["kite-jump", "kite-water-start"], backend=b)]
        b.before_write = lambda method, data: left.pop()() if left else None
        out, err, code = self.put([], passed=["kite-jump"], backend=b)
        self.assertEqual((err, code), ("", 0))
        # A's insert finds B's row and leaves it; A's update of that row carries the same date
        self.assertEqual([(c[0], c[1]) for c in b.writes()], [("POST", "glossary_passes"), ("POST", "glossary_passes"), ("PATCH", "glossary_passes")])
        self.assertEqual(recorded(b), [("kitesurf", "kite-jump", T1), ("kitesurf", "kite-water-start", T1)])

    def test_two_puts_on_a_sheet_published_again_between_them_keep_the_later_date_whichever_lands_last(self):
        # A read the sheet at T1 and is about to record it; meanwhile the sheet is published again (T2) and B, which
        # read that version, records it; A lands last: the row does not move back to T1, and the sheet, whose latest
        # version B read, is not asked again
        sheets = republished()
        b = Backend(sheets=sheets)
        def meanwhile():
            sheets[0]["updated_at"] = T2
            self.put([], passed=[{"slug": "kite-jump", "updated_at": T2}], backend=b)
            self.assertEqual(recorded(b), [("kitesurf", "kite-jump", T2)])
        left = [meanwhile]
        b.before_write = lambda method, data: left.pop()() if left else None
        self.assertEqual(sheets[0]["slug"], "kite-jump")
        out, err, code = self.put([], passed=[{"slug": "kite-jump", "updated_at": T1}], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(out, "glossary kitesurf: 0 inserted, 0 updated, 0 unchanged\n"
                              "glossary kitesurf: 0 sheets recorded as read, 1 left as recorded (a later version was read meanwhile)\n")
        self.assertEqual(recorded(b), [("kitesurf", "kite-jump", T2)])
        self.assertEqual([(c[2]["slug"], c[2]["sheet_updated_at"]) for c in b.writes() if c[0] == "PATCH"], [("eq.kite-jump", f"lte.{T1}")])
        out, _, _ = self.run_cmd(["sheets", "kitesurf", "--pending"], b)
        self.assertEqual([s["slug"] for s in json.loads(out)["sheets"]], ["kite-water-start"])

    def test_a_row_never_moves_back_to_an_earlier_date(self):
        b = Backend(passes=[read("kite-jump", at=T2)], sheets=republished("kite-jump"))
        out, err, code = self.put([], passed=[{"slug": "kite-jump", "updated_at": T1}, {"slug": "kite-water-start", "updated_at": T1}], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertIn("glossary kitesurf: 1 sheet recorded as read, 1 left as recorded (a later version was read meanwhile)\n", out)
        self.assertEqual(recorded(b), [("kitesurf", "kite-jump", T2), ("kitesurf", "kite-water-start", T1)])
        self.assertEqual(b.passes[0]["passed_at"], read("x")["passed_at"])   # left as it was, its time too

    def test_a_sheet_published_again_while_the_pass_ran_still_needs_the_pass(self):
        # the pass reads `sheets --pending`; kite-jump is published again before its `put`; the file gives back the
        # dates that were printed: the row says the version that was read, so the new one is asked
        sheets = republished()
        b = Backend(sheets=sheets)
        out, _, _ = self.run_cmd(["sheets", "kitesurf", "--pending"], b)
        passed = [{"slug": s["slug"], "updated_at": s["updated_at"]} for s in json.loads(out)["sheets"]]
        self.assertEqual(passed, [{"slug": "kite-jump", "updated_at": T1}, {"slug": "kite-water-start", "updated_at": T1}])
        self.assertEqual(sheets[0]["slug"], "kite-jump")
        sheets[0]["updated_at"] = T2
        out, err, code = self.put([], passed=passed, backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertIn("glossary kitesurf: 2 sheets recorded as read\n", out)
        self.assertEqual(recorded(b), [("kitesurf", "kite-jump", T1), ("kitesurf", "kite-water-start", T1)])
        out, _, _ = self.run_cmd(["sheets", "kitesurf", "--pending"], b)
        self.assertEqual([(s["slug"], s["updated_at"]) for s in json.loads(out)["sheets"]], [("kite-jump", T2)])
        # read again, at the date printed this time: nothing left
        self.put([], passed=[{"slug": "kite-jump", "updated_at": T2}], backend=b)
        out, _, _ = self.run_cmd(["sheets", "kitesurf", "--pending"], b)
        self.assertEqual(json.loads(out)["sheets"], [])

    def test_an_object_records_its_date_and_a_plain_slug_the_sheet_s_current_one(self):
        b = Backend(sheets=republished("kite-jump", "kite-water-start"))
        out, err, code = self.put([], passed=[{"slug": "kite-jump", "updated_at": T1}, "kite-water-start"], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(b.writes()[0][3], [{"theme": "kitesurf", "slug": "kite-jump", "sheet_updated_at": T1, "passed_at": self.NOW},
                                            {"theme": "kitesurf", "slug": "kite-water-start", "sheet_updated_at": T2, "passed_at": self.NOW}])
        self.assertEqual(recorded(b), [("kitesurf", "kite-jump", T1), ("kitesurf", "kite-water-start", T2)])

    def test_a_sheet_listed_twice_with_two_dates_keeps_the_earliest(self):
        for passed in ([{"slug": "kite-jump", "updated_at": T1}, "kite-jump"], ["kite-jump", {"slug": "kite-jump", "updated_at": T1}]):
            b = Backend(sheets=republished("kite-jump"))
            out, err, code = self.put([], passed=passed, backend=b)
            self.assertEqual((err, code), ("", 0), passed)
            self.assertEqual(recorded(b), [("kitesurf", "kite-jump", T1)], passed)

    def test_the_date_is_read_as_a_date_and_recorded_as_given(self):
        z = T1.replace("+00:00", "Z")   # the same instant, written otherwise
        self.assertNotEqual(z, T1)
        b = Backend()
        out, err, code = self.put([], passed=[{"slug": "kite-jump", "updated_at": z}], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(recorded(b), [("kitesurf", "kite-jump", z)])
        out, _, _ = self.run_cmd(["sheets", "kitesurf", "--pending"], b)
        self.assertEqual([s["slug"] for s in json.loads(out)["sheets"]], ["kite-water-start"])

    def test_a_date_later_than_the_sheet_s_is_refused_before_any_write(self):
        # a date of the future would hide the versions published until then
        out, err, code = self.put([entry()], passed=[{"slug": "kite-water-start", "updated_at": T1}, {"slug": "kite-jump", "updated_at": T2}])
        self.assertEqual((out, code), ("", 1))
        self.assertIn(f"rb: passed[1]: 'kite-jump': updated_at {T2} is later than the sheet's ({T1})\n", err)
        self.assertIn("1 problem(s), nothing written", err)
        self.assertEqual(self.backend.writes(), [])

    def test_a_date_that_is_not_one_is_refused_before_any_write(self):
        # the last two: no offset (not the same instant here and in the database); an object without its date is not
        # read as a plain slug
        for item in [{"slug": "kite-jump", "updated_at": bad} for bad in ("yesterday", "2026-13-45T00:00:00+00:00", "", None, 3, T1[:19])] + [{"slug": "kite-jump"}]:
            out, err, code = self.put([entry()], passed=[item])
            self.assertEqual((out, code), ("", 1), item)
            self.assertIn("rb: passed[0]: 'kite-jump': updated_at " + json.dumps(item.get("updated_at")) + NOT_AN_INSTANT, err)
            self.assertEqual(self.backend.writes(), [], item)

    def test_an_object_whose_slug_is_not_a_sheet_of_the_notebook_is_refused(self):
        out, err, code = self.put([entry()], passed=[{"slug": "push-up", "updated_at": T1}])
        self.assertEqual((out, code), ("", 1))
        self.assertIn("rb: passed[0]: 'push-up' is not a sheet of this notebook\n", err)
        self.assertEqual(self.backend.writes(), [])


class PutReconciles(Case):
    """Codex pass 1 on P11 G2b (#143): the file is all that still applies to the sheets of "passed". An entry that
    listed such a sheet and that the file does not give again for it loses that sheet; no entry is deleted, and the
    other sheets of an entry never move."""
    WATER_ITEM = {"slug": "kite-water-start", "quote": "border la barre", "where": "text"}
    JUMP_ITEM = {"slug": "kite-jump", "quote": "il faut border fort", "where": "text"}
    REMOVED_1 = ", 1 association removed (sheets read again)\n"
    S = [dict(s, updated_at=T1) for s in PutAtTheSameTime.S]

    def item(self, slug):
        return {"slug": slug, "quote": f"Sur la fiche {slug}, il faut border fort.", "where": "text"}

    def word_patches(self, b):
        return [[i["slug"] for i in c[3]["sheets"]] for c in b.calls if (c[0], c[1]) == ("PATCH", "glossary_words")]

    def test_a_sheet_published_again_without_the_word_loses_it_and_the_entry_stays(self):
        # Codex's scenario: « border » is listed for kite-water-start; the sheet is published again without the word
        # and read again: `terms: []`, `passed` up to date
        sheets = [dict(s, html="<p>Garde le kite à midi, les bras souples.</p>", updated_at=T2) if s["slug"] == "kite-water-start" else dict(s)
                  for s in SHEETS]
        b = Backend([stored()], sheets=sheets, passes=[read("kite-jump"), read("kite-water-start")])
        out, _, _ = self.run_cmd(["sheets", "kitesurf", "--pending"], b)
        self.assertEqual([(s["slug"], s["updated_at"]) for s in json.loads(out)["sheets"]], [("kite-water-start", T2)])
        out, err, code = self.put([], passed=[{"slug": "kite-water-start", "updated_at": T2}], backend=b)
        self.assertEqual((out, err, code), ("glossary kitesurf: 0 inserted, 0 updated, 0 unchanged" + self.REMOVED_1
                                            + "glossary kitesurf: 1 sheet recorded as read\n", "", 0))
        # the association is gone, the entry is still there with everything else it held
        self.assertEqual(len(b.words), 1)
        self.assertEqual({k: v for k, v in b.words[0].items() if k != "updated_at"}, {k: v for k, v in stored(sheets=[]).items() if k != "updated_at"})
        out, _, _ = self.run_cmd(["get", "kitesurf"], b)
        self.assertEqual([(e["term"], e["sheets"]) for e in json.loads(out)["terms"]], [("border", [])])
        # reconciled before the sheet is recorded as read, and the sheet is not asked again
        self.assertEqual([c[1] for c in b.writes()], ["glossary_words", "glossary_passes", "glossary_passes"])
        self.assertEqual(json.loads(self.run_cmd(["sheets", "kitesurf", "--pending"], b)[0])["sheets"], [])
        self.assertNotIn("kitesurf", self.run_cmd(["pending"], b)[0])   # no line for this notebook: nothing waits in it

    def test_an_entry_shared_by_two_sheets_keeps_the_sheet_that_was_not_read_again(self):
        words = [stored(sheets=[self.WATER_ITEM, self.JUMP_ITEM]),
                 stored(id="w2", term="crantage", forms=["crantage"], sheets=[{"slug": "kite-jump", "quote": "garder le crantage", "where": "text"}])]
        b = Backend(words)
        out, err, code = self.put([], passed=["kite-water-start"], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertIn("glossary kitesurf: 0 inserted, 0 updated, 0 unchanged" + self.REMOVED_1, out)
        self.assertEqual(b.words[0]["sheets"], [self.JUMP_ITEM])
        self.assertEqual((b.words[1]["sheets"], b.words[1]["updated_at"]), (words[1]["sheets"], T0))   # not even written
        self.assertEqual(self.word_patches(b), [["kite-jump"]])

    def test_an_entry_the_file_gives_for_another_sheet_only_loses_the_sheet_read_again(self):
        # the entry is in the file, for kite-jump; both sheets were read: kite-water-start no longer uses the word
        b = Backend([stored()])
        out, err, code = self.put([entry(photo=None, forms=["border"], sheets=[self.JUMP_ITEM])], passed=["kite-jump", "kite-water-start"], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertIn("glossary kitesurf: 0 inserted, 1 updated, 0 unchanged" + self.REMOVED_1, out)
        self.assertEqual(b.words[0]["sheets"], [self.JUMP_ITEM])
        self.assertEqual(b.words[0]["definition"], "The first definition.")

    def test_a_sheet_read_again_that_keeps_the_word_changes_nothing(self):
        b = Backend([stored(sheets=[self.WATER_ITEM, self.JUMP_ITEM])])
        out, err, code = self.put([entry(photo=None, forms=["border"], sheets=[self.WATER_ITEM])], passed=["kite-water-start"], backend=b)
        self.assertEqual((out, err, code), ("glossary kitesurf: 0 inserted, 0 updated, 1 unchanged\nglossary kitesurf: 1 sheet recorded as read\n", "", 0))
        self.assertEqual((b.words[0]["sheets"], b.words[0]["updated_at"]), ([self.WATER_ITEM, self.JUMP_ITEM], T0))
        self.assertEqual([c[1] for c in b.writes()], ["glossary_passes"])

    def test_a_sheet_that_is_not_in_passed_is_never_reconciled(self):
        # the file gives nothing for kite-jump, which the pass did not read: its association stays
        b = Backend([stored(sheets=[self.WATER_ITEM, self.JUMP_ITEM])])
        out, err, code = self.put([entry(photo=None, forms=["border"], sheets=[self.WATER_ITEM])], passed=["kite-water-start"], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertIn(self.JUMP_ITEM, b.words[0]["sheets"])

    def test_a_file_without_passed_removes_nothing(self):
        for more in ({}, {"passed": []}, {"passed": None}):
            for terms in ([], [entry(photo=None, forms=["border"], sheets=[self.JUMP_ITEM])]):
                b = Backend([stored()])
                out, err, code = self.put(terms, backend=b, **more)
                self.assertEqual((err, code), ("", 0), more)
                self.assertNotIn("removed", out)
                self.assertEqual(b.words[0]["sheets"], [self.WATER_ITEM] + [i for e in terms for i in e["sheets"]], more)
                self.assertEqual(b.passes, [])

    def test_replace_overwrites_its_entry_and_the_others_are_reconciled(self):
        words = [stored(), stored(id="w2", term="choquer", forms=["border"], sheets=[self.WATER_ITEM, self.JUMP_ITEM])]
        b = Backend(words)
        out, err, code = self.put([entry(photo=None, sheets=[self.WATER_ITEM])], "--replace", passed=["kite-water-start"], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertIn("glossary kitesurf: 0 inserted, 1 updated, 0 unchanged" + self.REMOVED_1, out)
        self.assertEqual((b.words[0]["sheets"], b.words[1]["sheets"]), ([self.WATER_ITEM], [self.JUMP_ITEM]))

    def test_a_sheet_published_again_since_the_pass_read_it_is_not_reconciled_and_still_needs_the_pass(self):
        # the pass read kite-water-start at T1 and found no word; the sheet was published again (T2) before its `put`:
        # what the pass says is about a text that is gone, and the pass that reads the new one reconciles
        b = Backend([stored()], sheets=republished("kite-water-start"), passes=[read("kite-jump")])
        out, err, code = self.put([], passed=[{"slug": "kite-water-start", "updated_at": T1}], backend=b)
        self.assertEqual((out, err, code), ("glossary kitesurf: 0 inserted, 0 updated, 0 unchanged\nglossary kitesurf: 1 sheet recorded as read\n", "", 0))
        self.assertEqual((b.words[0]["sheets"], b.words[0]["updated_at"]), ([self.WATER_ITEM], T0))
        self.assertEqual([s["slug"] for s in json.loads(self.run_cmd(["sheets", "kitesurf", "--pending"], b)[0])["sheets"]], ["kite-water-start"])
        out, err, code = self.put([], passed=[{"slug": "kite-water-start", "updated_at": T2}], backend=b)
        self.assertIn(self.REMOVED_1, out)
        self.assertEqual(b.words[0]["sheets"], [])

    def test_a_put_that_reconciles_and_one_that_adds_at_once_both_land(self):
        # the computer and the hosted worker: A read s1 again without the word; B, meanwhile, lists s2 under the same
        # entry and lands first: A's update names an updated_at that is gone, changes nothing, reads again and takes
        # s1 off what B stored. s2 is kept
        b = Backend([stored(sheets=[self.item("s1")])], sheets=self.S)
        def other():
            mine = self.put([entry(photo=None, forms=["border"], sheets=[self.item("s2")])], backend=b)
            self.assertEqual(mine, ("glossary kitesurf: 0 inserted, 1 updated, 0 unchanged\n", "", 0), "the other command")
        left = [other]
        b.before_write = lambda method, data: left.pop()() if left else None
        out, err, code = self.put([], passed=["s1"], backend=b)
        self.assertEqual((out, err, code), ("glossary kitesurf: 0 inserted, 0 updated, 0 unchanged" + self.REMOVED_1
                                            + "glossary kitesurf: 1 sheet recorded as read\n", "", 0))
        self.assertEqual(b.words[0]["sheets"], [self.item("s2")])
        self.assertEqual(self.word_patches(b), [[], ["s1", "s2"], ["s2"]])   # A overtaken, B, A again on what B wrote
        patches = [c for c in b.calls if (c[0], c[1]) == ("PATCH", "glossary_words")]
        self.assertEqual((patches[0][2]["updated_at"], patches[2][2]["updated_at"]), (f"eq.{T0}", "eq.2026-01-01T00:00:00.000001+00:00"))
        self.assertEqual(recorded(b), [("kitesurf", "s1", T1)])

    def test_a_put_that_adds_and_one_that_reconciles_at_once_both_land(self):
        # the other way round: A lists s2 under the entry; B, which read s1 again without the word, lands first
        b = Backend([stored(sheets=[self.item("s1")])], sheets=self.S)
        def other():
            mine = self.put([], passed=["s1"], backend=b)
            self.assertEqual((mine[1], mine[2]), ("", 0), "the other command")
            self.assertIn(self.REMOVED_1, mine[0])
        left = [other]
        b.before_write = lambda method, data: left.pop()() if left else None
        out, err, code = self.put([entry(photo=None, forms=["border"], sheets=[self.item("s2")])], backend=b)
        self.assertEqual((out, err, code), ("glossary kitesurf: 0 inserted, 1 updated, 0 unchanged\n", "", 0))
        self.assertEqual(b.words[0]["sheets"], [self.item("s2")])
        self.assertEqual(self.word_patches(b), [["s1", "s2"], [], ["s2"]])

    def test_an_entry_that_keeps_changing_stops_and_leaves_the_sheets_to_be_read_again(self):
        b = Backend([stored(sheets=[self.item("s1")]), stored(id="w2", term="choquer", forms=["border"], sheets=[self.item("s1"), self.item("s3")])],
                    sheets=self.S)
        def touch(method, data):   # someone writes the first entry just before each of this command's updates of it
            if method == "PATCH" and data == {"sheets": []}: b.words[0]["updated_at"] = b.tick()
        b.before_write = touch
        out, err, code = self.put([], passed=["s1"], backend=b)
        self.assertEqual((out, code), ("", 1))
        self.assertEqual(err, "rb: glossary kitesurf: 1 entry still lists a sheet read again: another command kept writing the same words (4 tries); "
                              "already written: 0 inserted, 0 updated, 1 association removed; no sheet recorded as read; run this again\n")
        self.assertEqual([i["slug"] for w in b.words for i in w["sheets"]], ["s1", "s3"])   # the second entry was reconciled once
        self.assertEqual([(c[0], c[1]) for c in b.writes()], [("PATCH", "glossary_words")] * (2 + rb.GLOSSARY_RETRIES))
        self.assertEqual(b.passes, [])

    # Codex pass 2 on #143: a sheet published again WHILE `put` runs. Its date is read again just before each try of
    # the reconciliation and just before the sheets are recorded; a sheet that moved is left to its next pass.
    MOVED_1 = ", 1 sheet published again meanwhile (not reconciled, not recorded as read)\n"
    B_ITEM = {"slug": "s1", "quote": "il faut border fort", "where": "text"}   # what pass B quotes from the new text of s1

    def before_call(self, b, nth, method, path, fn):
        """Run fn once, as another process would, just before this backend's nth `method path` call is answered."""
        inner, seen = b.rest, []
        def rest(cfg, m, p, *a, **kw):
            if (m, p) == (method, path):
                seen.append(1)
                if len(seen) == nth: fn()
            return inner(cfg, m, p, *a, **kw)
        b.rest = rest

    def pass_b(self, b, sheets):
        """s1 is published again (T2) and another pass, which read that text, lists it under « border » and records it."""
        self.assertEqual(sheets[0]["slug"], "s1")
        sheets[0]["updated_at"] = T2
        mine = self.put([entry(photo=None, forms=["border"], sheets=[self.B_ITEM])], passed=[{"slug": "s1", "updated_at": T2}], backend=b)
        self.assertEqual(mine, ("glossary kitesurf: 0 inserted, 1 updated, 0 unchanged\nglossary kitesurf: 1 sheet recorded as read\n", "", 0), "pass B")

    def pending(self, b):
        return [(s["slug"], s["updated_at"]) for s in json.loads(self.run_cmd(["sheets", "kitesurf", "--pending"], b)[0])["sheets"]]

    def test_what_another_pass_listed_for_a_sheet_published_again_after_the_dates_were_checked_is_kept(self):
        # Codex's interleaving: A read s1 at T1 and found no word. Once A's `put` has checked its dates and before it
        # reconciles, s1 is published again and pass B adds it to an entry A does not give. A must not take it off
        sheets = [dict(s) for s in self.S]
        b = Backend([stored(sheets=[self.item("s2")])], sheets=sheets, passes=[read("s2"), read("s3")])
        def other():
            self.assertEqual([c[:2] for c in b.calls].count(("GET", "sheets")), 1)   # A's reading of the dates it checks `passed` against
            self.assertEqual(b.writes(), [])
            self.pass_b(b, sheets)
        self.before_call(b, 2, "GET", "glossary_words", other)   # A's second reading of the glossary: its reconciliation
        out, err, code = self.put([], passed=[{"slug": "s1", "updated_at": T1}], backend=b)
        self.assertEqual((out, err, code), ("glossary kitesurf: 0 inserted, 0 updated, 0 unchanged" + self.MOVED_1, "", 0))
        self.assertEqual(b.words[0]["sheets"], [self.item("s2"), self.B_ITEM])
        self.assertEqual(self.word_patches(b), [["s2", "s1"]])   # B's update only: A wrote nothing
        self.assertEqual(recorded(b)[0], ("kitesurf", "s1", T2))   # B's row; A recorded nothing
        self.assertEqual(len([c for c in b.writes() if c[1] == "glossary_passes"]), 1)
        self.assertEqual(self.pending(b), [])   # the latest text was read, by B, and what B listed is there

    def test_a_sheet_published_again_between_two_tries_of_the_reconciliation_is_left_alone(self):
        # A read s1 at T1 without the word and goes to take it off « border ». Just before that update lands, s1 is
        # published again and pass B lists it anew: A's update matches no row, A reads again, and on that second try
        # the sheet's date is checked again: s1 is no longer A's to reconcile
        sheets = [dict(s) for s in self.S]
        b = Backend([stored(sheets=[self.item("s1")])], sheets=sheets, passes=[read("s2"), read("s3")])
        left = [lambda: self.pass_b(b, sheets)]
        b.before_write = lambda method, data: left.pop()() if left else None
        out, err, code = self.put([], passed=[{"slug": "s1", "updated_at": T1}], backend=b)
        self.assertEqual((out, err, code), ("glossary kitesurf: 0 inserted, 0 updated, 0 unchanged" + self.MOVED_1, "", 0))
        self.assertEqual(b.words[0]["sheets"], [self.B_ITEM])
        self.assertEqual(self.word_patches(b), [[], ["s1"]])   # A's first try, overtaken; B's; no second update by A
        self.assertEqual(recorded(b)[0], ("kitesurf", "s1", T2))
        self.assertEqual(self.pending(b), [])

    def test_a_sheet_published_again_after_the_reconciliation_is_not_recorded_and_waits_for_its_pass(self):
        # the republication alone, too late for the reconciliation (which went by the text A read): the check made
        # just before the sheets are recorded sees it, s1 gets no row and its next pass gives its words again
        sheets = [dict(s) for s in self.S]
        b = Backend([stored(sheets=[self.item("s1"), self.item("s2")])], sheets=sheets, passes=[read("s3")])
        self.before_call(b, 3, "GET", "sheets", lambda: sheets[0].update(updated_at=T2))   # 1 the checks, 2 the reconciliation, 3 before recording
        out, err, code = self.put([], passed=[{"slug": "s1", "updated_at": T1}, {"slug": "s2", "updated_at": T1}], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(out, "glossary kitesurf: 0 inserted, 0 updated, 0 unchanged, 2 associations removed (sheets read again)" + self.MOVED_1
                              + "glossary kitesurf: 1 sheet recorded as read\n")
        self.assertEqual(recorded(b), [("kitesurf", "s2", T1), ("kitesurf", "s3", T1)])
        self.assertEqual(self.pending(b), [("s1", T2)])
        out, err, code = self.put([entry(photo=None, forms=["border"], sheets=[self.B_ITEM])], passed=[{"slug": "s1", "updated_at": T2}], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertEqual((b.words[0]["sheets"], self.pending(b)), ([self.B_ITEM], []))

    def test_the_dates_are_read_alone_and_only_for_the_sheets_still_to_reconcile(self):
        b = Backend([stored(sheets=[self.item("s1")])], sheets=[dict(s) for s in self.S])
        self.put([], passed=["s1", "s3"], backend=b)
        named = [c[2] for c in b.calls if c[:2] == ("GET", "sheets") and "slug" in c[2]]
        self.assertEqual([(p["select"], p["slug"]) for p in named], [("slug,updated_at", 'in.("s1","s3")')] * 2)
        self.assertEqual([c[:2] for c in b.calls][-4:], [("GET", "sheets"), ("PATCH", "glossary_words"), ("GET", "sheets"), ("POST", "glossary_passes")])


class PutPassedAwayFromUTC(Case):
    """Codex pass 1 on P11 G2a: the date of a "passed" item names an instant by itself, whatever the zone of the machine
    that runs rb.py. Played in Europe/Paris (UTC+1 in February): a date read in the machine's zone shows here."""
    LATE = "2026-02-01T23:30:00+00:00"   # the sheet's date: the 1st in UTC, already the 2nd in Paris

    def setUp(self):
        super().setUp()
        saved = os.environ.get("TZ")
        def restore():
            if saved is None: os.environ.pop("TZ", None)
            else: os.environ["TZ"] = saved
            time.tzset()
        self.addCleanup(restore)
        os.environ["TZ"] = "Europe/Paris"
        time.tzset()
        # the zone is in force: a date without one is read an hour before the same in UTC
        self.assertEqual(datetime.datetime(2026, 2, 2).timestamp(), datetime.datetime(2026, 2, 1, 23, tzinfo=UTC).timestamp())

    def refused(self, bad, at=LATE):
        out, err, code = self.put([entry()], passed=[{"slug": "kite-jump", "updated_at": bad}], backend=Backend(sheets=republished("kite-jump", at=at)))
        self.assertEqual((out, code), ("", 1), bad)
        self.assertIn("rb: passed[0]: 'kite-jump': updated_at " + json.dumps(bad) + NOT_AN_INSTANT, err, bad)
        self.assertIn("1 problem(s), nothing written", err, bad)
        self.assertEqual(self.backend.writes(), [], bad)

    def test_a_date_without_a_time_is_refused_its_last_digits_are_not_an_offset(self):
        # the scenario of the review: read here as the 1st at 23:00Z (not later than the sheet's 23:30Z, so it went
        # through), recorded by a database in UTC as the 2nd at 00:00Z: the sheet published again at 23:45Z was then
        # never asked, and the row, which never moves back, could not be corrected
        self.assertLess(rb._ts("2026-02-02"), rb._ts(self.LATE))   # what the check compared, in this zone
        self.assertIsNone(rb._instant("2026-02-02"))
        self.refused("2026-02-02")

    def test_the_sheet_published_again_a_quarter_of_an_hour_later_is_asked_again(self):
        # the same story with the date the pass was given: the row says 23:30Z, the version of 23:45Z needs the pass
        sheets = republished("kite-jump", "kite-water-start", at=self.LATE)
        b = Backend(sheets=sheets)
        out, err, code = self.put([], passed=[{"slug": "kite-jump", "updated_at": self.LATE}, {"slug": "kite-water-start", "updated_at": self.LATE}], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(sheets[0]["slug"], "kite-jump")
        sheets[0]["updated_at"] = "2026-02-01T23:45:00+00:00"
        out, _, _ = self.run_cmd(["sheets", "kitesurf", "--pending"], b)
        self.assertEqual([(s["slug"], s["updated_at"]) for s in json.loads(out)["sheets"]], [("kite-jump", "2026-02-01T23:45:00+00:00")])

    def test_a_date_time_without_a_zone_or_cut_short_is_refused(self):
        for bad in ("2026-02-02T00:00:00",          # no zone: Postgres reads it in the database's, Python in this machine's
                    "2026-02-02 00:00:00", "2026-02-01T23:30:00.5",
                    "2026-02-01T23:30+00:00", "2026-02-01T23:30Z", "2026-02-01T23+00:00",   # a time cut short
                    "2026-02-01T23:30:00+00", "2026-02-01T23:30:00-02",                      # an offset cut short
                    "2026-02-01+00:00", "2026-02-01Z", "2026-02-01T23:30:00 Europe/Paris", "2026-02-01T23:30:00+00:00\n",
                    "2026-02-01T23:30:00+16:00", "2026-02-01T23:30:00+00:60", "2026-02-30T23:30:00+00:00", "2026-02-01T24:00:00+00:00"):
            self.assertIsNone(rb._instant(bad), bad)
            self.refused(bad)

    def test_the_same_instant_written_three_ways_is_accepted_and_is_the_first_of_february_in_utc(self):
        day = datetime.datetime(2026, 2, 1, 23, 30, tzinfo=UTC)
        for given, sheet_at, instant in (
                ("2026-02-01T23:30:00Z", self.LATE, day),
                ("2026-02-01T23:30:00+00:00", self.LATE, day),
                ("2026-02-02T00:30:00.123456+01:00", "2026-02-01T23:30:00.123456+00:00", day.replace(microsecond=123456))):
            self.assertEqual(rb._instant(given), instant, given)
            self.assertEqual(rb._instant(given).utcoffset(), datetime.timedelta(0), given)
            self.assertEqual(rb._instant(given).date(), datetime.date(2026, 2, 1), given)
            b = Backend(sheets=republished("kite-jump", at=sheet_at))
            out, err, code = self.put([], passed=[{"slug": "kite-jump", "updated_at": given}], backend=b)
            self.assertEqual((err, code), ("", 0), given)
            self.assertEqual(recorded(b), [("kitesurf", "kite-jump", given)], given)   # as given: the database reads the same instant
            out, _, _ = self.run_cmd(["sheets", "kitesurf", "--pending"], b)
            self.assertEqual([s["slug"] for s in json.loads(out)["sheets"]], ["kite-water-start"], given)   # read: not asked again

    def test_what_sheets_pending_prints_goes_back_into_put(self):
        # PostgREST's own writing: microseconds, trailing zeros dropped, +00:00
        for at in (T1, T2, "2026-02-01T23:30:00+00:00", "2026-02-01T23:59:59.999999+00:00", "2026-02-01T23:30:00.12+00:00"):
            b = Backend(sheets=republished("kite-jump", "kite-water-start", at=at))
            out, _, _ = self.run_cmd(["sheets", "kitesurf", "--pending"], b)
            passed = [{"slug": s["slug"], "updated_at": s["updated_at"]} for s in json.loads(out)["sheets"]]
            self.assertEqual(passed, [{"slug": "kite-jump", "updated_at": at}, {"slug": "kite-water-start", "updated_at": at}])
            out, err, code = self.put([], passed=passed, backend=b)
            self.assertEqual((err, code), ("", 0), at)
            self.assertEqual(recorded(b), [("kitesurf", "kite-jump", at), ("kitesurf", "kite-water-start", at)])
            out, _, _ = self.run_cmd(["sheets", "kitesurf", "--pending"], b)
            self.assertEqual(json.loads(out)["sheets"], [], at)

    def test_later_than_the_sheet_s_is_judged_on_instants_not_on_strings_nor_on_local_time(self):
        # 00:29+01:00 is 23:29Z, before the sheet's 23:30Z though its text sorts after: accepted
        b = Backend(sheets=republished("kite-jump", at=self.LATE))
        out, err, code = self.put([], passed=[{"slug": "kite-jump", "updated_at": "2026-02-02T00:29:00+01:00"}], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(recorded(b), [("kitesurf", "kite-jump", "2026-02-02T00:29:00+01:00")])
        # 22:31-01:00 is 23:31Z, after it though its text sorts before: refused, nothing written
        for late in ("2026-02-01T22:31:00-01:00", "2026-02-02T00:30:00.000001+01:00", "2026-02-01 23:30:01+0000"):
            out, err, code = self.put([entry()], passed=[{"slug": "kite-jump", "updated_at": late}], backend=Backend(sheets=republished("kite-jump", at=self.LATE)))
            self.assertEqual((out, code), ("", 1), late)
            self.assertIn(f"rb: passed[0]: 'kite-jump': updated_at {late} is later than the sheet's ({self.LATE})\n", err)
            self.assertEqual(self.backend.writes(), [], late)

    def test_the_check_gives_the_same_answer_in_every_zone(self):
        values = ("2026-02-02", "2026-02-02T00:00:00", "2026-02-01T23:30:00Z", "2026-02-02T00:30:00.123456+01:00", "2026-02-01 23:30:00-0330")
        seen = []
        for zone in ("Europe/Paris", "UTC", "America/Los_Angeles", "Pacific/Kiritimati"):
            os.environ["TZ"] = zone
            time.tzset()
            seen.append([rb._instant(v) for v in values])
        self.assertEqual(seen[0][:2], [None, None])
        self.assertEqual(seen[0][2:], [datetime.datetime(2026, 2, 1, 23, 30, tzinfo=UTC), datetime.datetime(2026, 2, 1, 23, 30, 0, 123456, tzinfo=UTC),
                                       datetime.datetime(2026, 2, 2, 3, 0, tzinfo=UTC)])
        self.assertTrue(all(s == seen[0] for s in seen), seen)


class SheetsPending(Case):
    """P11 G2a: `sheets <theme> --pending`: only the sheets that need the pass, and the glossary in short."""
    def pending(self, theme="kitesurf", **kw):
        out, err, code = self.run_cmd(["sheets", theme, "--pending"], Backend(**kw))
        self.assertEqual((err, code), ("", 0))
        return json.loads(out)

    def html_reads(self):
        return [c[2].get("slug") for c in self.backend.calls if c[1] == "sheets" and "html" in c[2]["select"]]

    def test_no_sheet_read_yet_every_sheet_and_the_glossary_in_short(self):
        two = [{"slug": "kite-jump", "quote": "x", "where": "text"}, {"slug": "kite-water-start", "quote": "y", "where": "text"}]
        doc = self.pending(words=[stored(), stored(id="w2", term="aile", sense="le kite", forms=["aile"], definition="La voile du kite.", sheets=two)])
        self.assertEqual(list(doc), ["notebook", "sheets", "glossary"])
        self.assertEqual(doc["notebook"], {"id": "kitesurf", "title": "Kitesurf", "family": "technique",
                                           "description": "Kite control, water start, riding, jumps, transitions."})
        self.assertEqual([list(s) for s in doc["sheets"]], [["slug", "title", "html", "photos", "updated_at"]] * 2)   # as without --pending, and the date
        self.assertEqual([(s["slug"], s["title"], s["photos"]) for s in doc["sheets"]],
                         [("kite-jump", "Le saut droit", ["thumb.jpg", "01-crantage.jpg"]),
                          ("kite-water-start", "Le départ plage", ["thumb.jpg", "01-bord.jpg"])])
        self.assertEqual(doc["sheets"][1]["html"], WATER)
        # the short form the prompt reads, in the order of `glossary get` (by number of sheets, then alphabetically)
        self.assertEqual(doc["glossary"], [{"term": "aile", "sense": "le kite", "forms": ["aile"], "definition": "La voile du kite."},
                                           {"term": "border", "sense": None, "forms": ["border"], "definition": "The first definition."}])
        self.assertEqual(self.backend.writes(), [])

    def test_each_pending_sheet_carries_its_updated_at_and_plain_sheets_does_not(self):
        doc = self.pending(sheets=republished("kite-jump"))
        self.assertEqual([(s["slug"], s["updated_at"]) for s in doc["sheets"]], [("kite-jump", T2), ("kite-water-start", T1)])
        out, err, code = self.run_cmd(["sheets", "kitesurf"], Backend(sheets=republished("kite-jump")))
        self.assertEqual((err, code), ("", 0))
        self.assertEqual([list(s) for s in json.loads(out)["sheets"]], [["slug", "title", "html", "photos"]] * 2)

    def test_the_sheets_the_pass_read_are_left_out_and_their_html_is_not_read(self):
        doc = self.pending(passes=[read("kite-jump")])
        self.assertEqual([(s["slug"], s["html"]) for s in doc["sheets"]], [("kite-water-start", WATER)])
        self.assertEqual(self.html_reads(), ['in.("kite-water-start")'])
        self.assertEqual(doc["glossary"], [])

    def test_a_sheet_published_again_since_needs_the_pass_again(self):
        doc = self.pending(sheets=republished("kite-jump"), passes=[read("kite-jump"), read("kite-water-start")])
        self.assertEqual([s["slug"] for s in doc["sheets"]], ["kite-jump"])

    def test_the_dates_are_compared_as_dates_not_as_text(self):
        for same in ("2026-02-01T08:30:00.500000+00:00", "2026-02-01T08:30:00.5Z", "2026-02-01T09:30:00.5+01:00"):
            self.assertFalse(rb._needs_pass(T1, same), same)
        self.assertTrue(rb._needs_pass("2026-02-01T08:30:00.500001+00:00", T1))   # later by a microsecond
        self.assertTrue(rb._needs_pass("2026-02-01T08:30:01+00:00", T1))
        self.assertFalse(rb._needs_pass(T1, T2))                                  # a row later than the sheet: read
        self.assertTrue(rb._needs_pass(T1, None))                                 # no row
        for unreadable in ("soon", ""):
            self.assertTrue(rb._needs_pass(T1, unreadable), unreadable)           # read once more rather than never
            self.assertTrue(rb._needs_pass(unreadable, T1), unreadable)
        self.assertTrue(rb._needs_pass(None, T1))

    def test_nothing_left_prints_no_sheet_and_still_the_glossary(self):
        doc = self.pending(words=[stored()], passes=[read("kite-jump"), read("kite-water-start")])
        self.assertEqual((doc["sheets"], len(doc["glossary"])), ([], 1))
        self.assertEqual(self.html_reads(), [])

    def test_a_row_of_another_notebook_does_not_count(self):
        # a sheet moved to another notebook has no word there until the pass runs on the arrival notebook
        doc = self.pending("strength", passes=[read("push-up", theme="kitesurf")])
        self.assertEqual([s["slug"] for s in doc["sheets"]], ["push-up"])

    def test_a_row_whose_sheet_no_longer_exists_is_ignored(self):
        doc = self.pending(passes=[read("deleted-sheet"), read("kite-jump")])
        self.assertEqual([s["slug"] for s in doc["sheets"]], ["kite-water-start"])

    def test_a_backend_that_does_not_record_the_passes_takes_every_sheet(self):
        doc = self.pending(passes_table=False)   # no error, exit 0 (checked by the helper)
        self.assertEqual([s["slug"] for s in doc["sheets"]], ["kite-jump", "kite-water-start"])

    def test_a_backend_without_the_glossary_table_says_so_in_one_line_and_exits_1(self):
        out, err, code = self.run_cmd(["sheets", "kitesurf", "--pending"], Backend(table=False))
        self.assertEqual((out, code), ("", 1))
        self.assertEqual(err, f"rb: {rb.NO_GLOSSARY}\n")
        self.assertEqual({c[1] for c in self.backend.calls}, {"glossary_words"})

    def test_a_notebook_that_is_not_the_account_s_is_refused(self):
        out, err, code = self.run_cmd(["sheets", "yoga", "--pending"])
        self.assertEqual((out, code), ("", 1))
        self.assertIn("'yoga' is not one of this account's notebooks", err)

    def test_the_flag_may_come_before_the_notebook(self):
        out, err, code = self.run_cmd(["sheets", "--pending", "kitesurf"], Backend(passes=[read("kite-jump")]))
        self.assertEqual((err, code), ("", 0))
        self.assertEqual([s["slug"] for s in json.loads(out)["sheets"]], ["kite-water-start"])

    def test_many_pending_sheets_are_read_fifty_at_a_time(self):
        sheets = [{"slug": f"s{i:03}", "kind": "sheet", "theme": "kitesurf", "title": f"S {i}", "html": "<p>x</p>", "updated_at": T1} for i in range(120)]
        doc = self.pending(sheets=sheets, passes=[read(f"s{i:03}") for i in range(10)])
        self.assertEqual([s["slug"] for s in doc["sheets"]], [f"s{i:03}" for i in range(10, 120)])
        self.assertEqual([len(json.loads("[" + p[4:-1] + "]")) for p in self.html_reads()], [50, 50, 10])

    def test_a_slug_with_a_comma_or_a_quote_is_still_one_slug(self):
        odd = ["a,b", 'c"d(e)', "back\\slash"]
        sheets = [{"slug": s, "kind": "sheet", "theme": "kitesurf", "title": s, "html": "<p>x</p>", "updated_at": T1} for s in odd]
        self.assertEqual([s["slug"] for s in self.pending(sheets=sheets)["sheets"]], sorted(odd))

    def test_the_list_of_slugs_reaches_the_server_quoted_and_encoded(self):
        import urllib.parse
        urls, saved = [], rb.http
        rb.http = lambda method, url, headers=None, data=None, raw=False, tolerate=(): urls.append(url) or []
        try:
            rb._glossary_sheets_named(CFG, "kitesurf", ["kite-jump", "a,b &c"])   # rb.rest is the real one here
        finally:
            rb.http = saved
        self.assertEqual(len(urls), 1)
        self.assertNotIn(" ", urls[0])
        self.assertNotIn('"', urls[0])
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(urls[0]).query)
        self.assertEqual(query["slug"], ['in.("a,b &c","kite-jump")'])
        self.assertEqual((query["theme"], query["kind"]), (["eq.kitesurf"], ["eq.sheet"]))


class PendingNotebooks(Case):
    """P11 G2a: `pending`: which notebooks of the technique family have sheets to read (what the nightly run asks first)."""
    def lines(self, **kw):
        out, err, code = self.run_cmd(["pending"], Backend(**kw))
        self.assertEqual((err, code), ("", 0))
        return out

    def test_one_line_per_technique_notebook_that_has_sheets_to_read(self):
        # kitesurf: technique by the library; strength: by the account's choice; custom-parkour: repetition.
        # The v1 session page of kitesurf is not a sheet
        self.assertEqual(self.lines(), "kitesurf 2\nstrength 1\n")
        self.assertEqual(self.backend.writes(), [])
        self.assertFalse(any("html" in c[2].get("select", "") for c in self.backend.calls))   # counted without the pages

    def test_a_notebook_whose_sheets_were_all_read_has_no_line(self):
        self.assertEqual(self.lines(passes=[read("kite-jump"), read("kite-water-start")]), "strength 1\n")
        self.assertEqual(self.lines(passes=[read("kite-jump"), read("kite-water-start"), read("push-up", theme="strength")]), "")

    def test_a_sheet_published_again_counts(self):
        every = [read("kite-jump"), read("kite-water-start"), read("push-up", theme="strength")]
        self.assertEqual(self.lines(passes=every, sheets=republished("kite-jump")), "kitesurf 1\n")

    def test_a_sheet_without_any_word_that_got_its_row_does_not_count(self):
        b = Backend()
        self.put([], passed=["kite-jump"], backend=b)
        self.assertEqual(self.run_cmd(["pending"], b)[0], "kitesurf 1\nstrength 1\n")

    def test_the_family_is_the_account_s_choice_else_the_library_s_else_repetition_as_the_app(self):
        themes = [
            {"id": "kitesurf", "family": "repetition", "builtin": True},           # the account's choice (the library says technique)
            {"id": "strength", "family": "technique", "builtin": True},            # the account's choice (the library says repetition)
            {"id": "wingfoil", "family": None, "builtin": True},                   # the library: technique
            {"id": "yoga", "family": None, "builtin": True},                       # the library: repetition
            {"id": "custom-parkour", "family": None, "builtin": False},            # a custom notebook: repetition
            {"id": "custom-slackline", "family": "technique", "builtin": False},   # a custom notebook, chosen
            {"id": "surf", "family": None, "builtin": False},                      # not built-in: the library is not asked (the app's familyOf)
        ]
        sheets = [{"slug": f"sheet-{t['id']}", "kind": "sheet", "theme": t["id"], "title": "T", "html": "<p>x</p>", "updated_at": T1} for t in themes]
        self.assertEqual(self.lines(themes=themes, sheets=sheets), "strength 1\nwingfoil 1\ncustom-slackline 1\n")
        asked = [c[2] for c in self.backend.calls if c[1] == "user_themes"]
        self.assertEqual(asked, [{"select": "id,builtin,family", "order": "position.asc,title.asc"}])   # the order of `rb.py themes`
        self.assertEqual((rb.library_families()["kitesurf"], rb.library_families()["wingfoil"], rb.library_families()["surf"]),
                         ("technique", "technique", "technique"))

    def test_a_backend_without_the_family_column_takes_the_library_s_default(self):
        self.assertEqual(self.lines(family_column=False), "kitesurf 2\n")

    def test_a_backend_that_does_not_record_the_passes_counts_every_sheet_and_asks_once(self):
        self.assertEqual(self.lines(passes_table=False), "kitesurf 2\nstrength 1\n")
        self.assertEqual(len([c for c in self.backend.calls if c[1] == "glossary_passes"]), 1)

    def test_a_backend_without_the_glossary_table_says_so_in_one_line_and_exits_1(self):
        out, err, code = self.run_cmd(["pending"], Backend(table=False))
        self.assertEqual((out, code), ("", 1))
        self.assertEqual(err, f"rb: {rb.NO_GLOSSARY}\n")
        self.assertEqual({c[1] for c in self.backend.calls}, {"glossary_words"})

    def test_an_account_without_technique_notebook_prints_nothing(self):
        self.assertEqual(self.lines(themes=[THEMES[2]]), "")
        self.assertEqual({c[1] for c in self.backend.calls}, {"glossary_words", "user_themes"})

    def test_a_long_notebook_is_counted_page_by_page(self):
        n = rb.LIST_PAGE + 2   # 1002 sheets, 1001 of them read: two pages of each table
        sheets = [{"slug": f"s{i:05}", "kind": "sheet", "theme": "kitesurf", "title": "T", "updated_at": T1} for i in range(n)]
        out = self.lines(themes=[THEMES[0]], sheets=sheets, passes=[read(f"s{i:05}") for i in range(n) if i != 3])
        self.assertEqual(out, "kitesurf 1\n")
        self.assertEqual([c[2].get("slug") for c in self.backend.calls if c[1] == "sheets"], [None, f"gt.s{rb.LIST_PAGE - 1:05}"])
        self.assertEqual([c[2].get("slug") for c in self.backend.calls if c[1] == "glossary_passes"], [None, f"gt.s{rb.LIST_PAGE:05}"])

    def test_from_pending_to_nothing_left_and_back_when_a_sheet_is_published_again(self):
        sheets = republished()
        b = Backend(sheets=sheets)
        self.assertEqual(self.run_cmd(["pending"], b)[0], "kitesurf 2\nstrength 1\n")
        doc = json.loads(self.run_cmd(["sheets", "kitesurf", "--pending"], b)[0])
        out, err, code = self.put([entry()], passed=[s["slug"] for s in doc["sheets"]], backend=b)
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(self.run_cmd(["pending"], b)[0], "strength 1\n")
        sheets[1]["updated_at"] = T2   # the water start is published again
        self.assertEqual(self.run_cmd(["pending"], b)[0], "kitesurf 1\nstrength 1\n")
        doc = json.loads(self.run_cmd(["sheets", "kitesurf", "--pending"], b)[0])
        self.assertEqual(([s["slug"] for s in doc["sheets"]], [e["term"] for e in doc["glossary"]]), (["kite-water-start"], ["border"]))


class Command(Case):
    def test_usage(self):
        for args in ([], ["get"], ["get", "a", "b"], ["sheets"], ["put", "kitesurf"], ["put", "kitesurf", "a.json", "b.json"],
                     ["drop", "kitesurf"], ["get", "kitesurf", "--replace"], ["get", ""],
                     ["sheets", "--pending"], ["get", "kitesurf", "--pending"], ["put", "kitesurf", "a.json", "--pending"],
                     ["pending", "kitesurf"], ["pending", "--pending"], ["sheets", "kitesurf", "strength", "--pending"]):
            out, err, code = self.run_cmd(args)
            self.assertEqual((out, code), ("", 1), args)
            self.assertIn("usage: rb.py glossary get <theme>", err)
            self.assertEqual(self.backend.calls, [], args)

    def test_the_docstring_lists_the_verbs(self):
        for line in ("rb.py glossary get <theme>", "rb.py glossary sheets <theme> [--pending]", "rb.py glossary put <theme> <file.json> [--replace]",
                     "rb.py glossary pending"):
            self.assertIn(line, rb.__doc__)
            self.assertIn(line, rb.GLOSSARY_USAGE)

    def test_the_functions_other_programs_import_keep_their_signature(self):
        # another program of the repo imports rb.py as a module and calls these: the glossary only adds functions
        real = {"session": self._saved[0], "rest": self._saved[1]}   # the ones of rb.py, whatever a test put in their place
        for name, sig in (("session", "()"), ("hdr", "(cfg, extra=None)"),
                          ("http", "(method, url, headers=None, data=None, raw=False, tolerate=())"),
                          ("rest", "(cfg, method, path, data=None, prefer=None, params=None, tolerate=())"),
                          ("library_notebooks", "(path=None)"), ("library_profiles", "(path=None)"), ("search_text", "(html)")):
            self.assertEqual(str(inspect.signature(real.get(name) or getattr(rb, name))), sig, name)


if __name__ == "__main__":
    unittest.main()
