"""Queue commands of tools/rb.py: claim stamps the claim time, requeue-stuck frees dead runs' requests.

No network: rb.session / rb.rest are replaced by an in-memory fake. Run: python3 -I tests/rb-queue.test.py
"""
import contextlib, importlib.util, io, pathlib, time, unittest

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


if __name__ == "__main__":
    unittest.main()
