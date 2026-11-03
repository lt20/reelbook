#!/usr/bin/env python3
"""rb.py — Reelbook command line, used by the reelbook skill. Standard library only.

    rb.py login [--url U --key K]   sign in (email + password; URL and anon key asked unless given) and keep a session
    rb.py whoami                show the signed-in account and backend
    rb.py themes                list the account's notebooks (id, title, description, groups), JSON lines
    rb.py queue                 list queued requests (JSON lines)
    rb.py claim <id>            mark a request as processing (processed_at = claim time until done/error)
    rb.py publish <dir>         sheet folder: upload <dir>/img/* and upsert the sheet (<dir>/meta.json + <dir>/index.html)
                                session folder: publish each exercise sheet sub-folder, then upsert the session
    rb.py done <id> --slug S    close a request once its sheet or session is published
    rb.py error <id> --note T   flag a request that could not be processed
    rb.py list                  list published sheets and sessions
    rb.py delete <slug>         remove a sheet and its images
    rb.py requeue-sessions [--dry-run]
                                queue again the video of every old (v1, one HTML page) session, so the skill
                                rebuilds it as exercise sheets + a session; skips a URL already queued or processing
    rb.py requeue-stuck [--hours N] [--dry-run]
                                put back in the queue every request left « processing » for more than N hours
                                (default 6) by a run that died (Mac asleep, crash); run first by nightly.sh and the skill

Session file: ~/.config/reelbook/config.json (chmod 600). Override with REELBOOK_CONFIG.

meta.json of a sheet folder (meta.json + index.html + img/):
    {"slug": "floor-angel", "kind": "sheet", "theme": "strength", "group": "Shoulders",
     "title": "Floor angel", "summary": "…", "duration": "3 min", "thumbnail": "img/thumb.jpg",
     "source": {"author": "Georges St-Pierre", "url": "https://…", "platform": "instagram | tiktok | youtube | facebook"}}

meta.json of a session folder (meta.json + one sheet sub-folder per exercise, no index.html):
    {"slug": "session-gsp-shoulders", "kind": "session", "theme": "strength", "title": "…",
     "format": "5 rounds · 60 s rest", "why": "…", "key_points": ["…", "…"],
     "source": {"author": "…", "url": "https://…", "platform": "…"},
     "items": [{"slug": "session-gsp-shoulders-floor-angel", "dose": "30 s"}, …]}   # video order
    Every item slug is the slug of a sub-folder's meta.json, and every sub-folder is an item. Optional
    "thumbnail": "<item slug>/img/<file>" (else the app uses the first item's). Publishing then deletes
    the old v1 session (sheets row with kind "session", images included) that has the same source.url.
    The v1 format (kind "session" with "exercises" and one index.html) is refused.
"""
import json, os, sys, time, getpass, mimetypes, pathlib, urllib.request, urllib.parse, urllib.error

CFG_PATH = pathlib.Path(os.environ.get("REELBOOK_CONFIG") or "~/.config/reelbook/config.json").expanduser()

def die(msg, code=1):
    print(f"rb: {msg}", file=sys.stderr); sys.exit(code)

def load_cfg():
    if not CFG_PATH.exists():
        die("not signed in: run `rb.py login` first")
    return json.loads(CFG_PATH.read_text())

def save_cfg(cfg):
    CFG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CFG_PATH.write_text(json.dumps(cfg, indent=2))
    os.chmod(CFG_PATH, 0o600)

class RbHTTPError(Exception):
    """Raised instead of exiting when the status code is in `tolerate`."""
    def __init__(self, code, body):
        super().__init__(f"{code}: {body}"); self.code = code; self.body = body

def http(method, url, headers=None, data=None, raw=False, tolerate=()):
    body = data if raw or data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, method=method, data=body, headers=headers or {})
    if not raw and data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        if e.code in tolerate:
            raise RbHTTPError(e.code, e.read().decode()[:400])
        die(f"{method} {url.split('?')[0]} → {e.code}: {e.read().decode()[:400]}")

# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------

def cmd_login(args):
    """Interactive by default. Non-interactive: environment variables REELBOOK_URL,
    REELBOOK_ANON_KEY, REELBOOK_EMAIL, REELBOOK_PASSWORD (each falls back to the saved value)."""
    old = json.loads(CFG_PATH.read_text()) if CFG_PATH.exists() else {}
    env = {k: os.environ.get("REELBOOK_" + k.upper(), "") for k in ("url", "anon_key", "email", "password")}
    # `rb.py login --url U --key K` : the command the app's Settings page gives to copy
    for i, a in enumerate(args):
        if a == "--url" and i + 1 < len(args): env["url"] = args[i + 1]
        if a == "--key" and i + 1 < len(args): env["anon_key"] = args[i + 1]
    if not sys.stdin.isatty() and not env["password"]:
        die("no terminal to ask for the password: run this in a normal terminal, or set REELBOOK_EMAIL and REELBOOK_PASSWORD")
    ask = lambda label, cur: (input(f"{label} [{cur or ''}]: ").strip() or cur) if sys.stdin.isatty() else cur
    url = env["url"] or ask("Supabase project URL", old.get("url", ""))
    key = env["anon_key"] or (old.get("anon_key", "") if not sys.stdin.isatty() else (input(f"Anon key [{'keep current' if old.get('anon_key') else ''}]: ").strip() or old.get("anon_key", "")))
    email = env["email"] or ask("Email", old.get("email", ""))
    pwd = env["password"] or getpass.getpass("Password: ")
    if not (url and key and email and pwd):
        die("project URL, anon key, email and password are all needed")
    url = url.rstrip("/")
    tok = http("POST", f"{url}/auth/v1/token?grant_type=password", {"apikey": key}, {"email": email, "password": pwd})
    cfg = {"url": url, "anon_key": key, "email": email, "user_id": tok["user"]["id"],
           "access_token": tok["access_token"], "refresh_token": tok["refresh_token"], "expires_at": int(time.time()) + tok.get("expires_in", 3600)}
    save_cfg(cfg)
    print(f"signed in as {email} on {url}")

def session():
    cfg = load_cfg()
    if cfg["expires_at"] < time.time() + 60:
        tok = http("POST", f"{cfg['url']}/auth/v1/token?grant_type=refresh_token", {"apikey": cfg["anon_key"]}, {"refresh_token": cfg["refresh_token"]})
        cfg.update(access_token=tok["access_token"], refresh_token=tok["refresh_token"], expires_at=int(time.time()) + tok.get("expires_in", 3600))
        save_cfg(cfg)
    return cfg

def hdr(cfg, extra=None):
    h = {"apikey": cfg["anon_key"], "Authorization": f"Bearer {cfg['access_token']}"}
    if extra: h.update(extra)
    return h

def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
    url = f"{cfg['url']}/rest/v1/{path}"
    if params: url += "?" + urllib.parse.urlencode(params, safe="=.,*()")
    extra = {"Prefer": prefer} if prefer else {}
    return http(method, url, hdr(cfg, extra), data, tolerate=tolerate)

def cmd_whoami(args):
    cfg = session()
    print(f"{cfg['email']} ({cfg['user_id']}) on {cfg['url']}")

# ---------------------------------------------------------------------------
# requests
# ---------------------------------------------------------------------------

def cmd_themes(args):
    cfg = session()
    rows = rest(cfg, "GET", "user_themes", params={"select": "id,title,description,groups,builtin", "order": "position.asc,title.asc"})
    for r in rows or []:
        print(json.dumps(r, ensure_ascii=False))
    if not rows:
        print("no notebook yet: open the app once, it creates the default ones", file=sys.stderr)

def cmd_queue(args):
    cfg = session()
    rows = rest(cfg, "GET", "requests", params={"status": "eq.queued", "order": "created_at.asc", "select": "id,url,theme,created_at"})
    for r in rows or []:
        print(json.dumps(r, ensure_ascii=False))
    if not rows:
        print("queue is empty", file=sys.stderr)

def _patch_request(cfg, rid, patch, expect=None):
    params = {"id": f"eq.{rid}"}
    if expect: params["status"] = f"eq.{expect}"
    rows = rest(cfg, "PATCH", "requests", patch, prefer="return=representation", params=params)
    if not rows:
        die(f"request {rid} not found" + (f" with status {expect}" if expect else ""))
    print(json.dumps(rows[0], ensure_ascii=False))

def cmd_claim(args):
    if not args: die("usage: rb.py claim <id>")
    _patch_request(session(), args[0], {"status": "processing", "processed_at": now()}, expect="queued")

def cmd_done(args):
    if len(args) < 3 or args[1] != "--slug": die("usage: rb.py done <id> --slug <slug>")
    _patch_request(session(), args[0], {"status": "done", "slug": args[2], "processed_at": now()})

def cmd_error(args):
    if len(args) < 3 or args[1] != "--note": die("usage: rb.py error <id> --note <text>")
    _patch_request(session(), args[0], {"status": "error", "note": " ".join(args[2:]), "processed_at": now()})

def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

# ---------------------------------------------------------------------------
# sheets
# ---------------------------------------------------------------------------

REQUIRED = ("slug", "theme", "group", "title")
SESSION_REQUIRED = ("slug", "theme", "title")
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp")
NO_SESSIONS = "this backend has no sessions table: re-run supabase/schema.sql (see docs/own-supabase.md)"

def _known_themes(cfg):
    return {r["id"] for r in (rest(cfg, "GET", "user_themes", params={"select": "id"}) or [])}

def _check_theme(theme, known, where):
    if known and theme not in known:
        die(f"{where}: theme '{theme}' is not one of this account's notebooks ({', '.join(sorted(known))}); add it in the app or pick another")

def _same_url(a, b):
    norm = lambda u: (u or "").strip().rstrip("/")
    return bool(norm(a)) and norm(a) == norm(b)

def _read_sheet(d):
    """Check a sheet folder (meta.json + index.html) without touching the network; return its meta."""
    meta_p, html_p = d / "meta.json", d / "index.html"
    if not meta_p.exists() or not html_p.exists(): die(f"{d} needs meta.json and index.html")
    meta = json.loads(meta_p.read_text())
    for k in REQUIRED:
        if not meta.get(k): die(f"{meta_p}: missing {k}")
    if meta.get("kind", "sheet") != "sheet": die(f"{meta_p}: kind must be \"sheet\" here")
    return meta

def _publish_sheet(cfg, d, meta):
    slug = meta["slug"]
    n, img_d = 0, d / "img"
    if img_d.is_dir():
        for f in sorted(img_d.iterdir()):
            if f.suffix.lower() not in IMG_EXT: continue
            ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            path = f"{cfg['user_id']}/{slug}/img/{f.name}"
            http("POST", f"{cfg['url']}/storage/v1/object/sheets/{path}", hdr(cfg, {"Content-Type": ctype, "x-upsert": "true"}), f.read_bytes(), raw=True)
            n += 1
    row = {"slug": slug, "kind": "sheet", "theme": meta["theme"], "group": meta["group"], "title": meta["title"],
           "summary": meta.get("summary", ""), "duration": meta.get("duration", ""), "thumbnail": meta.get("thumbnail", "img/thumb.jpg"),
           "source": meta.get("source", {}), "exercises": [], "html": (d / "index.html").read_text()}
    out = rest(cfg, "POST", "sheets", row, prefer="resolution=merge-duplicates,return=representation", params={"on_conflict": "user_id,slug"})
    print(f"published {slug}: {n} image(s), row {out[0]['id']}")

def _read_session(d, meta):
    """Check a v2 session folder without touching the network; return [(item slug, sub-folder, sheet meta)] in item order."""
    where = d / "meta.json"
    for k in SESSION_REQUIRED:
        if not meta.get(k): die(f"{where}: missing {k}")
    items = meta.get("items")
    if not isinstance(items, list) or not items:
        die(f"{where}: items must be a non-empty list of {{\"slug\", \"dose\"}}")
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("slug"), str) or not it["slug"] or not isinstance(it.get("dose", ""), str):
            die(f"{where}: bad item {json.dumps(it, ensure_ascii=False)}: expected {{\"slug\": \"…\", \"dose\": \"…\"}}")
    for k in ("format", "why"):
        if not isinstance(meta.get(k, ""), str): die(f"{where}: {k} must be a string")
    kp = meta.get("key_points", [])
    if not isinstance(kp, list) or not all(isinstance(x, str) for x in kp): die(f"{where}: key_points must be a list of strings")
    subs = {}
    for sub in sorted(p for p in d.iterdir() if p.is_dir() and (p / "meta.json").exists()):
        m = _read_sheet(sub)
        if m["slug"] in subs: die(f"{d}: two sub-folders use the slug {m['slug']}")
        subs[m["slug"]] = (sub, m)
    wanted = [it["slug"] for it in items]
    missing = [s for s in dict.fromkeys(wanted) if s not in subs]
    if missing: die(f"{where}: item(s) without a sheet sub-folder: {', '.join(missing)}")
    extra = [s for s in subs if s not in wanted]
    if extra: die(f"{d}: sub-folder sheet(s) not listed in items: {', '.join(extra)}")
    if meta["slug"] in subs: die(f"{where}: the session slug must differ from its exercise slugs")
    th = meta.get("thumbnail", "")
    if th:
        first = th.split("/", 1)[0]
        if first not in subs or not th.startswith(f"{first}/img/") or not (subs[first][0] / th[len(first) + 1:]).is_file():
            die(f"{where}: thumbnail must be \"<item slug>/img/<file>\" of one of the sub-folders, got {th}")
    return [(s, *subs[s]) for s in dict.fromkeys(wanted)]

def _delete_sheet(cfg, slug, kind=None, notes=True):
    prefix = f"{cfg['user_id']}/{slug}/img"
    objs = http("POST", f"{cfg['url']}/storage/v1/object/list/sheets", hdr(cfg), {"prefix": prefix, "limit": 1000}) or []
    if objs:
        http("DELETE", f"{cfg['url']}/storage/v1/object/sheets", hdr(cfg), {"prefixes": [f"{prefix}/{o['name']}" for o in objs]})
    params = {"slug": f"eq.{slug}"}
    if kind: params["kind"] = f"eq.{kind}"
    rest(cfg, "DELETE", "sheets", params=params)
    if notes: rest(cfg, "DELETE", "notes", params={"slug": f"eq.{slug}"})
    return len(objs)

def _drop_v1_sessions(cfg, url):
    """Delete the v1 sessions (sheets rows, kind 'session') built from the same video, with their images.
    Their notes are kept: the cadrage says v1 sessions carry none, and a note is user data."""
    if not (url or "").strip(): return []
    rows = rest(cfg, "GET", "sheets", params={"kind": "eq.session", "select": "slug,source"}) or []
    gone = []
    for r in rows:
        if _same_url((r.get("source") or {}).get("url"), url):
            n = _delete_sheet(cfg, r["slug"], kind="session", notes=False)
            print(f"deleted v1 session {r['slug']} ({n} image(s)): replaced by the new session")
            gone.append(r["slug"])
    return gone

def _publish_session(d, meta):
    sheets = _read_session(d, meta)
    cfg = session()
    try:
        rest(cfg, "GET", "sessions", params={"select": "id", "limit": "1"}, tolerate=(404,))
    except RbHTTPError:
        die(NO_SESSIONS + ", then publish again")
    known = _known_themes(cfg)
    _check_theme(meta["theme"], known, d / "meta.json")
    for _, sub, m in sheets:
        _check_theme(m["theme"], known, sub / "meta.json")
    for _, sub, m in sheets:          # the sheets first: the session only links to them
        _publish_sheet(cfg, sub, m)
    th = meta.get("thumbnail", "")
    row = {"slug": meta["slug"], "theme": meta["theme"], "title": meta["title"], "format": meta.get("format", ""),
           "why": meta.get("why", ""), "key_points": meta.get("key_points", []), "source": meta.get("source", {}),
           "origin": "video", "thumbnail": f"{cfg['user_id']}/{th}" if th else "",
           "items": [{"slug": it["slug"], "dose": it.get("dose", "")} for it in meta["items"]]}
    out = rest(cfg, "POST", "sessions", row, prefer="resolution=merge-duplicates,return=representation", params={"on_conflict": "user_id,slug"})
    print(f"published session {meta['slug']}: {len(row['items'])} item(s), {len(sheets)} sheet(s), row {out[0]['id']}")
    _drop_v1_sessions(cfg, (meta.get("source") or {}).get("url"))

def cmd_publish(args):
    if not args: die("usage: rb.py publish <dir>")
    d = pathlib.Path(args[0])
    meta_p = d / "meta.json"
    if not meta_p.exists(): die(f"{d} needs meta.json")
    meta = json.loads(meta_p.read_text())
    if meta.get("kind") == "session":
        if "items" not in meta or meta.get("exercises"):
            die(f"{meta_p}: this is the old session format (one page, \"exercises\"), no longer published. "
                "Write one sheet sub-folder per exercise and a session meta.json with \"items\" "
                "(skill/reelbook/SKILL.md section 3 bis, or `rb.py` with no argument for the format)")
        return _publish_session(d, meta)
    meta = _read_sheet(d)
    cfg = session()
    _check_theme(meta["theme"], _known_themes(cfg), meta_p)
    _publish_sheet(cfg, d, meta)

def cmd_list(args):
    cfg = session()
    rows = rest(cfg, "GET", "sheets", params={"select": "slug,kind,theme,group,title,added_at", "order": "theme,group,title"})
    for r in rows or []:
        print(f"{r['theme']:9} {r['group']:20} {r['kind']:8} {r['slug']:32} {r['title']}")
    try:
        ses = rest(cfg, "GET", "sessions", params={"select": "slug,theme,title,items", "order": "theme,title"}, tolerate=(404,))
    except RbHTTPError:
        print(NO_SESSIONS + " to enable sessions", file=sys.stderr); return
    for r in ses or []:   # kind "session2": a v2 session (exercise sheets + order); "session" rows above are v1 pages
        print(f"{r['theme']:9} {str(len(r.get('items') or [])) + ' item(s)':20} {'session2':8} {r['slug']:32} {r['title']}")

def cmd_delete(args):
    if not args: die("usage: rb.py delete <slug>")
    cfg = session(); slug = args[0]
    n = _delete_sheet(cfg, slug)
    print(f"deleted {slug} ({n} image(s))")

# ---------------------------------------------------------------------------
# migration of v1 sessions
# ---------------------------------------------------------------------------

def cmd_requeue_sessions(args):
    if any(a != "--dry-run" for a in args): die("usage: rb.py requeue-sessions [--dry-run]")
    dry = "--dry-run" in args
    cfg = session()
    v1 = rest(cfg, "GET", "sheets", params={"kind": "eq.session", "select": "slug,theme,title,source", "order": "added_at.asc"}) or []
    busy = [r.get("url") for r in (rest(cfg, "GET", "requests", params={"status": "in.(queued,processing)", "select": "url"}) or [])]
    todo = []
    for r in v1:
        url = ((r.get("source") or {}).get("url") or "").strip()
        if not url:
            print(f"skip {r['slug']}: no source url, reprocess it by hand", file=sys.stderr); continue
        if any(_same_url(url, b) for b in busy):
            print(f"skip {r['slug']}: {url} is already queued or processing", file=sys.stderr); continue
        if any(_same_url(url, t["url"]) for t in todo):
            print(f"skip {r['slug']}: same video as another v1 session", file=sys.stderr); continue
        todo.append({"url": url, "theme": r["theme"]})
        print(f"{'would queue' if dry else 'queue'} {r['slug']}: {url}")
    if todo and not dry:
        rest(cfg, "POST", "requests", todo, prefer="return=minimal")
    print(f"{len(v1)} v1 session(s), {len(todo)} request(s) {'to insert (dry run, nothing written)' if dry else 'inserted'}")

def _ts(v):
    """A PostgREST timestamp (« …+00:00 » or « …Z ») as epoch seconds; None when absent or unreadable."""
    if not v: return None
    import datetime
    try:
        return datetime.datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None

def cmd_requeue_stuck(args):
    usage = "usage: rb.py requeue-stuck [--hours N] [--dry-run]"
    hours, dry, rest_args = 6.0, False, list(args)
    while rest_args:
        a = rest_args.pop(0)
        if a == "--dry-run": dry = True
        elif a == "--hours" and rest_args:
            try: hours = float(rest_args.pop(0))
            except ValueError: die(usage)
            if hours <= 0: die(usage)
        else: die(usage)
    cfg = session()
    rows = rest(cfg, "GET", "requests", params={"status": "eq.processing", "select": "id,url,processed_at,created_at", "order": "created_at.asc"}) or []
    limit, n = time.time() - hours * 3600, 0
    for r in rows:
        since = _ts(r.get("processed_at")) or _ts(r.get("created_at"))
        if since is not None and since > limit:
            print(f"keep {r['id']}: processing for less than {hours:g} h", file=sys.stderr); continue
        stamp = r.get("processed_at") or r.get("created_at") or "?"
        print(f"{'would requeue' if dry else 'requeue'} {r['id']}: {r['url']} (processing since {stamp})")
        n += 1
        if not dry:
            # status=eq.processing in the filter: a request closed meanwhile is left alone
            rest(cfg, "PATCH", "requests", {"status": "queued", "processed_at": None,
                                            "note": f"requeued after a run stopped mid-way ({str(stamp)[:16]})"},
                 prefer="return=minimal", params={"id": f"eq.{r['id']}", "status": "eq.processing"})
    print(f"{len(rows)} processing, {n} {'to requeue (dry run, nothing written)' if dry else 'requeued'}")

COMMANDS = {"login": cmd_login, "whoami": cmd_whoami, "themes": cmd_themes, "queue": cmd_queue, "claim": cmd_claim, "publish": cmd_publish,
            "done": cmd_done, "error": cmd_error, "list": cmd_list, "delete": cmd_delete,
            "requeue-sessions": cmd_requeue_sessions, "requeue-stuck": cmd_requeue_stuck}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](sys.argv[2:])
