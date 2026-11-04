#!/usr/bin/env python3
"""rb.py — Reelbook command line, used by the reelbook skill. Standard library only.

    rb.py login [--url U --key K]   sign in (email + password; URL and anon key asked unless given) and keep a session
    rb.py whoami                show the signed-in account and backend
    rb.py themes                list the account's notebooks (id, title, description, groups, profile), JSON lines;
                                profile (gym | technique | partner) picks the sheet template: read from the library
                                of app/config.js by id, "gym" for a custom notebook
    rb.py queue                 list queued requests (JSON lines: id, url, theme, note, created_at); a note that
                                starts with « Redo: » is a correction asked from the app (« Something wrong? »):
                                its line also has redo_of, {"sheets": [slugs], "sessions": [slugs]} published
                                from that URL (source.url), the slugs to publish over
    rb.py claim <id>            mark a request as processing (processed_at = claim time until done/error)
    rb.py publish <dir> [--request <id>]
                                sheet folder: upload <dir>/img/* and upsert the sheet (<dir>/meta.json + <dir>/index.html)
                                session folder: publish each exercise sheet sub-folder, then upsert the session.
                                A backend with quotas (L29) may refuse a new sheet or photo: the limit is said in plain
                                words and, with --request, that request goes to error with the same message
    rb.py done <id> --slug S    close a request once its sheet or session is published
    rb.py error <id> --note T   flag a request that could not be processed (a « Redo: » note keeps its first
                                line, T goes after it: Retry in the app queues the correction again)
    rb.py list [--since ISO]    list published sheets and sessions; --since: only those added at or after ISO
                                (UTC, e.g. 2026-11-03T02:00:00Z), oldest first, video sessions only, without the
                                exercise sheets of a session listed too (nightly.sh: its « 2 new sheets: … » notice)
    rb.py delete <slug>         remove a sheet and its images
    rb.py requeue-sessions [--dry-run]
                                queue again the video of every old (v1, one HTML page) session, so the skill
                                rebuilds it as exercise sheets + a session; skips a URL already queued or processing.
                                For backends that still hold v1 sessions: the app no longer shows them
                                (Settings counts them) and nothing writes them any more
    rb.py requeue-stuck [--hours N] [--dry-run]
                                put back in the queue every request left « processing » for more than N hours
                                (default 6) by a run that died (Mac asleep, crash); run first by nightly.sh and the skill
    rb.py backfill-search [--dry-run]
                                fill search_text (the text the app searches) of every sheet of the account that has
                                none yet, from its html; once, after supabase/schema.sql added the column.
                                `publish` writes it for every new sheet
    rb.py backfill-tags [--dry-run]
                                derive the facet tags (zone, gear, minutes, type) of every sheet of the account that
                                has none yet, without Claude: zone from the group (else the title), gear and type from
                                keywords of the title and search text, minutes from duration; once, after
                                supabase/schema.sql added the column. `publish` sends the tags of meta.json

Session file: ~/.config/reelbook/config.json (chmod 600). Override with REELBOOK_CONFIG.

meta.json of a sheet folder (meta.json + index.html + img/):
    {"slug": "floor-angel", "kind": "sheet", "theme": "strength", "group": "Shoulders",
     "title": "Floor angel", "summary": "…", "duration": "3 min", "thumbnail": "img/thumb.jpg",
     "source": {"author": "Georges St-Pierre", "url": "https://…", "platform": "instagram | tiktok | youtube | facebook"}}
    `duration` is the practice time or "" (a video length or a step count is refused on a new sheet, only
    warned about on a sheet already published). Optional
    `steps` (whole number >= 1): checked, kept in meta.json only (no column yet; the app shows `duration`).
    Optional `tags` (L23, the facets of the search view): {"zone": ["shoulders"], "gear": ["band"], "minutes": 8,
    "type": "mobility"}, values from `facets` in app/config.js (an unknown value is refused on a new sheet, only
    warned about on a sheet already published); `minutes` defaults to the number in `duration`.

meta.json of a session folder (meta.json + one sheet sub-folder per exercise, no index.html):
    {"slug": "session-gsp-shoulders", "kind": "session", "theme": "strength", "title": "…",
     "format": "5 rounds · 60 s rest", "why": "…", "key_points": ["…", "…"],
     "source": {"author": "…", "url": "https://…", "platform": "…"},
     "items": [{"slug": "session-gsp-shoulders-floor-angel", "dose": "30 s"}, …]}   # video order
    Every item slug is the slug of a sub-folder's meta.json, and every sub-folder is an item. Optional
    "thumbnail": "<item slug>/img/<file>" (else the app uses the first item's). Publishing then deletes
    the old v1 session (sheets row with kind "session", images included) that has the same source.url.
    The v1 format (kind "session" with "exercises" and one index.html) is refused. The sheets columns
    `kind` and `exercises` only serve this migration now; `publish` writes kind "sheet" and leaves
    `exercises` to its default.
"""
import hashlib, json, os, re, sys, time, getpass, mimetypes, pathlib, urllib.request, urllib.parse, urllib.error, unicodedata
from html.parser import HTMLParser

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

# F1: exit code of a revoked session (the refresh token is gone: signed out everywhere, password changed…).
# tools/nightly.sh reads it to send « signed out, run rb.py login » rather than a bare failure.
SIGNED_OUT = 3
REVOKED = ("refresh_token_not_found", "refresh_token_already_used", "invalid_grant", "invalid refresh token",
           "session_not_found", "session_expired")

def self_path():
    """This script's path, ~ for the home folder: the login command to give works wherever rb.py was installed."""
    p, home = pathlib.Path(__file__).resolve(), pathlib.Path.home().resolve()
    return f"~/{p.relative_to(home)}" if home in p.parents else str(p)

def session():
    cfg = load_cfg()
    if cfg["expires_at"] < time.time() + 60:
        try:
            tok = http("POST", f"{cfg['url']}/auth/v1/token?grant_type=refresh_token", {"apikey": cfg["anon_key"]},
                       {"refresh_token": cfg["refresh_token"]}, tolerate=(400, 401, 403))
        except RbHTTPError as e:
            if any(w in e.body.lower() for w in REVOKED):
                die(f"Your computer was signed out of Reelbook (session revoked). Run: python3 {self_path()} login", SIGNED_OUT)
            die(f"POST {cfg['url']}/auth/v1/token → {e.code}: {e.body}")
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

LIBRARY_JS = pathlib.Path(__file__).resolve().parent.parent / "app" / "config.js"
PROFILES = ("gym", "technique", "partner")

def library_profiles(path=None):
    """{notebook id: profile} of the built-in notebooks of app/config.js; {} when the file cannot be read.
    A user_themes row has no profile column: the library is the only place it is written (L16)."""
    try:
        src = pathlib.Path(path or LIBRARY_JS).read_text(encoding="utf-8")
    except OSError:
        return {}
    out = {}
    for m in re.finditer(r"\{\s*id:\s*'([^']+)'([^{}]*)\}", src):
        p = re.search(r"\bprofile:\s*'([^']*)'", m.group(2))
        out[m.group(1)] = p.group(1) if p and p.group(1) in PROFILES else "gym"
    return out

def cmd_themes(args):
    cfg = session()
    rows = rest(cfg, "GET", "user_themes", params={"select": "id,title,description,groups,builtin", "order": "position.asc,title.asc"})
    profiles = library_profiles()
    for r in rows or []:
        r["profile"] = profiles.get(r.get("id"), "gym")
        print(json.dumps(r, ensure_ascii=False))
    if not rows:
        print("no notebook yet: open the app once, it creates the default ones", file=sys.stderr)

def cmd_queue(args):
    cfg = session()
    rows = rest(cfg, "GET", "requests", params={"status": "eq.queued", "order": "created_at.asc", "select": "id,url,theme,note,slug,created_at"})
    for r in rows or []:
        if (r.get("note") or "").startswith("Redo:"):
            r["redo_of"] = _published_from(cfg, r["url"])
        print(json.dumps(r, ensure_ascii=False))
    if not rows:
        print("queue is empty", file=sys.stderr)

def _published_from(cfg, url):
    """The sheets and sessions whose source.url is `url`: what a « Redo: » request republishes (same slugs)."""
    q = {"select": "slug", "source->>url": f"eq.{url}"}
    out = {"sheets": [r["slug"] for r in rest(cfg, "GET", "sheets", params=dict(q)) or []], "sessions": []}
    try:
        out["sessions"] = [r["slug"] for r in rest(cfg, "GET", "sessions", params=dict(q), tolerate=(404,)) or []]
    except RbHTTPError:
        pass
    return out

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

def _error_request(cfg, rid, note):
    # a correction keeps its « Redo: … » line first: the app shows the error, and Retry queues the instruction again
    was = rest(cfg, "GET", "requests", params={"id": f"eq.{rid}", "select": "note"}) or []
    redo = str((was[0].get("note") if was else "") or "").split("\n")[0]
    if redo.startswith("Redo:"): note = f"{redo}\n{note}"
    _patch_request(cfg, rid, {"status": "error", "note": note, "processed_at": now()})

def cmd_error(args):
    if len(args) < 3 or args[1] != "--note": die("usage: rb.py error <id> --note <text>")
    _error_request(session(), args[0], " ".join(args[2:]))

def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

# ---------------------------------------------------------------------------
# sheets
# ---------------------------------------------------------------------------

REQUIRED = ("slug", "theme", "group", "title")
SESSION_REQUIRED = ("slug", "theme", "title")
# Optional structured dose of a session item, written when the video states it (the app reads them before the
# free-text dose): whole numbers >= 0, and per_side a boolean; null counts as absent.
ITEM_FIELDS = ("sets", "reps", "seconds", "rest_s", "per_side")
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp")
# A sheet's duration is its practice time (« 5 min ») or "": never the video length (« 0:45 », « 1:02:30 ») nor a
# step count (L15)
NOT_A_DURATION = re.compile(r"(?<!\d)\d+(\s*:\s*\d\d){1,2}(?!\d)|\b(steps?|stages?|exercises?|étapes?|exercices?)\b", re.I)
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
    if not isinstance(meta.get("duration", ""), str): die(f"{meta_p}: duration must be a string")
    steps = meta.get("steps")
    if steps is not None and (not isinstance(steps, int) or isinstance(steps, bool) or steps < 1):
        die(f"{meta_p}: steps must be a whole number >= 1")
    return meta

# Full-text search (sheets.search_text): what a reader sees on the sheet, kit pills first, whitespace collapsed,
# at most SEARCH_MAX characters (cut at a word). Not read: scripts, styles, the <title>, image alt texts.
SEARCH_MAX = 4000
_SKIP_TAGS = {"script", "style", "template", "noscript", "title", "svg"}
_INLINE_TAGS = {"a", "b", "i", "em", "strong", "u", "s", "small", "sub", "sup", "mark", "abbr", "code", "q", "cite", "time"}
_VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

class _VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.body, self.kit, self.stack = [], [], []   # stack: (tag, skipped, in a .kit element)
    def _top(self, i):
        return bool(self.stack) and self.stack[-1][i]
    def _gap(self, tag):   # a block boundary separates words; inline tags do not
        if tag not in _INLINE_TAGS: (self.kit if self._top(2) else self.body).append(" ")
    def handle_starttag(self, tag, attrs):
        self._gap(tag)
        if tag in _VOID_TAGS: return
        kit = "kit" in (dict(attrs).get("class") or "").split()
        self.stack.append((tag, tag in _SKIP_TAGS or self._top(1), kit or self._top(2)))
    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):   # tolerant of unclosed tags
            if self.stack[i][0] == tag: del self.stack[i:]; break
        self._gap(tag)
    def handle_data(self, data):
        if not self._top(1): (self.kit if self._top(2) else self.body).append(data)

def search_text(html):
    p = _VisibleText()
    p.feed(html or ""); p.close()
    ws = lambda parts: re.sub(r"\s+", " ", "".join(parts)).strip()
    text = " ".join(t for t in (ws(p.kit), ws(p.body)) if t)
    if len(text) > SEARCH_MAX:
        cut = text[:SEARCH_MAX]
        if not text[SEARCH_MAX].isspace() and " " in cut: cut = cut.rsplit(" ", 1)[0]
        text = cut.rstrip()
    return text

NO_SEARCH_TEXT = "this backend has no sheets.search_text column: re-run supabase/schema.sql (see docs/own-supabase.md)"
NO_TAGS = "this backend has no sheets.tags column: re-run supabase/schema.sql (see docs/own-supabase.md)"
# The columns a sheet row can do without: a backend not migrated yet answers 400 (PostgREST PGRST204 on a write,
# 42703 on a read) naming the column, and the row goes out without it.
OPTIONAL_COLUMNS = {"search_text": NO_SEARCH_TEXT, "tags": NO_TAGS}

def _no_column(err, col):
    body = err.body or ""
    return err.code == 400 and re.search(rf"\b{col}\b", body) is not None

def _no_search_column(err):
    return _no_column(err, "search_text")

# ---------------------------------------------------------------------------
# Faceted library (L23): sheets.tags = {"zone": [], "gear": [], "minutes": n | null, "type": ""}, values from the
# `facets` vocabulary of app/config.js (read here, one source for the app, the skill and this tool).
# ---------------------------------------------------------------------------
FACET_LISTS = ("zone", "gear")

def facets_vocab(path=None):
    """{"zone": [...], "gear": [...], "type": [...]} from the `facets` block of app/config.js; {} when unreadable."""
    try:
        src = pathlib.Path(path or LIBRARY_JS).read_text(encoding="utf-8")
    except OSError:
        return {}
    block = re.search(r"\bfacets:\s*\{(.*?)\n\s*\}", src, re.S)
    if not block: return {}
    out = {}
    for key in ("zone", "gear", "type"):
        m = re.search(rf"\b{key}:\s*\[([^\]]*)\]", block.group(1))
        if m: out[key] = re.findall(r"'([^']*)'", m.group(1))
    return out

_UNIT = r"(h(?:ours?|eures?|r)?|min\w*|mn|s(?:ec\w*)?)(?![a-z])"
_NUM = r"(\d+(?:[.,]\d+)?)"

def _minutes(duration):
    """The practice time of a duration in whole minutes (« 8 min » → 8, « 10–15 min » → 15, « 1 h 30 min » → 90,
    « 45 s » → 1); None when no number carries a time unit (« 3 sets », « 20 »: never guessed)."""
    d = (duration or "").lower()
    per = lambda u: 60 if u[0] == "h" else 1 / 60 if u[0] == "s" else 1
    num = lambda x: float(x.replace(",", "."))
    # a range (« 10–15 min », « 10 to 15 min ») counts as its upper end, in the unit written after it
    d = re.sub(rf"{_NUM}\s*(?:-|–|—|to|à)\s*{_NUM}\s*{_UNIT}", lambda m: f"{max(num(m.group(1)), num(m.group(2)))} {m.group(3)}", d)
    parts = re.findall(rf"{_NUM}\s*{_UNIT}", d)
    if not parts: return None
    n = sum(num(x) * per(u) for x, u in parts)   # « 1 h 30 min » adds up; a number without a unit is ignored
    return int(-(-n // 1)) if n > 0 else 0

def _tag_problems(tags, vocab):
    """(errors, unknown): errors = a malformed tags object (always refused), unknown = values outside the vocabulary
    (refused on a new sheet, a warning on a sheet already published). No vocabulary: nothing is unknown."""
    if not isinstance(tags, dict): return ["tags must be an object"], []
    errors, unknown = [], []
    for k, v in tags.items():
        if k in FACET_LISTS:
            if not isinstance(v, list) or not all(isinstance(x, str) for x in v): errors.append(f"tags.{k} must be a list of strings")
            elif vocab.get(k): unknown += [f"{k} {json.dumps(x, ensure_ascii=False)}" for x in v if x not in vocab[k]]
        elif k == "minutes":
            if v is not None and (not isinstance(v, int) or isinstance(v, bool) or v < 0): errors.append("tags.minutes must be a whole number >= 0 or null")
        elif k == "type":
            if not isinstance(v, str): errors.append("tags.type must be a string")
            elif v and vocab.get("type") and v not in vocab["type"]: unknown.append(f"type {json.dumps(v, ensure_ascii=False)}")
        else:
            unknown.append(f"facet {json.dumps(k, ensure_ascii=False)}")
    return errors, unknown

def _check_tags(cfg, sheets):
    """Before any write, as _check_durations: `sheets` is [(meta.json path, meta)]. A malformed `tags` is refused;
    a value outside app/config.js `facets` is refused on a new sheet, only warned about on a sheet already published."""
    vocab, bad = facets_vocab(), []
    for p, m in sheets:
        if "tags" not in m: continue
        errors, unknown = _tag_problems(m["tags"], vocab)
        if errors: die(f"{p}: {'; '.join(errors)}")
        if unknown: bad.append((p, m, unknown))
    if not bad: return
    slugs = sorted({m["slug"] for _, m, _ in bad})
    rows = rest(cfg, "GET", "sheets", params={"select": "slug", "slug": f"in.({','.join(slugs)})"}) or []
    old = {r.get("slug") for r in rows} & set(slugs)
    for p, m, unknown in bad:
        msg = f"{p}: tags hold values outside the facets of app/config.js: {', '.join(unknown)}"
        if m["slug"] in old: print(f"rb: warning: {msg}; published anyway, the sheet existed before", file=sys.stderr)
        else: die(msg + " (pick from the vocabulary, or leave the facet empty)")

def _sheet_tags(meta):
    """The tags sent with a sheet, as written in meta.json; `minutes` from `duration` when the skill left it out."""
    tags = dict(meta["tags"])
    if "minutes" not in tags: tags["minutes"] = _minutes(meta.get("duration", ""))
    return tags

def _check_durations(cfg, sheets):
    """L15, new sheets only: refuse a duration that is a video length or a step count, before any write.
    `sheets` is [(meta.json path, meta)]. A sheet already published (a correction of an older sheet) only gets a
    warning, so that it can still be republished."""
    bad = [(p, m) for p, m in sheets if NOT_A_DURATION.search(m.get("duration", ""))]
    if not bad: return
    slugs = sorted({m["slug"] for _, m in bad})
    rows = rest(cfg, "GET", "sheets", params={"select": "slug", "slug": f"in.({','.join(slugs)})"}) or []
    old = {r.get("slug") for r in rows} & set(slugs)
    for p, m in bad:
        msg = (f"{p}: duration {json.dumps(m['duration'], ensure_ascii=False)} must be the practice time (\"5 min\") "
               "or \"\", never the video length nor a step count (put a count in \"steps\")")
        if m["slug"] in old: print(f"rb: warning: {msg}; published anyway, the sheet existed before this rule", file=sys.stderr)
        else: die(msg)

# ---------------------------------------------------------------------------
# Quotas (L29): a shared backend limits each account (supabase/schema.sql, « Quotas per account »). The database
# refuses with « quota: 300 sheets » or « quota: 200 MB of photos » (SQL P0001); a storage server that hides the
# message behind a bare refusal is read through my_quota().
# ---------------------------------------------------------------------------

QUOTA_RE = re.compile(r"quota: ([^\"\\\n]+)")
REQUEST_ID = None   # set by `publish --request <id>`: the request a quota refusal flags

def _quota_in(body):
    """The limit named by a quota refusal (« 300 sheets »), or None."""
    m = QUOTA_RE.search(str(body or ""))
    return m.group(1).strip().rstrip(".") if m else None

def _my_quota(cfg):
    """The account's limits and usage (my_quota(), a stable function: GET), or None on a backend without quotas."""
    try:
        q = rest(cfg, "GET", "rpc/my_quota", tolerate=(400, 401, 403, 404))
    except RbHTTPError:
        return None
    keys = ("sheets", "max_sheets", "storage_bytes", "max_storage_mb")
    return q if isinstance(q, dict) and all(isinstance(q.get(k), int) for k in keys) else None

def _photos_full(q):
    return f"{q['max_storage_mb']} MB of photos" if q and q["storage_bytes"] >= q["max_storage_mb"] * 1048576 else None

LIST_PAGE = 1000   # storage lists at most this many objects per call: the list is read page by page

def _remote_images(cfg, slug):
    """{file name: (MD5, size)} of the photos the backend already holds for this sheet (storage eTag and size), {} if
    none; None when the complete list could not be read (then nothing is skipped, and nothing is ever removed): a page
    that fails, an answer that is not a list, or a page that repeats a name already seen (a server ignoring `offset`).
    So a photo is only ever removed when it is absent from the whole list, never from a first page alone."""
    out, offset = {}, 0
    while True:
        try:
            objs = http("POST", f"{cfg['url']}/storage/v1/object/list/sheets", hdr(cfg),
                        {"prefix": f"{cfg['user_id']}/{slug}/img", "limit": LIST_PAGE, "offset": offset,
                         "sortBy": {"column": "name", "order": "asc"}}, tolerate=(400, 404))
        except RbHTTPError:
            return None
        if objs is None: objs = []
        if not isinstance(objs, list): return None
        for o in objs:
            if not isinstance(o, dict) or not o.get("name"): continue
            if o["name"] in out: return None
            md = o.get("metadata") or {}
            size = md.get("size")
            out[o["name"]] = (str(md.get("eTag") or "").strip('"').lower(), size if isinstance(size, int) else 0)
        if len(objs) < LIST_PAGE: return out
        offset += len(objs)

def _remove_files(cfg, paths):
    """Best effort: the photos a refused publish had just added, so that they do not fill the quota for nothing. Never
    stops the run: any failure (an HTTP status, the network, a bad answer) is reported and the caller goes on, so that
    _quota_stop() still flags the request as error."""
    if not paths: return
    try:
        http("DELETE", f"{cfg['url']}/storage/v1/object/sheets", hdr(cfg), {"prefixes": paths}, tolerate=range(300, 600))
        print(f"rb: removed the {len(paths)} photo(s) this publish had added", file=sys.stderr)
    except (Exception, SystemExit) as e:
        why = f"{e.code}: {e.body}" if isinstance(e, RbHTTPError) else type(e).__name__ + (f": {e}" if str(e) else "")
        print(f"rb: could not remove the photo(s) this publish had added ({why}): {', '.join(paths)}", file=sys.stderr)

def quota_message(limit):
    """What the user reads when a limit refuses a publish: which limit, what to do, how to ask for more."""
    what = ("The count starts again at midnight UTC." if limit.endswith("per day") else
            "Delete sheets you no longer need (`rb.py delete <slug>`) to make room.")
    return (f"quota reached on this backend: {limit} for this account. {what} For a higher limit, ask whoever runs this "
            "backend (the hosted one: open an issue at https://github.com/lt20/reelbook/issues). On your own Supabase "
            "project, lift it with one insert: see « Limits on a shared backend » in the README.")

def _quota_stop(cfg, limit, added=()):
    _remove_files(cfg, list(added))
    msg = quota_message(limit)
    if REQUEST_ID:
        _error_request(cfg, REQUEST_ID, msg)
    die(msg)

def _publish_sheet(cfg, d, meta, q=None):
    """`q`: the account's quota (_my_quota), read by the caller just before; None skips the checks made beforehand."""
    slug = meta["slug"]
    img_d = d / "img"
    files = [f for f in sorted(img_d.iterdir()) if f.suffix.lower() in IMG_EXT] if img_d.is_dir() else []
    n = len(files)
    # A photo the backend already holds, byte for byte (same MD5 as its eTag), is not sent again: a republish with the
    # same photos writes nothing to storage, so a full photo quota never blocks it.
    remote = _remote_images(cfg, slug) if files else {}
    known = remote or {}
    todo = []
    for f in files:
        data = f.read_bytes()
        if known.get(f.name, ("", 0))[0] != hashlib.md5(data).hexdigest(): todo.append((f, data))
    # Quotas (L29), checked before anything is sent: a new sheet past the sheet limit, or photos that would take the
    # account past its photo limit (what they add, minus the old versions they replace), stop here: no photo without a
    # sheet, no sheet left with half of its photos replaced. Only a race (another device at the same time) can still
    # be refused midway by the database.
    if q:
        is_new = not (rest(cfg, "GET", "sheets", params={"select": "slug", "slug": f"eq.{slug}"}) or [])
        if is_new and q["sheets"] >= q["max_sheets"]: _quota_stop(cfg, f"{q['max_sheets']} sheets")
        grow = sum(len(data) - known.get(f.name, ("", 0))[1] for f, data in todo)
        if todo and (_photos_full(q) or q["storage_bytes"] + grow > q["max_storage_mb"] * 1048576):
            _quota_stop(cfg, f"{q['max_storage_mb']} MB of photos")
    # photos this publish adds (not overwrites), removed again if a limit refuses the publish midway; none is ever
    # removed when the list of the photos already there could not be read (remote None)
    added = []
    for f, data in todo:
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        path = f"{cfg['user_id']}/{slug}/img/{f.name}"
        url = f"{cfg['url']}/storage/v1/object/sheets/{path}"
        try:
            http("POST", url, hdr(cfg, {"Content-Type": ctype, "x-upsert": "true"}), data, raw=True, tolerate=(400, 403, 500))
        except RbHTTPError as e:
            limit = _quota_in(e.body) or (_photos_full(_my_quota(cfg)) if e.code in (400, 403) else None)
            if limit: _quota_stop(cfg, limit, added)
            die(f"POST {url} → {e.code}: {e.body}")
        if remote is not None and f.name not in remote: added.append(path)
    row = {"slug": slug, "kind": "sheet", "theme": meta["theme"], "group": meta["group"], "title": meta["title"],
           "summary": meta.get("summary", ""), "duration": meta.get("duration", ""), "thumbnail": meta.get("thumbnail", "img/thumb.jpg"),
           "source": meta.get("source", {}), "html": (d / "index.html").read_text()}
    row["search_text"] = search_text(row["html"])
    if "tags" in meta: row["tags"] = _sheet_tags(meta)   # no tags in meta.json: an update keeps the ones it had
    post = lambda r, tolerate=(): rest(cfg, "POST", "sheets", r, prefer="resolution=merge-duplicates,return=representation",
                                       params={"on_conflict": "user_id,slug"}, tolerate=tolerate)
    while True:
        try:
            out = post(row, (400,))
            break
        except RbHTTPError as e:
            limit = _quota_in(e.body)
            if limit: _quota_stop(cfg, limit, added)
            # a backend not migrated yet (PostgREST PGRST204, unknown column): the sheet still goes out without it
            col = next((c for c in OPTIONAL_COLUMNS if c in row and _no_column(e, c)), None)
            if not col: die(f"POST sheets → {e}")
            print(f"rb: {OPTIONAL_COLUMNS[col]}; {slug} published without it", file=sys.stderr)
            row.pop(col)
    # stderr: a progress line (L14 acceptance test reads the stub's last stdout line); the run still shows it
    print(f"published {slug}: {n} image(s), {len(row.get('search_text') or '')} characters of search text, row {out[0]['id']}", file=sys.stderr)

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
        for k in ITEM_FIELDS:
            v = it.get(k)
            if v is not None and not (isinstance(v, bool) if k == "per_side" else isinstance(v, int) and not isinstance(v, bool) and v >= 0):
                die(f"{where}: bad item {json.dumps(it, ensure_ascii=False)}: {k} must be " + ("true or false" if k == "per_side" else "a whole number >= 0"))
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
    _check_durations(cfg, [(sub / "meta.json", m) for _, sub, m in sheets])
    _check_tags(cfg, [(sub / "meta.json", m) for _, sub, m in sheets])
    # Quotas (L29): all the new sheets of the session must fit before the first one is published, or the session would
    # stop midway and leave sheets without their session in the last free slots.
    q = _my_quota(cfg)
    if q:
        slugs = [m["slug"] for _, _, m in sheets]
        have = {r.get("slug") for r in (rest(cfg, "GET", "sheets", params={"select": "slug", "slug": f"in.({','.join(slugs)})"}) or [])}
        new = sum(1 for s in slugs if s not in have)
        if new and q["sheets"] + new > q["max_sheets"]:
            print(f"rb: this session adds {new} new sheet(s); the account has room for {max(q['max_sheets'] - q['sheets'], 0)}", file=sys.stderr)
            _quota_stop(cfg, f"{q['max_sheets']} sheets")
    for _, sub, m in sheets:          # the sheets first: the session only links to them
        _publish_sheet(cfg, sub, m, _my_quota(cfg))
    th = meta.get("thumbnail", "")
    row = {"slug": meta["slug"], "theme": meta["theme"], "title": meta["title"], "format": meta.get("format", ""),
           "why": meta.get("why", ""), "key_points": meta.get("key_points", []), "source": meta.get("source", {}),
           "origin": "video", "thumbnail": f"{cfg['user_id']}/{th}" if th else "",
           "items": [dict({"slug": it["slug"], "dose": it.get("dose", "")}, **{k: it[k] for k in ITEM_FIELDS if it.get(k) is not None})
                     for it in meta["items"]]}
    out = rest(cfg, "POST", "sessions", row, prefer="resolution=merge-duplicates,return=representation", params={"on_conflict": "user_id,slug"})
    print(f"published session {meta['slug']}: {len(row['items'])} item(s), {len(sheets)} sheet(s), row {out[0]['id']}")
    _drop_v1_sessions(cfg, (meta.get("source") or {}).get("url"))

def cmd_publish(args):
    global REQUEST_ID
    args = list(args)
    if "--request" in args:
        i = args.index("--request")
        if i + 1 >= len(args): die("usage: rb.py publish <dir> [--request <id>]")
        REQUEST_ID = args[i + 1]; del args[i:i + 2]
    if len(args) != 1: die("usage: rb.py publish <dir> [--request <id>]")
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
    _check_durations(cfg, [(meta_p, meta)])
    _check_tags(cfg, [(meta_p, meta)])
    _publish_sheet(cfg, d, meta, _my_quota(cfg))

def cmd_list(args):
    usage = "usage: rb.py list [--since <ISO time, e.g. 2026-11-03T02:00:00Z>]"
    since = None
    if args:
        if len(args) != 2 or args[0] != "--since" or _ts(args[1]) is None: die(usage)
        since = args[1]
    cfg = session()
    sp = {"select": "slug,kind,theme,group,title,added_at", "order": "added_at.asc" if since else "theme,group,title"}
    pp = {"select": "slug,theme,title,items,created_at", "order": "created_at.asc" if since else "theme,title"}
    if since:
        sp["added_at"] = f"gte.{since}"
        pp["created_at"] = f"gte.{since}"
        pp["origin"] = "eq.video"   # published by a run, not a session made in the app meanwhile
    rows = rest(cfg, "GET", "sheets", params=sp) or []
    try:
        ses = rest(cfg, "GET", "sessions", params=pp, tolerate=(404,)) or []
    except RbHTTPError:
        ses = None
    if since and ses:   # a new session's exercise sheets are part of it: the session alone stands for them
        items = {i.get("slug") for r in ses for i in (r.get("items") or []) if isinstance(i, dict)}
        rows = [r for r in rows if r["slug"] not in items]
    # --since is read by nightly.sh: tab-separated, as a group name may hold spaces (and the word « session »)
    line = (lambda *f: "\t".join(str(x).replace("\t", " ") for x in f)) if since else \
        (lambda th, g, k, sl, ti: f"{th:9} {g:20} {k:8} {sl:32} {ti}")
    for r in rows:
        print(line(r['theme'], r['group'], r['kind'], r['slug'], r['title']))
    if ses is None:
        print(NO_SESSIONS + " to enable sessions", file=sys.stderr); return
    for r in ses:   # kind "session2": a v2 session (exercise sheets + order); "session" rows above are v1 pages
        print(line(r['theme'], str(len(r.get('items') or [])) + ' item(s)', 'session2', r['slug'], r['title']))

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
    done = len(todo)
    if todo and not dry:
        try:
            rest(cfg, "POST", "requests", todo, prefer="return=minimal", tolerate=(400,))
        except RbHTTPError as e:
            if not _quota_in(e.body): die(f"POST requests → {e}")
            # the daily link quota (L29) refused the whole batch: queue what fits today, one by one
            done = 0
            for t in todo:
                try:
                    rest(cfg, "POST", "requests", t, prefer="return=minimal", tolerate=(400,))
                except RbHTTPError as e1:
                    if not _quota_in(e1.body): die(f"POST requests → {e1}")
                    print(f"rb: {quota_message(_quota_in(e1.body))} {done} of {len(todo)} queued today: run "
                          "`rb.py requeue-sessions` again tomorrow for the rest (it skips what is already queued).", file=sys.stderr)
                    break
                done += 1
    print(f"{len(v1)} v1 session(s), {done} request(s) {'to insert (dry run, nothing written)' if dry else 'inserted'}")

def _ts(v):
    """A PostgREST timestamp (« …+00:00 » or « …Z ») as epoch seconds; None when absent or unreadable."""
    if not v: return None
    import datetime, re
    s = str(v).replace("Z", "+00:00")
    # Postgres drops trailing zeros (« .12345 »); fromisoformat wants 3 or 6 digits before Python 3.11
    s = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6], s, count=1)
    try:
        return datetime.datetime.fromisoformat(s).timestamp()
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
    rows = rest(cfg, "GET", "requests", params={"status": "eq.processing", "select": "id,url,note,processed_at,created_at", "order": "created_at.asc"}) or []
    limit, n = time.time() - hours * 3600, 0
    for r in rows:
        since = _ts(r.get("processed_at")) or _ts(r.get("created_at"))
        if since is not None and since > limit:
            print(f"keep {r['id']}: processing for less than {hours:g} h", file=sys.stderr); continue
        stamp = r.get("processed_at") or r.get("created_at") or "?"
        print(f"{'would requeue' if dry else 'requeue'} {r['id']}: {r['url']} (processing since {stamp})")
        n += 1
        if not dry:
            # a correction keeps its « Redo: … » note: it is the instruction the next run applies
            note = str(r.get("note") or "").split("\n")[0]
            if not note.startswith("Redo:"): note = f"requeued after a run stopped mid-way ({str(stamp)[:16]})"
            # status=eq.processing in the filter: a request closed meanwhile is left alone
            rest(cfg, "PATCH", "requests", {"status": "queued", "processed_at": None, "note": note},
                 prefer="return=minimal", params={"id": f"eq.{r['id']}", "status": "eq.processing"})
    print(f"{len(rows)} processing, {n} {'to requeue (dry run, nothing written)' if dry else 'requeued'}")

# ---------------------------------------------------------------------------
# full-text search backfill (once, after the search_text column is added)
# ---------------------------------------------------------------------------

def cmd_backfill_search(args):
    if any(a != "--dry-run" for a in args): die("usage: rb.py backfill-search [--dry-run]")
    dry = "--dry-run" in args
    cfg = session()
    PAGE, last, seen, n = 50, None, 0, 0   # html is heavy: 50 rows a read, keyset on slug (writes do not shift it)
    while True:
        params = {"select": "slug,html,search_text", "user_id": f"eq.{cfg['user_id']}", "search_text": "eq.",
                  "order": "slug", "limit": str(PAGE)}
        if last is not None: params["slug"] = f"gt.{last}"
        try:
            rows = rest(cfg, "GET", "sheets", params=params, tolerate=(400,)) or []
        except RbHTTPError as e:
            if _no_search_column(e): die(NO_SEARCH_TEXT + ", then run this again")
            die(f"GET sheets → {e}")
        for r in rows:
            if (r.get("search_text") or "").strip(): continue   # filled meanwhile, or a server ignoring the filter
            seen += 1
            text = search_text(r.get("html") or "")
            if not text: continue
            n += 1
            print(f"{r['slug']}: {len(text)} characters" + (" (dry run)" if dry else ""))
            if not dry:
                rest(cfg, "PATCH", "sheets", {"search_text": text}, prefer="return=minimal",
                     # search_text=eq.: a sheet republished since the read keeps the text publish wrote
                     params={"slug": f"eq.{r['slug']}", "user_id": f"eq.{cfg['user_id']}", "search_text": "eq."})
        if len(rows) < PAGE: break
        last = rows[-1]["slug"]
    print(f"{seen} sheet(s) without search text, {n} {'to fill (dry run, nothing written)' if dry else 'filled'}")

# ---------------------------------------------------------------------------
# facet backfill (once, after the tags column is added): tags derived without Claude (decision 6)
# ---------------------------------------------------------------------------

def _fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if not unicodedata.combining(c)).lower()

# Keywords on folded text (English, with the French of older sheets). The text of a sheet is its title, its library
# group, its slug (an exercise of a session carries the session's: `session-dos-2-halteres-shrugs`) and its search text.
# - zone: a body area named in the title, else a movement of the title (« pompes » → chest), else the group when the
#   whole group name is body areas (« Ankles & feet »; « Kicks & knees » is a family of techniques), else the slug;
#   none at all in a `technique` or `partner` notebook (a kick is not a knee exercise, a foil tack not an ankle one).
# - gear: from the title, slug and search text.
# - type: the keyword met first in the title, group and slug; else the notebook's profile (TYPE_BY_PROFILE); else the
#   keyword met first in the search text; else the notebook (TYPE_BY_NOTEBOOK); else empty.
ZONE_WORDS = {"shoulders": r"shoulders?|epaules?", "arms": r"arms?|bras|biceps|triceps", "chest": r"chest|pecs?|pectoraux",
              "back": r"back|spine|dos", "core": r"core|abs|abdos?|abdominaux", "hips": r"hips?|glutes?|hanches?|fessiers?",
              "legs": r"legs?|jambes?", "knees": r"knees?|genoux?", "ankles": r"ankles?|feet|chevilles?|pieds?",
              "neck": r"neck|nuque|cou", "full body": r"full[- ]body|corps entier"}
# Movements that name a zone only when the title names no body area (« pompe triceps » works the arms).
ZONE_MOVES = {"chest": r"pompes?|push[- ]?ups?"}
GEAR_WORDS = {"mat": r"mats?|tapis", "band": r"bands?|elastiques?", "dumbbell": r"dumbbells?|halteres?",
              "kettlebell": r"kettlebells?", "barbell": r"barbells?", "bar": r"pull[- ]?up bar|bar|barre fixe",
              "rings": r"rings|anneaux", "ball": r"balls?|ballon", "foam roller": r"foam roll\w*|rouleau",
              "chair": r"chairs?|chaise", "wall": r"walls?|mur", "board": r"boards?", "kite": r"kites?",
              "plate": r"plates?|disques?|discs?", "cable": r"cables?|poulies?|pulleys?", "machine": r"machines?|smith",
              "bench": r"bench(?:es)?|bancs?"}
GEAR_NONE = (r"no equipment|without (?:any )?equipment|equipment[- ]free|no gear|bodyweight|body weight"
             r"|sans (?:aucun )?(?:materiel|equipement)|poids du corps")
TYPE_WORDS = {"strength": r"strength\w*|renforcement|musculation", "mobility": r"mobility|mobilite", "stretch": r"stretch\w*|etirements?",
              "cardio": r"cardio\w*|hiit", "skill": r"skills?", "drill": r"drills?|educatifs?",
              "warm-up": r"warm[- ]?ups?|echauffement", "routine": r"routines?"}
NO_ZONE_PROFILES = ("technique", "partner")
TYPE_BY_PROFILE = {"technique": "skill", "partner": "skill"}
TYPE_BY_NOTEBOOK = {"strength": "strength", "yoga": "stretch"}

def _words(text, table):
    """{value: position of its first keyword in text} for the values of `table` met in text."""
    out = {}
    for value, pat in table.items():
        m = re.search(rf"(?<![\w-])(?:{pat})(?![\w-])", text)
        if m: out[value] = m.start()
    return out

def _group_zones(group):
    """The zones of a library group whose whole name is body areas (« Ankles & feet »), else none (« Kicks & knees »)."""
    found = _words(group, ZONE_WORDS)
    rest = re.sub(rf"(?<![\w-])(?:{'|'.join(ZONE_WORDS.values())})(?![\w-])", " ", group)
    return found if found and not re.sub(r"\b(?:and|et)\b|[&,/+\s]", "", rest) else {}

def derive_tags(row, vocab=None, profiles=None):
    """The tags of a published sheet from what it already holds: notebook, group, title, slug, search text, duration.
    Values outside the vocabulary of app/config.js are dropped (a vocabulary change never writes an unknown value).
    `profiles` is {notebook id: profile} (library_profiles(); a notebook it does not know is 'gym')."""
    vocab = facets_vocab() if vocab is None else vocab
    profiles = library_profiles() if profiles is None else profiles
    ok = lambda k, v: not vocab.get(k) or v in vocab[k]
    theme = row.get("theme") or ""
    profile = profiles.get(theme, "gym")
    # hyphens read as spaces: « Pompe-triceps » names the triceps, a slug is words joined by hyphens
    group, title, text, slug = (_fold(row.get(k)).replace("-", " ") for k in ("group", "title", "search_text", "slug"))
    zones = {}
    if profile not in NO_ZONE_PROFILES:
        zones = _words(title, ZONE_WORDS) or _words(title, ZONE_MOVES) or _group_zones(group) or _words(slug, ZONE_WORDS)
    # a title that says « without equipment » beats the kit of its session's slug (« Shrugs sans matériel »)
    if not _words(title, GEAR_WORDS) and re.search(GEAR_NONE, title): gear = ["none"]
    else:
        found = _words(title + " \n " + slug + " \n " + text, GEAR_WORDS)
        gear = [g for g in GEAR_WORDS if g in found]
        if not gear and re.search(GEAR_NONE, slug + " \n " + text): gear = ["none"]
    first = lambda d: min(d, key=d.get) if d else ""
    kind = (first(_words(title + " \n " + group + " \n " + slug, TYPE_WORDS)) or TYPE_BY_PROFILE.get(profile)
            or first(_words(text, TYPE_WORDS)) or TYPE_BY_NOTEBOOK.get(theme, ""))
    return {"zone": [z for z in ZONE_WORDS if z in zones and ok("zone", z)], "gear": [g for g in gear if ok("gear", g)],
            "minutes": _minutes(row.get("duration")), "type": kind if kind and ok("type", kind) else ""}

def cmd_backfill_tags(args):
    if any(a != "--dry-run" for a in args): die("usage: rb.py backfill-tags [--dry-run]")
    dry = "--dry-run" in args
    cfg = session()
    vocab, profiles = facets_vocab(), library_profiles()
    cols = ["slug", "theme", '"group"', "title", "duration", "search_text", "tags"]
    PAGE, last, seen, n = 200, None, 0, 0   # keyset on slug (writes do not shift it)
    while True:
        params = {"select": ",".join(cols), "user_id": f"eq.{cfg['user_id']}", "tags": "eq.{}", "order": "slug", "limit": str(PAGE)}
        if last is not None: params["slug"] = f"gt.{last}"
        try:
            rows = rest(cfg, "GET", "sheets", params=params, tolerate=(400,)) or []
        except RbHTTPError as e:
            if _no_column(e, "tags"): die(NO_TAGS + ", then run this again")
            if _no_column(e, "search_text") and "search_text" in cols: cols.remove("search_text"); continue
            die(f"GET sheets → {e}")
        for r in rows:
            if r.get("tags"): continue   # tagged meanwhile, or a server ignoring the filter
            seen += 1
            tags = derive_tags(r, vocab, profiles)
            if not (tags["zone"] or tags["gear"] or tags["type"] or tags["minutes"] is not None): continue
            n += 1
            print(f"{r['slug']}: {json.dumps(tags, ensure_ascii=False)}" + (" (dry run)" if dry else ""))
            if not dry:
                rest(cfg, "PATCH", "sheets", {"tags": tags}, prefer="return=minimal",
                     # tags=eq.{}: a sheet republished since the read keeps the tags publish wrote
                     params={"slug": f"eq.{r['slug']}", "user_id": f"eq.{cfg['user_id']}", "tags": "eq.{}"})
        if len(rows) < PAGE: break
        last = rows[-1]["slug"]
    print(f"{seen} sheet(s) without tags, {n} {'to tag (dry run, nothing written)' if dry else 'tagged'}")

COMMANDS = {"login": cmd_login, "whoami": cmd_whoami, "themes": cmd_themes, "queue": cmd_queue, "claim": cmd_claim, "publish": cmd_publish,
            "done": cmd_done, "error": cmd_error, "list": cmd_list, "delete": cmd_delete,
            "requeue-sessions": cmd_requeue_sessions, "requeue-stuck": cmd_requeue_stuck,
            "backfill-search": cmd_backfill_search, "backfill-tags": cmd_backfill_tags}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](sys.argv[2:])
