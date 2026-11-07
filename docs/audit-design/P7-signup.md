# P7 — Sign-up and `#welcome` overhaul

Fifth chantier, requested by Laurent on 7 Nov 2026. Coordinator: session `reelbook-a7`. Protocol: the one of
`COORDINATION.md` (one agent per lot, Codex verdict on the head, coordinator merges). Laurent, 7 Nov: « OK recos »,
« je te laisse challenger et valider les maquettes », « tu peux merger les PR sans moi ». Deployment stays with him
(`db push`, `functions deploy`, Supabase and Cloudflare settings).

## Why

Sign-up (read in the code of `main`, 7 Nov):
- `mailer_autoconfirm` is `true` on the hosted project (`/auth/v1/settings`, 7 Nov): any address makes an account,
  nobody proves it is theirs.
- `auth.signUp` gives a session at once and the app moves on: nothing ever says « your account exists ».
- Sign-in and sign-up share one form, told apart by a title and a ghost button. « Backend: Reelbook hosted » sits under it.
- No « forgot password ». A lost password is a dead end, and so is « an account already exists: sign in instead ».

`#welcome` (seen live, 7 Nov):
- The FR/EN dictionary exists (L30), but the page has no language switch: only the landing has one.
- Out of date: only « paste the link » (no share shortcut, L28), no installation on the phone, no Git or Python, a
  duration per sheet (Laurent, 4 Nov: not to be put forward).
- Installation comes last although everything depends on it. It says nothing about where the person stands.

## Decisions (numbered after COORDINATION.md)

21. Sign-up proves the address with a **6-digit code by email** and is protected by **Cloudflare Turnstile**.
22. Sender: **Resend** with a domain of Laurent's. **Domain still open.** Supabase's default service is not an option:
    2 messages an hour, and only to the project's team (Supabase docs, 7 Nov).
23. An address that already has an account is **told so plainly**, with « Sign in » and « Forgot password ». Today's
    message already does; with confirmation on, Supabase hides it, so the app reads it from `identities: []`.
24. **« Forgot password »** is added, with the same code by email.
25. `#welcome` becomes **a list of steps, then the rewritten guide**, with a FR/EN switch on the page. The rest of the
    app stays English (decision 13, L35 later): labels of the app are quoted as they are.
26. **L31 first**: Laurent turns on the 50-seat cap when it is merged, without waiting for the email code.
27. Mockups are challenged and validated by the coordinator, with an independent critique; Laurent does not have to
    approve them before the code.
28. An account must prove its address before it can enter (Supabase « Confirm email », no « allow unverified sign-in »).

## Facts checked, and what they impose

- **Supabase's Turnstile is project-wide and also guards the password grant.** Source of `supabase/auth`,
  `internal/api/api.go` and `middleware.go` (7 Nov): `verifyCaptcha` on `/signup`, `/recover`, `/resend`, `/otp`,
  `/magiclink`, `/token`; `isIgnoreCaptchaRoute` skips only `refresh_token`, `pkce` and `id_token`. So:
  - `rb.py login` (password grant) fails once Turnstile is on. Computers already signed in keep working (refresh).
  - `verifyCaptcha` skips a request carrying an admin role. Hence the small `cli-login` function of L42. **To be proved
    on a local stack with Turnstile on before anything else in L42**; if it does not hold, stop and report.
  - `/verify` is not guarded: entering the code needs no token. « Resend » and « Forgot password » do.
- **A Turnstile token is single use**: reset the widget after every attempt, failed or not.
- **Beta locks (L32)**: an account holds a seat when confirmed or created less than an hour ago. Keep the code's
  lifetime at Supabase's default of 1 hour, or a pending account outlives its hold. A refusal reaches `signUp` as
  « Database error saving new user » (HTTP 500), so the app reads `beta_seats()` first (L31). Known and accepted limit
  (Codex, #80, and the comment of `beta_accounts`): a resend renews the code but not the hold, so a late confirmation can
  pass the total by a seat. No extra locking for that; a test in L41 records the behaviour.
- **Order of deployment**: the new client must work with confirmation off (session at once) and on, with Turnstile off
  and on. An old cached client plus a code email would be a dead end, so the client ships first and stays compatible.
  Shipping first does not prove an installed PWA has updated (Codex, #80): L41 tests it from a service worker holding
  the previous version, and only then may Laurent reach steps 4 and 5 below. If that test fails, L41 adds an explicit
  update step on the auth screen.
- **Own backends** keep working untouched: no Turnstile, and their email may carry a link instead of a code (default
  template), so the code screen also accepts the session arriving from that link.

## The flow (the mockup makes it concrete)

States of the auth screen, each with one main action:

| State | Shows | Main action | Next |
|---|---|---|---|
| `signup` | email, password with show/hide, Turnstile, « step 1 of 2 » | Get my code | `code` |
| `code` | « Code sent to x@y », change address, 6 digits (`one-time-code`, numeric, paste), resend with a 60 s countdown, spam hint | Confirm | signed in, `#welcome` with « Account created » |
| `signin` | email, password, forgot password | Sign in | home; unconfirmed address: code resent, `code` |
| `exists` | « An account already exists with x@y » | Sign in | `signin`, or `forgot` |
| `forgot` | email, Turnstile | Get a code | `reset` |
| `reset` | code, new password | Change my password | signed in |
| full / closed | the L31 waiting list | Join the waiting list | message of L31 |

- Sign-up and sign-in stop looking like one form: distinct titles, the other path is a plain link.
- **The code screen survives leaving the app** (iPhone: Mail, then back; the PWA may reload): pending email and kind in
  `localStorage` (`rb.pending`, 1 hour, cleared on success). **Never the password.**
- Wrong, expired, too many attempts, resend too soon, offline: a message for each, FR and EN.
- « Backend: … » goes from under the form for the hosted path; the own-Supabase path stays reachable.
- Plain French `tu`, no jargon (`backend`, `OTP`, `captcha`).

## Mockup review (7 Nov, coordinator + independent critique, decision 27)

Applied to the mockup and binding on L41, L42, L43:

- **Turnstile is invisible by default**: `appearance: interaction-only`, `execution: execute`, so a fresh token at submit.
  Cloudflare's own widget, never a drawn imitation; our messages stay outside it. Mounted on every guarded screen
  (`signup`, `signin`, resend, `forgot`), with a failure state on each. Blocked: say what to do (turn off the blocker,
  another browser), try again, write to us. No loop.
- **A way out when the code never comes**: after a resend, check the address, search for « Reelbook », write to us.
  Contact from `hosted.contact` in `app/config.js`; empty hides the link. `too many attempts` shows no resend and no
  validity line.
- **Last password wins**: Supabase does not update an unconfirmed account on a second `signUp` (`signup.go`, to confirm in
  L41's local test). So after `verifyOtp` type `signup`: `updateUser({password})` when the password is still in memory,
  and otherwise (the page reloaded) a short `set-password` state before entering. This fixes the wrong-password trap, and
  a stranger who pre-registered someone's address no longer keeps a valid password.
- **Fewer statuses**: « account not created yet » only in the subtitle of `code`; no status line on `signup` and `exists`; no
  `code-ok` state (the button spins, then `#welcome`); « Account created for x » in the banner of `#welcome` only, no
  « you are signed in » (French would need a gender) and no account card, so the steps read 1, 2, 3.
- **Own Supabase** is not offered on the hosted `signup`: the choice is made on the landing or in `#setup` (L31 cards); the
  link stays on `signin`.
- **`#welcome` follows the device**:
  - phone: no command, no tabs. Says why this step cannot happen here, and sends the line to the person; the main action
    then moves to the phone step;
  - computer: « Copy the line », system detected, no send button; the phone step shows a QR code of the app's address and
    the address as text (static SVG, shown only on the hosted address).
- **The computer step knows**: `rb.py login` writes `reelbook_cli_at` in the account's `user_metadata` (no schema change,
  also on own backends; a failure never blocks the login). The app reads it with `getUser()` when the page regains focus,
  so the step ticks itself after the install. A sheet or a processed request also counts. No checkbox here; the phone step
  keeps its checkbox. This is the one `tools/rb.py` change of L43, so L43 is reviewed as protected.
- **Step 3 is « Your first sheet »**, up to `/reelbook`, since the first sheet is what proves the product. Add an **all done**
  state of the page. The install step says it will ask for email and hidden password, links its prerequisites, and names
  Terminal or PowerShell according to the tab. The phone step has two numbered lines (home screen and sign in there, then the
  shortcut). « Open my notebooks » sits right under the steps; the guide is collapsed and keeps the night run in one line.
- **New states**: invalid address, password too short, sending limit reached, last seat taken meanwhile. The email is carried
  over between `signup`, `exists`, `signin` and `forgot`. « Change address » returns to where the person came from.
- **Not retained**: « did you mean gmail.com? » (the address is in bold on `code`, with « change address » beside it), moving the
  night run out of the guide.
- **Settled at validation (coordinator, #83)**: `#welcome` keeps the app's 640 px column on a computer; a closed beta reuses
  `beta.closed`, its sub-line tells it from a full one; `reset` hedges because `/recover` does not say whether an address
  has an account.
- **To measure after launch**: pending, confirmed, first sheet per account (a query for Laurent, in L34's business tests).

## Lots

| Lot | What | Depends on | Zone | Branch |
|---|---|---|---|---|
| L40 | Mockup of the auth states and `#welcome`, FR/EN, 390 px | — | docs | `docs/p7-mockup` |
| L31 | Hosting cards, seats, waiting list, refusals (`lots/L31.md`), `WAITLIST = true` | #77 merged | app | `feat/p6-hosting` |
| L41 | Auth states, code, resend, resume, forgot password, compatible with confirmation off and on | L31, L40 | app | `feat/p7-signup` |
| L43 | `#welcome` of the mockup, FR/EN switch | L40 | app | `feat/p7-welcome` |
| L42 | Turnstile in the client, `cli-login`, `rb.py login`, local proof | L41 | protected | `feat/p7-turnstile` |
| L34 | Captures and business tests (P6 lot, extended to this flow) | L41, L42, L43 | tests | `test/p7-launch` |

### L41 notes
- Check against a real local Supabase Auth, not only the fake backend: `signUp` for a new, an unconfirmed and a confirmed
  address; `verifyOtp` types `signup` and `recovery`; the rate-limit error of a resend.
- Whatever confirms the session must not `await` inside `onAuthStateChange` (known pitfall).
- `tests/auth-flow.test.cjs` and `tools/preview/fake-supabase.js` learn the new calls; one test per state.

### L42 notes
- Site key in `app/config.js` (`hosted.turnstileSiteKey`), empty until Laurent has it: empty means no widget and no script.
- Token passed to `signUp`, `signInWithPassword`, `resend`, `resetPasswordForEmail`. Script blocked or failing: a clear
  message and a retry; sign-in must not be lost while Turnstile is off on the server.
- `rb.py login`: direct first, and on `captcha_failed` the function. So own backends never need it.
- `supabase/functions/cli-login`: email and password in, tokens out; no logging of either.
- **Abuse criterion (Codex, #80)**: this route deliberately skips Turnstile, and every call reaches Auth from the
  function. A test of repeated calls must show both that automated attempts get limited and that they cannot exhaust a
  shared quota and lock out legitimate sign-ins. If the platform's limits do not give both, the function adds its own
  limit (per address and per caller). Report the measured behaviour in the PR.

### L43 notes
- Steps: account created (true by construction); computer, phone, first video. **Show as done only what the app really
  knows**: a video in the queue or a sheet is known; a computer is known once a sheet or a processed request exists; a
  phone only from `display-mode: standalone` on this device, otherwise a tick the person sets (per user, decision 8).
- Guide: current truth only (share shortcut, paste on Android, Git and Python 3.9+, `/reelbook`, nightly on a Mac). No
  duration per sheet, no hour for the night run.

## Laurent's deployment (in this order, each step separately reversible)

1. After L31 merges: `supabase/schema.sql`, his account `exempt`, the `beta_settings` row (comments in the file).
2. Domain chosen, Resend set up, custom SMTP in Supabase. Then `hosted.mailReady: true` in `app/config.js` (a one-line PR): until then « Forgot your password? » is not offered on the hosted backend, since it would fail.
3. Before step 4, a check: `select count(*) from auth.users where email_confirmed_at is null` should be 0 or known.
4. After L41 merges: email templates with `{{ .Token }}` (confirmation and recovery), then « Confirm email » on.
5. After L42 merges: Turnstile widget for `lt20.github.io`, site key given to the coordinator (a one-line PR), `cli-login`
   deployed and tried, then Turnstile on in Supabase.

Every step gets a business test in the Notion base.

## Status

See the P7 table of `COORDINATION.md`.
