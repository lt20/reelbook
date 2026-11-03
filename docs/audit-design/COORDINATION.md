# Design audit — phases P0 to P4: coordination

Source: the design audit of 3 Nov 2026 (six expert reviews, consolidated plan, private artifact
https://claude.ai/artifact/NFEons9RCq5bvS2xpFaCM5). First chantier (3 Nov): phases **P0 (fixes), P1 (usable during the
workout) and P2 (practice loop)**, lots L0–L8. Second chantier (from 3 Nov evening, « enchaîne sur P3 et P4 en
autonomie »): **P3 (session player) and P4 (scale and finish)**, lots L9–L20.

## Protocol (Paul's, adapted to Reelbook — Laurent, 3 Nov 2026: « follow the Paul rules, as autonomous as possible »)

- One **coordinator** session (does not code: splits, briefs, verifies, merges, keeps this file).
- One **agent per lot** = one worktree (`.claude/worktrees/<slug>`, from `origin/main`) = one branch = one PR.
- **No human test.** A lot is done when its DoD is green **and** Codex's review of the PR head says `ok`.
- **Codex, the second look** (`codex exec`, Laurent's ChatGPT login, never the API, never in CI):
  - reviews every PR (`scripts/codex-review.sh <PR> --post`, verdict `ok` | `bloquant`, 3 passes max, then the
    coordinator arbitrates in writing in the PR);
  - writes **acceptance tests before the code** for the lots marked « acceptance » below
    (`scripts/codex-acceptance.sh`, separate commit). The lot agent never edits them; if one looks wrong it says so
    here under *Open questions* and Codex decides.
- **Merge**: the coordinator merges (squash) once CI (`auth-flow`, required) is green and the Codex verdict on the
  head is `ok`. Merging to `main` deploys the app (GitHub Pages): it is the release.
- **What stays with Laurent** (decision 3, 3 Nov): `db push` of `supabase/schema.sql` to the hosted project, and any
  PR touching `.github/**`. The app must keep working on a backend without the new table until he pushes it.
- 3 agents at most at the same time; two lots that touch the same screen run one after the other. Merge conflict:
  `git merge origin/main`, never rebase or force-push.
- Journal: one `progress/YYYY-MM-DD-<lot>.md` per lot, in its PR (format in `progress/README.md`, created by L0).
- Agent context budget ~200K, handover note `progress/HANDOFF-<lot>.md` from 170K, clean stop past 250K.
- No read of production data, by any means. Public repo: never commit a frame from a third-party video
  (Laurent's sheets in `work/` are local only).

## Decisions taken (3 Nov 2026, « OK recos »)

1. Personal use first: P0 → P4, opening to tinkerers (P5) later.
2. UI stays in English. Session headings follow the content language later (P5, O6 quick win), not in this chantier.
3. Two additive migrations: practice log in P2 (this chantier), full-text search in P4. `db push` by Laurent.
4. Public demo with Laurent's own videos: later (P5). **Consequence here**: no screenshot of real sheets in the
   README (frames belong to third parties); README gets the app link only.
5. (3 Nov, P3/P4, « OK recos ») The full-text search backfill of existing
   sheets writes to production: the coordinator prepares `rb.py backfill-search`, **Laurent runs it** after the
   `db push` of the column.
6. (3 Nov, « OK recos ») The new « technique » template applies to new videos only; existing kitesurf / fight sheets are not
   reprocessed (it would spend Laurent's Claude runs).
7. Arbitrated on the audit: no bottom tab bar (three destinations): sticky nav bar + floating « + » button.
   Notebook pages keep photo cards, one horizontal row per group.
8. Every local state tied to an account's content is stored per user (`<key>.<user id>`) — Codex, L7 pass 4.

## Lots

| Lot | What | Audit items | Size | Acceptance by Codex | Depends on | Wave | Branch | Status |
|---|---|---|---|---|---|---|---|---|
| L0 | Tooling: Codex scripts, preview with fake backend, iPhone screenshots | — | M | no | — | A | `chore/agent-tooling` | merged #26 |
| L1 | App fixes: session format truncation, copy bugs, sign-up redirect, accessibility base | C1 C2 C5 C6 | M | no (agent writes the regression tests) | — | A | `fix/p0-app` | merged #25 |
| L2 | Docs and install: app link, Supabase pause, Python 3.9 | C3 C4 | S | no | — | A | `docs/p0-install` | merged #27 |
| L3 | Sheet in use: keep screen on, gesture first, full-screen photos | Q1 Q3 Q4 | M | no | L0 L1 | B | `feat/p1-sheet` | merged #29 |
| L4 | Queue and polish: queue states, retry, tap targets, danger colour, session format pill | Q6 Q7 Q8 | M | yes | L0 L1 | B | `feat/p1-queue` | merged #28 |
| L5 | Session navigation and notes autosave | Q5 Q2 | M | yes | L3 | C | `feat/p1-session-nav` | merged #29 |
| L6 | Practice log (schema + UI) | B1 | L | yes | L5 | D | `feat/p2-practice` | merged #30 |
| L7 | New arrivals and « Something wrong? » | B2 B4 | M | yes | L4 | C | `feat/p2-arrivals` | merged #28 |
| L8 | « To try » shelf | B3 | S | yes | L6 L7 | E | `feat/p2-to-try` | in progress |

### P3 and P4 (second chantier)

| Lot | What | Audit items | Size | Acceptance by Codex | Depends on | Wave | Branch | Status |
|---|---|---|---|---|---|---|---|---|
| L9 | Structured dose: parser + skill fields | S2 | S | yes | — | F | `feat/p3-dose` | waiting |
| L10 | Session player: one exercise per screen | S1 | L | yes | L9 | G | `feat/p3-player` | waiting |
| L11 | Player: sets, rest timer, end of session | S3 S4 | M | yes | L10 | H | `feat/p3-sets` | waiting |
| L12 | Notebook page in five screens + photo cards | E1 E2 | M | yes | — | F | `feat/p4-notebook` | waiting |
| L13 | Home recomposed | E3 | S | yes | L12 L8 | G | `feat/p4-home` | waiting |
| L14 | Full-text search (column + backfill + app) — protected | E4 | M | yes | L13 | H | `feat/p4-search` | waiting |
| L15 | Skill writing rules | E5 | S | no | L9 | G | `docs/p4-skill-rules` | waiting |
| L16 | « Technique » template for board sports and fighting — protected (`app/config.js`) | E6 | M | no | L15 | H | `feat/p4-technique` | waiting |
| L17 | Native navigation: sticky bar, back, scroll restore, ⋯ menu, floating + | E7 | M | yes | L11 L13 L18 | I | `feat/p4-nav` | waiting |
| L18 | Bottom sheets instead of centred dialogs | E8 | M | no | L11 | I | `feat/p4-sheets` | waiting |
| L19 | Instant start: service worker, cached catalogue, parallel loads, self-hosted fonts | E9 | M | yes | — | F | `feat/p4-instant` | waiting |
| L20 | Type scale in rem, tokens, wordmark SVG | E10 | M | no | all others | J | `feat/p4-type` | waiting |

Ports: L9 8779, L10 8780 … L20 8790.

Specs: `docs/audit-design/lots/<lot>.md`. Preview ports (one per lot, to run in parallel): L0 8770, L1 8771 … L8 8778.

### Files each lot touches (to keep parallel lots apart)
- L0: `scripts/**`, `tools/preview/**`, `tests/e2e/**`, `tests/fixtures/**`, `progress/README.md`.
- L1: `app/index.html` (CSS head, setup/auth copy, home copy, `loadSheet` wrapper), `app/sessions.js`, `tests/*.cjs`.
- L2: `README.md`, `docs/own-supabase.md`, `app/install.sh`, `app/install.ps1`, `skill/reelbook/SKILL.md` (Python line only), `tools/*.py` if needed.
- L3: `app/index.html` sheet view (`loadSheet`, `showSheet`, `topNav`) + CSS.
- L4: `app/index.html` home queue (`refreshQueue`, queue markup), cards (`card`, `v2Card`), global CSS tokens.
- L5: `app/index.html` session view, sheet top banner, notes (`wireNotes`), `app/sessions.js`, `skill/reelbook/SKILL.md`.
- L6: `supabase/schema.sql`, `app/index.html` (catalogue, sheet/session top, cards, home counter), `README.md` (schema note).
- L7: `app/index.html` home, sheet/session bottom, `tools/nightly.sh`, `tools/rb.py`, `skill/reelbook/SKILL.md`, `tests/rb-*.py`.
- L8: `app/index.html` home.

## Open questions
_(P0–P2 questions below were settled by the coordinator's arbitration comments in each PR: L4 dot before « 1 failed »
and `animationend` toast accepted (#28); L5 double write of the top bar accepted (#30); L6 Log assertion scoped
(#32); L7 slug and `rb.seen.<user id>` (#31).)_

- **L4, `tests/acceptance/l4/queue.test.cjs` (summary row)** — the spec wants the failed count « in danger colour »,
  the test matches `3 in the queue · 1 failed` as one run of text in `#queue-summary`'s HTML, so `1 failed` cannot
  sit in its own coloured `<span>`. L4 ships the label in ink with a danger-coloured dot before it. Proposal: accept
  the dot, or relax the regex to allow a tag around `1 failed` (L4 then colours the count). For Codex.
- **L4, `tests/harness.cjs` timers** — the harness runs any `setTimeout` at once, so a 5 s `setTimeout` would send the
  queue delete before the test's « no write yet » assertion. L4 ends the « Removed · Undo » toast on the
  `animationend` of its 5 s countdown bar instead (plus `pagehide` / page hidden). Measured in the preview: toast
  visible at 4.5 s, gone and delete sent at 5.5 s; Undo sends nothing. For Codex: fine, or should the harness grow
  a fake clock?
- **L5, `tests/acceptance/l5/navigation.test.cjs` « Group · Back »** (raised by the L5 agent, for Codex): the test
  reads `page.element('sheet-top').innerHTML` right after opening a sheet. In the harness that element is a separate
  fake: it only holds what the app writes to `$('sheet-top').innerHTML` itself, never the `<div id="sheet-top">`
  rendered inside `#view`. To pass, `showSheet` now sets the top bar a second time after rendering (same markup,
  harmless in a browser). Suggestion: read `page.element('view').innerHTML` there, as the other L5 tests do; the
  extra line in `showSheet` can then go.

- **L9, three acceptance tests that cannot pass as written** (raised by the L9 agent, for Codex; the code they aim at
  is in place and covered by `tests/dose.test.cjs` and `tests/rb-sessions.test.py`):
  1. `l9/dose-parser.test.cjs` « every fixture and Laurent session format… »: every `parseRest` value in the list
     passes; the last line counts the non-null expectations as 6, but the list holds 7 (30, 60, 90, 60, 90, 30, 90).
     Fix: `7` (and « 7/13 » in the message).
  2. `l9/publish.test.cjs`: the stubbed `_read_session` returns the sub-folder as `None`, and `_publish_session`
     evaluates `sub / "meta.json"` as the argument of the (stubbed) `_check_theme` → `TypeError` before any POST.
     The real `_read_session` always returns a `Path`. Fix: `[('move', pathlib.Path('/unused/move'), {...})]`.
  3. `l9/structured-items.test.cjs` « a backend without the sessions table still loads its sheets »: asserts
     `element('home').hidden === true` on `#strength`, but a notebook page is drawn inside `#home` (`route()` ends in
     `show('home')`; `#groups` is a child of `#home`), so `home` is visible there by design (`tests/auth-flow.test.cjs`
     runs the same scenario without that line). Fix: drop the line, or assert `element('view').hidden === true`.
- **L7, `tests/acceptance/l7/report-correction.test.cjs` (Redo payload)** — settled (3 Nov, coordinator decision
  after Codex review ×3): slug added (`{url, theme, note, slug}`, spec §B4 updated).

- **L8, `tests/acceptance/l8/to-try.test.cjs` « hidden when no sheet qualifies », case `empty catalogue`** —
  settled (3 Nov, coordinator decision after Codex review ×3): the app sends a user with no sheet to `#welcome`, so
  that case alone now stores `rb.welcome.u1` before loading the home page.

## Debt (found during P0–P2, not blocking)
- Queue: a stale read can show a removed row until the next refresh (#28, Codex pass 4).
- Notes: drafts `rb.draft.<uid>.<key>` are not cleared on sign-out (#30).
- Practice log: a save stored at 23:59 whose answer is lost, retried after midnight, makes a duplicate entry (#32).
- `scripts/codex-acceptance.sh --out` accepts any folder of the repo; should be limited to `tests/` (L0).
- Screenshots run in Chromium, not WebKit (L0).
- Queue delete on page close may not leave a real iPhone (supabase-js fetches the token first) (#28).

## Known pitfalls
- **Every change to `app/sessions.js` or `app/sheet.js` bumps its `?v=` in `index.html` and in `SHELL` of `app/sw.js`,
  and the cache `VERSION`** (Codex, L5 pass 4: an installed PWA could pair a new `index.html` with an old module).
- Every local state tied to an account's content is keyed per user (decision 8).
- `app/index.html` is one ~1 800-line file (it was 1 200): never read it whole; `grep -n` then `sed -n`. Parallel lots touch
  different regions; expect small merge conflicts in the CSS head.
- `tests/auth-flow.test.cjs` runs the app script in a `vm` with a fake DOM: new DOM APIs (`dialog.showModal`,
  `navigator.wakeLock`, `IntersectionObserver`) must be guarded so the harness keeps working.
- `main` requires an up-to-date branch (`strict`): before merging, `gh pr update-branch <N>` (merge, not rebase) and
  wait for `auth-flow`.
- Never `await` a Supabase call inside `onAuthStateChange` (auth lock: the catalogue never loads).
- iOS: no Web Share Target, no Vibration API; Screen Wake Lock works in an installed PWA from iOS 18.4.

## Steps
### L0
### L1
### L2
