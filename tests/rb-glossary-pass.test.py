"""The glossary pass (P11 G2b): the one prompt both engines read (skill/reelbook/glossary.md), the skill's steps that
run it (skill/reelbook/SKILL.md) and the night's catch-up (tools/nightly.sh).

The prompt and `rb.py glossary` cannot drift apart: the example the prompt gives as « received » is what
`glossary sheets <theme> --pending` prints for that notebook, and the example it gives as « returned » goes through
every check of `glossary put`.

No network, no Claude: the backend is the in-memory one of tests/rb-glossary.test.py; tools/nightly.sh is sourced and
each command it would start is a shell function. Every sheet and word is made up.
Run: python3 -I tests/rb-glossary-pass.test.py
"""
import importlib.util, json, os, pathlib, re, subprocess, sys, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("rb_glossary_test", ROOT / "tests" / "rb-glossary.test.py")
g = importlib.util.module_from_spec(spec)   # its fake backend and its Case; its own tests stay in that module
spec.loader.exec_module(g)

PROMPT = (ROOT / "skill" / "reelbook" / "glossary.md").read_text(encoding="utf-8")
SKILL = (ROOT / "skill" / "reelbook" / "SKILL.md").read_text(encoding="utf-8")
NIGHTLY = ROOT / "tools" / "nightly.sh"


def example():
    """The two JSON blocks of the prompt: what the pass receives, what it returns."""
    blocks = re.findall(r"```json\n(.*?)\n```", PROMPT, flags=re.S)
    assert len(blocks) == 2, f"{len(blocks)} JSON blocks in glossary.md, expected the example's two"
    return json.loads(blocks[0]), json.loads(blocks[1])


def backend_of(received):
    """The backend that would print the example's input: its notebook, its sheets, its glossary in the table."""
    nb = received["notebook"]
    sheets = [{"slug": s["slug"], "kind": "sheet", "theme": nb["id"], "title": s["title"], "html": s["html"],
               "updated_at": s["updated_at"]} for s in received["sheets"]]
    words = [g.stored(id=f"w{i}", theme=nb["id"], term=w["term"], sense=w["sense"], forms=w["forms"], definition=w["definition"],
                      confidence="unsure", doubt="Un doute déjà écrit.", photo=None, related=[], sheets=[])
             for i, w in enumerate(received["glossary"])]
    return g.Backend(words=words, themes=[{"id": nb["id"], "title": "", "description": "", "family": None}], sheets=sheets)


class PromptExample(g.Case):
    def test_what_the_prompt_receives_is_what_sheets_pending_prints(self):
        received, _ = example()
        out, err, code = self.run_cmd(["sheets", received["notebook"]["id"], "--pending"], backend_of(received))
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(json.loads(out), received)   # the notebook, each sheet with its photos and date, the glossary in short

    def test_what_the_prompt_returns_passes_the_checks_of_put_and_is_written(self):
        received, returned = example()
        theme, b = received["notebook"]["id"], backend_of(received)
        path = pathlib.Path(self._tmp.name) / "returned.json"
        path.write_text(json.dumps(returned, ensure_ascii=False), encoding="utf-8")
        out, err, code = self.run_cmd(["put", theme, str(path)], b)
        self.assertEqual((err, code), ("", 0))
        self.assertEqual(out, f"glossary {theme}: 3 inserted, 1 updated, 0 unchanged\nglossary {theme}: 2 sheets recorded as read\n")
        # the entry the glossary had keeps what the notebook holds and gets the new form and the new sheet
        old = next(w for w in b.words if w["term"] == "border")
        self.assertEqual((old["definition"], old["confidence"], old["doubt"]), (received["glossary"][0]["definition"], "unsure", "Un doute déjà écrit."))
        self.assertEqual(old["forms"], ["border", "bordé", "borde"])
        self.assertEqual([s["slug"] for s in old["sheets"]], ["saut-droit"])
        # every sheet read is recorded with the date the prompt was given, the one without any word too
        self.assertEqual({p["slug"]: p["sheet_updated_at"] for p in b.passes}, {s["slug"]: s["updated_at"] for s in received["sheets"]})
        # nothing is left to read: the next pass is not given these sheets again
        self.assertEqual(json.loads(self.run_cmd(["sheets", theme, "--pending"], b)[0])["sheets"], [])
        self.assertEqual(self.run_cmd(["pending"], b)[0], "")

    def test_the_example_follows_the_rules_it_illustrates(self):
        received, returned = example()
        self.assertEqual(list(returned), ["notebook", "language", "terms", "rejected", "passed"])
        self.assertEqual(returned["passed"], [{"slug": s["slug"], "updated_at": s["updated_at"]} for s in received["sheets"]])
        photos = {s["slug"]: s["photos"] for s in received["sheets"]}
        for e in returned["terms"]:
            with self.subTest(e["term"]):
                self.assertEqual(list(e), ["term", "sense", "forms", "kind", "definition", "confidence", "doubt", "spelling", "sheets", "photo", "related"])
                self.assertIn(e["kind"], ("manoeuvre", "position", "gear", "action", "zone", "call", "other"))
                self.assertEqual(e["forms"], [f.lower() for f in e["forms"]])
                for item in e["sheets"]:
                    if item["where"] == "text": self.assertTrue(4 <= len(item["quote"].split()) <= 20, item["quote"])
                if e["photo"]:
                    self.assertEqual(list(e["photo"]), ["slug", "file", "why"])
                    self.assertIn(e["photo"]["file"], photos[e["photo"]["slug"]][1:])   # one of the sheet's photos, never its thumbnail
        self.assertEqual([e["term"] for e in returned["terms"]], sorted(e["term"] for e in returned["terms"]))   # one sheet each: alphabetical
        self.assertTrue(all(r["word"] and r["why"] for r in returned["rejected"]))

    def test_the_prompt_can_be_given_as_it_is_to_any_engine(self):
        # no tool, no command, no path of a computer, no engine: the skill and the server each say how they call it
        for word in ("rb.py", "python", "mcp__", "chrome", "claude", "tools/", "work/", "skill", "~/", "/reelbook", "supabase", "worker", "bash"):
            self.assertNotIn(word, PROMPT.lower(), word)
        self.assertNotRegex(PROMPT, r"https?://")

    def test_the_prompt_carries_the_decisions(self):
        for part in ("The reader cannot remove, edit or add a word", "leave it out and list it in `rejected`",       # decision 3
                     "from what you know of the discipline", "not by paraphrasing the sheet",                       # decision 2
                     "The basic gear of the discipline IS one", "a step or phase that a sheet itself names",        # decision 8
                     "a compound whose meaning is the sum of its everyday words", "## One entry per sense",
                     "ONE photo, never more", "Never the sheet's thumbnail",                                         # decision 4
                     "## Words the glossary already has", "Its definition is not rewritten",                        # the incremental mode
                     "never created a second time", "every sheet you read", "A sheet where you found no word is listed too"):
            self.assertIn(part, PROMPT, part)

    def test_the_prompt_the_skill_and_put_say_the_same_rule_for_a_sheet_read_again(self):
        # Codex pass 1 on #143: the prompt said « leave the unused entry out » while `put` only added. Now the three say
        # it: for a sheet read, the answer is every entry that applies; what is not given again is taken off that sheet
        for part in ("return ALL the entries that apply to it, those `glossary` already has included",
                     "an entry you do not return for a sheet you read\nis taken off that sheet",
                     "the entry itself stays in the glossary, with the sheets you were not given",
                     "What you return for a sheet replaces what the\nglossary listed for that sheet"):
            self.assertIn(part, PROMPT, part)
        skill = re.search(r"^## 5\. .*?(?=^## |\Z)", SKILL, flags=re.S | re.M).group(0)
        for part in ("`terms` gives every entry that still applies to\n   it, those already in the glossary included",
                     "A sheet that is\n   not in `passed` loses nothing", "`, D associations removed (sheets read again)`",
                     "Fix the entry, do not drop it", "« still lists a sheet read again » (exit 1)"):
            self.assertIn(part, skill, part)
        usage = " ".join(g.rb.__doc__.split())
        for part in ("no entry is ever deleted (an entry can lose a sheet the pass read again",
                     "that the file does not give again for it loses that item of sheets",
                     "Its items for the other sheets never move, and an entry left without any sheet stays, with sheets empty",
                     'Without "passed": nothing is recorded and no association is removed',
                     # Codex pass 2 on #143: the check on the sheets' dates, and what it does not close
                     "a sheet published again while this command ran is neither reconciled nor recorded as read",
                     "That check and the write after it are two calls, not one operation",
                     "can still lose an association, which the next pass of that sheet, then waiting, gives back"):
            self.assertIn(part, usage, part)
        self.assertNotIn("nothing is ever deleted", usage)

    def test_an_entry_the_answer_does_not_give_again_for_a_sheet_read_is_taken_off_it(self):
        # the example again, on a notebook where « border » was already listed for the sheet read: returned as the
        # prompt asks, it stays listed; left out of the answer, it is taken off, and the entry stays in the glossary
        received, returned = example()
        theme = received["notebook"]["id"]
        listed = next(e for e in returned["terms"] if e["term"] == "border")["sheets"]
        for terms, sheets, line in ((returned["terms"], listed, "3 inserted, 1 updated, 0 unchanged\n"),
                                    ([e for e in returned["terms"] if e["term"] != "border"], [],
                                     "3 inserted, 0 updated, 0 unchanged, 1 association removed (sheets read again)\n")):
            b = backend_of(received)
            b.words[0]["sheets"] = [dict(i) for i in listed]
            path = pathlib.Path(self._tmp.name) / "returned.json"
            path.write_text(json.dumps(dict(returned, terms=terms), ensure_ascii=False), encoding="utf-8")
            out, err, code = self.run_cmd(["put", theme, str(path)], b)
            self.assertEqual((err, code), ("", 0))
            self.assertIn(f"glossary {theme}: {line}", out)
            old = next(w for w in b.words if w["term"] == "border")
            self.assertEqual((old["sheets"], old["definition"]), (sheets, received["glossary"][0]["definition"]))
            self.assertEqual(json.loads(self.run_cmd(["sheets", theme, "--pending"], b)[0])["sheets"], [])


class SkillSteps(unittest.TestCase):
    def section(self, n):
        return re.search(rf"^## {n}\. .*?(?=^## |\Z)", SKILL, flags=re.S | re.M).group(0)

    def test_the_request_is_closed_before_the_pass(self):
        publish, glossary = self.section(4), self.section(5)
        self.assertLess(SKILL.index(publish), SKILL.index(glossary))
        self.assertLess(publish.index("rb.py done <id>"), publish.index("the glossary pass of\n  section 5"))
        self.assertIn("once its request is closed", glossary)
        self.assertIn("A failed pass never fails a video", glossary)
        self.assertIn("nothing is flagged with `rb.py error`", glossary)

    def test_the_pass_reads_the_prompt_file_and_calls_the_three_commands(self):
        s = self.section(5)
        self.assertTrue((ROOT / "skill" / "reelbook" / "glossary.md").is_file())
        for part in ("`glossary.md`, next to this file", "rb.py glossary pending", "rb.py glossary sheets <theme> --pending",
                     "rb.py glossary put <theme> work/glossary/<theme>.json", '`passed` with one `{"slug", "updated_at"}` per sheet'):
            self.assertIn(part, s, part)

    def test_what_put_and_pending_can_answer_is_handled(self):
        s = self.section(5)
        for part in ("It exits 1", "fix the file **once**", "Refused a second time: stop, leave the sheets\n     pending",
                     "« passes not recorded »: stop after that notebook and say why", "No other pass in this run"):
            self.assertIn(part, s, part)

    def test_the_route_of_the_night_run_is_a_route_of_the_skill(self):
        s = self.section(5)
        self.assertIn("**`/reelbook glossary [<notebook>] [at most N sheets]`**", s)
        self.assertIn("10 by default", s)
        self.assertIn("`<notebook>: X sheets read, Y words added, Z words updated`", s)
        self.assertIn('"/reelbook glossary, at most $gmax sheets"', NIGHTLY.read_text(encoding="utf-8"))
        self.assertIn("`/reelbook glossary …` takes no queue and no video: go to section 5", self.section(1))
        self.assertIn('"/reelbook glossary"', SKILL.split("\n---\n")[0])   # the description announces the route

    def test_the_command_that_keeps_n_sheets_keeps_the_named_ones_first(self):
        code = re.search(r'`python3 -c "(import json,sys;.*?)" work/glossary/<theme>\.in\.json <N>', self.section(5), flags=re.S).group(1)
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / "kitesurf.in.json"
            doc = {"notebook": {"id": "kitesurf"}, "sheets": [{"slug": s, "title": "É"} for s in "abcd"], "glossary": [{"term": "border"}]}
            p.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
            r = subprocess.run([sys.executable, "-c", code, str(p), "2", "c"], capture_output=True, text=True, check=True)
            self.assertEqual(r.stdout, "2 sheet(s) to read\n")
            kept = json.loads(p.read_text(encoding="utf-8"))
            self.assertEqual([s["slug"] for s in kept["sheets"]], ["c", "a"])
            self.assertEqual((kept["notebook"], kept["glossary"], kept["sheets"][0]["title"]), (doc["notebook"], doc["glossary"], "É"))
            subprocess.run([sys.executable, "-c", code, str(p), "10"], capture_output=True, text=True, check=True)   # fewer than N: all of them
            self.assertEqual(len(json.loads(p.read_text(encoding="utf-8"))["sheets"]), 2)


def bash(script, *args, env=None):
    """Source tools/nightly.sh (functions only), then run `script`."""
    base = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": os.environ.get("HOME", "/tmp")}
    return subprocess.run(["bash", "-c", 'src="$1"; shift; source "$src"; ' + script, "bash", str(NIGHTLY), *args],
                          capture_output=True, text=True, env=dict(base, **(env or {})), check=True)


class NightGlossaryPure(unittest.TestCase):
    def count(self, listing):
        return bash('glossary_count "$1"', listing).stdout

    def notice(self, status, after):
        return bash('glossary_notice "$@"', str(status), str(after)).stdout.rstrip("\n")

    def test_the_sheets_waiting_are_the_sum_of_the_lines_of_glossary_pending(self):
        self.assertEqual(self.count("kitesurf 2\nstrength 1\n"), "3\n")
        self.assertEqual(self.count("custom-parkour 12"), "12\n")
        self.assertEqual(self.count(""), "0\n")                                # nothing printed: nothing waits
        self.assertEqual(self.count("kitesurf 2\nnot a count\n\nfight 1"), "3\n")

    def test_the_notice_gives_the_exit_of_the_pass_and_the_sheets_still_waiting(self):
        self.assertEqual(self.notice(0, 0), "Glossary: run done (claude exit 0) · 0 still waiting")
        self.assertEqual(self.notice(0, 4), "Glossary: run done (claude exit 0) · 4 still waiting")
        self.assertEqual(self.notice(0, "?"), "Glossary: run done (claude exit 0), rb.py glossary pending failed")

    def test_only_a_pass_that_failed_itself_is_called_a_failure(self):
        self.assertEqual(self.notice(1, 4), "Glossary run failed (claude exit 1) · 4 still waiting")
        self.assertEqual(self.notice(137, 0), "Glossary run failed (claude exit 137) · 0 still waiting")
        self.assertEqual(self.notice(1, "?"), "Glossary run failed (claude exit 1), rb.py glossary pending failed")

    def test_the_notice_no_longer_takes_the_count_before_the_pass(self):
        # Codex pass 1 on #143: sheets read = waiting before - waiting after is wrong as soon as another engine
        # publishes during the pass. Nothing in the notice is worked out from a difference any more
        src = NIGHTLY.read_text(encoding="utf-8")
        body = re.search(r"^glossary_notice\(\) \{\n(.*?)^\}", src, flags=re.S | re.M).group(1)
        self.assertNotIn("before", body)
        self.assertNotIn("$((", body)
        self.assertIn('glossary_notice "$status" "$after"', src)
        self.assertNotIn("no sheet read", src)


# cmd_run with nothing real behind it: rb.py, Claude, caffeinate, the battery, the phone are shell functions that write
# what they were asked to a file. REELBOOK_CONFIG and HOME point at an empty folder besides, so no session exists.
NIGHT = r'''
out="$TMP/calls"; REPO="$TMP"; CLAUDE=fake_claude
python3() { echo "python3 $*" >> "$out"; }
queued() { echo "$QUEUED"; }
on_battery() { [ "${BATTERY:-0}" = 1 ]; }
screen_locked() { return 1; }
open() { :; }
caffeinate() { shift; "$@"; }
fake_claude() { echo "claude $*" >> "$out"; return "${CLAUDE_EXIT:-0}"; }
notify() { echo "notify $1" >> "$out"; }
log() { echo "log $*" >> "$out"; }
glossary_waiting() {   # the answers of `rb.py glossary pending`, one per call: $WAITING = "3 1", or "fail"
  local i; i="$(cat "$TMP/asked" 2>/dev/null || echo 0)"; echo $((i + 1)) > "$TMP/asked"
  set -- $WAITING; shift "$i"
  [ "${1:-fail}" = fail ] && return 1
  echo "$1"
}
cmd_run "$@"
'''


class NightGlossaryRun(unittest.TestCase):
    def night(self, *args, **env):
        with tempfile.TemporaryDirectory() as tmp:
            env = dict({k: str(v) for k, v in env.items()}, TMP=tmp, HOME=tmp, REELBOOK_CONFIG=str(pathlib.Path(tmp) / "none.json"))
            bash(NIGHT, *args, env=env)
            calls = pathlib.Path(tmp) / "calls"
            lines = calls.read_text(encoding="utf-8").splitlines() if calls.exists() else []
        rb = [l for l in lines if l.startswith("python3 ")]   # what reached the stub of rb.py: never the glossary (it has its own)
        self.assertEqual([l for l in rb if "requeue-stuck" not in l and "list --since" not in l], [])
        return [l for l in lines if l not in rb]

    def claude(self, lines):
        return [l for l in lines if l.startswith("claude ")]

    def test_an_empty_queue_still_catches_up_the_glossary_without_chrome(self):
        lines = self.night(QUEUED=0, WAITING="3 1")
        self.assertEqual(self.claude(lines), ["claude -p --model claude-opus-5-5 --permission-mode auto /reelbook glossary, at most 10 sheets"])
        self.assertEqual(lines[-4:], ["log glossary: 3 sheet(s) waiting, reading up to 10", self.claude(lines)[0],
                                      "log Glossary: run done (claude exit 0) · 1 still waiting",
                                      "notify Glossary: run done (claude exit 0) · 1 still waiting"])
        self.assertIn("log queue empty", lines)

    def test_after_the_videos_the_glossary_gets_its_own_run_and_its_own_notice(self):
        lines = self.night("--max", "1", "--glossary-max", "3", QUEUED=2, WAITING="5 2")
        video, glossary = self.claude(lines)
        self.assertIn("--chrome", video)
        self.assertIn("/reelbook process the queue, at most 1 requests", video)
        self.assertEqual(glossary, "claude -p --model claude-opus-5-5 --permission-mode auto /reelbook glossary, at most 3 sheets")
        notices = [l for l in lines if l.startswith("notify ")]
        self.assertEqual(notices, ["notify Night run: nothing published (claude exit 0) · 2 still queued", "notify Glossary: run done (claude exit 0) · 2 still waiting"])
        self.assertLess(lines.index(notices[0]), lines.index(glossary))   # the videos' notice does not wait for the glossary

    def test_a_night_with_nothing_to_do_starts_nothing_and_sends_nothing(self):
        lines = self.night(QUEUED=0, WAITING="0")
        self.assertEqual(lines, ["log queue empty"])

    def test_on_battery_the_glossary_is_skipped_as_the_videos_are(self):
        lines = self.night(QUEUED=0, WAITING="4", BATTERY=1)
        self.assertEqual(lines, ["log queue empty", "log glossary: 4 sheet(s) waiting, Mac on battery: skipped"])
        lines = self.night(QUEUED=2, WAITING="4", BATTERY=1)
        self.assertEqual(self.claude(lines), [])
        self.assertFalse(any("glossary" in l.lower() for l in lines))

    def test_a_backend_without_the_glossary_is_one_log_line(self):
        lines = self.night(QUEUED=0, WAITING="fail")
        self.assertEqual(lines, ["log queue empty", "log glossary: rb.py glossary pending failed (exit 1): skipped"])

    def test_a_glossary_run_that_failed_is_said(self):
        lines = self.night(QUEUED=0, WAITING="3 3", CLAUDE_EXIT=1)
        self.assertEqual(lines[-1], "notify Glossary run failed (claude exit 1) · 3 still waiting")
        lines = self.night(QUEUED=0, WAITING="3")   # rb.py fails after the run
        self.assertEqual(lines[-1], "notify Glossary: run done (claude exit 0), rb.py glossary pending failed")

    def test_sheets_that_arrive_during_the_pass_do_not_make_it_a_failure(self):
        # Codex pass 1 on #143: 3 sheets wait; the pass reads them (exit 0) while another engine publishes 3, or 5:
        # as many or more wait afterwards. The night says what it knows, the exit and what still waits, never « failed »
        for after in (3, 5):
            lines = self.night(QUEUED=0, WAITING=f"3 {after}")
            self.assertEqual(lines[-2:], [f"log Glossary: run done (claude exit 0) · {after} still waiting",
                                          f"notify Glossary: run done (claude exit 0) · {after} still waiting"])
            self.assertFalse(any("failed" in l or "no sheet read" in l for l in lines), lines)
        # and a pass that failed is a failure even when fewer sheets wait afterwards (it read some, or some were deleted)
        lines = self.night(QUEUED=0, WAITING="3 1", CLAUDE_EXIT=2)
        self.assertEqual(lines[-1], "notify Glossary run failed (claude exit 2) · 1 still waiting")

    def test_the_usage_text_names_the_option(self):
        r = subprocess.run(["bash", str(NIGHTLY)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertIn("run [--max N] [--glossary-max N]", r.stdout)
        self.assertTrue(r.stdout.rstrip().endswith("(rb.py requeue-stuck)."), r.stdout[-200:])


if __name__ == "__main__":
    unittest.main()
