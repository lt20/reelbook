# Sessions v2: a session is made of exercises

Framing doc, decided with Laurent on 2026-11-02 (grill session). Reread before touching any lot below.
PR 1 (#12) shipped the independent part: queue only on the home page, « Move » on simple sheets.

## Today (v1)

A session is one `sheets` row with `kind = 'session'`: one HTML page written by Claude from one video,
each exercise a `<section class="exo">` inside it, listed in `sheets.exercises` (jsonb) for the cards.
Exercises are not sheets: their content and photos live only in the session page.

## Decisions

| # | Decision |
|---|----------|
| 1 | In a notebook, « In the queue » is hidden; « + Add a video » stays and still notes the notebook as a hint. (#12) |
| 2 | « Move » = Notebook menu, then Group menu (notebook's groups ∪ groups in use ∪ « New group… »). Also changes group within a notebook. (#12) |
| 4 | Two deliveries: #12 now, sessions v2 as its own chantier (this doc). |
| 5 | A session belongs to one notebook and **links** to exercises (= sheets) from any group, even another notebook. One exercise can sit in several sessions. Moving an exercise never removes it from a session; only a manual removal does. |
| 5b | Reelbook still builds sessions automatically from a video with several exercises: N exercise sheets + 1 session linking them in video order. |
| 6 | A session holds: title, a free-text format line (« 5 rounds · 60 s rest »), an ordered list of items, each with its own free-text dose (« 30 s », « 3×10 »). Video sessions add `why`, `key_points` and `source`, filled by Claude, read-only. User sessions hide them when empty. |
| 7 | Existing v1 sessions are **requeued** and reprocessed by Claude (few of them, no notes attached). |
| 8 | Two entry points: « + New session » in a notebook's Sessions section (title, then tick exercises from the notebook, by group, with search), and « Add to session » on a sheet page (pick a session or create one). Session page has an « Edit » mode: ↑ ↓ to reorder, dose, format, remove an item, delete the session. |
| 9 | An exercise sheet from a video session is the light v1 section turned into a sheet (description, numbered photos, 2–3 cues, easier version, one-line summary for the card). Why / key points / dose stay on the session. The sheet shows « From the session … ». Processing time unchanged. |
| 10 | Video sessions are editable like user sessions (order, dose, format, items); why / key points / source read-only. Reprocessing the video rewrites the session and drops the edits (said in the help). |
| 11 | A session can be moved to another notebook (Move, Notebook menu only). Its exercises do not follow. |

## Technical choices (made by Claude, reversible)

- **Schema**, appended to `supabase/schema.sql`, idempotent, RLS « own rows » like the others:
  ```
  sessions (
    id uuid pk default gen_random_uuid(), user_id uuid default auth.uid() → auth.users on delete cascade,
    slug text not null, theme text not null, title text not null,
    format text not null default '', why text not null default '', key_points jsonb not null default '[]',
    source jsonb not null default '{}',          -- {author, url, platform}; empty for user sessions
    origin text not null default 'user' check (origin in ('video','user')),
    thumbnail text not null default '',          -- storage path <user_id>/<sheet slug>/img/..., from the first item if empty
    items jsonb not null default '[]',           -- ordered [{slug, dose}]; slug = sheets.slug
    created_at, updated_at (touch trigger), unique (user_id, slug))
  ```
  `items` as one jsonb array: a reorder is one atomic update. An item whose sheet no longer exists is skipped at render.
- Sessions are rendered by the app from these fields; no session HTML any more.
- « in N sessions » tag and « From the session … » are computed client-side from `sessions.items`; no extra column.
- The app **tolerates a backend without the `sessions` table** (self-hosted users who have not re-run the schema):
  session features hidden, one line in Settings: « Re-run supabase/schema.sql to enable sessions. »
- v1 sessions (`sheets.kind = 'session'`) keep rendering as today until migrated.
- `rb.py`:
  - `publish` accepts a session folder v2 (`meta.json` `kind: "session"`, `format`, `why`, `key_points`,
    `items[{slug, dose}]`, plus one sub-folder per exercise sheet): publishes the sheets, then upserts the session
    (`origin: 'video'`). If a v1 session row has the same `source.url`, it is deleted with its storage files.
  - `requeue-sessions [--dry-run]`: inserts one `requests` row per v1 session source URL (skips a URL already queued).
- Skill (`skill/reelbook/SKILL.md`, `templates/`): section 3 bis rewritten for v2; new `templates/exercise.html`
  (light sheet), `templates/session.html` removed once v1 is gone.

## Lots

| Lot | Content | Files | Depends on |
|-----|---------|-------|------------|
| S1 | Schema + `rb.py` (publish v2, legacy delete, `requeue-sessions`) + skill and templates | `supabase/`, `tools/rb.py`, `skill/`, `templates/`, `docs/own-supabase.md` | nothing |
| S2 | App, read side: session page from structure, Sessions section, « in N sessions », « From the session », Move for sessions, legacy fallback, missing-table tolerance | `app/` | #12 merged, S1 schema |
| S3 | App, composition: « + New session », « Add to session », Edit mode | `app/` | S2 |
| S4 | Cleanup once Laurent has run `requeue-sessions` and the queue is empty: drop v1 rendering, `exercises` column use, `templates/session.html` | `app/`, `templates/`, `skill/` | S1–S3 + migration done |

S2 and S3 touch `app/index.html`: one after the other, never stacked.

## Laurent's part (prod)

1. Run the updated `supabase/schema.sql` on the reelbook project (and the hosted backend) after S1 merges.
2. After S2 + S3: `python3 tools/rb.py requeue-sessions --dry-run`, then without `--dry-run`, then `/reelbook`.
3. Business test of each lot from its PR's « Test métier » section.
