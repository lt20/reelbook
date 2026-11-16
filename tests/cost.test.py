"""tools/cost.py: reelbook sessions found in Claude Code transcripts, cut into videos at rb.py done / error,
streamed lines of one call counted once, priced at the API rates.

Run: python3 -I tests/cost.test.py
"""
import contextlib, importlib.util, io, json, pathlib, sys, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("cost", ROOT / "tools" / "cost.py")
cost = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cost)


def line(sid, t, mid, usage=None, bash=None, model="claude-opus-5-5"):
    content = [{"type": "tool_use", "name": "Bash", "input": {"command": bash}}] if bash else [{"type": "text", "text": "…"}]
    msg = {"id": mid, "model": model, "content": content}
    if usage:
        msg["usage"] = usage
    return json.dumps({"type": "assistant", "sessionId": sid, "requestId": "r" + mid,
                       "timestamp": f"2026-11-10T10:{t:02d}:00Z", "message": msg})


U = {"input_tokens": 10, "cache_creation_input_tokens": 1000, "cache_read_input_tokens": 100_000, "output_tokens": 500}


class CostTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = pathlib.Path(self.tmp.name) / "proj"
        d.mkdir()
        (d / "a.jsonl").write_text("\n".join([
            line("s1", 0, "m0", U, bash="python3 tools/rb.py queue"),
            line("s1", 1, "m1", U),
            line("s1", 1, "m1", U, bash="python3 tools/rb.py publish work/plank --request 7"),  # same call, 2nd block
            line("s1", 2, "m2", U, bash="python3 tools/rb.py done 7 --slug plank"),
            line("s1", 3, "m3", U),
            line("s1", 4, "m4", U, bash="python3 tools/rb.py error 8 --reason private --note x"),
            line("s1", 5, "m5", U),
            "not json",
        ]))
        (d / "other.jsonl").write_text(line("s2", 0, "x", U, bash="ls"))  # not a reelbook session

    def tearDown(self):
        self.tmp.cleanup()

    def test_split(self):
        sessions = cost.load_sessions(self.tmp.name, None)
        self.assertEqual(list(sessions), ["s1"])
        rows = cost.split("s1", sessions["s1"])
        self.assertEqual([(r["kind"], r["outcome"], r["slug"], r["calls"], r["publish"]) for r in rows], [
            ("video", "done", "plank", 3, 1),
            ("video", "error:private", "", 2, 0),
            ("overhead", "", "", 1, 0),
        ])

    def test_price(self):
        # 10×4 + 1000×4×1.25 + 100000×0.20 + 500×20 = 40 + 5000 + 20000 + 10000 → $0.03504
        self.assertAlmostEqual(cost.cost(U, "claude-opus-5-5"), 0.03504)
        one_hour = dict(U, cache_creation={"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 1000})
        self.assertAlmostEqual(cost.cost(one_hour, "claude-opus-5-5"), 0.03504 + 0.003)
        self.assertEqual(cost.price_of("claude-sonnet-5-5[1m]"), cost.PRICES["claude-sonnet-5-5"])
        self.assertEqual(cost.price_of("claude-opus-4-8"), cost.PRICES["claude-opus-4"])

    def test_report(self):
        out = io.StringIO()
        sys.argv = ["cost.py", "--dir", self.tmp.name]
        with contextlib.redirect_stdout(out):
            cost.main()
        text = out.getvalue()
        self.assertIn("videos: 2 (1 done, 1 failed)", text)
        self.assertIn("all-in per sheet: $0.21", text)  # 6 calls × $0.03504 over 1 sheet


if __name__ == "__main__":
    unittest.main()
