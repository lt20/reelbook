# Design audit — phases P0, P1, P2: coordination

Source: the design audit of 3 Nov 2026 (six expert reviews, consolidated plan, private artifact
https://claude.ai/artifact/NFEons9RCq5bvS2xpFaCM5). This chantier delivers phases **P0 (fixes), P1 (usable during the
workout) and P2 (practice loop)**: 18 items, ~50 h estimated.

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

## Lots

| Lot | What | Audit items | Size | Acceptance by Codex | Depends on | Wave | Branch | Status |
|---|---|---|---|---|---|---|---|---|
| L0 | Tooling: Codex scripts, preview with fake backend, iPhone screenshots | — | M | no | — | A | `chore/agent-tooling` | to launch |
| L1 | App fixes: session format truncation, copy bugs, sign-up redirect, accessibility base | C1 C2 C5 C6 | M | no (agent writes the regression tests) | — | A | `fix/p0-app` | to launch |
| L2 | Docs and install: app link, Supabase pause, Python 3.9 | C3 C4 | S | no | — | A | `docs/p0-install` | to launch |
| L3 | Sheet in use: keep screen on, gesture first, full-screen photos | Q1 Q3 Q4 | M | no | L0 L1 | B | `feat/p1-sheet` | waiting |
| L4 | Queue and polish: queue states, retry, tap targets, danger colour, session format pill | Q6 Q7 Q8 | M | yes | L0 L1 | B | `feat/p1-queue` | waiting |
| L5 | Session navigation and notes autosave | Q5 Q2 | M | yes | L3 | C | `feat/p1-session-nav` | waiting |
| L6 | Practice log (schema + UI) | B1 | L | yes | L5 | D | `feat/p2-practice` | waiting |
| L7 | New arrivals and « Something wrong? » | B2 B4 | M | yes | L4 | C | `feat/p2-arrivals` | waiting |
| L8 | « To try » shelf | B3 | S | yes | L6 L7 | E | `feat/p2-to-try` | waiting |

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
- **L4, `tests/acceptance/l4/queue.test.cjs` (summary row)** — the spec wants the failed count « in danger colour »,
  the test matches `3 in the queue · 1 failed` as one run of text in `#queue-summary`'s HTML, so `1 failed` cannot
  sit in its own coloured `<span>`. L4 ships the label in ink with a danger-coloured dot before it. Proposal: accept
  the dot, or relax the regex to allow a tag around `1 failed` (L4 then colours the count). For Codex.
- **L4, `tests/harness.cjs` timers** — the harness runs any `setTimeout` at once, so a 5 s `setTimeout` would send the
  queue delete before the test's « no write yet » assertion. L4 ends the « Removed · Undo » toast on the
  `animationend` of its 5 s countdown bar instead (plus `pagehide` / page hidden). Measured in the preview: toast
  visible at 4.5 s, gone and delete sent at 5.5 s; Undo sends nothing. For Codex: fine, or should the harness grow
  a fake clock?

- **L7, `tests/acceptance/l7/report-correction.test.cjs` (Redo payload)** — the test wants the insert to be exactly
  `{url, theme, note}`, so the page the user flagged (one exercise of a session made from the same video) is not
  sent. Codex's review (pass 1) asked for it. L7 ships `rb.py queue` with `redo_of` (the sheets and sessions
  published from that URL) and the skill reads the note to tell which exercise is wrong. Proposal: allow a
  `slug` field in the payload (the `requests.slug` column, otherwise set by `rb.py done`) so the skill knows the
  page for sure. For Codex.

## Known pitfalls
- `app/index.html` is one ~1 200-line file: never read it whole; `grep -n` then `sed -n`. Parallel lots touch
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
