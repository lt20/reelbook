> **Draft — not in force, awaiting validation by the maintainer.** Nothing below applies yet. This text is not
> linked from the app or the README until it is validated. Placeholders: `[LEGAL ENTITY]`, `[SUPABASE REGION]`,
> `[CONTACT EMAIL]`, `[DELETION DELAY]`, `[DATE]`.

# Privacy note — the hosted Reelbook backend

Last updated: `[DATE]`.

This note covers the **hosted backend**: the Supabase project the maintainer runs for people who do not set up
their own. If you use Reelbook with your own Supabase project, your data is in your project and this note does not
apply to it.

## Who runs it

`[LEGAL ENTITY]` (the « maintainer ») runs the hosted backend and decides what is done with its data. Contact:
`[CONTACT EMAIL]`.

## What is stored

- **Your account**: your email address and your password (stored hashed by Supabase Auth, never readable).
- **What you add**: the video links you queue, your sheets (text and layout), the photos taken from the videos,
  your sessions, your notebooks, your notes, and your practice log (the days you mark « Done today », with what you
  write there).
- **Technical logs** kept by Supabase to run and protect the service (for example the IP address and time of a
  sign-in), for a limited time set by Supabase.

The app itself is served by GitHub Pages, which may keep its own access logs. On your phone or computer the app
keeps a copy of what you opened (browser storage) so that it works offline; that copy never leaves your device.

## Why

Only to run Reelbook for you: show your sheets on your devices, keep your queue until your computer processes it,
and keep the service working and safe (including the per-account limits). Turning a video into a sheet happens on
your own computer, with your own Claude Code: the hosted backend does not send your data to anyone.

No sale, no advertising, no tracking, no analytics, no profiling. Your data is never shared with other users:
every row and every file is tied to your account.

## Where

In a Supabase project hosted in `[SUPABASE REGION]`. Supabase acts as the maintainer's processor. The maintainer
administers the database and could technically read it; they only look at stored data to run the service, answer
your request, or when the law requires it.

## How long

As long as your account exists. When you ask for your account to be deleted, your account and everything listed
under « What you add » are deleted within `[DELETION DELAY, e.g. 30 days]`; technical logs expire on their own.

## Your data, your copy

Your sheets come from folders on your own computer (`work/`), which stay yours. `rb.py` (the command line that
publishes them) works against any Supabase backend, so you can move to your own project at any time: create it,
run `supabase/schema.sql`, and republish. On request, the maintainer sends you a copy of everything stored for your
account.

## Your rights

Under the Swiss Federal Act on Data Protection (nLPD/revFADP) and, where it applies, the EU General Data Protection
Regulation (GDPR), you can ask to see your data, correct it, delete it, receive a copy of it, or object to how it
is used. Write to `[CONTACT EMAIL]`; you get an answer within 30 days. You can also complain to the Swiss Federal
Data Protection and Information Commissioner (FDPIC) or to the data protection authority of your EU country.

## Changes

If this note changes in a way that matters, existing accounts are told before it applies.
