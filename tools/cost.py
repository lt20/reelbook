#!/usr/bin/env python3
"""What a Reelbook run costs, read from Claude Code's own transcripts.

    cost.py [--since YYYY-MM-DD] [--dir ~/.claude/projects] [--csv out.csv]

Claude Code writes every session to ~/.claude/projects/**/*.jsonl, with the token
usage of each model call. This script keeps the sessions that ran rb.py (an
interactive /reelbook or the nightly run), cuts each one into videos at every
`rb.py done` / `rb.py error`, and prices the calls at the Claude API rates below.

On a Pro or Max plan you do not pay these amounts: they are what the same work
would cost through the API, i.e. what a hosted service would pay per video.

Notes:
- Calls before the first video of a run (reading the queue, setup) are reported
  as "overhead"; calls after the last close (final summary) too.
- The glossary pass runs after `done`, so it is counted with the next video,
  or in the overhead of the run's end. A run that only does the glossary is
  reported on its own line.
- Needs nothing but Python 3.9+.
"""
import argparse, csv, glob, json, os, re, statistics, sys
from datetime import datetime, timezone

# $ per million tokens: input, output, cache read. Cache writes are priced from
# input: x1.25 for the 5-minute cache, x2 for the 1-hour cache.
PRICES = {
    "claude-opus-5-5":   (4.00, 20.00, 0.20),
    "claude-opus-5":     (5.00, 25.00, 0.50),
    "claude-opus-4":     (5.00, 25.00, 0.50),   # 4.6, 4.7, 4.8
    "claude-sonnet-5-5": (2.00, 10.00, 0.10),
    "claude-sonnet-5":   (2.00, 10.00, 0.20),
    "claude-sonnet-4":   (3.00, 15.00, 0.30),
    "claude-haiku-5-5":  (0.10, 0.50, 0.01),
    "claude-haiku-4":    (1.00, 5.00, 0.10),
    "claude-fable-5-2":  (8.00, 40.00, 0.20),
    "claude-fable-5":    (10.00, 50.00, 1.00),  # 5, 5.1
}
DEFAULT_MODEL = "claude-opus-5-5"
unknown_models = set()


def price_of(model):
    model = (model or "").split("[")[0]
    best = max((k for k in PRICES if model.startswith(k)), key=len, default=None)
    if best is None:
        if model and model != "<synthetic>":
            unknown_models.add(model)
        best = DEFAULT_MODEL
    return PRICES[best]


def cost(u, model):
    p_in, p_out, p_read = price_of(model)
    cc = u.get("cache_creation") or {}
    w1h = cc.get("ephemeral_1h_input_tokens") or 0
    w5m = cc.get("ephemeral_5m_input_tokens")
    if w5m is None:
        w5m = (u.get("cache_creation_input_tokens") or 0) - w1h
    return (u.get("input_tokens", 0) * p_in
            + w5m * p_in * 1.25 + w1h * p_in * 2
            + u.get("cache_read_input_tokens", 0) * p_read
            + u.get("output_tokens", 0) * p_out) / 1e6


def ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


RB_RUN = re.compile(r"rb\.py\s+(queue|claim|publish|done|error|glossary)\b")
CLOSE = re.compile(r"rb\.py\s+(done|error)\s+(\S+)(.*)", re.S)
SLUG = re.compile(r"--slug\s+(\S+)")
REASON = re.compile(r"--reason\s+(\S+)")


def bash_commands(msg):
    content = msg.get("content")
    if not isinstance(content, list):
        return []
    return [b.get("input", {}).get("command", "") for b in content
            if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == "Bash"]


def load_sessions(root, since):
    """sessionId -> list of events (time, kind, data), sorted by time."""
    sessions = {}
    seen = {}  # (session, message id, request id) -> event, to merge the lines of one streamed call
    for path in glob.glob(os.path.join(os.path.expanduser(root), "**", "*.jsonl"), recursive=True):
        try:
            f = open(path, encoding="utf-8")
        except OSError:
            continue
        with f:
            for line in f:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get("type") != "assistant":
                    continue
                t = ts(e.get("timestamp", ""))
                if t is None or (since and t < since):
                    continue
                sid = e.get("sessionId") or path
                msg = e.get("message") or {}
                ev = sessions.setdefault(sid, [])
                for cmd in bash_commands(msg):
                    ev.append((t, "cmd", cmd))
                u = msg.get("usage")
                if not u:
                    continue
                key = (sid, msg.get("id"), e.get("requestId"))
                if key in seen:  # same call, another content block: keep the largest counts
                    old = seen[key][2]
                    for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"):
                        old["usage"][k] = max(old["usage"].get(k, 0) or 0, u.get(k, 0) or 0)
                    continue
                call = {"usage": dict(u), "model": msg.get("model")}
                seen[key] = (t, "call", call)
                ev.append(seen[key])
    for ev in sessions.values():
        ev.sort(key=lambda x: (x[0], x[1] != "call"))
    return {s: ev for s, ev in sessions.items() if any(k == "cmd" and RB_RUN.search(d) for _, k, d in ev)}


def new_bucket():
    return {"calls": 0, "in": 0, "write": 0, "read": 0, "out": 0, "cost": 0.0, "start": None, "end": None, "publish": 0}


def add(b, t, call):
    u = call["usage"]
    b["calls"] += 1
    b["in"] += u.get("input_tokens", 0) or 0
    b["write"] += u.get("cache_creation_input_tokens", 0) or 0
    b["read"] += u.get("cache_read_input_tokens", 0) or 0
    b["out"] += u.get("output_tokens", 0) or 0
    b["cost"] += cost(u, call["model"])
    b["start"] = b["start"] or t
    b["end"] = t


def split(sid, events):
    """One row per video, plus the run's overhead (and glossary-only runs)."""
    rows, cur, closed, glossary = [], new_bucket(), 0, False
    for t, kind, data in events:
        if kind == "call":
            add(cur, t, data)
            continue
        if re.search(r"rb\.py\s+glossary", data):
            glossary = True
        if re.search(r"rb\.py\s+publish", data):
            cur["publish"] += 1
        m = CLOSE.search(data)
        if m:
            what, rid, rest = m.groups()
            slug, reason = SLUG.search(rest), REASON.search(rest)
            cur.update(kind="video", session=sid, request=rid, outcome="done" if what == "done" else
                       "error:" + (reason.group(1) if reason else "?"), slug=slug.group(1) if slug else "")
            rows.append(cur)
            cur, closed = new_bucket(), closed + 1
    if cur["calls"]:
        cur.update(kind="glossary" if glossary and not closed else "overhead", session=sid, request="",
                   outcome="", slug="")
        rows.append(cur)
    return rows


def money(x):
    return f"${x:,.2f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default="~/.claude/projects", help="Claude Code transcripts (default: %(default)s)")
    ap.add_argument("--since", help="only calls from this date on (YYYY-MM-DD)")
    ap.add_argument("--csv", help="also write one line per video / overhead to this CSV file")
    a = ap.parse_args()
    since = datetime.fromisoformat(a.since).replace(tzinfo=timezone.utc) if a.since else None

    sessions = load_sessions(a.dir, since)
    if not sessions:
        sys.exit(f"No session running rb.py found under {a.dir}" + (f" since {a.since}" if a.since else "") + ".")
    rows = [r for sid, ev in sessions.items() for r in split(sid, ev)]
    rows.sort(key=lambda r: r["start"])

    videos = [r for r in rows if r["kind"] == "video"]
    print(f"{'date':16} {'outcome':22} {'slug':28} {'calls':>5} {'min':>4} {'read M':>7} {'out k':>6} {'cost':>8}")
    for r in rows:
        mins = (r["end"] - r["start"]).total_seconds() / 60 if r["start"] else 0
        label = r["outcome"] if r["kind"] == "video" else f"({r['kind']})"
        print(f"{r['start']:%Y-%m-%d %H:%M} {label[:22]:22} {r['slug'][:28]:28} {r['calls']:5} {mins:4.0f} "
              f"{r['read'] / 1e6:7.2f} {r['out'] / 1e3:6.1f} {money(r['cost']):>8}")

    total = sum(r["cost"] for r in rows)
    done = [r for r in videos if r["outcome"] == "done"]
    failed = [r for r in videos if r["outcome"] != "done"]
    other = sum(r["cost"] for r in rows if r["kind"] != "video")
    sheets = sum(r["publish"] for r in done)
    print()
    print(f"Runs: {len(sessions)}   videos: {len(videos)} ({len(done)} done, {len(failed)} failed)   total: {money(total)}")
    if done:
        c = sorted(r["cost"] for r in done)
        p90 = c[min(len(c) - 1, int(round(0.9 * (len(c) - 1))))]
        print(f"Per video done:  median {money(statistics.median(c))}   mean {money(statistics.mean(c))}   "
              f"p90 {money(p90)}   min {money(c[0])}   max {money(c[-1])}")
        print(f"All-in per video done (failures and overhead spread on them): {money(total / len(done))}")
        if sheets:
            print(f"Published sheets: {sheets} (a session counts its exercise sheets and itself)   "
                  f"all-in per sheet: {money(total / sheets)}")
    if failed:
        print(f"Failed videos cost {money(sum(r['cost'] for r in failed))}; overhead and glossary {money(other)}.")
    parts = {"cache reads": 0.0, "cache writes": 0.0, "output": 0.0, "uncached input": 0.0}
    for sid, ev in sessions.items():
        for _, kind, call in ev:
            if kind != "call":
                continue
            u, (p_in, p_out, p_read) = call["usage"], price_of(call["model"])
            parts["cache reads"] += (u.get("cache_read_input_tokens", 0) or 0) * p_read / 1e6
            parts["output"] += (u.get("output_tokens", 0) or 0) * p_out / 1e6
            parts["uncached input"] += (u.get("input_tokens", 0) or 0) * p_in / 1e6
            parts["cache writes"] += cost({"cache_creation_input_tokens": u.get("cache_creation_input_tokens", 0) or 0,
                                           "cache_creation": u.get("cache_creation")}, call["model"])
    if total:
        print("Where it goes: " + ", ".join(f"{k} {v / total:.0%}" for k, v in parts.items()))
    if unknown_models:
        print(f"Priced as {DEFAULT_MODEL} (unknown model): {', '.join(sorted(unknown_models))}")

    if a.csv:
        cols = ["kind", "outcome", "slug", "request", "session", "start", "end", "calls", "in", "write", "read", "out",
                "publish", "cost"]
        with open(a.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            for r in rows:
                w.writerow({**r, "start": r["start"].isoformat() if r["start"] else "",
                            "end": r["end"].isoformat() if r["end"] else "", "cost": round(r["cost"], 4)})
        print(f"CSV: {a.csv}")


if __name__ == "__main__":
    main()
