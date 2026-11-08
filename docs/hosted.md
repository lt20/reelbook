# The hosted backend

The maintainers run one Supabase project for people who do not want to create their own.
It is enabled by filling `hosted.url` and `hosted.anonKey` in `app/config.js`.

- Same schema as `supabase/schema.sql`, same row level security: every row and every file is
  tied to the account that created it. Maintainers can see usage, not read your sheets through
  the app, but they administer the database, so treat it as a trusted third party.
- Free for now. A paid hosted plan is planned; there is no checkout yet. Existing accounts get
  notice before any change and can export: the
  skill's `rb.py` works against any backend, and `supabase/schema.sql` recreates yours in
  minutes.
- Quotas per account, enforced by the database: 10 video links a day, 300 sheets, 200 MB of
  photos (README, « Limits on a shared backend »). Settings shows your usage. More on request.

## The beta: 50 spots and a waiting list

The hosted backend is a beta with a limited number of accounts. The first screen and the sign-up screen say how
many spots are taken, read from `beta_seats()`.

- When the beta is full or closed, the hosted card becomes a **waiting list**: first name, email and a consent box.
  No account is created. Reelbook keeps those two fields only to say a spot has opened; they are deleted when that
  address signs up, or on request. An address already listed gets the same answer as a new one.
- **Your own Supabase is always open**, without these limits: it is the way in when the beta is full
  ([docs/own-supabase.md](own-supabase.md)). Its choice is made on the first screen or on the « Where should your
  new account live? » screen, and on the sign-in form; the hosted sign-up form no longer offers it.
- A sign-up can still be refused at the last moment (the last spot just went, or enough sign-ups for today). The app
  says which, in French or English, and leads to the waiting list when that is the way in. Accounts already created
  are not concerned: they keep signing in.
- The whole project also has limits of its own (videos a day, total photos): a refused link says so, and that the
  next day or later is the time to try again.

A backend without `beta_seats()` or without a row in `beta_settings` shows no count and no waiting list, and signs
up as before. To turn the cap on, see « Beta locks » in `supabase/schema.sql`: mark the maintainer's account `exempt`
first, then add the settings row. Deleting the row lifts every lock at once.

## Moving to your own project

To move from hosted to your own project: create it, run the schema, change the backend in the
app's Settings, sign up again, then republish your sheets with `rb.py publish` from the local
`work/` folders (keep them).
