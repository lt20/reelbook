#!/usr/bin/env python3
"""rb.py — Reelbook command line, used by the reelbook skill. Standard library only.

    rb.py login [--url U --key K]   sign in (email + password; URL and anon key asked unless given) and keep a session
    rb.py whoami                show the signed-in account and backend
    rb.py themes                list the account's notebooks (id, title, description, groups, profile), JSON lines;
                                profile (gym | technique | partner) picks the sheet template: read from the library
                                of app/config.js by id, "gym" for a custom notebook
    rb.py library               list the built-in notebooks of app/config.js not on this account yet, JSON lines
    rb.py add-theme <library id>
    rb.py add-theme --title T --description D
                                add a notebook to the account and print its line (as `rb.py themes` does): a built-in
                                one by id, or a custom one (id custom-<slug>, description of 30 characters or more,
                                as in the app). Already there: prints it, adds nothing
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
    rb.py error <id> [--reason R] --note T
                                flag a request that could not be processed (a « Redo: » note keeps its first
                                line, T goes after it: Retry in the app queues the correction again). R says who
                                can act (requests.reason, P8 R3): signin_required, quota, needs_computer, private,
                                removed, restricted, not_video, fetch_blocked, processing_failed, daily_cap, other.
                                A reason the computer retries (fetch_blocked, processing_failed, daily_cap) puts the
                                request back in the queue once; failing again, it is an error with reason « other ».
                                A backend without the column: the error is written without a reason
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
    rb.py glossary get <theme>  print the glossary of a notebook (P11) as JSON, {"notebook", "terms": [...]}: the shape
                                of a glossary pass's output. A backend without the table: an empty glossary
    rb.py glossary sheets <theme> [--pending]
                                print what the glossary pass reads, as JSON: the notebook (id, title, description,
                                family) and each of its sheets (slug, title, html, photos: the file names under img/).
                                Sessions are not sheets: left out. A backend without the table: says so in
                                one line (re-run supabase/schema.sql) and exits 1, so that no pass is run.
                                --pending: only the sheets that need the pass (never read by it, or published again
                                since: table glossary_passes), each with its updated_at (what "passed" gives back
                                to `put`), and with them "glossary", the notebook's current
                                entries in short (term, sense, forms, definition). A backend that does not record
                                the passes yet: every sheet needs it
    rb.py glossary pending      one line per notebook of the technique family that has sheets needing the pass,
                                `<theme> <count>`; nothing when there is none. The family is the account's choice
                                (user_themes.family), else the built-in default of app/config.js, else repetition.
                                A backend that does not record the passes yet: every sheet counts; one without
                                the glossary table: says so in one line and exits 1
    rb.py glossary put <theme> <file.json> [--replace]
                                write the entries of a glossary pass's output. Checked before any write, all problems
                                reported at once and nothing written when there is one: the notebook is the account's;
                                each entry has term, definition, non-empty forms, confidence (sure | unsure), doubt only
                                with unsure; no two entries with the same term and sense; each item of sheets names a
                                sheet of this notebook, its quote is found in that sheet's text (tags removed,
                                whitespace collapsed, case ignored; alt texts count) and holds one of the forms, its
                                where is text | title | caption | chip; photo names a sheet of this notebook.
                                An entry that exists (same term and sense, case ignored) keeps its definition, doubt
                                and photo, gets the file's forms it did not have (case ignored, its own first) and
                                the new items of sheets (an item for a slug already listed replaces it); every quote
                                of the result, kept or new, must hold one of these forms, else nothing is written.
                                --replace overwrites the whole entry. A new entry is inserted; no entry is ever
                                deleted (an entry can lose a sheet the pass read again: see "passed" below). An
                                entry another command wrote meanwhile is read and merged again (3 times
                                at most, then an error that says what was written). Prints one line: inserted,
                                updated, unchanged. A backend without the table: says so in one line, exits 1.
                                The file may carry "passed": [{"slug": "…", "updated_at": "…"}, ...], the sheets the
                                pass read, those where it found no word included, each with the updated_at that
                                `sheets --pending` printed with its text. Checked with the rest, before any write:
                                the slug is a sheet of this notebook, the date is a full date-time with its time
                                zone (2026-02-01T23:30:00+00:00 or …Z; not a date alone, not a time without a zone)
                                and is not a later instant than the sheet's. Once the entries are written, the
                                sheets read are reconciled: the file is taken as ALL the entries that still apply to
                                each sheet of "passed", so every entry of the notebook, in the file or not, that
                                listed such a sheet and that the file does not give again for it loses that item of
                                sheets. Its items for the other sheets never move, and an entry left without any
                                sheet stays, with sheets empty. A sheet published again since the date given is not
                                reconciled: it still needs the pass, which will do it on the new text. The sheets'
                                dates are read again just before each try of the reconciliation and just before the
                                sheets are recorded: a sheet published again while this command ran is neither
                                reconciled nor recorded as read, and the first line then ends with how many. That
                                check and the write after it are two calls, not one operation: a sheet published
                                again exactly between them can still lose an association, which the next pass of
                                that sheet, then waiting, gives back (it is not waiting only if another pass also
                                read and recorded the new text within that same gap). Same
                                conditional write and same tries as the entries, so two commands at once do not undo
                                each other; the first line then ends with how many associations were removed (when
                                there are some). If it fails: exit 1, what was written is said, no sheet is
                                recorded. Then each sheet gets its row in glossary_passes with
                                that date (a row never moves back to an earlier one), and a second line says how
                                many: a sheet published again while the pass ran still needs it afterwards. A plain
                                "<slug>" (a manual call) records the sheet's current updated_at. A backend that
                                does not record the passes yet: the entries are written, one
                                line says the passes are not recorded, exit 0. Without "passed": nothing is
                                recorded and no association is removed (the file only adds)

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
    prompt = lambda label, shown: f"{label} [{shown}] (press Enter to keep it): " if shown else f"{label}: "
    ask = lambda label, cur: (input(prompt(label, cur)).strip() or cur) if sys.stdin.isatty() else cur
    url = env["url"] or ask("Supabase project URL", old.get("url", ""))
    key = env["anon_key"] or (old.get("anon_key", "") if not sys.stdin.isatty() else (input(prompt("Anon key", "keep current" if old.get("anon_key") else "")).strip() or old.get("anon_key", "")))
    email = env["email"] or ask("Email", old.get("email", ""))
    pwd = env["password"] or getpass.getpass("Password of your Reelbook account (hidden as you type): ")
    if not (url and key and email and pwd):
        die("project URL, anon key, email and password are all needed")
    url = url.rstrip("/")
    tok = password_grant(url, key, email, pwd)
    cfg = {"url": url, "anon_key": key, "email": email, "user_id": tok["user"]["id"],
           "access_token": tok["access_token"], "refresh_token": tok["refresh_token"], "expires_at": int(time.time()) + tok.get("expires_in", 3600)}
    save_cfg(cfg)
    print(f"Signed in as {email} (Reelbook hosted)." if is_hosted(url) else f"Signed in as {email} on your own Supabase: {url}")
    mark_cli_login(url, key, cfg["access_token"])

def password_grant(url, key, email, pwd):
    """L42a: Supabase's own password grant first. Only when that project answers `captcha_failed` (Turnstile on, as on
    the hosted backend) does rb.py ask the project's cli-login Edge Function, which makes the same grant server side:
    a backend without a captcha never depends on that function."""
    creds = {"email": email, "password": pwd}
    try:
        return http("POST", f"{url}/auth/v1/token?grant_type=password", {"apikey": key}, creds, tolerate=(400,))
    except RbHTTPError as e:
        if "captcha_failed" not in e.body:
            die(f"POST {url}/auth/v1/token → {e.code}: {e.body}")
    try:
        return http("POST", f"{url}/functions/v1/cli-login", {"apikey": key}, creds, tolerate=(400, 401, 403, 404, 413, 415, 429, 500, 502, 503))
    except RbHTTPError as e:
        if e.code == 404:
            die("this backend asks a captcha to sign in, and its cli-login function is not deployed "
                "(supabase/functions/cli-login: supabase functions deploy cli-login --no-verify-jwt)")
        try:
            msg = json.loads(e.body).get("message")
        except (ValueError, AttributeError):
            msg = None
        die(msg or f"POST {url}/functions/v1/cli-login → {e.code}: {e.body}")

def mark_cli_login(url, key, token):
    """L43: tells the app a computer is linked (reelbook_cli_at in user_metadata, read by #welcome). Best effort, in
    silence: whatever goes wrong here, the login has already succeeded."""
    data = json.dumps({"data": {"reelbook_cli_at": now()}}).encode()
    req = urllib.request.Request(f"{url}/auth/v1/user", method="PUT", data=data,
                                 headers={"apikey": key, "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10): pass
    except urllib.error.HTTPError as e: e.close()
    except Exception: pass

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
    where = ", Reelbook hosted" if is_hosted(cfg["url"]) else f" on your own Supabase: {cfg['url']}"
    print(f"{cfg['email']} ({cfg['user_id']}){where}")

def hosted_url(path=None):
    """The url of the hosted backend: REELBOOK_HOSTED_URL (the installer sets it from the published config.js), else
    the `hosted: { url: ... }` of the repository's app/config.js, read as text; "" when neither gives one."""
    env = os.environ.get("REELBOOK_HOSTED_URL", "").strip()
    if env:
        return env.rstrip("/")
    try:
        src = pathlib.Path(path or LIBRARY_JS).read_text(encoding="utf-8")
    except OSError:
        return ""
    src = re.sub(r"(?m)(^|\s)//.*$", "", src)  # line comments out, never the `//` of 'https://'
    block = re.search(r"(?:^|[{,\s])hosted:\s*\{([^}]*)\}", src)
    url = block and re.search(r"(?:^|[{,\s])url:\s*['\"]([^'\"]*)['\"]", block.group(1))
    return url.group(1).rstrip("/") if url else ""

def is_hosted(url):
    """True on the hosted backend: its users never chose a Supabase project, so its url means nothing to them."""
    hosted = hosted_url()
    return bool(hosted) and url.rstrip("/") == hosted

# ---------------------------------------------------------------------------
# requests
# ---------------------------------------------------------------------------

LIBRARY_JS = pathlib.Path(__file__).resolve().parent.parent / "app" / "config.js"
PROFILES = ("gym", "technique", "partner")

def library_notebooks(path=None):
    """{id: {title, sub, groups, profile}} of the built-in notebooks of app/config.js; {} when the file cannot be read."""
    try:
        src = pathlib.Path(path or LIBRARY_JS).read_text(encoding="utf-8")
    except OSError:
        return {}
    out = {}
    for m in re.finditer(r"\{\s*id:\s*'([^']+)'([^{}]*)\}", src):
        text = lambda key: (re.search(rf"\b{key}:\s*'([^']*)'", m.group(2)) or (None, ""))[1]
        groups = re.search(r"\bgroups:\s*\[([^\]]*)\]", m.group(2))
        out[m.group(1)] = {"title": text("title"), "sub": text("sub"), "groups": re.findall(r"'([^']*)'", groups.group(1)) if groups else [],
                           "profile": text("profile") if text("profile") in PROFILES else "gym"}
    return out

def library_profiles(path=None):
    """{notebook id: profile}. A user_themes row has no profile column: the library is the only place it is written (L16)."""
    return {i: n["profile"] for i, n in library_notebooks(path).items()}

def cmd_themes(args):
    cfg = session()
    rows = rest(cfg, "GET", "user_themes", params={"select": "id,title,description,groups,builtin", "order": "position.asc,title.asc"})
    profiles = library_profiles()
    for r in rows or []:
        r["profile"] = profiles.get(r.get("id"), "gym")
        print(json.dumps(r, ensure_ascii=False))
    if not rows:
        print("no notebook yet: open the app once, it creates the default ones", file=sys.stderr)

def cmd_library(args):
    on = _known_themes(session())
    for i, n in library_notebooks().items():
        if i not in on:
            print(json.dumps({"id": i, "title": n["title"], "description": n["sub"], "groups": n["groups"], "profile": n["profile"]}, ensure_ascii=False))

def _slugify(s):
    """Same as slugify in app/index.html: a notebook named twice, here or in the app, gets the same id."""
    s = "".join(c for c in unicodedata.normalize("NFD", s.lower()) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40]

def cmd_add_theme(args):
    usage = "usage: rb.py add-theme <library id> | rb.py add-theme --title <name> --description <what goes in it>"
    if not args: die(usage)
    lib, row = library_notebooks(), None
    if args[0].startswith("--"):
        opt = dict(zip(args[0::2], args[1::2]))
        title, description = opt.get("--title", "").strip(), opt.get("--description", "").strip()
        if not title or set(opt) != {"--title", "--description"}: die(usage)
        if len(description) < 30: die("the description needs at least 30 characters: say what belongs in this notebook")
        for i, n in lib.items():
            if _slugify(title) in (i, _slugify(n["title"])): die(f"'{title}' is a built-in notebook: rb.py add-theme {i}")
        row = {"id": "custom-" + (_slugify(title) or format(int(time.time()), "x")), "title": title, "description": description, "groups": [], "builtin": False}
    elif args[0] in lib:
        n = lib[args[0]]
        row = {"id": args[0], "title": n["title"], "groups": n["groups"], "builtin": True}
    else:
        die(f"'{args[0]}' is not a built-in notebook ({', '.join(sorted(lib))}); a notebook of your own: --title and --description")
    cfg = session()
    fields = "id,title,description,groups,builtin"
    rows = rest(cfg, "GET", "user_themes", params={"select": fields + ",position"}) or []
    # the app seeds the default notebooks only on an account that has none: a first row written here would cancel them
    if not rows: die("no notebook yet: open the app once, it creates the default ones")
    same = [r for r in rows if r["id"] == row["id"]]
    if same:
        print(f"notebook '{row['id']}' is already on this account", file=sys.stderr)
        added = same[0]
    else:
        row["position"] = max(r.get("position") or 0 for r in rows) + 1
        added = rest(cfg, "POST", "user_themes", row, prefer="return=representation", params={"select": fields})[0]
    print(json.dumps({**{k: added.get(k) for k in fields.split(",")}, "profile": library_profiles().get(row["id"], "gym")}, ensure_ascii=False))

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
    try:
        rows = rest(cfg, "PATCH", "requests", patch, prefer="return=representation", params=params, tolerate=(400,))
    except RbHTTPError as e:
        # P8 R3: a backend without requests.reason (PostgREST PGRST204, HTTP 400) gets the same write without it
        if "reason" not in patch or not _no_column(e, "reason"): die(f"PATCH requests → {e}")
        patch = {k: v for k, v in patch.items() if k != "reason"}
        if patch.get("status") == "queued": patch.update(status="error", processed_at=now())  # no trace of a first try
        print("rb: this backend has no requests.reason column: the error is written without its reason "
              "(re-run supabase/schema.sql, see docs/own-supabase.md)", file=sys.stderr)
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

# requests.reason (P8 R3, supabase/schema.sql): who can act on a request that failed. The same list as the check of
# the column and as the app (REASONS in app/index.html). The computer tries the RETRY ones again by itself.
REASONS = ("signin_required", "quota", "needs_computer", "private", "removed", "restricted", "not_video",
           "fetch_blocked", "processing_failed", "daily_cap", "other")
RETRY_REASONS = ("fetch_blocked", "processing_failed", "daily_cap")

def _request_before(cfg, rid):
    """The request's note and reason before an error is written; without the reason column (PostgREST 42703, HTTP
    400), its note only: the dict then has no "reason" key."""
    try:
        was = rest(cfg, "GET", "requests", params={"id": f"eq.{rid}", "select": "note,reason"}, tolerate=(400,)) or []
    except RbHTTPError as e:
        if not _no_column(e, "reason"): die(f"GET requests → {e}")
        was = rest(cfg, "GET", "requests", params={"id": f"eq.{rid}", "select": "note"}) or []
    return was[0] if was else {}

def _error_request(cfg, rid, note, reason=None):
    was = _request_before(cfg, rid)
    # a correction keeps its « Redo: … » line first: the app shows the error, and Retry queues the instruction again
    redo = str(was.get("note") or "").split("\n")[0]
    if redo.startswith("Redo:"): note = f"{redo}\n{note}"
    patch = {"status": "error", "note": note, "processed_at": now(), "reason": reason}
    if reason in RETRY_REASONS and "reason" in was:
        if was.get("reason") in RETRY_REASONS:
            patch["reason"] = "other"   # it failed on its second try too: the user sees it (Try again, Report this)
        else:
            # the next run tries it once more: the app shows it as Not started; the reason marks the first try
            patch.update(status="queued", processed_at=None)
    _patch_request(cfg, rid, patch)

def cmd_error(args):
    usage = "usage: rb.py error <id> [--reason <reason>] --note <text>"
    if not args: die(usage)
    rid, opts, reason = args[0], list(args[1:]), None
    if "--reason" in opts:
        i = opts.index("--reason")
        if i + 1 >= len(opts): die(usage)
        reason = opts[i + 1]; del opts[i:i + 2]
        if reason not in REASONS: die(f"unknown reason '{reason}': one of {', '.join(REASONS)}")
    if len(opts) < 2 or opts[0] != "--note": die(usage)
    _error_request(session(), rid, " ".join(opts[1:]), reason)

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
        die(f"{where}: theme '{theme}' is not one of this account's notebooks ({', '.join(sorted(known))}); add it with `rb.py add-theme`, or pick another")

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
        _error_request(cfg, REQUEST_ID, msg, reason="quota")
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

# ---------------------------------------------------------------------------
# glossary (P11 G1): the words of a notebook (table glossary_words, docs/audit-design/P11-glossary.md › Data contract).
# The pass that finds the words reads `glossary sheets` and writes with `glossary put`; the app only reads the table.
# ---------------------------------------------------------------------------

NO_GLOSSARY = "this backend has no glossary yet: re-run supabase/schema.sql (see docs/own-supabase.md)"
GLOSSARY_FIELDS = ("term", "sense", "forms", "kind", "definition", "confidence", "doubt", "spelling", "photo", "related", "sheets")
GLOSSARY_CONFIDENCE = ("sure", "unsure")
GLOSSARY_WHERE = ("text", "title", "caption", "chip")
GLOSSARY_RETRIES = 3   # how many times `put` starts an entry again when another command wrote it meanwhile
GLOSSARY_USAGE = ("usage: rb.py glossary get <theme>\n       rb.py glossary sheets <theme> [--pending]\n"
                  "       rb.py glossary put <theme> <file.json> [--replace]\n       rb.py glossary pending")
# P11 G2a: which sheets the pass has read (table glossary_passes; a backend may have glossary_words and not this one yet)
NO_PASSES = "this backend does not record which sheets the glossary pass has read: passes not recorded (re-run supabase/schema.sql, see docs/own-supabase.md)"
GLOSSARY_SHORT = ("term", "sense", "forms", "definition")   # an entry as the pass reads the glossary it adds to

class _SheetText(HTMLParser):
    """A sheet's text as a quote of the glossary is looked for: tags removed, in the order of the page, a block
    boundary is a space, the alt text of each photo included (a quote may be a caption). Also the photos' file names."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.photos, self.stack = [], [], []   # stack: (tag, skipped)
    def _skipped(self):
        return bool(self.stack) and self.stack[-1][1]
    def handle_starttag(self, tag, attrs):
        if tag not in _INLINE_TAGS: self.parts.append(" ")
        if tag == "img" and not self._skipped():
            a = dict(attrs)
            if a.get("alt"): self.parts.append(a["alt"] + " ")
            name = (a.get("src") or "")[4:] if (a.get("src") or "").startswith("img/") else ""
            if name and name not in self.photos: self.photos.append(name)
        if tag in _VOID_TAGS: return
        self.stack.append((tag, tag in _SKIP_TAGS or self._skipped()))
    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):   # tolerant of unclosed tags
            if self.stack[i][0] == tag: del self.stack[i:]; break
        if tag not in _INLINE_TAGS: self.parts.append(" ")
    def handle_data(self, data):
        if not self._skipped(): self.parts.append(data)

def _squash(s):
    """Whitespace collapsed, case ignored: how a quote, a form and a sheet's text are compared."""
    return re.sub(r"\s+", " ", s).strip().lower()

def _sheet_text(html):
    """(text, photo file names) of a sheet's HTML; the text is ready to compare (_squash)."""
    p = _SheetText()
    p.feed(html or ""); p.close()
    return _squash("".join(p.parts)), p.photos

def library_families(path=None):
    """{notebook id: family} of the built-in notebooks of app/config.js (the default of user_themes.family, P8 R14)."""
    try:
        src = pathlib.Path(path or LIBRARY_JS).read_text(encoding="utf-8")
    except OSError:
        return {}
    return {m.group(1): m.group(2) for m in re.finditer(r"\{\s*id:\s*'([^']+)'[^{}]*?\bfamily:\s*'(repetition|technique)'", src)}

def _glossary_rows(cfg, theme):
    """The entries of a notebook, as stored (with their id and updated_at: what a conditional update of `put` names);
    None on a backend without the table."""
    out, last = [], None
    while True:
        params = {"select": "id,updated_at," + ",".join(GLOSSARY_FIELDS), "user_id": f"eq.{cfg['user_id']}", "theme": f"eq.{theme}",
                  "order": "id", "limit": str(LIST_PAGE)}
        if last is not None: params["id"] = f"gt.{last}"
        try:
            rows = rest(cfg, "GET", "glossary_words", params=params, tolerate=(404,)) or []
        except RbHTTPError:
            return None
        out += rows
        if len(rows) < LIST_PAGE: return out
        last = rows[-1]["id"]

def _glossary_notebook(cfg, theme):
    """{id, title, description, family} of a notebook of the account, None when it is not one. A built-in notebook
    takes what its row leaves empty from the library of app/config.js; no family chosen: the library's, else repetition."""
    params = {"select": "id,title,description,family", "id": f"eq.{theme}"}
    try:
        rows = rest(cfg, "GET", "user_themes", params=params, tolerate=(400,)) or []
    except RbHTTPError as e:
        if not _no_column(e, "family"): die(f"GET user_themes → {e}")
        rows = rest(cfg, "GET", "user_themes", params=dict(params, select="id,title,description")) or []   # before P8 R14
    row = next((r for r in rows if r.get("id") == theme), None)
    if row is None: return None
    lib = library_notebooks().get(theme, {})
    return {"id": theme, "title": row.get("title") or lib.get("title", ""), "description": row.get("description") or lib.get("sub", ""),
            "family": row.get("family") or library_families().get(theme, "repetition")}

def _glossary_sheets(cfg, theme):
    """The sheets of a notebook (slug, title, html, updated_at), by slug. Sessions are not sheets: left out."""
    PAGE, out, last = 50, [], None   # html is heavy: 50 rows a read, keyset on slug
    while True:
        params = {"select": "slug,title,html,updated_at", "user_id": f"eq.{cfg['user_id']}", "theme": f"eq.{theme}", "kind": "eq.sheet",
                  "order": "slug", "limit": str(PAGE)}
        if last is not None: params["slug"] = f"gt.{last}"
        rows = rest(cfg, "GET", "sheets", params=params) or []
        out += rows
        if len(rows) < PAGE: return out
        last = rows[-1]["slug"]

def _glossary_key(e):
    return (e["term"].strip().lower(), (e.get("sense") or "").strip().lower())

def _glossary_get(theme):
    cfg = session()
    rows = _glossary_rows(cfg, theme) or []   # no table: an empty glossary, no error
    # the order of the pass's output: by how many sheets use the entry, then alphabetically
    rows.sort(key=lambda r: (-len(r.get("sheets") or []), _glossary_key(r)))
    print(json.dumps({"notebook": theme, "terms": [{k: r.get(k) for k in GLOSSARY_FIELDS} for r in rows]}, ensure_ascii=False, indent=2))

def _glossary_sheet_out(r):
    """A sheet as `glossary sheets` prints it."""
    return {"slug": r["slug"], "title": r.get("title") or "", "html": r.get("html") or "", "photos": _sheet_text(r.get("html"))[1]}

def _glossary_dump(theme):
    cfg = session()
    if _glossary_rows(cfg, theme) is None: die(NO_GLOSSARY)   # exit 1: the caller stops before running a pass
    nb = _glossary_notebook(cfg, theme)
    if nb is None: die(f"'{theme}' is not one of this account's notebooks (see `rb.py themes`)")
    sheets = [_glossary_sheet_out(r) for r in _glossary_sheets(cfg, theme)]
    print(json.dumps({"notebook": nb, "sheets": sheets}, ensure_ascii=False, indent=2))

# P11 G2a: which sheets still need the pass. glossary_passes has one row per sheet the pass has read, with the sheet's
# updated_at at that time (docs/audit-design/P11-glossary.md › Data contract › Which sheets had the pass).

def _glossary_passes(cfg, theme):
    """{sheet slug: sheet_updated_at} of the sheets of a notebook the pass has read; None on a backend without the table."""
    out, last = {}, None
    while True:
        params = {"select": "slug,sheet_updated_at", "user_id": f"eq.{cfg['user_id']}", "theme": f"eq.{theme}", "order": "slug", "limit": str(LIST_PAGE)}
        if last is not None: params["slug"] = f"gt.{last}"
        try:
            rows = rest(cfg, "GET", "glossary_passes", params=params, tolerate=(404,)) or []
        except RbHTTPError:
            return None
        out.update((r["slug"], r.get("sheet_updated_at")) for r in rows)
        if len(rows) < LIST_PAGE: return out
        last = rows[-1]["slug"]

def _needs_pass(updated_at, read_at):
    """A sheet needs the pass when it has no row (read_at None), or when it was published again since: its updated_at is
    later than the one the pass read. A date that cannot be read counts as later: read once more rather than never."""
    if read_at is None: return True
    now_, then = _ts(updated_at), _ts(read_at)
    return now_ is None or then is None or now_ > then

def _glossary_sheet_dates(cfg, theme):
    """{slug: updated_at} of the sheets of a notebook, without their html. Sessions are not sheets: left out."""
    out, last = {}, None
    while True:
        params = {"select": "slug,updated_at", "user_id": f"eq.{cfg['user_id']}", "theme": f"eq.{theme}", "kind": "eq.sheet",
                  "order": "slug", "limit": str(LIST_PAGE)}
        if last is not None: params["slug"] = f"gt.{last}"
        rows = rest(cfg, "GET", "sheets", params=params) or []
        out.update((r["slug"], r.get("updated_at")) for r in rows)
        if len(rows) < LIST_PAGE: return out
        last = rows[-1]["slug"]

def _glossary_pending_slugs(cfg, theme, passes):
    """The slugs of the sheets of a notebook that need the pass, by slug. passes: what _glossary_passes gave (None on a
    backend without the table: every sheet needs it)."""
    passes = passes or {}
    return sorted(s for s, d in _glossary_sheet_dates(cfg, theme).items() if _needs_pass(d, passes.get(s)))

def _glossary_sheets_named(cfg, theme, slugs, select="slug,title,html,updated_at"):
    """Those sheets of a notebook (slug, title, html, updated_at), by slug: the html of the others is not read."""
    PAGE, out, slugs = 50, [], sorted(slugs)
    for i in range(0, len(slugs), PAGE):
        # quoted as PostgREST reads a list: a slug is free text (a comma or a parenthesis would cut the list)
        names = ",".join('"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"' for s in slugs[i:i + PAGE])
        out += rest(cfg, "GET", "sheets", params={"select": select, "user_id": f"eq.{cfg['user_id']}", "theme": f"eq.{theme}",
                                                  "kind": "eq.sheet", "slug": f"in.({names})", "order": "slug"}) or []
    return out

def _glossary_dump_pending(theme):
    cfg = session()
    have = _glossary_rows(cfg, theme)
    if have is None: die(NO_GLOSSARY)   # exit 1, as `glossary sheets`: no pass is run
    nb = _glossary_notebook(cfg, theme)
    if nb is None: die(f"'{theme}' is not one of this account's notebooks (see `rb.py themes`)")
    slugs = _glossary_pending_slugs(cfg, theme, _glossary_passes(cfg, theme))
    # updated_at: of the html printed with it (one row, one read); the pass gives it back in "passed", so that `put`
    # records the version that was read and not the one it finds
    sheets = [dict(_glossary_sheet_out(r), updated_at=r.get("updated_at")) for r in _glossary_sheets_named(cfg, theme, slugs)]
    have.sort(key=lambda r: (-len(r.get("sheets") or []), _glossary_key(r)))   # the order of `glossary get`
    print(json.dumps({"notebook": nb, "sheets": sheets, "glossary": [{k: r.get(k) for k in GLOSSARY_SHORT} for r in have]}, ensure_ascii=False, indent=2))

def _glossary_technique(cfg):
    """The ids of the account's notebooks of the technique family, in the order of `rb.py themes`. As the app
    (familyOf): the account's choice (user_themes.family), else the default app/config.js gives a built-in notebook,
    else repetition. A backend without the family column: the default, as `glossary sheets` answers."""
    params = {"select": "id,builtin,family", "order": "position.asc,title.asc"}
    try:
        rows = rest(cfg, "GET", "user_themes", params=params, tolerate=(400,)) or []
    except RbHTTPError as e:
        if not _no_column(e, "family"): die(f"GET user_themes → {e}")
        rows = rest(cfg, "GET", "user_themes", params=dict(params, select="id,builtin")) or []   # before P8 R14
    lib = library_families()
    family = lambda r: r.get("family") or (lib.get(r.get("id")) if r.get("builtin") is not False else None) or "repetition"
    return [r["id"] for r in rows if family(r) == "technique"]

def _glossary_pending():
    cfg = session()
    params = {"select": "id", "user_id": f"eq.{cfg['user_id']}", "order": "id", "limit": "1"}
    try:
        rest(cfg, "GET", "glossary_words", params=params, tolerate=(404,))
    except RbHTTPError:
        die(NO_GLOSSARY)   # exit 1, as `glossary sheets`: a pass would have nowhere to write
    recorded = True
    for theme in _glossary_technique(cfg):
        passes = _glossary_passes(cfg, theme) if recorded else None
        if passes is None: recorded = False   # no table: asked once, then every sheet of every notebook needs the pass
        n = len(_glossary_pending_slugs(cfg, theme, passes))
        if n: print(f"{theme} {n}")

def _glossary_record(cfg, theme, dates):
    """Record that the pass read these sheets, {slug: the updated_at of the text it read}. A row never moves back to an
    earlier date: a sheet without a row gets one (an insert that leaves the existing rows alone, one statement); a
    sheet that has one is updated only where the stored date is not later than this one (one conditional update per
    sheet). Two commands at once on a sheet published again between their readings: whichever lands last, the row
    keeps the later date, the one of the latest version a pass read. A backend without the table: one line, nothing
    recorded."""
    # no user_id, as the entries: the column's default (auth.uid()) and RLS own it
    rows = [{"theme": theme, "slug": s, "sheet_updated_at": d, "passed_at": now()} for s, d in dates.items()]
    try:
        new = rest(cfg, "POST", "glossary_passes", rows, prefer="resolution=ignore-duplicates,return=representation",
                   params={"on_conflict": "user_id,theme,slug", "select": "slug"}, tolerate=(404,)) or []
    except RbHTTPError:
        print(f"rb: {NO_PASSES}", file=sys.stderr); return
    inserted = {r.get("slug") for r in new}   # an answer that names none: every sheet goes through the update, same result
    done, kept = 0, 0
    for row in rows:
        if row["slug"] in inserted: done += 1; continue
        # passed_at with it: a sheet read again gets the new time
        params = {"user_id": f"eq.{cfg['user_id']}", "theme": f"eq.{theme}", "slug": f"eq.{row['slug']}",
                  "sheet_updated_at": f"lte.{row['sheet_updated_at']}", "select": "slug"}
        patch = {"sheet_updated_at": row["sheet_updated_at"], "passed_at": row["passed_at"]}
        if rest(cfg, "PATCH", "glossary_passes", patch, prefer="return=representation", params=params): done += 1
        else: kept += 1
    print(f"glossary {theme}: {done} sheet{'' if done == 1 else 's'} recorded as read"
          + (f", {kept} left as recorded (a later version was read meanwhile)" if kept else ""))

PASSED_SHAPE = 'passed must be a list of {"slug": "…", "updated_at": "…"} (or of sheet slugs)'
PASSED_DATE = "a full date-time with its time zone, as `sheets --pending` prints it (2026-02-01T23:30:00+00:00, or …Z)"
# date, T or a space, hh:mm:ss, up to 6 decimals (what a timestamptz keeps), then Z or ±hh:mm / ±hhmm. Matched on the
# whole value: the "-02" that ends a bare date is a day, not an offset
_INSTANT = re.compile(r"(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(?:Z|([+-])(\d\d):?(\d\d))", re.ASCII)

def _instant(v):
    """The instant a date-time names, as an aware UTC datetime; None unless it is written in full with its own time
    zone (PASSED_DATE). A date alone, a time without seconds or a time without a zone name no instant by themselves:
    Postgres would read them in the database's zone, Python in this machine's. Nothing here reads the machine's zone."""
    import datetime
    m = _INSTANT.fullmatch(v) if isinstance(v, str) else None
    if not m: return None
    y, mo, d, h, mi, sec, frac, sign, oh, om = m.groups()
    off = (int(oh) * 60 + int(om)) * (-1 if sign == "-" else 1) if sign else 0
    if sign and (int(om) > 59 or abs(off) > 15 * 60 + 59): return None   # the offsets Postgres takes
    try:
        at = datetime.datetime(int(y), int(mo), int(d), int(h), int(mi), int(sec), int(((frac or "") + "000000")[:6]),
                               tzinfo=datetime.timezone(datetime.timedelta(minutes=off)))
        return at.astimezone(datetime.timezone.utc)
    except (ValueError, OverflowError):
        return None

def _glossary_passed(passed, dates):
    """The file's "passed" as ({slug: the updated_at to record}, problems). An item is {"slug", "updated_at"}: the date
    `sheets --pending` printed with the text the pass read, recorded as given; or a plain slug (a manual call): the
    sheet's current date. dates: {slug: current updated_at} of the notebook's sheets, None when the notebook is not
    the account's (the slugs are then not checked). A sheet listed twice counts once, with its earliest date. Dates
    are compared as instants (UTC), never as strings nor in this machine's zone."""
    if passed is None: return {}, []
    if not isinstance(passed, list): return {}, [PASSED_SHAPE]
    out, problems = {}, []
    for i, p in enumerate(passed):
        slug, given = (p.get("slug"), True) if isinstance(p, dict) else (p, False)
        if not (isinstance(slug, str) and slug): return {}, [PASSED_SHAPE]
        if dates is not None and slug not in dates:
            problems.append(f"passed[{i}]: '{slug}' is not a sheet of this notebook"); continue
        at = p.get("updated_at") if given else (dates or {}).get(slug)
        if given:
            # in full and with its zone: anything less is not the same instant here and in the database
            if _instant(at) is None:
                problems.append(f"passed[{i}]: '{slug}': updated_at {json.dumps(at, ensure_ascii=False)} is not {PASSED_DATE}"); continue
            current = _instant((dates or {}).get(slug))
            if current is not None and _instant(at) > current:
                problems.append(f"passed[{i}]: '{slug}': updated_at {at} is later than the sheet's ({dates[slug]})"); continue
        if slug not in out or _earlier(at, out[slug]): out[slug] = at
    return out, problems

def _earlier(a, b):
    """Is date a an earlier instant than date b? One that names no instant (a plain slug has no date when the notebook
    is not the account's) counts as the earliest."""
    a, b = _instant(a), _instant(b)
    return b is not None and (a is None or a < b)

def _glossary_problems(terms, texts):
    """Every reason not to write `terms`, in plain words. texts: {sheet slug: its text} of the notebook, None when the
    notebook itself is missing (then what names a sheet is not checked)."""
    out, seen = [], {}
    text_or_null = lambda v: v is None or isinstance(v, str)
    for i, e in enumerate(terms):
        if not isinstance(e, dict):
            out.append(f"terms[{i}]: not an object"); continue
        term = e.get("term")
        named = isinstance(term, str) and bool(term.strip())
        bad = lambda msg, at=f"terms[{i}]" + (f" « {term.strip()} »" if named else ""): out.append(f"{at}: {msg}")
        if not named: bad("term is missing")
        if not (isinstance(e.get("definition"), str) and e["definition"].strip()): bad("definition is missing")
        forms = e.get("forms")
        if not (isinstance(forms, list) and forms and all(isinstance(f, str) and f.strip() for f in forms)):
            bad("forms must be a list of at least one string"); forms = []
        if e.get("confidence") not in GLOSSARY_CONFIDENCE: bad(f"confidence must be one of {', '.join(GLOSSARY_CONFIDENCE)}")
        for k in ("sense", "kind", "doubt", "spelling"):
            if not text_or_null(e.get(k)): bad(f"{k} must be a string or null")
        if isinstance(e.get("doubt"), str) and e["doubt"].strip() and e.get("confidence") != "unsure":
            bad("doubt goes only with confidence « unsure »")
        related = e.get("related")
        if related is not None and not (isinstance(related, list) and all(isinstance(r, str) for r in related)):
            bad("related must be a list of strings")
        if named and text_or_null(e.get("sense")):
            key = _glossary_key(e)
            if key in seen: bad(f"same term and sense as terms[{seen[key]}]")
            else: seen[key] = i
        items = e.get("sheets")
        if items is not None and not isinstance(items, list):
            bad("sheets must be a list"); items = []
        for j, it in enumerate(items or []):
            at = f"sheets[{j}]"
            if not isinstance(it, dict):
                bad(f"{at}: not an object"); continue
            slug, quote = it.get("slug"), it.get("quote")
            if it.get("where") not in GLOSSARY_WHERE: bad(f"{at}: where must be one of {', '.join(GLOSSARY_WHERE)}")
            if not (isinstance(quote, str) and _squash(quote)):
                bad(f"{at}: quote is missing"); quote = None
            elif forms and not any(_squash(f) in _squash(quote) for f in forms):
                bad(f"{at}: the quote holds none of the entry's forms")
            if texts is None: continue
            if not isinstance(slug, str) or slug not in texts: bad(f"{at}: '{slug}' is not a sheet of this notebook")
            elif quote and _squash(quote) not in texts[slug]: bad(f"{at}: the quote is not found in the text of sheet '{slug}'")
        photo = e.get("photo")
        if photo is None: continue
        if not (isinstance(photo, dict) and isinstance(photo.get("file"), str) and photo["file"].strip()):
            bad("photo must be null or {slug, file}")
        elif texts is not None and (not isinstance(photo.get("slug"), str) or photo["slug"] not in texts):
            bad(f"photo: '{photo.get('slug')}' is not a sheet of this notebook")
    return out

def _glossary_row(e):
    """One entry of a pass's output as the table stores it (checked before by _glossary_problems)."""
    items = {}
    for it in e.get("sheets") or []:   # one item per sheet: a later one for the same slug replaces it
        items[it["slug"]] = {"slug": it["slug"], "quote": it["quote"], "where": it["where"]}
    photo = e.get("photo")
    if photo:   # the file name under img/, as the app builds the photo's path; `why` is the pass's own note
        file = photo["file"].strip()
        photo = {"slug": photo["slug"], "file": file[4:] if file.startswith("img/") else file}
    clean = lambda v: (v or "").strip() or None
    return {"term": e["term"].strip(), "sense": clean(e.get("sense")), "forms": [f.strip() for f in e["forms"]], "kind": clean(e.get("kind")),
            "definition": e["definition"].strip(), "confidence": e["confidence"], "doubt": clean(e.get("doubt")),
            "spelling": clean(e.get("spelling")), "photo": photo or None, "related": list(e.get("related") or []), "sheets": list(items.values())}

def _glossary_merge(old, row):
    """What `put` without --replace changes in the stored entry `old`, and why it may not: (patch, problems). The forms
    become the stored ones then the file's that are not among them (case ignored); the items of `sheets` are the
    stored ones with the file's (an item for a slug already listed replaces it in place); the rest of the stored
    entry is kept. Every quote of the result, kept or new, must hold one of these forms: checked here, on what
    would be stored."""
    forms, seen = [], set()
    for f in list(old.get("forms") or []) + row["forms"]:
        key = _squash(f) if isinstance(f, str) else ""
        if key and key not in seen:
            seen.add(key); forms.append(f)
    items = {it.get("slug"): it for it in (old.get("sheets") or []) if isinstance(it, dict)}
    mine = {it["slug"]: it for it in row["sheets"]}
    items.update(mine)
    sheets = list(items.values())
    holds = lambda it: isinstance(it.get("quote"), str) and any(k in _squash(it["quote"]) for k in seen)
    problems = [f"« {row['term']} »: the quote {'of' if it.get('slug') in mine else 'already stored for'} sheet '{it.get('slug')}' "
                f"holds none of the forms of the merged entry ({', '.join(forms)})" for it in sheets if not holds(it)]
    patch = {}
    if forms != (old.get("forms") or []): patch["forms"] = forms
    if sheets != (old.get("sheets") or []): patch["sheets"] = sheets
    return patch, problems

def _glossary_plan(rows, have, replace):
    """What writing `rows` (entries as _glossary_row gives them) asks of a glossary that stores `have`:
    (new, changed, same, problems). new: the rows to insert; changed: [(row, stored entry, patch)]; same: how many
    need no write; problems: the merges that would store a quote without any of the entry's forms."""
    known = {_glossary_key(r): r for r in have}
    new, changed, same, problems = [], [], 0, []
    for row in rows:
        old = known.get(_glossary_key(row))
        if old is None:
            new.append(row); continue
        if replace:
            patch = {k: v for k, v in row.items() if old.get(k) != v}
        else:
            patch, bad = _glossary_merge(old, row)
            problems += bad
        if patch: changed.append((row, old, patch))
        else: same += 1
    return new, changed, same, problems

def _glossary_stale(have, given, slugs):
    """What reconciling the sheets read again (`slugs`) asks of a glossary that stores `have`: [(stored entry, its
    `sheets` without the items to drop, how many are dropped)], the entries that lose nothing left out. given:
    {entry key: the slugs the file lists for it}. An item goes when its sheet was read again and the file does not
    give the entry for that sheet; the items for any other sheet stay as they are, in their order."""
    out = []
    for old in have:
        mine = given.get(_glossary_key(old), ())
        items = old.get("sheets") or []
        keep = [it for it in items if not (isinstance(it, dict) and it.get("slug") in slugs and it.get("slug") not in mine)]
        if len(keep) < len(items): out.append((old, keep, len(items) - len(keep)))
    return out

def _glossary_moved(cfg, theme, passed, slugs):
    """Those of `slugs` whose sheet is no longer the text the pass read: its updated_at, read now, is a later instant
    than the date of `passed` ({slug: the date read}), or the sheet is gone. One reading of the dates alone, made just
    before a write that relies on them (Codex pass 2 on #143). The check and the write are two calls, not one
    operation: this narrows the time in which a sheet published again goes unseen, it does not close it."""
    if not slugs: return set()
    now = {r["slug"]: r.get("updated_at") for r in _glossary_sheets_named(cfg, theme, slugs, select="slug,updated_at")}
    return {s for s in slugs if s not in now or _earlier(passed.get(s), now[s])}

def _glossary_reconcile(cfg, theme, given, passed, slugs):
    """Take the sheets read again (`slugs`) off the entries the file does not give for them: (associations removed,
    entries still to change). Each update names the updated_at it read, as the merge of `put` does: one that matches
    no row was overtaken by another command, so the glossary is read again and what is left to drop is worked out on
    that reading (what the other command added for another sheet is kept), GLOSSARY_RETRIES more times at most. No
    entry is deleted: one that loses its last sheet keeps `sheets` empty. At each try, once the glossary is read and
    before the updates, the sheets published again since the date of `passed` are taken out of `slugs` for good
    (_glossary_moved): what another pass listed for their new text is not this command's to remove."""
    slugs, removed, left = set(slugs), 0, 0
    for attempt in range(1 + GLOSSARY_RETRIES):
        have = _glossary_rows(cfg, theme) or []
        slugs -= _glossary_moved(cfg, theme, passed, slugs)
        left = 0
        for old, sheets, n in _glossary_stale(have, given, slugs):
            params = {"id": f"eq.{old['id']}", "user_id": f"eq.{cfg['user_id']}", "updated_at": f"eq.{old.get('updated_at')}", "select": "id"}
            if rest(cfg, "PATCH", "glossary_words", {"sheets": sheets}, prefer="return=representation", params=params): removed += n
            else: left += 1
        if not left: break
    return removed, left

def _glossary_put(theme, file, replace):
    try:
        doc = json.loads(pathlib.Path(file).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        die(f"{file}: cannot be read as JSON ({e})")
    terms = doc.get("terms") if isinstance(doc, dict) else None
    if not isinstance(terms, list): die(f"{file}: expected the output of a glossary pass: {{\"notebook\", \"terms\": [...]}}")
    cfg = session()
    have = _glossary_rows(cfg, theme)
    if have is None: die(NO_GLOSSARY + ", then run this again")
    # Checks before any write, all reported at once.
    problems, texts, dates = [], None, {}
    if theme not in _known_themes(cfg):
        problems.append(f"'{theme}' is not one of this account's notebooks (see `rb.py themes`)")
    else:
        sheets = _glossary_sheets(cfg, theme)
        texts = {r["slug"]: _sheet_text(r.get("html"))[0] for r in sheets}
        dates = {r["slug"]: r.get("updated_at") for r in sheets}   # of the text the quotes are checked against
    if doc.get("notebook") not in (None, theme):
        problems.append(f"the file is the glossary of notebook '{doc.get('notebook')}', not of '{theme}'")
    problems += _glossary_problems(terms, texts)
    # "passed": the sheets the pass read (P11 G2a), those where it found no word included
    passed, bad = _glossary_passed(doc.get("passed"), None if texts is None else dates)
    problems += bad
    if problems:
        for p in problems: print(f"rb: {p}", file=sys.stderr)
        die(f"{file}: {len(problems)} problem(s), nothing written")
    # A new entry is inserted; one that exists is merged (or, with --replace, overwritten). No entry is ever deleted.
    # Two commands at once: an update names the updated_at it read (the table's trigger changes it at each write), so
    # one that matches no row was overtaken; an insert the unique index refuses (409, 23505) met an entry inserted
    # meanwhile. Both read the glossary again, merge and check again on that reading, and try again.
    rows, inserted, updated, same = [_glossary_row(e) for e in terms], 0, 0, 0
    given = {_glossary_key(r): {it["slug"] for it in r["sheets"]} for r in rows}   # what the file lists, entry by entry
    for attempt in range(1 + GLOSSARY_RETRIES):
        if attempt: have = _glossary_rows(cfg, theme) or []
        new, changed, unchanged, problems = _glossary_plan(rows, have, replace)
        if problems:   # before any write on the first reading; a later reading may find what another command stored
            for p in problems: print(f"rb: {p}", file=sys.stderr)
            die(f"{file}: {len(problems)} problem(s), " + (f"after another command changed the glossary; already written: {inserted} inserted, {updated} updated"
                                                          if attempt else "nothing written"))
        same += unchanged; rows = []
        if new:
            try:   # one statement: all of them or none
                rest(cfg, "POST", "glossary_words", [dict(r, theme=theme) for r in new], prefer="return=minimal", tolerate=(409,))
                inserted += len(new)
            except RbHTTPError as e:
                if "23505" not in e.body: die(f"POST glossary_words → {e}")
                rows += new
        for row, old, patch in changed:
            params = {"id": f"eq.{old['id']}", "user_id": f"eq.{cfg['user_id']}", "updated_at": f"eq.{old.get('updated_at')}", "select": "id"}
            if rest(cfg, "PATCH", "glossary_words", patch, prefer="return=representation", params=params): updated += 1
            else: rows.append(row)
        if not rows: break
    else:
        names = ", ".join(r["term"] for r in rows[:5]) + (", …" if len(rows) > 5 else "")
        die(f"glossary {theme}: {len(rows)} entr{'y' if len(rows) == 1 else 'ies'} not written ({names}): another command kept writing "
            f"the same words ({1 + GLOSSARY_RETRIES} tries); already written: {inserted} inserted, {updated} updated; run this again")
    # The sheets read again are reconciled (Codex pass 1 on #143): the file is all that still applies to them, so an
    # entry it does not give for one of them loses that sheet. Only the sheets whose text is still the one the pass
    # read: one published again since still needs the pass, and a later reading of it by another command is not undone.
    # The dates above were read before the entries were written, so the sheets' current dates are read again just
    # before each try of the reconciliation, and once more just before the sheets are recorded (Codex pass 2): a
    # sheet published again while this command ran is neither reconciled nor recorded as read by it.
    removed = 0
    read_again = {s for s, at in passed.items() if not _earlier(at, dates.get(s))}
    if read_again:
        removed, left = _glossary_reconcile(cfg, theme, given, passed, read_again)
        if left:
            die(f"glossary {theme}: {left} entr{'y still lists' if left == 1 else 'ies still list'} a sheet read again: another command kept "
                f"writing the same words ({1 + GLOSSARY_RETRIES} tries); already written: {inserted} inserted, {updated} updated, "
                f"{removed} association{'' if removed == 1 else 's'} removed; no sheet recorded as read; run this again")
    moved = _glossary_moved(cfg, theme, passed, read_again)
    print(f"glossary {theme}: {inserted} inserted, {updated} updated, {same} unchanged"
          + (f", {removed} association{'' if removed == 1 else 's'} removed (sheets read again)" if removed else "")
          + (f", {len(moved)} sheet{'' if len(moved) == 1 else 's'} published again meanwhile (not reconciled, not recorded as read)" if moved else ""))
    # after the entries and the reconciliation, never before: a `put` that stopped above leaves its sheets to be read again
    passed = {s: at for s, at in passed.items() if s not in moved}
    if passed: _glossary_record(cfg, theme, passed)

def cmd_glossary(args):
    verb, rest_args = (args[0] if args else None), args[1:]
    replace = verb == "put" and "--replace" in rest_args
    if replace: rest_args = [a for a in rest_args if a != "--replace"]
    pending = verb == "sheets" and "--pending" in rest_args
    if pending: rest_args = [a for a in rest_args if a != "--pending"]
    if verb == "pending" and not rest_args:
        _glossary_pending()
    elif verb in ("get", "sheets") and len(rest_args) == 1 and rest_args[0]:
        (_glossary_get if verb == "get" else _glossary_dump_pending if pending else _glossary_dump)(rest_args[0])
    elif verb == "put" and len(rest_args) == 2 and rest_args[0]:
        _glossary_put(rest_args[0], rest_args[1], replace)
    else:
        die(GLOSSARY_USAGE)

COMMANDS = {"login": cmd_login, "whoami": cmd_whoami, "themes": cmd_themes, "library": cmd_library, "add-theme": cmd_add_theme, "queue": cmd_queue, "claim": cmd_claim, "publish": cmd_publish,
            "done": cmd_done, "error": cmd_error, "list": cmd_list, "delete": cmd_delete,
            "requeue-sessions": cmd_requeue_sessions, "requeue-stuck": cmd_requeue_stuck,
            "backfill-search": cmd_backfill_search, "backfill-tags": cmd_backfill_tags, "glossary": cmd_glossary}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](sys.argv[2:])
