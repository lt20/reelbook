---
name: reelbook
description: Turn an Instagram/TikTok/YouTube/Facebook video into a Reelbook exercise sheet (photos from the video + why / dose / key points / sequence) and publish it to the user's Reelbook backend. Use when the user says "process the queue", "/reelbook", "/reelbook <link>", or pastes a reel, Short or video link while talking about an exercise.
---

# Exercise sheet from a video

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

## 2. Read the video (Chrome, `mcp__claude-in-chrome__*`)
- `navigate` to the link. `get_page_text` gives author and caption; open the comments if needed
  (they often name the exercise).
- **The video only loads while the tab is visible** (`document.visibilityState === 'visible'`,
  `video.readyState 4`). Otherwise ask the user to bring the tab to the front.
- Find the video: `[...document.querySelectorAll('video')].find(v => v.getBoundingClientRect().width > 100)`,
  `pause()`, seek via `currentTime` + the `seeked` event (4 s timeout: Instagram sometimes
  replaces the `<video>` element mid-session, re-select it on every call).
- **Scouting, three passes.** One frame per second misses movements: a rep plus its variation
  lasts about 1 s, so 1 fps keeps landing on the same phase (a reel of 10 push-ups, each followed
  by a different tap, came out as "plank, push-up, pike"). Helper, pasted with `javascript_tool`
  after each page load (a navigation clears it); it draws timestamped thumbnails in a fixed full-screen `div#__grid` →
  `screenshot`:
  ```js
  window.__sheet = async (t0, step, n, W = 230, H = 205, y0 = 0, y1 = 1) => {
    const pick = () => [...document.querySelectorAll('video')].find(v => { const r = v.getBoundingClientRect(); return r.width > 100 && r.bottom > 0 && r.top < innerHeight; });
    const seek = t => new Promise(res => { const v = pick(); v.pause();
      const to = setTimeout(() => res(v), 4000);
      v.addEventListener('seeked', () => { clearTimeout(to); res(v); }, { once: true });
      v.currentTime = t; });
    document.getElementById('__grid')?.remove();
    const g = document.createElement('div'); g.id = '__grid';
    g.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000;display:flex;flex-wrap:wrap;align-content:flex-start;gap:2px;padding:2px';
    document.body.appendChild(g);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * step, v = await seek(t), c = document.createElement('canvas');
      c.width = W; c.height = H; const x = c.getContext('2d');
      const sy = v.videoHeight * y0, sh = v.videoHeight * (y1 - y0);
      x.drawImage(v, 0, sy, v.videoWidth, sh, 0, 0, W, H);
      x.fillStyle = '#ff0'; x.font = 'bold 18px sans-serif'; x.fillText(t.toFixed(1), 4, 20);
      g.appendChild(c);
    }
    return n;
  };
  ```
  `y0`/`y1` crop the thumbnails to the band where the subject is (e.g. `0.3, 0.8` for someone on
  the floor in a 9:16 video), so hands and feet stay readable; pick `W`/`H` to keep the aspect
  of that band. Fit the grid to `innerWidth`/`innerHeight` (230×205 gives 5 or 6 columns, about
  25 per screen) and check the last row is on screen. Remove `#__grid` before the final captures.
  - **Pass A, inventory, the whole video**: one frame every **0.2 s** from the first to the last
    second (`__sheet(0, 0.2, 30, …)`, then `__sheet(6, 0.2, 30, …)`…). Video longer than ~60 s:
    1 s to find the passages, then 0.2 s on each of them.
  - **Pass B, written timeline**: before any photo, write the timeline `start–end s → movement`
    covering **the whole video**, with no unexplained gap over 1 s. Look for cycles (a rep + a
    variation that alternates sides or changes every pair). Count reps by writing down the time of
    each one (push-ups at 1.8, 2.8, 3.8 s…), never by estimating: a guessed count was off by two. Every
    distinct movement in the timeline gets at least one photo. A gap or a doubt = another 0.2 s
    grid on that passage.
  - **Pass C, peak**: around each photo kept, a **0.1 s** grid over ±0.3 s to pick the peak frame
    (hand down, knee closest, hips highest). 0.1 s finds no new movement, it finds the best image.
- Burned-in subtitles sit in the 60–75 % band of the height: read them (full-frame grid) to
  reconstruct what is said. **No text, no subtitles, no useful comments**: the timeline is the only
  source; the sheet says, in a `note`, that the names are read from the images.
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
  Decide the count **from the grid**, exercise by exercise. A **flow** (one continuous chain of
  different moves) takes one photo per distinct movement of the timeline, even beyond 5: the 3–5
  range is for a single movement.
- **Mandatory check**: `Read` every final photo and tick head / hands / supports visible before
  writing the sheet. A photo that fails is redone. Then match the photos against the timeline:
  every line has its photo, or the sheet says why not.
- Clean the overlays, close the tab (`tabs_close_mcp`).

### YouTube (`youtube.com/watch`, `/shorts/`, `youtu.be`)
- No sign-in needed (only for age-restricted or private videos: ask the user). Dismiss the consent
  banner if it shows up.
- Metadata: title and channel from the page; click « …plus » to expand the description, which holds
  the chapters and often the dose. Open « Show transcript » when it exists: it replaces the burned-in
  subtitles to reconstruct what is said.
- Video element: on `/watch`, `document.querySelector('video.html5-main-video')`; on `/shorts/`, the
  `<video>` whose rect is on screen (the page scrolls vertically and keeps several), re-selected on
  every call. Pause it, then seek as above.
- Before capturing, hide the player chrome (controls, cards, end screen, title overlay) and wait out
  or skip any ad: a frame with an ad or a control bar is redone. Mouse parked in a corner.
- Shorts are 9:16: use the two-halves + `vstack.py` route. A `/watch` video is 16:9: the full frame
  is enough.
- **Long video** (more than ~2 min, or chapters listed): never scout the whole video. Read the
  chapters / transcript, pick the passages that show an exercise, run passes A–C **only on those
  passages**, and build **one session page** (section 3 bis), one `exo` block per exercise.
- `meta.json`: `source.platform` = `"youtube"`; the footer link is the video URL, with the
  timestamp (`&t=…s`) when the sheet comes from one passage.

### Facebook (`facebook.com/reel/…`, `/share/r/…`, `/watch`, `/<page>/videos/…`, `fb.watch`)
- Needs the user signed in to Facebook in that Chrome. `share/r/` and `fb.watch` links redirect: note the
  final URL (`facebook.com/reel/<id>`) and use it in `meta.json` and the footer.
- The page keeps **the next reel's `<video>` loaded below the current one**: pick the video whose rect is on
  screen (`r.bottom > 0 && r.top < innerHeight`), not the first one, in every helper.
- The caption is cut after one line: click « See more » / « En voir plus » before reading it.
- Streams are low resolution (often 540×960, sometimes 720×1280) and heavily compressed: capture a band of
  the frame around the subject drawn to the full viewport, never a full-frame capture, and expect softer
  photos. Reels are 9:16; a `/watch` video can be 16:9.
- `meta.json`: `source.platform` = `"facebook"`.

## 3. Write the sheet
- Work folder: `work/<slug>/` in the repository (git-ignored) with `index.html`, `meta.json`,
  `img/`. Copy `templates/sheet.html` → `work/<slug>/index.html`; images in `work/<slug>/img/`,
  referenced as `img/<file>.jpg`; thumbnail `img/thumb.jpg` cropped **3:2** (960×640 or 684×456,
  whole body) because cards use `object-fit: cover`.
- Section order is fixed: Why → Dose (marked "suggestion" when the reel gives none) → Key points →
  Sequence (numbered photos, palm/direction badge when useful) → Variation → Source.
- Second person, short sentences, author credit + video link in the footer. No `<script>`, no
  `<style>`: the app provides the styles (class names in `templates/`).
- `meta.json`: `slug`, `kind: "sheet"`, `theme`, `group`, `title`, `summary` (one line for the
  card), `duration`, `thumbnail`, `source {author, url, platform}` (`platform`: `instagram`, `tiktok`, `youtube` or `facebook`).

## 3 bis. One video = a session (several exercises)
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
