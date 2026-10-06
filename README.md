# Reelbook

Turn the exercise reels you save on Instagram or TikTok into **sheets you can read on the mat**:
photos taken from the video, why the exercise matters, how much to do, the key points, the
sequence step by step, the source. Sheets are grouped in three notebooks: strength, yoga &
stretching, fight techniques.

Two parts:

- **The app** (`app/`): a small installable web app. You paste reel links from your phone and
  read your sheets there. No store, no build step: a static page talking to a Supabase backend.
- **The skill** (`skill/exercise-reel/`): instructions for [Claude Code](https://claude.com/claude-code).
  Every few days you run it on your computer. It opens each queued reel in Chrome, watches it,
  extracts the key frames, writes the sheet and publishes it to your backend.

This is a tinkerer's tool. It works, we use it daily, but it leans on Claude Code, a Chrome
extension and the way Instagram renders videos today. Read *What can break* before you start.

## What you need

- **Claude Code** with a Pro plan or above, and the **Claude in Chrome** extension installed in
  a Chrome where you are signed in to Instagram and/or TikTok.
- **Python 3.10+** with Pillow (`pip install pillow`) for the image tools.
- A backend for your data. Two options:
  - **Your own Supabase project**, free tier. Ten minutes: [docs/own-supabase.md](docs/own-supabase.md).
  - **The hosted backend** run by the maintainers, when enabled in `app/config.js`. Free for now;
    it may become a paid option later. Your data stays private to your account either way.

## Quick start

1. Open the app, pick a backend, create an account. Install it on your phone (*Add to Home screen*).
2. Save a reel: **+ Add a reel**, paste the link. It shows under *In the queue*.
3. On your computer:

   ```
   git clone https://github.com/lt20/reelbook
   cd reelbook
   python3 -m pip install pillow
   python3 tools/rb.py login --url … --key …      # once: paste the command from the app's Settings page, then email + password
   ln -s "$PWD/skill/exercise-reel" ~/.claude/skills/exercise-reel
   ```

4. Start Claude Code anywhere, open Chrome next to it, and type `/exercise-reel`.
   Keep the computer unlocked and the reel tab in front: the video does not load in the
   background. Claude asks you to bring the tab forward when needed.
5. Ten to fifteen minutes later the sheet is in the app, under its theme and group. A reel with
   several exercises becomes one *session* page, each exercise also listed in its group.

## Notebooks

Sheets live in notebooks. A new account starts with three (Strength, Yoga & stretching, Fight
techniques). **+ Add a notebook** on the home page offers the built-in library (kitesurf,
wingfoil, surfing, running, pilates, barre, pole dance, dance, prenatal, cooking, beauty, crafts… 29 in
`app/config.js`) and a **custom notebook**: a name plus a description of what goes in it. The
description is written for Claude: it is what the skill reads to decide where a reel belongs
and how to group it. Notebooks are per account; remove one from Settings when it is empty.

## How a sheet is made

1. `rb.py themes` lists your notebooks, `rb.py queue` your queued links; Claude claims one.
2. Chrome opens the reel. Claude reads caption and comments, draws a grid of frames (one per
   second, then every half second on the useful phase) and reads the burned-in subtitles.
3. It picks the key positions, captures them full size, crops them so the **whole body** stays
   visible (head, hands, feet), rebuilds vertical frames from two halves, and checks every photo.
4. It writes the sheet from `templates/sheet.html` (or `templates/session.html`), in your language,
   decides the theme and group, and publishes with `rb.py publish`.
5. The request is closed with `rb.py done`. Open the app: the sheet is there, with a notes box
   only you can see.

## Data model

Three tables and one private storage bucket, all locked to the signed-in user by row level
security (`supabase/schema.sql`):

| Table / bucket | Holds |
| --- | --- |
| `requests` | pasted links: `url`, `status` (queued → processing → done / error), `theme` hint, `slug` |
| `sheets` | one row per sheet or session: `slug`, `theme`, `group`, `title`, `summary`, `source`, `exercises`, `html` |
| `notes` | your personal note per sheet |
| `user_themes` | your notebooks: built-in ones turned on, custom ones with their description |
| `sheets/<user_id>/<slug>/img/*` | the photos |

The app renders `sheets.html` inside its own styles and signs image URLs on the fly. Nothing is
public, nothing is shared between accounts.

## Repository layout

```
app/        the web app (index.html, config.js, manifest, service worker, vendored supabase-js)
skill/      the Claude Code skill (exercise-reel/SKILL.md)
templates/  sheet.html and session.html, the HTML the skill fills in
tools/      rb.py (backend CLI), crop.py, vstack.py (Pillow)
supabase/   schema.sql
docs/       setup guides
work/       local work folders of the skill (git-ignored)
```

## Hosting the app yourself

`app/` is static. Any host works: GitHub Pages, Netlify, Vercel, a folder on a NAS, or
`python3 -m http.server` for a quick look. Edit `app/config.js` to set the hosted backend (or
leave it empty to hide the option) and the repository link. The service worker caches the
shell; sheets and photos need the network.

## What can break

- **The capture pipeline.** It drives Instagram and TikTok pages through a browser. A DOM change
  on their side, a login wall or a video element replaced mid-session will need a fix in
  `SKILL.md`. The skill already re-selects the live video and times out seeks for that reason.
- **Tab visibility.** Browsers do not decode video in background tabs. Claude asks you to bring
  the tab to the front; there is no way around it today.
- **Frames are theirs.** Sheets reuse frames from someone else's video. Keep them for personal
  use, credit the author (the footer does), and do not publish a backend full of them.
- **Quotas.** Free Supabase: 1 GB of storage, roughly 400 sheets. The hosted backend will set a
  per-account limit.

## Contributing

Issues and pull requests welcome, in particular for: TikTok page quirks, a Linux or Windows
check of the tools, better templates for yoga and fight sheets. Keep the app a single file and
the tools standard-library plus Pillow.

## License

MIT. See [LICENSE](LICENSE).
