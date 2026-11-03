# Run Reelbook on your own Supabase project

Ten minutes, free tier, no card. You get a private backend that only you can read.

## 1. Create the project

1. Sign up at https://supabase.com and create a new project (any name, any region close to you).
   Keep the database password somewhere: you do not need it for Reelbook, but Supabase asks for it.
2. Wait for the project to be ready (about a minute).

## 2. Run the schema

1. Dashboard → **SQL Editor** → **New query**.
2. Paste the whole content of [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**.
   It creates the tables (`requests`, `sheets`, `notes`, `user_themes`, `sessions`), their row
   level security policies and a private storage bucket `sheets`. It is safe to run again later.
3. **After each Reelbook update**, run the latest `supabase/schema.sql` again the same way: it only
   adds what is missing (sessions, for instance, need the `sessions` table) and keeps your data.

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

Open the Reelbook app: the hosted copy at https://lt20.github.io/reelbook/ (the link at the top of
the README), or your own copy of `app/` served from any static host or `python3 -m http.server`
inside `app/`. Choose **Create an account**, then **My own Supabase project**. Paste the URL and
anon key, and create your account with an email and a password. On another device, use **Sign in
to my own instance** to enter the same URL and anon key once before signing in.

Install it on your phone from the browser menu: *Add to Home screen* (Android, Chrome) or
*Share → Add to Home Screen* (iOS, Safari).

## 6. Connect Claude Code

On the computer where Claude Code and Chrome run, paste the install line shown in the app's
**Settings** page (it carries your project's URL and anon key): it clones the repository, installs
Pillow, links the skill and signs you in. Prefer typing each command? See
[manual-install.md](manual-install.md).

Then, in any Claude Code session: `/reelbook`. See the README for what happens next.

## Limits of the free tier

- 500 MB database, 1 GB storage. A sheet weighs about 2 MB of images: room for roughly 400 sheets.
- A free project with no activity for 7 days is paused, and opening the app does not wake it up.
  Restore it by hand: open the project in the [Supabase dashboard](https://supabase.com/dashboard)
  and click **Restore project**; it takes a few minutes and your data is kept. While the project is
  paused, the app cannot load your sheets and says your Supabase project may be paused.
