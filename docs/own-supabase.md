# Run Reelbook on your own Supabase project

Ten minutes, free tier, no card. You get a private backend that only you can read.

## 1. Create the project

1. Sign up at https://supabase.com and create a new project (any name, any region close to you).
   Keep the database password somewhere: you do not need it for Reelbook, but Supabase asks for it.
2. Wait for the project to be ready (about a minute).

## 2. Run the schema

1. Dashboard → **SQL Editor** → **New query**.
2. Paste the whole content of [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**.
   It creates three tables (`requests`, `sheets`, `notes`), their row level security policies and
   a private storage bucket `sheets`. It is safe to run again later.

## 3. Allow password sign-in without email confirmation (recommended for a single user)

Dashboard → **Authentication** → **Providers** → **Email**: keep *Email* enabled and turn
**Confirm email** off. Otherwise the free built-in mailer sends a confirmation link, limited to a
few emails per hour, which is fine too: confirm once and sign in.

## 4. Get the two values the app needs

Dashboard → **Project settings** → **API**:

- **Project URL**, like `https://abcdefgh.supabase.co`
- **anon public** key (a long `eyJ…` string)

The anon key is meant to live in a browser: row level security is what protects your data,
and every table in the schema is locked to the signed-in user.

## 5. Open the app and sign up

Open the Reelbook app (the hosted copy at the URL given in the README, or your own copy of
`app/` served from any static host or `python3 -m http.server` inside `app/`). Choose **My own
Supabase project**, paste URL and anon key, create an account with an email and a password.

Install it on your phone from the browser menu: *Add to Home screen* (Android, Chrome) or
*Share → Add to Home Screen* (iOS, Safari).

## 6. Connect Claude Code

On the computer where Claude Code and Chrome run:

```
git clone https://github.com/lt20/reelbook
cd reelbook
python3 -m pip install pillow
python3 tools/rb.py login --url … --key …   # copy the exact command from the app's Settings page
ln -s "$PWD/skill/exercise-reel" ~/.claude/skills/exercise-reel
```

Then, in any Claude Code session: `/exercise-reel`. See the README for what happens next.

## Limits of the free tier

- 500 MB database, 1 GB storage. A sheet weighs about 2 MB of images: room for roughly 400 sheets.
- Projects paused after a week without traffic: open the app, it wakes up in a few seconds.
