# The demo notebook (`#demo`)

What a visitor sees at `https://lt20.github.io/reelbook/#demo` (or `?demo`): a read-only notebook, no account,
no backend. Everything comes from this folder; the app has no list of its own, so replacing the content needs no
code.

**Today's content is a placeholder**: four sheets and one session drawn for Reelbook (simple silhouettes made by
`scripts/demo-drawings.py`, no frame from any video). It is meant to be replaced by exercises Laurent films himself.

## What is in the folder

```
app/demo/
  catalogue.json          the list: notebooks, sheets (title, summary, group, thumbnail), the session
  goblet-squat/           one folder per sheet, named after its slug
    index.html            the sheet, the same html as any Reelbook sheet (templates/sheet.html or technique.html)
    img/                  its photos: thumb + steps (.jpg, .png, .svg…)
  push-up/ dead-bug/ water-start/
```

## Replacing it with your own footage (no code)

1. **Film and process** the exercises as usual: queue your own video, run `/reelbook`. You get normal sheets in
   your account, with photos taken from *your* video (you own the footage, so it may go in this public repo).
2. **Copy each sheet here**: a folder named after the sheet's slug (lower case, digits, dashes), with the sheet's
   `index.html` and its `img/` folder. In `index.html`, photos are written `img/<file>`; keep them that way.
   The easiest source is the `work/<slug>/` folder the skill builds on your computer before publishing.
3. **Edit `catalogue.json`**: one entry per sheet under `sheets` (`slug` = folder name, `notebook` = a notebook id
   such as `strength` or `kitesurf`, `title`, `summary`, `group`, `thumbnail` = `img/<file>` inside its folder,
   `author` = the credit shown on the card). The session goes under `sessions`: its `items` list sheet slugs in
   order, each with its `dose`; its `thumbnail` is a path from this folder (`goblet-squat/img/thumb.jpg`).
4. **Delete** the placeholder folders you no longer list, and their entries.
5. Check the credit line at the bottom of each sheet (`<footer>`), then open `#demo` in a browser before merging.

Rules: no frame from someone else's video (the repo is public); four sheets keep the acceptance test
(`tests/acceptance/l27/`) green. If you change that number, update the test in the same PR.
An entry the app cannot read (a slug with other characters, a path with `..`) is skipped, not shown broken.

The service worker keeps every demo file after the first visit, so a new demo shows on the visitor's next start.
