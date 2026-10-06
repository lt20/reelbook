# The hosted backend

The maintainers run one Supabase project for people who do not want to create their own.
It is enabled by filling `hosted.url` and `hosted.anonKey` in `app/config.js`.

- Same schema as `supabase/schema.sql`, same row level security: every row and every file is
  tied to the account that created it. Maintainers can see usage, not read your sheets through
  the app, but they administer the database, so treat it as a trusted third party.
- Free for now. If it becomes a paid option, existing accounts get notice and can export: the
  skill's `rb.py` works against any backend, and `supabase/schema.sql` recreates yours in
  minutes.
- Quota: to be set per account (storage and number of requests per day) before opening widely.

To move from hosted to your own project: create it, run the schema, change the backend in the
app's Settings, sign up again, then republish your sheets with `rb.py publish` from the local
`work/` folders (keep them).
