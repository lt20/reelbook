---
name: reelbook
description: Turn an Instagram/TikTok/YouTube/Facebook video into a Reelbook exercise sheet (photos from the video + why / dose / key points / sequence) and publish it to the user's Reelbook backend. Use when the user says "process the queue", "/reelbook", "/reelbook <link>", or pastes a reel, Short or video link while talking about an exercise.
model: claude-opus-5-5
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
app. Routes in the app: `#` portal, `#<theme>`, `#<slug>` for a sheet, `#session/<slug>` for a
session.

**Language**: write the sheet in the user's language (the one they talk to you in). Section
titles follow the template, translated.

## 1. Take the queue
- `python3 tools/rb.py requeue-stuck` first: it puts back in the queue a request left « processing » for
  more than 6 h by a run that died (Mac asleep, crash). Never pass a shorter `--hours`: another run may be at work.
- `python3 tools/rb.py themes` then `python3 tools/rb.py queue` lists queued requests (`id`, `url`, `theme` hint, `note`, `created_at`), or
  use the link given as argument. A request carries only a URL: **you decide theme and group**
  after watching the video. The `theme` field is the page the link was pasted from: a hint, not
  an instruction.
- **A `note` that starts with « Redo: » is a correction** the user asked from the app (« Something
  wrong? » under a sheet or session): that video is already published. Apply the instruction after
  « Redo: », and keep the **same slug** so that publishing overwrites the old sheet (a session: the
  same session slug and the same exercise slugs). Its queue line has `redo_of`: the sheets and
  sessions published from that video (`source.url`), the slugs to publish over; when the video made a
  session, the note says which exercise is wrong, and the others stay as they are. The request's
  `theme` is the notebook the page is in now: keep it, and keep the group (`rb.py list`). Start from
  `work/<slug>/` when the earlier run left it, and change only what the note asks. `rb.py error`
  keeps the « Redo: » line, so the user can retry it from the app. In the
  end-of-run report, list the sheets redone and what changed in each.
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
  range is for a single movement. A **progression** (stages toward one movement, section 3 bis)
  takes one or two photos per stage, even beyond 5.
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
  passages**, and build **one session** (section 3 bis): one exercise sheet per exercise, unless
  the video teaches one movement in stages (then one sheet, section 3 bis).
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
  `<style>`: the app provides the styles (class names in `templates/`). To point to another of
  the user's sheets, link `#<its slug>` (`rb.py list` gives the slugs).
- `meta.json`: `slug`, `kind: "sheet"`, `theme`, `group`, `title`, `summary` (one line for the
  card), `duration`, `thumbnail`, `source {author, url, platform}` (`platform`: `instagram`, `tiktok`, `youtube` or `facebook`).

## 3 bis. One video = a session (several exercises)
- **First decide: one movement taught in stages, or a workout?** Several named moves do not make
  a session. A session is a **workout**: independent exercises, each worth doing for itself with
  its own dose (circuit, routine, warm-up list, « 5 exercises for… »). A video that teaches **one
  movement** broken into stages is **one sheet** (section 3), however many stages it names: « X in
  5 steps », « progression to X », « how to X », « X from beginner to full », drills or lead-ups
  that end in the full movement. Signs: the title or caption names one movement; the last stage
  is that movement; each stage adds a piece to the previous one, or only exists to reach the last.
  Then the stages are the **Sequence**, one numbered step per stage (« Stage 1 · plank »…) with
  its photos and the sign that it is clean enough to move on, the full movement as the last step;
  Dose says how to work the stages (« each stage 3×5 until clean, then the next »). Precedent:
  `side-kick-progression` (one sheet, right). Counter-example: « Front kick through en 5 étapes »
  was split into a session of 5 sheets (`session-front-kick-through`, wrong: plank, front sit
  through… are stages of the front kick through). In doubt, one sheet, and say so to the user.
- A workout: several named exercises = **one session**: one light
  exercise sheet per exercise, plus one session that links them **in the video's order**. Grid per
  exercise, photos per the count rule.
- Work folder: `work/<session-slug>/` holds the session `meta.json` and **one sub-folder per
  exercise**, `work/<session-slug>/<exercise-slug>/` (`index.html`, `meta.json`, `img/`, as in
  section 3). No `index.html` at the session level: the app draws the session page itself.
- **Slugs, unique and stable**: session `session-<…>`; each exercise `<session-slug>-<anchor>`
  (anchor: lowercase ascii with dashes, from the exercise name, e.g. `session-gsp-floor-angel`).
  Reprocessing the same video must give the same slugs, so the publish rewrites the sheets
  instead of adding duplicates. The same exercise twice in the circuit = one sheet, two items.
- **Exercise sheet**: copy `templates/exercise.html` (light sheet): description, numbered photos,
  2–3 cues, an easier version, footer with author credit + video link (YouTube: with the
  `&t=…s` of the passage). **No** Why, Dose or Key points on it: they go on the session. Its
  `meta.json`: `kind: "sheet"`, `theme` = the session's notebook, `group` = the exercise's own
  group (Shoulders, Legs…, never "Sessions"), `title`, `summary` (one line for the card),
  `duration: ""` (the dose lives on the session), `thumbnail` (`img/thumb.jpg`, 3:2, whole body),
  `source` = the session's.
- **Session `meta.json`**:
  ```json
  {"slug": "session-gsp", "kind": "session", "theme": "strength", "title": "…",
   "format": "5 rounds · 60 s rest",
   "why": "What the session is for, two or three sentences.",
   "key_points": ["Cue for the whole session.", "Second cue."],
   "source": {"author": "…", "url": "https://…", "platform": "instagram"},
   "items": [{"slug": "session-gsp-floor-angel", "dose": "30 s"}, {"slug": "session-gsp-squat", "dose": "3×10"}]}
  ```
  `format`: one free-text line, the post's format (rounds, time per exercise, rest); when the
  video gives none, a suggestion marked as such (« suggestion: 3 rounds »). `items`: every
  exercise sub-folder, in video order, each with its own free-text `dose` (`""` when none is
  given). `why` and `key_points` are written in the user's language, like the sheets. Optional
  `"thumbnail": "<exercise slug>/img/thumb.jpg"`; leave it out and the app uses the first
  item's.
- **Requeued old sessions**: a backend set up before sessions v2 may still hold old one-page
  sessions; the app hides them and Settings tells the user to run `rb.py requeue-sessions`, which
  puts their videos back in the queue. Process them like any video, and keep `source.url`
  **exactly** the request's URL: the publish deletes the old page that has the same `source.url`
  (with its images), and nothing else does. `rb.py publish` refuses the old format (`exercises[]`).

## 4. Publish and close
- Sheet: `python3 tools/rb.py publish work/<slug>` uploads the images and upserts the sheet.
- Session: `python3 tools/rb.py publish work/<session-slug>` checks the whole folder first, then
  publishes each exercise sheet, then the session, then deletes the old one-page session of the
  same video if an older backend still has one. « no sessions table »: the user has to re-run
  `supabase/schema.sql` on their project (`docs/own-supabase.md`); say so and flag the request
  with `rb.py error`. Reprocessing a video rewrites its session: changes made to it in the app
  (order, doses, removed items) are lost.
- Check in the app (Chrome): open `<app url>#<slug>` (for a session, `<app url>#session/<slug>`, then
  each exercise sheet from it).
- `python3 tools/rb.py done <id> --slug <slug>` (a session: its slug). On failure:
  `rb.py error <id> --note "<why>"`.
- Give the user the sheet link (a session: the links of its exercise sheets). Then take the next
  queued request.
