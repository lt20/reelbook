#!/usr/bin/env python3
"""rb.py — Reelbook command line, used by the reelbook skill. Standard library only.

    rb.py login [--url U --key K]   sign in (email + password; URL and anon key asked unless given) and keep a session
    rb.py whoami                show the signed-in account and backend
    rb.py themes                list the account's notebooks (id, title, description, groups), JSON lines
    rb.py queue                 list queued requests (JSON lines)
    rb.py claim <id>            mark a request as processing
    rb.py publish <dir>         upload <dir>/img/* and upsert the sheet described by <dir>/meta.json + <dir>/index.html
    rb.py done <id> --slug S    close a request once its sheet is published
    rb.py error <id> --note T   flag a request that could not be processed
    rb.py list                  list published sheets
    rb.py delete <slug>         remove a sheet and its images

Session file: ~/.config/reelbook/config.json (chmod 600). Override with REELBOOK_CONFIG.

meta.json for publish:
    {"slug": "floor-angel", "kind": "sheet", "theme": "strength", "group": "Shoulders",
     "title": "Floor angel", "summary": "…", "duration": "3 min", "thumbnail": "img/thumb.jpg",
     "source": {"author": "Georges St-Pierre", "url": "https://…", "platform": "instagram"},
     "exercises": []}      # sessions only: [{"anchor","title","group","summary","duration","thumbnail"}]
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

def http(method, url, headers=None, data=None, raw=False):
    body = data if raw or data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, method=method, data=body, headers=headers or {})
    if not raw and data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
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

def rest(cfg, method, path, data=None, prefer=None, params=None):
    url = f"{cfg['url']}/rest/v1/{path}"
    if params: url += "?" + urllib.parse.urlencode(params, safe="=.,*()")
    extra = {"Prefer": prefer} if prefer else {}
    return http(method, url, hdr(cfg, extra), data)

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
    _patch_request(session(), args[0], {"status": "processing"}, expect="queued")

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

def cmd_publish(args):
    if not args: die("usage: rb.py publish <dir>")
    d = pathlib.Path(args[0])
    meta_p, html_p, img_d = d / "meta.json", d / "index.html", d / "img"
    if not meta_p.exists() or not html_p.exists(): die(f"{d} needs meta.json and index.html")
    meta = json.loads(meta_p.read_text())
    for k in REQUIRED:
        if not meta.get(k): die(f"meta.json: missing {k}")
    cfg = session()
    slug = meta["slug"]
    known = {r["id"] for r in (rest(cfg, "GET", "user_themes", params={"select": "id"}) or [])}
    if known and meta["theme"] not in known:
        die(f"theme '{meta['theme']}' is not one of this account's notebooks ({', '.join(sorted(known))}); add it in the app or pick another")
    # images
    n = 0
    if img_d.is_dir():
        for f in sorted(img_d.iterdir()):
            if f.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"): continue
            ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            path = f"{cfg['user_id']}/{slug}/img/{f.name}"
            http("POST", f"{cfg['url']}/storage/v1/object/sheets/{path}", hdr(cfg, {"Content-Type": ctype, "x-upsert": "true"}), f.read_bytes(), raw=True)
            n += 1
    row = {"slug": slug, "kind": meta.get("kind", "sheet"), "theme": meta["theme"], "group": meta["group"], "title": meta["title"],
           "summary": meta.get("summary", ""), "duration": meta.get("duration", ""), "thumbnail": meta.get("thumbnail", "img/thumb.jpg"),
           "source": meta.get("source", {}), "exercises": meta.get("exercises", []), "html": html_p.read_text()}
    out = rest(cfg, "POST", "sheets", row, prefer="resolution=merge-duplicates,return=representation", params={"on_conflict": "user_id,slug"})
    print(f"published {slug}: {n} image(s), row {out[0]['id']}")

def cmd_list(args):
    cfg = session()
    rows = rest(cfg, "GET", "sheets", params={"select": "slug,kind,theme,group,title,added_at", "order": "theme,group,title"})
    for r in rows or []:
        print(f"{r['theme']:9} {r['group']:20} {r['kind']:8} {r['slug']:32} {r['title']}")

def cmd_delete(args):
    if not args: die("usage: rb.py delete <slug>")
    cfg = session(); slug = args[0]
    prefix = f"{cfg['user_id']}/{slug}/img"
    objs = http("POST", f"{cfg['url']}/storage/v1/object/list/sheets", hdr(cfg), {"prefix": prefix, "limit": 1000}) or []
    if objs:
        http("DELETE", f"{cfg['url']}/storage/v1/object/sheets", hdr(cfg), {"prefixes": [f"{prefix}/{o['name']}" for o in objs]})
    rest(cfg, "DELETE", "sheets", params={"slug": f"eq.{slug}"})
    rest(cfg, "DELETE", "notes", params={"slug": f"eq.{slug}"})
    print(f"deleted {slug} ({len(objs)} image(s))")

COMMANDS = {"login": cmd_login, "whoami": cmd_whoami, "themes": cmd_themes, "queue": cmd_queue, "claim": cmd_claim, "publish": cmd_publish,
            "done": cmd_done, "error": cmd_error, "list": cmd_list, "delete": cmd_delete}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](sys.argv[2:])
