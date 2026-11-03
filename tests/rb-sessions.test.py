"""Sessions v2 in tools/rb.py: publish of a session folder and requeue-sessions.

No network: `session`, `rest` and `http` are replaced by fakes that record every call.
Run: python3 -I -m unittest discover -s tests -p 'rb-*.test.py'
"""
import contextlib, importlib.util, io, json, pathlib, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb", ROOT / "tools" / "rb.py")
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)

CFG = {"url": "https://example.test", "anon_key": "k", "access_token": "t", "user_id": "u1"}
URL = "https://www.instagram.com/reel/abc/"


class FakeBackend:
    """Answers the few PostgREST / storage calls rb.py makes, from in-memory tables."""

    def __init__(self, sheets=(), requests=(), themes=("strength",), has_sessions=True):
        self.sheets, self.requests, self.themes = list(sheets), list(requests), list(themes)
        self.has_sessions, self.calls = has_sessions, []

    def rest(self, cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
        params = params or {}
        self.calls.append(("rest", method, path, data, params))
        if path == "user_themes":
            return [{"id": t} for t in self.themes]
        if path == "sessions" and not self.has_sessions:
            if 404 in tolerate:
                raise rb.RbHTTPError(404, "relation does not exist")
            raise SystemExit("404")
        if method == "GET" and path == "sheets":
            rows = self.sheets
            if params.get("kind") == "eq.session":
                rows = [r for r in rows if r["kind"] == "session"]
            return [dict(r) for r in rows]
        if method == "GET" and path == "requests":
            assert params.get("status") == "in.(queued,processing)"
            return [r for r in self.requests if r["status"] in ("queued", "processing")]
        if method == "GET" and path == "sessions":
            return []
        if method == "POST":
            return [{"id": f"id-{data['slug']}"}] if isinstance(data, dict) else None
        return None

    def http(self, method, url, headers=None, data=None, raw=False, tolerate=()):
        self.calls.append(("http", method, url.split("/storage/v1/")[-1], None if raw else data, {}))
        if "object/list/sheets" in url:
            return [{"name": "thumb.jpg"}, {"name": "1-a.jpg"}]
        return None

    def rest_calls(self, method, path):
        return [c for c in self.calls if c[0] == "rest" and c[1] == method and c[2] == path]


def write(p, obj=None, text=None):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj) if obj is not None else text)


def session_folder(root, items=("s-a", "s-b"), extra=()):
    d = root / "session-x"
    write(d / "meta.json", {"slug": "session-x", "kind": "session", "theme": "strength", "title": "X",
                            "format": "3 rounds", "why": "because", "key_points": ["one", "two"],
                            "source": {"author": "A", "url": URL, "platform": "instagram"},
                            "items": [{"slug": s, "dose": "30 s"} for s in items]})
    for s in list(dict.fromkeys(items)) + list(extra):
        write(d / s / "meta.json", {"slug": s, "kind": "sheet", "theme": "strength", "group": "Legs",
                                    "title": s.upper(), "source": {"url": URL}})
        write(d / s / "index.html", text=f"<p>{s}</p>")
        write(d / s / "img" / "thumb.jpg", text="jpg")
    return d


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self._saved = (rb.session, rb.rest, rb.http)

    def tearDown(self):
        rb.session, rb.rest, rb.http = self._saved
        self.tmp.cleanup()

    def use(self, fake):
        rb.session, rb.rest, rb.http = (lambda: CFG), fake.rest, fake.http
        self.fake = fake
        return fake

    def run_cmd(self, fn, args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            fn(args)
        return out.getvalue(), err.getvalue()


class PublishSessionV2(Base):
    def test_sheets_first_then_session_then_v1_deleted(self):
        fake = self.use(FakeBackend(sheets=[
            {"slug": "session-old", "kind": "session", "source": {"url": URL.rstrip("/")}},
            {"slug": "session-other", "kind": "session", "source": {"url": "https://other"}},
            {"slug": "plain", "kind": "sheet", "source": {"url": URL}},
        ]))
        d = session_folder(self.root, items=("s-b", "s-a", "s-b"))
        out, _ = self.run_cmd(rb.cmd_publish, [str(d)])

        writes = [(c[2], c[3]["slug"]) for c in fake.calls if c[0] == "rest" and c[1] == "POST"]
        self.assertEqual(writes, [("sheets", "s-b"), ("sheets", "s-a"), ("sessions", "session-x")])
        sheet_rows = [c[3] for c in fake.rest_calls("POST", "sheets")]
        self.assertTrue(all(r["kind"] == "sheet" for r in sheet_rows))
        self.assertFalse(any("exercises" in r for r in sheet_rows), "the v1 column is left to its default")
        row = fake.rest_calls("POST", "sessions")[0][3]
        self.assertEqual(row["origin"], "video")
        self.assertEqual(row["items"], [{"slug": "s-b", "dose": "30 s"}, {"slug": "s-a", "dose": "30 s"}, {"slug": "s-b", "dose": "30 s"}])
        self.assertEqual((row["format"], row["why"], row["key_points"], row["thumbnail"]), ("3 rounds", "because", ["one", "two"], ""))
        self.assertEqual(fake.rest_calls("POST", "sessions")[0][4], {"on_conflict": "user_id,slug"})

        # the v1 session with the same URL (trailing slash aside) goes, with its images; the others stay
        deletes = fake.rest_calls("DELETE", "sheets")
        self.assertEqual([c[4] for c in deletes], [{"slug": "eq.session-old", "kind": "eq.session"}])
        self.assertEqual(fake.rest_calls("DELETE", "notes"), [])
        storage_del = [c for c in fake.calls if c[0] == "http" and c[1] == "DELETE"]
        self.assertEqual(storage_del[0][3], {"prefixes": ["u1/session-old/img/thumb.jpg", "u1/session-old/img/1-a.jpg"]})
        # and only after the session upsert
        order = [(c[1], c[2]) for c in fake.calls if c[0] == "rest" and c[1] in ("POST", "DELETE")]
        self.assertLess(order.index(("POST", "sessions")), order.index(("DELETE", "sheets")))
        # images uploaded under each sheet's own folder
        uploads = [c[2] for c in fake.calls if c[0] == "http" and c[1] == "POST" and "object/sheets/" in c[2]]
        self.assertEqual(uploads, ["object/sheets/u1/s-b/img/thumb.jpg", "object/sheets/u1/s-a/img/thumb.jpg"])
        self.assertIn("deleted v1 session session-old", out)

    def test_thumbnail_points_into_an_item_folder(self):
        fake = self.use(FakeBackend())
        d = session_folder(self.root)
        meta = json.loads((d / "meta.json").read_text()); meta["thumbnail"] = "s-a/img/thumb.jpg"
        write(d / "meta.json", meta)
        self.run_cmd(rb.cmd_publish, [str(d)])
        self.assertEqual(fake.rest_calls("POST", "sessions")[0][3]["thumbnail"], "u1/s-a/img/thumb.jpg")

    def assertRefused(self, d, fragment, fake=None):
        fake = self.use(fake or FakeBackend())
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err), self.assertRaises(SystemExit):
            rb.cmd_publish([str(d)])
        self.assertIn(fragment, err.getvalue())
        self.assertEqual([c for c in fake.calls if c[1] in ("POST", "DELETE")], [], "nothing written")
        return fake

    def test_item_without_sub_folder_is_refused_before_any_write(self):
        d = session_folder(self.root)
        meta = json.loads((d / "meta.json").read_text()); meta["items"].append({"slug": "s-missing", "dose": ""})
        write(d / "meta.json", meta)
        self.assertRefused(d, "s-missing")

    def test_structured_dose_fields_pass_through_and_null_is_absent(self):
        fake = self.use(FakeBackend())
        d = session_folder(self.root)
        meta = json.loads((d / "meta.json").read_text())
        meta["items"][0].update({"sets": 3, "reps": 10, "seconds": 0, "rest_s": 60, "per_side": False, "note": "dropped"})
        meta["items"][1].update({"sets": None, "per_side": True})
        write(d / "meta.json", meta)
        self.run_cmd(rb.cmd_publish, [str(d)])
        self.assertEqual(fake.rest_calls("POST", "sessions")[0][3]["items"], [
            {"slug": "s-a", "dose": "30 s", "sets": 3, "reps": 10, "seconds": 0, "rest_s": 60, "per_side": False},
            {"slug": "s-b", "dose": "30 s", "per_side": True}])

    def test_bad_structured_dose_field_is_refused_before_any_write(self):
        for k, v in (("sets", "3"), ("reps", -1), ("seconds", 1.5), ("rest_s", True), ("per_side", 1)):
            d = session_folder(self.root / k)
            meta = json.loads((d / "meta.json").read_text()); meta["items"][0][k] = v
            write(d / "meta.json", meta)
            self.assertRefused(d, k + " must be")

    def test_sub_folder_not_in_items_is_refused(self):
        self.assertRefused(session_folder(self.root, extra=("s-stray",)), "s-stray")

    def test_missing_sessions_table_is_refused_before_any_write(self):
        self.assertRefused(session_folder(self.root), "schema.sql", FakeBackend(has_sessions=False))

    def test_unknown_theme_is_refused_before_any_write(self):
        self.assertRefused(session_folder(self.root), "theme", FakeBackend(themes=("yoga",)))

    def test_v1_session_folder_is_refused(self):
        d = self.root / "session-v1"
        write(d / "meta.json", {"slug": "session-v1", "kind": "session", "theme": "strength", "group": "Sessions",
                                "title": "V1", "exercises": [{"anchor": "a", "title": "A"}]})
        write(d / "index.html", text="<p>v1</p>")
        self.use(FakeBackend())
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit):
            rb.cmd_publish([str(d)])
        self.assertIn("old session format", err.getvalue())
        self.assertEqual(self.fake.calls, [])

    def test_plain_sheet_still_publishes(self):
        fake = self.use(FakeBackend())
        d = self.root / "floor-angel"
        write(d / "meta.json", {"slug": "floor-angel", "kind": "sheet", "theme": "strength", "group": "Shoulders", "title": "Floor angel"})
        write(d / "index.html", text="<p>x</p>")
        self.run_cmd(rb.cmd_publish, [str(d)])
        self.assertEqual([c[3]["slug"] for c in fake.rest_calls("POST", "sheets")], ["floor-angel"])
        self.assertEqual(fake.rest_calls("POST", "sessions"), [])

    def sheet(self, name, **meta):
        d = self.root / name
        write(d / "meta.json", dict({"slug": name, "kind": "sheet", "theme": "strength", "group": "Arms", "title": "T"}, **meta))
        write(d / "index.html", text="<p>x</p>")
        return d

    def test_duration_is_a_practice_time_and_steps_a_whole_number(self):
        # L15: « 5 min » or "" passes, with an optional step count; the video length or a step count in duration is refused
        for i, (dur, steps) in enumerate((("5 min", None), ("", 5), ("10–15 min", 3), ("30 s", None))):
            fake = self.use(FakeBackend())
            self.run_cmd(rb.cmd_publish, [str(self.sheet(f"ok-{i}", duration=dur, **({} if steps is None else {"steps": steps})))])
            row = fake.rest_calls("POST", "sheets")[0][3]
            self.assertEqual(row["duration"], dur)
            self.assertNotIn("steps", row, "no column for it yet")
        for i, dur in enumerate(("0:45", "1:02:30", " 12 : 05 ", "5 étapes", "5 steps", "3 exercises", "4 exercices", 5)):
            self.assertRefused(self.sheet(f"bad-dur-{i}", duration=dur), "practice time")
        for i, steps in enumerate((0, "5", 2.5, True)):
            self.assertRefused(self.sheet(f"bad-steps-{i}", steps=steps), "steps must be")

    def test_a_session_exercise_with_a_step_count_as_duration_is_refused(self):
        d = session_folder(self.root)
        meta = json.loads((d / "s-a" / "meta.json").read_text()); meta["duration"] = "4 étapes"
        write(d / "s-a" / "meta.json", meta)
        self.assertRefused(d, "practice time")


class RequeueSessions(Base):
    V1 = [
        {"slug": "session-a", "kind": "session", "theme": "strength", "title": "A", "source": {"url": "https://a/"}},
        {"slug": "session-b", "kind": "session", "theme": "yoga", "title": "B", "source": {"url": "https://b"}},
        {"slug": "session-b2", "kind": "session", "theme": "yoga", "title": "B again", "source": {"url": "https://b/"}},
        {"slug": "session-c", "kind": "session", "theme": "fight", "title": "C", "source": {"url": "https://c"}},
        {"slug": "session-nourl", "kind": "session", "theme": "fight", "title": "D", "source": {}},
        {"slug": "plain", "kind": "sheet", "theme": "fight", "title": "E", "source": {"url": "https://e"}},
    ]
    REQ = [{"url": "https://a", "status": "queued"}, {"url": "https://c", "status": "done"}]

    def test_dry_run_writes_nothing(self):
        fake = self.use(FakeBackend(sheets=self.V1, requests=self.REQ))
        out, err = self.run_cmd(rb.cmd_requeue_sessions, ["--dry-run"])
        self.assertEqual(fake.rest_calls("POST", "requests"), [])
        self.assertIn("would queue session-b: https://b", out)
        self.assertIn("would queue session-c: https://c", out)
        self.assertIn("2 request(s) to insert (dry run", out)
        self.assertIn("session-a: https://a/ is already queued", err)

    def test_one_request_per_url_skipping_queued_ones(self):
        fake = self.use(FakeBackend(sheets=self.V1, requests=self.REQ))
        _, err = self.run_cmd(rb.cmd_requeue_sessions, [])
        posts = fake.rest_calls("POST", "requests")
        self.assertEqual(len(posts), 1, "one insert call")
        # a: already queued; b2: same video as b; c: done long ago, so queued again; no url: reported
        self.assertEqual(posts[0][3], [{"url": "https://b", "theme": "yoga"}, {"url": "https://c", "theme": "fight"}])
        self.assertIn("session-b2: same video", err)
        self.assertIn("session-nourl: no source url", err)

    def test_nothing_to_do(self):
        fake = self.use(FakeBackend(sheets=[], requests=[]))
        out, _ = self.run_cmd(rb.cmd_requeue_sessions, [])
        self.assertEqual(fake.rest_calls("POST", "requests"), [])
        self.assertIn("0 v1 session(s), 0 request(s) inserted", out)

    def test_unknown_argument(self):
        self.use(FakeBackend())
        with self.assertRaises(SystemExit):
            self.run_cmd(rb.cmd_requeue_sessions, ["--yes"])


class ListIncludesSessions(Base):
    def test_lists_v2_sessions_and_tolerates_missing_table(self):
        fake = self.use(FakeBackend())
        fake.rest = (lambda orig: lambda cfg, m, path, *a, **k: (
            [{"slug": "session-x", "theme": "strength", "title": "X", "items": [{"slug": "a"}, {"slug": "b"}]}]
            if path == "sessions" else orig(cfg, m, path, *a, **k)))(fake.rest)
        rb.rest = fake.rest
        out, _ = self.run_cmd(rb.cmd_list, [])
        self.assertRegex(out, r"strength\s+2 item\(s\)\s+session2\s+session-x\s+X")
        self.use(FakeBackend(has_sessions=False))
        out, err = self.run_cmd(rb.cmd_list, [])
        self.assertIn("re-run supabase/schema.sql", err)


if __name__ == "__main__":
    unittest.main()
