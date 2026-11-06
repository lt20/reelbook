# The demo notebook (`#demo`)

What a visitor sees at `https://lt20.github.io/reelbook/#demo` (or `?demo`): a read-only notebook, no account,
no backend. Everything comes from this folder; the app has no list of its own, so replacing the content needs no
code.

**Today's content** (L37, 6 Nov 2026): the five examples of the landing page (mockup v3), one sheet per notebook,
and one session that chains them. They are **generated demonstrations made from videos**: staged images of other
people in other places, holding the same positions; not Laurent's footage and not frames from the original videos.
Laurent holds the right to publish them (6 Nov 2026). Each sheet's footer says « Generated demonstration », with no
third-party author's name.

| Folder | Notebook | Group | Template |
|---|---|---|---|
| `spinning-back-kick/` | `fight` | Kicks & knees | `templates/technique.html` |
| `pirouette-en-dehors/` | `dance` | Turns | `templates/sheet.html` |
| `diagonal-stretch/` | `yoga` | Hips | `templates/sheet.html` |
| `nose-press-on-a-box/` | `snow` | Park | `templates/technique.html` |
| `push-up-taps-jump-squat/` | `strength` | HIIT | `templates/sheet.html` |

The texts are the English ones of the mockup (title, six steps, alt texts); a template section the mockup gives no
text for is left out rather than invented. Photos: 512 × 640 JPEG, thumbnails 240 px on the long side, quality 70
(`sips -Z`, no crop); the whole folder weighs about 1.9 MB.

## What is in the folder

```
app/demo/
  catalogue.json          the list: notebooks, sheets (title, summary, group, thumbnail), the session
  spinning-back-kick/     one folder per sheet, named after its slug
    index.html            the sheet, the same html as any Reelbook sheet (templates/sheet.html or technique.html)
    img/                  its photos: thumb + steps (.jpg, .png, .svg…)
  pirouette-en-dehors/ diagonal-stretch/ nose-press-on-a-box/ push-up-taps-jump-squat/
```

## Replacing it (no code)

1. **Make the sheets** as usual: queue a video, run `/reelbook`. You get normal sheets in your account. Only
   photos you may publish go here (the repo is public): your own footage, or images you hold the rights to.
2. **Copy each sheet here**: a folder named after the sheet's slug (lower case, digits, dashes), with the sheet's
   `index.html` and its `img/` folder. In `index.html`, photos are written `img/<file>`; keep them that way.
   The easiest source is the `work/<slug>/` folder the skill builds on your computer before publishing.
3. **Edit `catalogue.json`**: one entry per sheet under `sheets` (`slug` = folder name, `notebook` = a notebook id
   of `app/config.js` such as `strength` or `fight`, `title`, `summary`, `group`, `thumbnail` = `img/<file>` inside
   its folder, `author` = the credit shown on the card). The session goes under `sessions`: its `items` list sheet
   slugs in order, each with its `dose`; its `thumbnail` is a path from this folder
   (`spinning-back-kick/img/thumb.jpg`).
4. **Delete** the folders you no longer list, and their entries.
5. Check the credit line at the bottom of each sheet (`<footer>`), then open `#demo` in a browser before merging.

Rules: no frame from someone else's video (the repo is public); five sheets keep the acceptance test
(`tests/acceptance/l27/`) green. If you change that number, update the test in the same PR.
An entry the app cannot read (a slug with other characters, a path with `..`) is skipped, not shown broken.

The service worker keeps every demo file after the first visit, so a new demo shows on the visitor's next start.
