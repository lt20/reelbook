# Lot journal

One file per lot, written by the lot agent and committed in the lot's PR:
`progress/YYYY-MM-DD-<lot>.md` (the date the lot started, e.g. `progress/2026-11-03-L0.md`).
A handover note, when an agent stops before the end, is `progress/HANDOFF-<lot>.md`.

## Format

```markdown
---
lot: L3
pr: 31
items: [Q1, Q3, Q4]                 # audit items delivered (docs/audit-design/COORDINATION.md)
test:                               # commands actually run on the final head, with their result
  - "node --check app/*.js — ok"
  - "node --test tests/*.cjs — 41/41"
  - "python3 -I tests/rb-queue.test.py — ok"
e2e: "tests/e2e/steps/smoke.json + tests/e2e/steps/l3.json, light and dark — 12/12 ok"
codex: "ok @ 1a2b3c4d5e6f (pass 2/3)"
---

## What
What the lot changes, as the user sees it.

## Why
The audit item or the problem behind it.

## Decisions
Choices made where the spec left a gap (and flagged « À confirmer » in the PR).

## Pitfalls
What cost time, what the next lot should know.
```

Only what was actually run goes under `test`, `e2e` and `codex`; « not run » is a valid value. There is no
checker script: the coordinator reads the file when reviewing the PR.
