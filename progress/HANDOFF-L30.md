# L30 handover (PR #75, branch feat/p6-landing)

## Done
- Landing (mockup v2) in `app/index.html` (`#intro`, `lp-` CSS under `#intro`), logic and FR / EN dictionary in
  `app/landing.js` (`window.RBL`), app strings via `T(key, english)`; seats from `beta_seats()`; dance images;
  MMA manifest `app/assets/mma/image-map.json` + README; `sw.js` VERSION 41 + `landing.js?v=1`.
- Tests: `tests/landing.test.cjs` (8), `tests/harness.cjs` options `win` / `rpc`; L25 acceptance cases rewritten in
  a separate commit (to arbitrate). All suites 493/493.
- Captures 390 / 1440 × FR / EN × MMA / Dance, WebKit + Chromium: overflow 0, headings ≤ 2 lines, 0 console error.
  Capture scripts (not committed): the lot's scratchpad `caps.mjs`, `flow.mjs` (preview on 8800, `beta_seats` stubbed
  with an init script that wraps `window.supabase.createClient`).

## Left
- Codex review passes (`scripts/codex-review.sh 75 --post`, 3 max), fixes between passes. Status: see PR comments.
- PR stays draft: the coordinator decides.

## Pitfalls
- `tests/l21-identity.test.cjs`: every `transition:` up to `</style>` must sit in
  `@media (prefers-reduced-motion:no-preference)`.
- In-page links of the landing must never change `location.hash` (the app routes on it): the click handler in
  `landing.js` prevents it.
- Lazy images: scroll the page before a full-page screenshot.

## DoD state
- Tests 493/493; captures 10/10 in WebKit and Chromium (overflow 0, headings ≤ 2 lines, 0 console error, 0 third-party request).
- Journal `progress/2026-11-04-L30.md` (update its `codex:` line).

## Codex state (takeover, 4 Nov): 3/3 passes used, all bloquant, every item fixed
- Pass 1 @ 37a1521 → fixed in ab7ebfb · pass 2 @ ab7ebfb → fixed in 13fd6d1 · pass 3 @ 13fd6d1 → fixed in fff577f.
- fff577f is not re-reviewed: a 4th pass needs the coordinator (`scripts/codex-review.sh 75 --post --force-pass`).
- Details and the `beta_seats` capture incident: journal `progress/2026-11-04-L30.md`, « Codex fixes ».
- PR stays draft.

## Gaps in the mockup (reported in the PR)
- Inert: « Ajouter le raccourci », original-video links, example search results, « Créer le carnet », « Fait aujourd'hui ».
- No language switch outside the landing; « See a demo » kept under the landing; « a computer that stays on » no longer said.
- Copy I wrote: MMA placeholder caption, aria labels, all French of auth / setup / welcome; footer cut to its first
  sentence; « Natan Levy » → « [compte] ».
- Before L32 is pushed, `beta_seats()` 404s on hosted: line hidden, the browser logs the failed request (prod only).
