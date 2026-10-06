---
name: exercise-reel
description: Turn an Instagram/TikTok reel into a Reelbook exercise sheet (photos from the video + why / dose / key points / sequence) and publish it to the user's Reelbook backend. Use when the user says "process the queue", "/exercise-reel", "/exercise-reel <link>", or pastes a reel link while talking about an exercise.
---

# Exercise sheet from a reel

Reelbook repository: the folder that contains this skill's parent `skill/` directory (set once in
`~/.config/reelbook/config.json` as `"repo"`, or ask the user). You need `tools/rb.py`,
`tools/crop.py`, `tools/vstack.py` (Pillow) and `templates/`. Backend: the user's Supabase
project, reached through `rb.py` (sign-in done once with `rb.py login`).

**Notebooks (themes)**: each account has its own set. `python3 tools/rb.py themes` lists them
(`id`, `title`, `description`, `groups`): built-in ones from `app/config.js` (strength, yoga,
fight, kitesurf, cooking, pilates…) and **custom ones** the user described themselves
(`id` starts with `custom-`, the `description` says what belongs in it: follow it). A sheet
needs a `theme` from that list and a `group`: use the notebook's groups when it has some, else
create a short, reusable group name (custom notebooks start with none). If no notebook fits at
all, do not invent one: publish in the closest and tell the user, who can add a notebook in the
app. Routes in the app: `#` portal, `#<theme>`, `#<slug>`, `#<slug>~<anchor>`.

**Language**: write the sheet in the user's language (the one they talk to you in). Section
titles follow the template, translated.

## 1. Take the queue
- `python3 tools/rb.py themes` then `python3 tools/rb.py queue` lists queued requests (`id`, `url`, `theme` hint, `created_at`), or
  use the link given as argument. A request carries only a URL: **you decide theme and group**
  after watching the video. The `theme` field is the page the link was pasted from: a hint, not
  an instruction.
- `python3 tools/rb.py claim <id>` before starting.

## 2. Read the reel (Chrome, `mcp__claude-in-chrome__*`)
- `navigate` to the link. `get_page_text` gives author and caption; open the comments if needed
  (they often name the exercise).
- **The video only loads while the tab is visible** (`document.visibilityState === 'visible'`,
  `video.readyState 4`). Otherwise ask the user to bring the tab to the front.
- Find the video: `[...document.querySelectorAll('video')].find(v => v.getBoundingClientRect().width > 100)`,
  `pause()`, seek via `currentTime` + the `seeked` event (4 s timeout: Instagram sometimes
  replaces the `<video>` element mid-session, re-select it on every call).
- Scouting grid: a 148×263 canvas per second, then every 0.5 s on the useful phase, drawn in a
  fixed full-screen `div` → `screenshot`. Burned-in subtitles sit in the 60–75 % band of the
  height: read them to reconstruct what is said.
- Final frames: full-viewport canvas (`drawImage(v, 0, sy, sw, sh, 0, 0, cw, ch)`), mouse parked
  in a corner (`hover` 1195,858), `screenshot` with `save_to_disk: true` and **scale 1** (the file
  is saved at the requested scale; 0.25 gives a 300 px file, useless). Note the rendered size.
- **Vertical 9:16 video** (720×1280): a full-frame capture is only ~485 px wide. Capture **two
  halves** (`__cap(t, 0, 0.5)` then `__cap(t, 0.5, 0.5)`), crop each (top `0 0 W 861`, bottom
  `0 2 W 861` to avoid a 1-px seam), then `python3 tools/vstack.py <dst> 960 top.jpg bottom.jpg`
  → 960×1706 photo. 4:5 or 16:9 videos: the full frame is enough. Text banners in the frame:
  shift the bands to exclude them.
- Crop: `python3 tools/crop.py <src> <dst> <x> <y> <w> <h> 960`.
- **FRAMING RULE**: the photo shows the **whole body**: head, both hands, the supports (feet /
  knees). Default frame = the full video frame minus text banners; tighten only when the subject
  is small, and **never** to the point of cutting head, hands or feet. Split-screen video: keep
  each half whole. If the subject leaves the frame in the video itself, pick another frame rather
  than deliver a cropped photo.
- **NUMBER OF PHOTOS**: 2 per movement is a **minimum** (start / end position), never a cap. A
  multi-phase movement (slider plank to pike, candlestick, drop-and-catch…) takes 3 to 5: one per
  key position found on the grid, plus one detail photo when a placement conditions the exercise.
  Decide the count **from the grid**, exercise by exercise.
- **Mandatory check**: `Read` every final photo and tick head / hands / supports visible before
  writing the sheet. A photo that fails is redone.
- Clean the overlays, close the tab (`tabs_close_mcp`).

## 3. Write the sheet
- Work folder: `work/<slug>/` in the repository (git-ignored) with `index.html`, `meta.json`,
  `img/`. Copy `templates/sheet.html` → `work/<slug>/index.html`; images in `work/<slug>/img/`,
  referenced as `img/<file>.jpg`; thumbnail `img/thumb.jpg` cropped **3:2** (960×640 or 684×456,
  whole body) because cards use `object-fit: cover`.
- Section order is fixed: Why → Dose (marked "suggestion" when the reel gives none) → Key points →
  Sequence (numbered photos, palm/direction badge when useful) → Variation → Source.
- Second person, short sentences, author credit + reel link in the footer. No `<script>`, no
  `<style>`: the app provides the styles (class names in `templates/`).
- `meta.json`: `slug`, `kind: "sheet"`, `theme`, `group`, `title`, `summary` (one line for the
  card), `duration`, `thumbnail`, `source {author, url, platform}`.

## 3 bis. One reel = a session (several exercises)
- Decide from the caption / the grid: several named exercises = **one session page**, not N
  sheets. Copy `templates/session.html`; slug `session-…`. Why → Format (the post's dose:
  seconds × exercises, rounds, rest) → Key points → "The circuit" (`ol.plan` with `#anchor`
  links) → one `<section class="exo" id="<anchor>">` per exercise (h2 "n · Title", description,
  `.steps`, `ul` of 2–3 cues + an easier version). Grid per exercise, photos per the count rule.
- `meta.json`: `kind: "session"`, `group: "Sessions"`, `exercises[]` with `anchor`, `title`,
  `group`, `summary`, `duration`, `thumbnail` (3:2, whole body, cropped from a photo). The app
  builds the group cards and the `#<slug>~<anchor>` links by itself.

## 4. Publish and close
- `python3 tools/rb.py publish work/<slug>` uploads the images and upserts the sheet.
- Check in the app (Chrome): open `<app url>#<slug>`; a deep link `#<slug>~<anchor>` only
  reaches the page at load, so navigate elsewhere first.
- `python3 tools/rb.py done <id> --slug <slug>`. On failure: `rb.py error <id> --note "<why>"`.
- Give the user the sheet link. Then take the next queued request.
