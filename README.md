# Reelbook

Turn the how-to videos you save on Instagram, TikTok, YouTube or Facebook into **sheets you can actually use**:
photos taken from the video, why it matters, how much to do, the key points, the steps in
order, the source. A kitesurf transition, a yoga flow, a knife technique, a pole spin, a judo
throw: one video, one sheet, filed in the notebook of your choice.

**Open the app:** https://lt20.github.io/reelbook/

Notebooks are yours to pick: 29 built-in ones (strength, yoga, running, surfing, pilates,
cooking, beauty, crafts…) plus any notebook you describe yourself.

Two parts:

- **The app** (`app/`): a small installable web app. You paste video links from your phone and
  read your sheets there. No store, no build step: a static page talking to a Supabase backend.
- **The skill** (`skill/reelbook/`): instructions for [Claude Code](https://claude.com/claude-code).
  Every few days you run it on your computer, or a Mac runs it every night. It opens each queued
  video in Chrome, watches it, extracts the key frames, writes the sheet and publishes it to your
  backend.

This is a tinkerer's tool. It works, we use it daily, but it leans on Claude Code, a Chrome
extension and the way Instagram renders videos today. Read *What can break* before you start.

## What you need

- **Claude Code** with a Pro plan or above, and the **Claude in Chrome** extension installed in
  a Chrome where you are signed in to Instagram, TikTok and/or Facebook (YouTube needs no sign-in).
- **Claude Opus 5.5.** The skill and the overnight run ask for it (`model: claude-opus-5-5`). It is
  the only model Reelbook is tested with: picking the peak frame and cropping the whole body lean
  on vision, and lighter models are not guaranteed to get them right.
- **Python 3.9+** with Pillow (`pip install pillow`) for the image tools. The
  `python3` macOS installs with its Command Line Tools (3.9) is enough.
- A backend for your data. Two options:
  - **Your own Supabase project**, free tier. Ten minutes: [docs/own-supabase.md](docs/own-supabase.md).
  - **The hosted backend** run by the maintainers, when enabled in `app/config.js`. Free for now;
    a paid hosted plan is planned. Your data stays private to your account either way.

## Quick start

1. Open the app at https://lt20.github.io/reelbook/ and choose **Create an account**. Pick a
   backend, then enter your email and password. Returning users sign in directly; on a new
   device, **Sign in to my own instance** lets self-hosted users enter their Supabase URL and anon
   key once. Install the app on your phone (*Add to Home screen*).
2. Save a video: **+ Add a video**, paste the link. It shows under *In the queue* on the home page.
3. On your computer, paste the install line shown in the app's **Settings** page (**Send to my
   computer** there mails or shares it from your phone). On the hosted backend it is the same for
   everyone. macOS / Linux:

   ```
   curl -fsSL https://lt20.github.io/reelbook/install.sh | bash
   ```

   Windows (PowerShell):

   ```
   irm https://lt20.github.io/reelbook/install.ps1 | iex
   ```

   The installer reads the hosted backend's URL and anon key from the app's published `config.js`
   (as text, it never runs it). On your own Supabase project, Settings shows the line with its URL
   and key: `… | bash -s -- --url … --key …` (Windows: set `$env:REELBOOK_URL` and
   `$env:REELBOOK_KEY` first). `install.sh --help` lists the options; `--dry-run` shows which
   backend would be used and installs nothing.

   It clones this repository into `~/reelbook`, installs Pillow in a private venv, links the
   skill into `~/.claude/skills/`, and asks for your email and password. Prefer doing it by
   hand? [docs/manual-install.md](docs/manual-install.md).

4. Start Claude Code anywhere, open Chrome next to it, and type `/reelbook`.
   Keep the computer unlocked and the video tab in front: the video does not load in the
   background. Claude asks you to bring the tab forward when needed.
5. Ten to fifteen minutes later the sheet is in the app, under its theme and group. A video with
   several exercises becomes a *session*: one exercise sheet per exercise, each filed in its group,
   plus a session that links them in video order, with a dose for each exercise (« 30 s »,
   « 3×10 ») and the video's format, why and key points. The session shows in the notebook's
   Sessions section; each of its sheets carries « in 1 session » and links back to it.

**Overnight (macOS).** `tools/nightly.sh install` processes the queue every night at 02:00 (or
`install 23:30`) through a LaunchAgent, at most 5 videos per run. Leave Chrome open with the
extension. Claude only starts when the queue holds something and the Mac is **plugged in**: on
battery, macOS sleeps anyway and the run dies mid-way. A locked screen is fine, the video still
plays. A video left « in progress » by a run that died goes back to the queue after 6 hours
(`rb.py requeue-stuck`).

- `tools/nightly.sh check` shows what a run would do, `run --max 1` tries one video now,
  `uninstall` removes it.
- On install, macOS notifies a new background item, « Reelbook night run »: that is this run, keep
  it allowed (System Settings → General → Login Items).
- Log in `~/Library/Logs/reelbook-nightly.log`. Set `REELBOOK_NOTIFY_URL` to an
  [ntfy](https://ntfy.sh) topic before installing to get a phone notice after each run.
- Signing out of the app no longer signs the computer out. If rb.py or the night notice says
  « signed out », run `python3 tools/rb.py login` again.

## Notebooks

Sheets live in notebooks. A new account starts with three (Strength, Yoga & stretching, Fight
techniques). **+ Add a notebook** on the home page offers the built-in library (kitesurf,
wingfoil, surfing, running, pilates, barre, pole dance, dance, prenatal, cooking, beauty, crafts… 29 in
`app/config.js`) and a **custom notebook**: a name plus a description of what goes in it. The
description is written for Claude: it is what the skill reads to decide where a video belongs
and how to group it. Notebooks are per account; remove one from Settings when it is empty.

A video that fits none of your notebooks still gets its sheet: Claude turns on the matching built-in
notebook, or creates a custom one named after the subject (`rb.py add-theme`), and says so in its
report. It never files a video in a merely « closest » notebook.

Claude filed a sheet in the wrong place? Open it and tap **Move**: pick another notebook and a
group (one it already has, or a new one). A session moves too, to another notebook only: a box
takes along its exercise sheets of the same notebook (ticked for a session made from a video), and
sheets in other notebooks stay where they are.

Don't want a sheet any more? **Delete sheet**, at the bottom of its page, removes it with its photos
and your note. A session that listed it simply skips it; processing the same video again brings it
back.

## Your own sessions

A session is an ordered list of sheets, each with its own dose. Besides the ones Claude builds
from a video, you can compose your own:

- **+ New session**, in a notebook's Sessions section: a title, then tick the notebook's sheets in
  the order you want them (grouped, with a filter). The new session opens in Edit mode.
- **Add to session**, on a sheet page: pick any session (all notebooks), or « New session… » to
  create one in the sheet's notebook. The sheet goes last; a sheet is never added twice.
- **Edit**, on a session page: ↑ ↓ to reorder, a dose per exercise (« 30 s », « 3×10 »), the format
  line (« 5 rounds · 60 s rest »), the title, remove an exercise, or delete the session. Removing or
  deleting never deletes a sheet. A session from a video is editable too, but processing that
  video again rewrites it and drops your edits.

Each session page also has its own « My notes ».

## How a sheet is made

1. `rb.py requeue-stuck` frees the links a dead run left « in progress », `rb.py themes` lists your
   notebooks, `rb.py queue` your queued links; Claude claims one, and adds a notebook if none fits.
2. Chrome opens the video. Claude reads caption and comments, draws a grid of the whole video
   (a frame every 0.2 s, so short reps are not missed; on a long video, only the useful passages), reads the burned-in subtitles and writes
   a second-by-second timeline of the movements.
3. It takes one photo per distinct movement (start and end at least for a single exercise), picks each peak frame
   on a 0.1 s grid, captures it full size, crops it so the **whole body** stays
   visible (head, hands, feet), rebuilds vertical frames from two halves, and checks every photo.
4. It writes the sheet from `templates/sheet.html` (for a session: one `templates/exercise.html`
   sheet per exercise, and the session's order and doses), in your language, decides the theme
   and group, and publishes with `rb.py publish`.
5. The request is closed with `rb.py done`. Open the app: the sheet is there, with a notes box
   only you can see.

## Data model

Six tables and one private storage bucket, all locked to the signed-in user by row level
security (`supabase/schema.sql`):

| Table / bucket | Holds |
| --- | --- |
| `requests` | pasted links: `url`, `status` (queued → processing → done / error), `theme` hint, `slug` |
| `sheets` | one row per sheet: `slug`, `theme`, `group`, `title`, `summary`, `duration`, `thumbnail`, `source`, `html`, `search_text` (the sheet's visible text, at most 4 000 characters, that search reads), `tags` (`{"zone": [], "gear": [], "minutes": n, "type": ""}`, the facets of the search view, values from `facets` in `app/config.js`) (`kind` and `exercises` are left from the old one-page sessions and only serve their migration, below) |
| `sessions` | one row per session: `slug`, `theme`, `title`, `format`, `why`, `key_points`, `source`, `origin` (`video` or `user`), `thumbnail`, `items` (ordered `{slug, dose}`, each slug a sheet) |
| `notes` | your personal note per sheet (key: its slug) and per session (key: `session/<slug>`) |
| `user_themes` | your notebooks: built-in ones turned on, custom ones with their description |
| `practice_log` | one row each time you tap « Done today » on a sheet or a session: `slug` (as for notes), `done_on`, `text` (« 12 kg, 3x10 ») |
| `account_quotas` | limits of one account, read-only for it (see « Limits on a shared backend » below) |
| `beta_settings`, `beta_waitlist` | the hosted beta's project-wide limits and its waiting list; no client reads them (off without a settings row, below) |
| `sheets/<user_id>/<slug>/img/*` | the photos |

The app renders `sheets.html` inside its own styles, builds session pages from their `sessions`
row, and signs image URLs on the fly. Nothing is public, nothing is shared between accounts.
A backend set up before sessions existed has no `sessions` table: re-run `supabase/schema.sql`
(it only adds what is missing); until then the app hides sessions and says so in Settings.
The practice log came later still: on your own Supabase, re-run `supabase/schema.sql` to create the
`practice_log` table; until then the app shows no « Done today » and no practice count.
Search in the text of the sheets came after that: re-run `supabase/schema.sql` to add the
`sheets.search_text` column, then fill it once for the sheets you already have with
`python3 tools/rb.py backfill-search` (add `--dry-run` first to see the list; it writes only sheets whose
`search_text` is empty, and new sheets get it from `rb.py publish`). Until then search reads titles,
summaries, groups, notebooks, authors and your notes, as before.
The facet chips of the search view (Zone, Gear, Time, Type) came next: re-run `supabase/schema.sql` to add the
`sheets.tags` column, then tag the sheets you already have once with `python3 tools/rb.py backfill-tags`
(`--dry-run` first; it derives the tags from each sheet's group, title, text and duration, without Claude, and
writes only sheets that have none). New sheets get their tags from the skill through `rb.py publish`. Until then
the app searches as before, without the chips.
A backend that still holds old one-page sessions (`sheets` rows with `kind = 'session'`, before
sessions were made of sheets): the app hides them and Settings counts them. Run
`python3 tools/rb.py requeue-sessions` (add `--dry-run` first to see the list), then `/reelbook`:
each video is rebuilt as exercise sheets plus a session, and its old page is deleted.

### Limits on a shared backend

`supabase/schema.sql` limits what each account may add, so that one account cannot fill a backend shared
by several people (the hosted one): **10 video links a day** (counted from midnight UTC), **300 sheets**
and **200 MB of photos**. The database enforces them, whatever the client; they only refuse what would
add (a new link, a new sheet, a new or changed photo): nothing stored is removed, and republishing a sheet you
already have works (`rb.py publish` does not send again the photos the backend already holds). Settings shows « Usage: 4/10 links today · 120/300 sheets · 80/200 MB »;
`rb.py publish` says which limit refused it. A backend set up before the limits has none until
`supabase/schema.sql` is re-run.

**On your own Supabase**, lift them for your account with one insert in the SQL editor (your user id is
under Authentication › Users, or `select id, email from auth.users;`):

```sql
insert into public.account_quotas (user_id, max_requests_per_day, max_sheets, max_storage_mb, note)
values ('<your user id>', 1000, 100000, 100000, 'owner')
on conflict (user_id) do update set max_requests_per_day = excluded.max_requests_per_day,
  max_sheets = excluded.max_sheets, max_storage_mb = excluded.max_storage_mb, note = excluded.note;
```

A null column keeps the default; one row per account you want to lift.

The same file also holds project-wide limits for a beta (seats, sign-ups a day, videos a day, total photos,
kill switches, a waiting list: « Beta locks » in `supabase/schema.sql`). They are **off until a row of
`beta_settings` exists**: your own Supabase never needs one, and behaves as above without it. A daily ntfy summary
of those figures (« Daily alert ») is scheduled only where the `pg_cron` and `pg_net` extensions are enabled, and
sends nothing until you store a topic in Vault.

## Repository layout

```
app/        the web app (index.html, config.js, sessions.js, manifest, service worker, vendored supabase-js)
skill/      the Claude Code skill (reelbook/SKILL.md)
templates/  sheet.html and exercise.html (one exercise of a session), the HTML the skill fills in
tools/      rb.py (backend CLI), crop.py, vstack.py (Pillow), nightly.sh (overnight runs, macOS),
            import-legacy.py (one-off import of the author's first notebook)
supabase/   schema.sql
tests/      app tests (Node) and rb.py tests (Python), run by GitHub Actions
docs/       setup guides, sessions-v2.md (design notes of the sessions rework)
work/       local work folders of the skill (git-ignored)
```

## Hosting the app yourself

`app/` is static. Any host works: GitHub Pages, Netlify, Vercel, a folder on a NAS, or
`python3 -m http.server` for a quick look. Edit `app/config.js` to set the hosted backend (or
leave it empty to hide the option) and the repository link. The service worker caches the
shell; sheets and photos need the network.

## What can break

- **The capture pipeline.** It drives Instagram, TikTok, YouTube and Facebook pages through a browser. A DOM change
  on their side, a login wall or a video element replaced mid-session will need a fix in
  `SKILL.md`. The skill already re-selects the live video and times out seeks for that reason.
- **Tab visibility.** Browsers do not decode video in background tabs. Claude asks you to bring
  the tab to the front; there is no way around it today.
- **Frames are theirs.** Sheets reuse frames from someone else's video. Keep them for personal
  use, credit the author (the footer does), and do not publish a backend full of them.
- **Quotas.** Free Supabase: 1 GB of storage, roughly 400 sheets. Each account is limited by the
  schema (« Limits on a shared backend », above); lift your own on your own project.

## Platforms

The app runs in any browser. The skill needs Claude Code and Chrome with the Claude in Chrome
extension: macOS is what we use daily; Windows and Linux should work (Claude Code and the
extension exist there, the tools are plain Python + Pillow) but have not been tried. Reports welcome.

## Contributing

Issues and pull requests welcome, in particular for: TikTok, YouTube and Facebook page quirks, a Windows or Linux
run of the skill, better templates for yoga and fight sheets. Keep the app static with no build
step (one page plus a few plain scripts), and the tools standard-library plus Pillow.

Pull requests run two jobs in GitHub Actions; `auth-flow` is required before merging to `main`.
Run them locally:

```
node --test tests/auth-flow.test.cjs tests/sessions.test.cjs     # app (Node.js 22 or newer)
python3 -I tests/rb-sessions.test.py && python3 -I tests/rb-queue.test.py   # rb.py (Python 3.9+)
bash -n tools/nightly.sh
```

## License

MIT. See [LICENSE](LICENSE).
