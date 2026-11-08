// L41: the auth screens (docs/audit-design/P7-signup.md). One test per state and per error, with the answers measured
// on a real Supabase Auth (progress/2026-11-07-L41.md), not the ones the docs promise.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app, html, hostedUrl, ownUrl, ownKey} = require('./harness.cjs');

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const shown = (page, id) => page.element(id).hidden === false;
const titleOf = page => page.element('auth-title').textContent;
const EMAIL = 'camille@example.com', PW = 'correct-horse-1';
const USER = {id: 'u1', email: EMAIL, created_at: new Date().toISOString()};
const ERR = {
  wrong: {status: 403, code: 'otp_expired', message: 'Token has expired or is invalid'},
  limit: {status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached'},
  soon: {status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.'},
  hour: {status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded'},
  exists: {status: 422, code: 'user_already_exists', message: 'User already registered'},
  unconfirmed: {status: 400, code: 'email_not_confirmed', message: 'Email not confirmed'},
  creds: {status: 400, code: 'invalid_credentials', message: 'Invalid login credentials'},
  same: {status: 422, code: 'same_password', message: 'New password should be different from the old password.'},
  weak: {status: 422, code: 'weak_password', message: 'Password should be at least 6 characters.'},
  net: {status: 0, name: 'AuthRetryableFetchError', message: 'Failed to fetch'}
};
const failure = e => Object.assign(new Error(e.message), e);

// A page with a scriptable auth client: every call is journalled in `log`, the answers in `answers` (one by call name).
async function auth(answers = {}, options = {}) {
  const log = [];
  const say = (name, args) => { log.push([name, ...args]); const a = answers[name]; const r = typeof a === 'function' ? a(...args) : a; if (r instanceof Error) throw r; return r || {data: {}, error: null}; };
  const fns = get => {
    const fire = (ev, user) => { const c = get(); if (c.authListener) c.authListener(ev, user ? {user, access_token: 't'} : null); };
    return {
      signUp: async (...a) => { const r = say('signUp', a); if (r.data && r.data.session) fire('SIGNED_IN', r.data.session.user); return r; },
      signInWithPassword: async (...a) => { const r = say('signIn', a); if (!r.error && !r.data?.user && !answers.signIn) return {error: null}; if (r.data && r.data.session) fire('SIGNED_IN', r.data.session.user); return r; },
      resend: async (...a) => say('resend', a),
      resetPasswordForEmail: async (...a) => say('recover', a),
      getSession: async () => ({data: {session: {user: answers.sessionUser || USER}}, error: null}),
      verifyOtp: async (...a) => { const r = say('verify', a); if (!r.error) fire(a[0].type === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN', USER); return r; },
      updateUser: async (...a) => { const r = say('update', a); if (!r.error) fire('USER_UPDATED', USER); return r; }
    };
  };
  const page = await app({auth: fns, tables: {}, timerCap: 1000, ...options});
  await settle();
  return {page, log, client: () => page.clients.at(-1)};
}
const submit = async page => { await page.fire('auth-form', 'submit'); await settle(); };
const type = (page, email = EMAIL, pass = PW) => { page.element('a-email').value = email; page.element('a-pass').value = pass; };
const toSignup = async page => { await page.fire('intro-signup'); await settle(); };
const toSignin = async page => { await page.fire('intro-signin'); await settle(); };
const atCode = async (answers = {}, options = {}) => {
  const s = await auth(answers, options);
  await toSignup(s.page); type(s.page); await submit(s.page);
  assert.equal(titleOf(s.page), 'Enter your code');
  return s;
};
const code = async (page, value) => { page.element('a-code').value = value; await submit(page); };
const pending = page => JSON.parse(page.storage.get('rb.pending') || 'null');
const stored = (over = {}) => ({'rb.backend': JSON.stringify({mode: 'hosted'}), 'rb.pending': JSON.stringify({email: EMAIL, type: 'signup', at: Date.now() - 240000, from: 'signup', url: hostedUrl, ...over})});

// ---------- signup
test('signup: its own title and step line, password rules in the label, the other path a plain link', async () => {
  const {page} = await auth(); await toSignup(page);
  assert.equal(titleOf(page), 'Create your account');
  assert.ok(page.element('a-step').innerHTML.startsWith('Account, step 1 of 2')); assert.ok(shown(page, 'a-step'));
  assert.equal(page.element('a-pass-l').textContent, 'Password · 6 characters or more');
  assert.equal(page.element('a-submit').textContent, 'Get my code');
  assert.equal(page.element('a-other-t').textContent, 'Already have an account? '); assert.equal(page.element('a-toggle').textContent, 'Sign in');
  assert.ok(!shown(page, 'a-backend-row'), 'no « Backend » line on the hosted path');
  assert.ok(!shown(page, 'a-adv'), 'own Supabase is not offered on the hosted sign-up');
});

test('signup: invalid address and short password are said before any call', async () => {
  const {page, log} = await auth(); await toSignup(page);
  type(page, 'camille@example', PW); await submit(page);
  assert.equal(page.element('a-err').textContent, 'That doesn’t look like an email address: check it.');
  type(page, EMAIL, 'short'); await submit(page);
  assert.equal(page.element('a-err').textContent, 'The password needs at least 6 characters.');
  assert.deepEqual(log, []);
});

test('signup: no session → code, with the pending kept; the password never in storage', async () => {
  const {page} = await atCode();
  assert.equal(page.element('a-sent').innerHTML, `A 6-digit code is on its way to <b>${EMAIL}</b>.`);
  assert.equal(page.element('a-change').textContent, 'Change address');
  assert.ok(page.element('a-step').innerHTML.includes('step 2 of 2'));
  const p = pending(page);
  assert.equal(p.email, EMAIL); assert.equal(p.type, 'signup'); assert.ok(Date.now() - p.at < 5000);
  for (const v of page.storage.values()) assert.ok(!String(v).includes(PW), 'never the password');
});

test('signup: a session at once (confirmation off, today\'s prod) enters directly; no code, no pending', async () => {
  const {page} = await auth({signUp: {data: {session: {user: USER, access_token: 't'}, user: USER}, error: null}});
  await toSignup(page); type(page); await submit(page);
  assert.ok(!shown(page, 'auth')); assert.equal(page.storage.get('rb.pending'), undefined);
  assert.deepEqual(JSON.parse(page.storage.get('rb.backend')), {mode: 'hosted'});
});

for (const [name, answer] of [['identities: [] (older servers)', {data: {user: {id: 'x', identities: []}, session: null}, error: null}], ['HTTP 422 user_already_exists (measured)', {data: {}, error: ERR.exists}]]) {
  test(`exists: ${name}: told plainly, sign in or forgot, the address carried`, async () => {
    const {page} = await auth({signUp: answer}); await toSignup(page); type(page); await submit(page);
    assert.equal(titleOf(page), 'This address already has an account');
    assert.ok(page.element('a-lead').innerHTML.startsWith(`<b>${EMAIL}</b> already has a Reelbook account.`));
    assert.ok(!shown(page, 'a-email-row')); assert.ok(shown(page, 'a-forgot-row')); assert.equal(page.element('a-submit').textContent, 'Sign in');
    assert.equal(page.element('a-toggle').textContent, 'Use another address');
    await submit(page); // « Sign in »
    assert.equal(titleOf(page), 'Sign in'); assert.equal(page.element('a-email').value, EMAIL);
  });
}

test('exists → forgot and exists → use another address keep the address in the field', async () => {
  const {page} = await auth({signUp: {data: {}, error: ERR.exists}}); await toSignup(page); type(page); await submit(page);
  await page.fire('a-forgot'); await settle();
  assert.equal(titleOf(page), 'Forgot your password'); assert.equal(page.element('a-email').value, EMAIL);
  const b = await auth({signUp: {data: {}, error: ERR.exists}}); await toSignup(b.page); type(b.page); await submit(b.page);
  await b.page.fire('a-toggle'); await settle();
  assert.equal(titleOf(b.page), 'Create your account'); assert.equal(b.page.element('a-email').value, EMAIL);
});

test('signup: the same address again within the minute (HTTP 429 « after N seconds »): the code screen, its countdown, the password kept', async () => {
  const {page, log} = await auth({signUp: {data: {}, error: ERR.soon}, verify: {data: {session: {}}, error: null}});
  await toSignup(page); type(page); await submit(page);
  assert.equal(titleOf(page), 'Enter your code');
  assert.equal(page.element('a-err').textContent, 'The last code just left: wait for the countdown before asking for another.');
  assert.match(page.element('a-help').innerHTML, /resend the code in <b>4[0-2] s<\/b>/);
  await code(page, '123456');
  assert.equal(log.find(l => l[0] === 'update')[1].password, PW);
});

test('signup: the hourly limit, a network failure, offline', async () => {
  let s = await auth({signUp: {data: {}, error: ERR.hour}}); await toSignup(s.page); type(s.page); await submit(s.page);
  assert.equal(s.page.element('a-err').textContent, 'Sending limit reached for this address: try again in an hour. Nothing was created.');
  assert.equal(titleOf(s.page), 'Create your account');
  s = await auth({signUp: failure(ERR.net)}); await toSignup(s.page); type(s.page); await submit(s.page);
  assert.equal(s.page.element('a-err').textContent, 'The server did not answer: check your connection and try again.');
  s = await auth({signUp: failure(ERR.net)}, {nav: {onLine: false}}); await toSignup(s.page); type(s.page); await submit(s.page);
  assert.equal(s.page.element('a-err').textContent, 'You’re offline: nothing was sent. Try again once you’re back online.');
});

// ---------- code
test('code: right code, password in memory: updateUser with it (last password wins), then the app; the session never opens it before', async () => {
  let shownDuring = null;
  const s = await atCode({update: () => { shownDuring = s.page.element('auth').hidden === false; return {data: {}, error: null}; }, verify: {data: {session: {}}, error: null}});
  await code(s.page, '123456');
  assert.equal(JSON.stringify(s.log.find(l => l[0] === 'verify')[1]), JSON.stringify({email: EMAIL, token: '123456', type: 'signup'}));
  assert.equal(shownDuring, true, 'still on the auth screen while the password is saved');
  assert.equal(s.log.find(l => l[0] === 'update')[1].password, PW);
  assert.equal(s.page.storage.get('rb.pending'), undefined, 'cleared on success');
  assert.ok(!shown(s.page, 'auth'));
});

// L41c: after the merge with L43 (#welcome), the end of the code path is the first arrival: #welcome, banner included.
test('code then first sign-in: an empty new account lands on #welcome with « Account created », also through set-password', async () => {
  const s = await atCode({update: {data: {}, error: null}, verify: {data: {session: {}}, error: null}});
  await code(s.page, '123456'); await settle();
  assert.equal(s.page.location.hash, '#welcome'); assert.equal(s.page.element('welcome').hidden, false);
  assert.ok(!shown(s.page, 'intro')); assert.ok(!shown(s.page, 'auth'));
  assert.equal(s.page.element('w-flash').hidden, false); assert.ok(s.page.element('w-flash').innerHTML.includes(EMAIL));
  let calls = 0;
  const t = await atCode({update: () => (++calls === 1 ? {data: {}, error: ERR.weak} : {data: {}, error: null}), verify: {data: {session: {}}, error: null}});
  await code(t.page, '123456');
  // the catalogue read may already have set #welcome: the set-password screen stays in front of it, banner not spent
  assert.equal(titleOf(t.page), 'Choose your password'); assert.ok(shown(t.page, 'auth')); assert.ok(!shown(t.page, 'welcome'));
  assert.equal(t.page.storage.get('rb.welcome.seen.u1'), undefined);
  t.page.element('a-pass').value = 'another-horse-2'; await submit(t.page); await settle();
  assert.equal(calls, 2); assert.equal(t.page.storage.get('rb.pending'), undefined);
  assert.equal(t.page.location.hash, '#welcome'); assert.equal(t.page.element('w-flash').hidden, false);
});

test('code: the same password again (HTTP 422 same_password) is no error on the screen', async () => {
  const s = await atCode({update: {data: {}, error: ERR.same}, verify: {data: {session: {}}, error: null}});
  await code(s.page, '123456');
  assert.ok(!shown(s.page, 'auth')); assert.equal(s.page.storage.get('rb.pending'), undefined);
});

test('code: updateUser refused after the code: set-password says so, the session stays behind it', async () => {
  const s = await atCode({update: {data: {}, error: ERR.weak}, verify: {data: {session: {}}, error: null}});
  await code(s.page, '123456');
  assert.equal(titleOf(s.page), 'Choose your password'); assert.ok(shown(s.page, 'a-err')); assert.ok(shown(s.page, 'auth'));
});

test('code: six digits go at once on the hosted backend, once; letters are dropped', async () => {
  const s = await atCode({verify: {data: {session: {}}, error: ERR.wrong}});
  const input = s.page.element('a-code');
  input.value = '12a34'; await s.page.fire('a-code', 'input');
  assert.equal(input.value, '1234'); assert.equal(s.log.filter(l => l[0] === 'verify').length, 0);
  input.value = '123456'; await s.page.fire('a-code', 'input'); await settle();
  assert.equal(s.log.filter(l => l[0] === 'verify').length, 1);
});

test('code wrong: HTTP 403 otp_expired within the hour: « not the right code », the countdown stays', async () => {
  const s = await atCode({verify: {data: {}, error: ERR.wrong}});
  await code(s.page, '111111');
  assert.equal(s.page.element('a-err').textContent, 'That code isn’t right. Check the 6 digits of the latest email.');
  assert.equal(s.page.element('a-submit').textContent, 'Confirm'); assert.ok(shown(s.page, 'a-help'));
  assert.equal(titleOf(s.page), 'Enter your code');
  assert.ok(pending(s.page), 'the pending stays');
});

test('code expired, by the clock of the page: a flow resumed 59 min 59 s ago, the code refused an instant later', async () => {
  // A pending a few ms from its hour: the page keeps it at load, and the same 403 otp_expired then reads as expired.
  const {page} = await auth({verify: {data: {}, error: ERR.wrong}}, {stored: stored({at: Date.now() - 3599990})});
  await code(page, '111111');
  await new Promise(r => setTimeout(r, 15));
  await code(page, '111111');
  assert.equal(page.element('a-err').textContent, 'This code has expired. Ask for a new one: it will reach the same address.');
  assert.equal(page.element('a-submit').textContent, 'Get a new code'); assert.ok(!shown(page, 'a-help'));
});

test('code: an expired code\'s button asks for a new one', async () => {
  const s = await auth({verify: {data: {}, error: ERR.wrong}}, {stored: stored({at: Date.now() - 3599995})});
  await new Promise(r => setTimeout(r, 10));
  await code(s.page, '111111');
  assert.equal(s.page.element('a-submit').textContent, 'Get a new code');
  await submit(s.page);
  assert.equal(s.log.filter(l => l[0] === 'resend').length, 1);
  assert.equal(s.page.element('a-submit').textContent, 'Confirm');
  assert.ok(s.page.element('a-note').innerHTML.startsWith('New code sent to'));
});

test('code too many attempts: HTTP 429: no resend, no validity line, the button off', async () => {
  const s = await atCode({verify: {data: {}, error: ERR.limit}});
  await code(s.page, '111111');
  assert.equal(s.page.element('a-err').textContent, 'Too many attempts. Wait a few minutes, then ask for a new code.');
  assert.equal(s.page.element('a-submit').disabled, true); assert.ok(!shown(s.page, 'a-help'));
  s.page.element('a-code').value = '123456'; await s.page.fire('a-code', 'input'); await settle();
  assert.equal(s.log.filter(l => l[0] === 'verify').length, 1, 'nothing goes out');
});

test('code offline, and a failure while online', async () => {
  const on = await atCode({verify: failure(ERR.net)});
  await code(on.page, '123456');
  assert.equal(on.page.element('a-err').textContent, 'The server did not answer: check your connection and try again.');
  assert.equal(titleOf(on.page), 'Enter your code');
  const off = await atCode({verify: failure(ERR.net)}, {nav: {onLine: false}});
  await code(off.page, '123456');
  assert.equal(off.page.element('a-err').textContent, 'You’re offline: the code could not be checked. Try again once you’re back online.');
});

// ---------- resend
const clickResend = async page => { await page.element('auth-form').listeners.click({preventDefault() {}, target: {closest: () => ({dataset: {au: 'resend'}})}}); await settle(); };
test('resend: countdown first; a new code renews the date, the banner and the way out', async () => {
  const s = await auth({}, {stored: stored()});
  assert.ok(s.page.element('a-help').innerHTML.includes('data-au="resend"'), 'past the 60 s: the link');
  await clickResend(s.page);
  assert.deepEqual(s.log.at(-1)[1].type, 'signup');
  assert.equal(s.page.element('a-note').innerHTML, `New code sent to <b>${EMAIL}</b>. Only the latest one works.`);
  assert.ok(Date.now() - pending(s.page).at < 5000);
  assert.match(s.page.element('a-help').innerHTML, /^Still nothing\? Check <b>camille@example\.com<\/b> and search your inbox for Reelbook\.$/);
});

test('resend too soon: its message, the server\'s seconds in the countdown', async () => {
  const s = await auth({resend: {data: {}, error: ERR.soon}}, {stored: stored()});
  await clickResend(s.page);
  assert.equal(s.page.element('a-err').textContent, 'The last code just left: wait for the countdown before asking for another.');
  assert.match(s.page.element('a-help').innerHTML, /resend the code in <b>4[0-2] s<\/b>/);
});

test('resend: hourly limit and offline have their own lines', async () => {
  let s = await auth({resend: {data: {}, error: ERR.hour}}, {stored: stored()});
  await clickResend(s.page);
  assert.equal(s.page.element('a-err').textContent, 'Sending limit reached for this address: try again in an hour.');
  s = await auth({resend: failure(ERR.net)}, {stored: stored(), nav: {onLine: false}});
  await clickResend(s.page);
  assert.equal(s.page.element('a-err').textContent, 'You’re offline: nothing was sent. Try again once you’re back online.');
});

test('« email us » reads hosted.contact: empty hides it, an address or mailto: links it, not on an own backend', async () => {
  const s = await auth({}, {stored: stored(), cfg: {contact: 'hello@reelbook.example'}});
  await clickResend(s.page);
  assert.ok(s.page.element('a-help').innerHTML.includes('<a href="mailto:hello@reelbook.example">email us</a>'));
  const bad = await auth({}, {stored: stored(), cfg: {contact: 'javascript:alert(1)'}});
  await clickResend(bad.page);
  assert.ok(!bad.page.element('a-help').innerHTML.includes('javascript'));
  const own = await auth({}, {stored: stored({url: ownUrl}), remembered: {mode: 'own', url: ownUrl, key: ownKey}, cfg: {contact: 'hello@reelbook.example'}});
  own.page.storage.set('rb.pending', stored({url: ownUrl})['rb.pending']);
  assert.ok(!own.page.element('a-help').innerHTML.includes('mailto'));
});

test('app/config.js has the contact key, the hosted address', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '../app/config.js'), 'utf8'), /contact: 'contact@reelbook\.si'/);
});

// ---------- resume
test('resume: a reload brings the code screen back, with its banner, and asks for the password after the code', async () => {
  const {page, log} = await auth({verify: {data: {session: {}}, error: null}}, {stored: stored()});
  assert.equal(titleOf(page), 'Enter your code'); assert.ok(shown(page, 'auth-form')); assert.ok(!shown(page, 'intro'));
  assert.equal(page.element('a-note').innerHTML, `Picking up where you left off: the code sent 4 min ago to <b>${EMAIL}</b> is still valid.`);
  await code(page, '123456');
  assert.equal(log.filter(l => l[0] === 'update').length, 0, 'no password in memory');
  assert.equal(titleOf(page), 'Choose your password');
  assert.ok(page.element('a-step').innerHTML.includes(`account created for <b>${EMAIL}</b>`));
  assert.ok(shown(page, 'auth'), 'the app waits behind');
  assert.equal(pending(page).verified, true, 'a reload here asks again');
});

test('password minimum is 6 (decision 29): 5 is said before any call, 6 goes, on sign-up, set-password, reset and new-password', async () => {
  const up = await auth(); await toSignup(up.page);
  type(up.page, EMAIL, '12345'); await submit(up.page);
  assert.equal(up.page.element('a-err').textContent, 'The password needs at least 6 characters.'); assert.deepEqual(up.log, []);
  type(up.page, EMAIL, '123456'); await submit(up.page);
  assert.equal(up.log.find(l => l[0] === 'signUp')[1].password, '123456');
  const set = await auth({}, {stored: stored({verified: true}), sessions: {[hostedUrl]: USER}}); await settle();
  set.page.element('a-pass').value = '12345'; await submit(set.page); assert.equal(set.log.length, 0);
  set.page.element('a-pass').value = '123456'; await submit(set.page);
  assert.equal(set.log.at(-1)[0], 'update'); assert.equal(set.log.at(-1)[1].password, '123456');
  const rs = await atReset();
  rs.page.element('a-code').value = '123456'; rs.page.element('a-pass').value = '12345'; await submit(rs.page);
  assert.equal(rs.log.filter(l => l[0] === 'verify').length, 0);
  rs.page.element('a-pass').value = '123456'; await submit(rs.page);
  assert.equal(rs.log.filter(l => l[0] === 'verify').length, 1);
  const np = await auth({}, {stored: stored({verified: true, type: 'recovery'}), sessions: {[hostedUrl]: USER}}); await settle();
  np.page.element('a-pass').value = '12345'; await submit(np.page);
  assert.equal(np.page.element('a-err').textContent, 'The password needs at least 6 characters.'); assert.equal(np.log.length, 0);
  np.page.element('a-pass').value = '123456'; await submit(np.page);
  assert.equal(np.log.at(-1)[0], 'update'); assert.equal(np.log.at(-1)[1].password, '123456');
});

test('set-password: too short, then saved, then the app', async () => {
  const {page, log} = await auth({}, {stored: stored({verified: true}), sessions: {[hostedUrl]: USER}});
  await settle();
  assert.equal(titleOf(page), 'Choose your password'); assert.ok(shown(page, 'auth'));
  page.element('a-pass').value = 'short'; await submit(page);
  assert.equal(page.element('a-err').textContent, 'The password needs at least 6 characters.');
  assert.equal(log.length, 0);
  page.element('a-pass').value = PW; await submit(page);
  assert.equal(log.at(-1)[0], 'update'); assert.equal(log.at(-1)[1].password, PW);
  assert.ok(!shown(page, 'auth')); assert.equal(page.storage.get('rb.pending'), undefined);
});

test('resume: an hour old, or from another backend, or malformed: forgotten', async () => {
  for (const pend of [stored({at: Date.now() - 3600001}), stored({url: ownUrl}), {'rb.backend': JSON.stringify({mode: 'hosted'}), 'rb.pending': '{oops'}, stored({email: ''}), stored({type: 'magic'})]) {
    const {page} = await auth({}, {stored: pend});
    assert.equal(titleOf(page), 'Sign in');
    assert.ok(!page.storage.get('rb.pending'));
  }
});

test('resume: a session for that address (a link opened in this tab): the address is proved, the password is asked', async () => {
  const {page, log} = await auth({}, {stored: stored(), sessions: {[hostedUrl]: USER}});
  await settle();
  assert.equal(titleOf(page), 'Choose your password'); assert.ok(shown(page, 'auth')); assert.equal(pending(page).verified, true);
  assert.equal(log.length, 0);
});

test('the link of a confirmation email with nothing remembered here (another device, « change address » before it): the password is asked', async () => {
  const {page, log} = await auth({}, {hash: '#access_token=x&type=signup', sessions: {[hostedUrl]: USER}, stored: {'rb.backend': JSON.stringify({mode: 'hosted'})}});
  await settle();
  assert.equal(titleOf(page), 'Choose your password'); assert.ok(shown(page, 'auth')); assert.equal(pending(page).verified, true); assert.equal(pending(page).email, EMAIL);
  assert.equal(log.length, 0);
});

test('a session restored with no such link: the app, nothing asked', async () => {
  const {page} = await auth({}, {hash: '#settings', sessions: {[hostedUrl]: USER}, stored: {'rb.backend': JSON.stringify({mode: 'hosted'})}});
  await settle();
  assert.ok(!shown(page, 'auth'));
});

test('forgot on an own backend chosen in the sign-up, new device: the backend is remembered, so the reset comes back after Mail', async () => {
  const s = await auth({signUp: {data: {}, error: ERR.exists}});
  await s.page.fire('intro-signin'); await settle(); await s.page.fire('a-toggle'); await settle();
  await s.page.fire('pick-own', 'change'); s.page.element('own-url').value = ownUrl; s.page.element('own-key').value = ownKey; await s.page.fire('own-form', 'submit'); await settle();
  type(s.page); await submit(s.page);
  assert.equal(titleOf(s.page), 'This address already has an account');
  await s.page.fire('a-forgot'); await settle(); await submit(s.page);
  assert.equal(titleOf(s.page), 'New password');
  assert.equal(JSON.parse(s.page.storage.get('rb.backend')).url, ownUrl);
  assert.equal(pending(s.page).url, ownUrl);
  const back = await auth({}, {stored: {'rb.backend': s.page.storage.get('rb.backend'), 'rb.pending': s.page.storage.get('rb.pending')}});
  assert.equal(titleOf(back.page), 'New password'); assert.ok(shown(back.page, 'a-code-row'));
});

test('another account opened in another tab before the save: the password is not written on it, the flow given up', async () => {
  const s = await atCode({verify: {data: {session: {}}, error: null}, sessionUser: {id: 'b', email: 'b@example.test'}});
  await code(s.page, '123456');
  assert.equal(s.log.filter(l => l[0] === 'update').length, 0);
  assert.equal(s.page.storage.get('rb.pending'), undefined);
  const set = await auth({sessionUser: {id: 'b', email: 'b@example.test'}}, {stored: stored({verified: true}), sessions: {[hostedUrl]: USER}});
  await settle(); set.page.element('a-pass').value = PW; await submit(set.page);
  assert.equal(set.log.filter(l => l[0] === 'update').length, 0);
});

test('offline restart, token expired: no session but one stored: the password stays owed; the refresh does not open the app', async () => {
  const key = 'rb.auth.' + hostedUrl.replace(/\W/g, '');
  const session = JSON.stringify({access_token: 't', refresh_token: 'r', expires_at: 1, user: USER});
  const {page, client} = await auth({}, {stored: {...stored({verified: true}), [key]: session}});
  await settle();
  assert.equal(pending(page).verified, true, 'not forgotten');
  client().authListener('TOKEN_REFRESHED', {user: USER, access_token: 't2'}); await settle();
  assert.equal(titleOf(page), 'Choose your password'); assert.ok(shown(page, 'auth'));
});

test('a code accepted over an hour ago, its password never saved: a reload still asks (the pre-registered password must not survive)', async () => {
  const {page} = await auth({}, {stored: stored({verified: true, at: Date.now() - 2 * 3600000}), sessions: {[hostedUrl]: USER}});
  await settle();
  assert.equal(titleOf(page), 'Choose your password'); assert.ok(shown(page, 'auth'));
});

test('verified but no session any more: forgotten, the sign-in form', async () => {
  const {page} = await auth({}, {stored: stored({verified: true, at: Date.now() - 2 * 3600000})});
  await settle();
  assert.equal(titleOf(page), 'Sign in'); assert.equal(page.storage.get('rb.pending'), undefined);
});

// ---------- a session from elsewhere
test('code: a session arriving from a link or another tab leaves the screen for set-password; nothing is written from it', async () => {
  const s = await atCode();
  s.client().authListener('SIGNED_IN', {user: USER, access_token: 't'}); await settle();
  assert.equal(titleOf(s.page), 'Choose your password'); assert.ok(shown(s.page, 'auth')); assert.equal(pending(s.page).verified, true);
  assert.equal(s.log.filter(l => l[0] === 'update').length, 0);
  // saved in the other tab: this tab's older password never overwrites it
  s.client().authListener('USER_UPDATED', {user: USER, access_token: 't'}); await settle();
  assert.ok(!shown(s.page, 'auth')); assert.equal(s.page.storage.get('rb.pending'), undefined);
  assert.equal(s.log.filter(l => l[0] === 'update').length, 0, 'two tabs: the password saved last stays');
  const other = await atCode();
  other.client().authListener('SIGNED_IN', {user: {...USER, id: 'u2', email: 'someone@else.test'}, access_token: 't'}); await settle();
  assert.ok(!shown(other.page, 'auth'));
  assert.equal(other.log.filter(l => l[0] === 'update').length, 0, 'never on another account');
});

test('code: a stored « verified » for another account never asks that account for a password', async () => {
  const {page, log} = await auth({}, {stored: stored({verified: true, email: 'other@example.test'}), sessions: {[hostedUrl]: USER}});
  await settle();
  assert.ok(!shown(page, 'auth')); assert.equal(log.length, 0); assert.equal(page.storage.get('rb.pending'), undefined);
});

test('PASSWORD_RECOVERY from a link: the new password is asked before the app; a reload asks again', async () => {
  const {page, log, client} = await auth({}, {sessions: {[hostedUrl]: USER}, stored: {'rb.backend': JSON.stringify({mode: 'hosted'})}});
  await settle(); assert.ok(!shown(page, 'auth'));
  client().authListener('PASSWORD_RECOVERY', {user: USER, access_token: 't'}); await settle();
  assert.ok(shown(page, 'auth')); assert.equal(titleOf(page), 'New password');
  assert.ok(!shown(page, 'a-code-row')); assert.ok(!shown(page, 'a-sent-row'));
  assert.equal(pending(page).verified, true); assert.equal(pending(page).type, 'recovery');
  page.element('a-pass').value = PW; await submit(page);
  assert.equal(log.at(-1)[0], 'update'); assert.equal(log.at(-1)[1].password, PW);
  assert.ok(!shown(page, 'auth'));
  assert.equal(page.element('flash').innerHTML, `Password changed for <b>${EMAIL}</b>.`); assert.ok(shown(page, 'flash'));
});

test('another tab saved the password: this tab\'s set-password ends', async () => {
  const {page, client} = await auth({}, {stored: stored({verified: true}), sessions: {[hostedUrl]: USER}});
  await settle(); assert.ok(shown(page, 'auth'));
  client().authListener('USER_UPDATED', {user: USER, access_token: 't'}); await settle();
  assert.ok(!shown(page, 'auth')); assert.equal(page.storage.get('rb.pending'), undefined);
});

// ---------- change address
test('change address: back to the screen of origin, the address in its field, the code forgotten', async () => {
  const s = await atCode();
  await s.page.fire('a-change'); await settle();
  assert.equal(titleOf(s.page), 'Create your account'); assert.equal(s.page.element('a-email').value, EMAIL);
  assert.equal(s.page.storage.get('rb.pending'), undefined);
});

// ---------- signin
test('signin: wrong password, offline; forgot and create are links; own Supabase stays reachable', async () => {
  let s = await auth({signIn: {data: {}, error: ERR.creds}}); await toSignin(s.page);
  assert.equal(titleOf(s.page), 'Sign in'); assert.equal(s.page.element('a-submit').textContent, 'Sign in');
  assert.equal(s.page.element('a-other-t').textContent, 'New here? '); assert.equal(s.page.element('a-toggle').textContent, 'Create an account');
  assert.ok(shown(s.page, 'a-adv')); assert.ok(shown(s.page, 'a-forgot-row'));
  type(s.page); await submit(s.page);
  assert.equal(s.page.element('a-err').textContent, 'Wrong email or password.');
  s = await auth({signIn: failure(ERR.net)}, {nav: {onLine: false}}); await toSignin(s.page); type(s.page); await submit(s.page);
  assert.equal(s.page.element('a-err').textContent, 'You’re offline: check your connection and try again.');
});

test('signin, address never confirmed: a new code, the code screen with its banner; « change address » returns to sign-in', async () => {
  const s = await auth({signIn: {data: {}, error: ERR.unconfirmed}, verify: {data: {session: {}}, error: null}}); await toSignin(s.page); type(s.page); await submit(s.page);
  assert.deepEqual(s.log.find(l => l[0] === 'resend')[1].type, 'signup');
  assert.equal(titleOf(s.page), 'Enter your code');
  assert.equal(s.page.element('a-note').innerHTML, 'Your sign-up isn’t finished: we just sent you a new code.');
  assert.equal(pending(s.page).from, 'signin');
  await s.page.fire('a-change'); await settle();
  assert.equal(titleOf(s.page), 'Sign in'); assert.equal(s.page.element('a-email').value, EMAIL);
});

test('signin, never confirmed, resend too soon: the code screen without « we just sent », the password still applied after the code', async () => {
  const s = await auth({signIn: {data: {}, error: ERR.unconfirmed}, resend: {data: {}, error: ERR.soon}, verify: {data: {session: {}}, error: null}}); await toSignin(s.page); type(s.page); await submit(s.page);
  assert.equal(titleOf(s.page), 'Enter your code'); assert.ok(!shown(s.page, 'a-note'));
  assert.equal(s.page.element('a-err').textContent, 'The last code just left: wait for the countdown before asking for another.');
  await code(s.page, '123456');
  assert.equal(s.log.find(l => l[0] === 'update')[1].password, PW);
});

test('signin, never confirmed, resend offline: stays on sign-in with the line', async () => {
  const s = await auth({signIn: {data: {}, error: ERR.unconfirmed}, resend: failure(ERR.net)}, {nav: {onLine: false}}); await toSignin(s.page); type(s.page); await submit(s.page);
  assert.equal(titleOf(s.page), 'Sign in');
  assert.equal(s.page.element('a-err').textContent, 'You’re offline: check your connection and try again.');
});

// ---------- hosted.mailReady (L41b)
const OFF = {cfg: {mailReady: false}};
const atExists = async options => { const s = await auth({signUp: {data: {}, error: ERR.exists}}, options); await toSignup(s.page); type(s.page); await submit(s.page); assert.equal(titleOf(s.page), 'This address already has an account'); return s; };
test('mailReady false, hosted backend: no « Forgot your password? » on signin nor exists, the rest as it was', async () => {
  const s = await auth({signIn: {data: {}, error: ERR.creds}}, OFF); await toSignin(s.page);
  assert.equal(titleOf(s.page), 'Sign in'); assert.ok(!shown(s.page, 'a-forgot-row'));
  assert.ok(shown(s.page, 'a-adv')); assert.equal(s.page.element('a-toggle').textContent, 'Create an account');
  type(s.page); await submit(s.page); assert.equal(s.page.element('a-err').textContent, 'Wrong email or password.');
  assert.ok(!shown(s.page, 'a-forgot-row'), 'a failed sign-in does not bring it back');
  const e = await atExists(OFF); assert.ok(!shown(e.page, 'a-forgot-row'));
  assert.equal(e.page.element('a-submit').textContent, 'Sign in'); assert.equal(e.page.element('a-toggle').textContent, 'Use another address');
});
test('mailReady false, own backend: the link stays on signin and exists, since the setting speaks of the hosted one', async () => {
  const s = await auth({signUp: {data: {}, error: ERR.exists}}, {...OFF, remembered: {mode: 'own', url: ownUrl, key: ownKey}}); // its sign-in form is the first thing shown
  assert.equal(titleOf(s.page), 'Sign in'); assert.ok(shown(s.page, 'a-forgot-row'));
  await s.page.fire('a-toggle'); await settle(); type(s.page); await submit(s.page);
  assert.equal(titleOf(s.page), 'This address already has an account'); assert.ok(shown(s.page, 'a-forgot-row'));
});
test('mailReady true, or absent from a config.js still in cache: the link stays on the hosted backend', async () => {
  for (const options of [{cfg: {mailReady: true}}, {}]) {
    const s = await auth({}, options); await toSignin(s.page); assert.ok(shown(s.page, 'a-forgot-row'));
    const e = await atExists(options); assert.ok(shown(e.page, 'a-forgot-row'));
  }
});
test('app/config.js ships mailReady true: the hosted backend sends email', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '../app/config.js'), 'utf8'), /mailReady: true/);
});

// ---------- forgot, reset
const atReset = async (answers = {}, options = {}) => {
  const s = await auth(answers, options); await toSignin(s.page); s.page.element('a-email').value = EMAIL;
  await s.page.fire('a-forgot'); await settle();
  assert.equal(titleOf(s.page), 'Forgot your password');
  await submit(s.page);
  assert.equal(titleOf(s.page), 'New password');
  return s;
};

test('forgot: a bad address; a good one: resetPasswordForEmail, then reset, hedged', async () => {
  const s = await auth(); await toSignin(s.page); s.page.element('a-email').value = 'nope';
  await s.page.fire('a-forgot'); await settle();
  assert.ok(s.page.element('a-lead').innerHTML.startsWith('Enter your address'));
  await submit(s.page);
  assert.equal(s.page.element('a-err').textContent, 'That doesn’t look like an email address: check it.');
  assert.equal(s.log.length, 0);
  const r = await atReset();
  assert.equal(r.log.find(l => l[0] === 'recover')[1], EMAIL);
  assert.equal(r.page.element('a-sent').innerHTML, `Code sent to <b>${EMAIL}</b>, if an account uses it.`);
  assert.ok(shown(r.page, 'a-nocode')); assert.equal(pending(r.page).type, 'recovery'); assert.equal(pending(r.page).from, 'forgot');
});

test('forgot: resend too soon goes on to reset with the countdown; hourly limit and offline stay', async () => {
  let s = await auth({recover: {data: {}, error: ERR.soon}}); await toSignin(s.page); s.page.element('a-email').value = EMAIL;
  await s.page.fire('a-forgot'); await settle(); await submit(s.page);
  assert.equal(titleOf(s.page), 'New password'); assert.match(s.page.element('a-help').innerHTML, /in <b>4[0-2] s<\/b>/);
  s = await auth({recover: {data: {}, error: ERR.hour}}); await toSignin(s.page); s.page.element('a-email').value = EMAIL;
  await s.page.fire('a-forgot'); await settle(); await submit(s.page);
  assert.equal(titleOf(s.page), 'Forgot your password');
  assert.equal(s.page.element('a-err').textContent, 'Sending limit reached for this address: try again in an hour.');
});

test('reset: code, new password: verifyOtp recovery (its PASSWORD_RECOVERY event opens nothing), updateUser, then home with the flash', async () => {
  let during = null;
  const s = await atReset({update: () => { during = s.page.element('auth').hidden === false && titleOf(s.page); return {data: {}, error: null}; }, verify: {data: {session: {}}, error: null}});
  s.page.element('a-code').value = '123456'; s.page.element('a-pass').value = PW; await submit(s.page);
  assert.equal(JSON.stringify(s.log.find(l => l[0] === 'verify')[1]), JSON.stringify({email: EMAIL, token: '123456', type: 'recovery'}));
  assert.equal(during, 'New password');
  assert.equal(s.log.find(l => l[0] === 'update')[1].password, PW);
  assert.ok(!shown(s.page, 'auth'));
  assert.equal(s.page.element('flash').innerHTML, `Password changed for <b>${EMAIL}</b>.`);
  assert.equal(s.page.storage.get('rb.pending'), undefined);
});

test('reset: no auto-send at six digits (the password is on the same screen)', async () => {
  const s = await atReset({verify: {data: {}, error: ERR.wrong}});
  s.page.element('a-code').value = '123456'; await s.page.fire('a-code', 'input'); await settle();
  assert.equal(s.log.filter(l => l[0] === 'verify').length, 0);
});

test('reset: wrong code, too short a password, too many attempts', async () => {
  const s = await atReset({verify: {data: {}, error: ERR.wrong}});
  s.page.element('a-code').value = '123456'; s.page.element('a-pass').value = 'short'; await submit(s.page);
  assert.equal(s.page.element('a-err').textContent, 'The password needs at least 6 characters.'); assert.equal(s.log.filter(l => l[0] === 'verify').length, 0);
  s.page.element('a-pass').value = PW; await submit(s.page);
  assert.equal(s.page.element('a-err').textContent, 'That code isn’t right. Check the 6 digits of the latest email.');
  const t = await atReset({verify: {data: {}, error: ERR.limit}});
  t.page.element('a-code').value = '123456'; t.page.element('a-pass').value = PW; await submit(t.page);
  assert.equal(t.page.element('a-err').textContent, 'Too many attempts. Wait a few minutes, then ask for a new code.');
});

test('reset: the same password (HTTP 422 same_password) still counts as changed; a refusal leaves the code behind', async () => {
  const s = await atReset({update: {data: {}, error: ERR.same}, verify: {data: {session: {}}, error: null}});
  s.page.element('a-code').value = '123456'; s.page.element('a-pass').value = PW; await submit(s.page);
  assert.ok(!shown(s.page, 'auth')); assert.ok(shown(s.page, 'flash'));
  const w = await atReset({update: {data: {}, error: ERR.weak}, verify: {data: {session: {}}, error: null}});
  w.page.element('a-code').value = '123456'; w.page.element('a-pass').value = PW; await submit(w.page);
  assert.ok(shown(w.page, 'auth')); assert.ok(!shown(w.page, 'a-code-row')); assert.ok(shown(w.page, 'a-err'));
});

test('reset: « create one » goes to sign-up with the address; « change address » to forgot', async () => {
  const s = await atReset();
  await s.page.element('auth-form').listeners.click({preventDefault() {}, target: {closest: () => ({dataset: {au: 'create'}})}}); await settle();
  assert.equal(titleOf(s.page), 'Create your account'); assert.equal(s.page.element('a-email').value, EMAIL);
  const c = await atReset();
  await c.page.fire('a-change'); await settle();
  assert.equal(titleOf(c.page), 'Forgot your password'); assert.equal(c.page.element('a-email').value, EMAIL);
});

test('resume of a reset: the code and new password are asked again', async () => {
  const {page} = await auth({}, {stored: stored({type: 'recovery', from: 'forgot'})});
  assert.equal(titleOf(page), 'New password'); assert.ok(shown(page, 'a-code-row')); assert.ok(shown(page, 'a-pass-row'));
});

// ---------- own backends
const OWN = {remembered: {mode: 'own', url: ownUrl, key: ownKey}};
test('own backend: no six-digit promise, no auto-send, a longer code goes; the backend line shows; no contact link', async () => {
  const s = await auth({verify: {data: {session: {}}, error: null}}, {...OWN, cfg: {contact: 'hello@reelbook.example'}});
  await s.page.fire('a-toggle'); await settle();
  assert.equal(titleOf(s.page), 'Create your account');
  assert.ok(shown(s.page, 'a-backend-row'));
  type(s.page); await submit(s.page);
  assert.equal(s.page.element('a-sent').innerHTML, `A code or a link is on its way to <b>${EMAIL}</b>.`);
  assert.equal(s.page.element('a-code-l').textContent, 'Code from the email');
  assert.equal(s.page.element('a-code').maxLength, 10);
  s.page.element('a-code').value = '123456'; await s.page.fire('a-code', 'input'); await settle();
  assert.equal(s.log.filter(l => l[0] === 'verify').length, 0, 'not at six');
  s.page.element('a-code').value = '12345678'; await submit(s.page);
  assert.equal(s.log.find(l => l[0] === 'verify')[1].token, '12345678');
});

test('own backend: an address without a dot is accepted, as today', async () => {
  const s = await auth({}, OWN);
  await s.page.fire('a-toggle'); await settle();
  type(s.page, 'me@localhost'); await submit(s.page);
  assert.equal(s.log.find(l => l[0] === 'signUp')[1].email, 'me@localhost');
});

// ---------- the one call for L42
test('the guarded calls go through one function, and it adds nothing yet', () => {
  for (const call of ['signUp', 'signInWithPassword', 'resend', 'resetPasswordForEmail']) {
    const outside = html.split('const guardedAuth')[0] + html.split('const rememberBackend')[1];
    assert.ok(!new RegExp(`client\\.auth\\.${call}\\(`).test(outside), `${call} only in guardedAuth`);
  }
  assert.ok(html.includes("guardedAuth(client, 'signUp'") && html.includes("guardedAuth(client, 'signInWithPassword'") && html.includes("guardedAuth(client, 'resend'") && html.includes("guardedAuth(client, 'resetPasswordForEmail'"));
});

test('never the password in storage, at any screen: nothing writes a-pass or heldPw to ls', () => {
  assert.ok(!/ls\.set\([^)]*(heldPw|password|a-pass)/.test(html));
  assert.ok(html.includes("JSON.stringify({email: flow.email, type: flow.type, at: flow.at, from: flow.from, verified: !!flow.verified, url: backend.url})"));
});

// ---------- texts
test('the texts of the screens are in both dictionaries', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app/landing.js'), 'utf8');
  const keys = [...html.matchAll(/'(au\.[a-z0-9.]+)':/g)].map(m => m[1]);
  assert.ok(keys.length > 50);
  for (const k of new Set(keys)) assert.equal(src.split(`'${k}':`).length - 1, 2, k);
});

// ---------- the beta: a late confirmation (P7-signup.md, accepted limit)
test('accepted limit, measured on a real Auth: the trigger sees inserts only, so a confirmation after a resend can pass the total by one; the app shows full, never above', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
  assert.match(sql, /create trigger beta_signup before insert on auth\.users/);
  assert.ok(!/beta_on_signup[^;]*before update|before update[^;]*beta_on_signup/.test(sql), 'no check at the confirmation');
  // what beta_seats() answered after that confirmation (progress/2026-11-07-L41.md)
  const rpc = name => name === 'beta_seats' ? {data: {open: false, taken: 2, total: 1, today_left: 98}, error: null} : {data: null, error: {code: 'PGRST202'}};
  const {page} = await auth({}, {rpc});
  await page.fire('intro-signin'); await settle();
  await page.fire('a-toggle'); await settle();
  assert.ok(shown(page, 's-full'));
  assert.equal(page.element('s-wlH').textContent, 'Beta full: 1 of 1 spots taken', 'the count stays at the total');
});

// ---------- L42b: Turnstile (P7-signup.md, « Facts checked », « Mockup review », « L42 notes »)
const SITE = '1x00000000000000000000AA'; // Cloudflare's public test key that always passes
const TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const CAPTCHA = {status: 400, code: 'captcha_failed', message: 'captcha protection: request disallowed (no captcha response)'};
// Cloudflare's API as the app uses it: render once, execute at each send (its callback, or its error-callback when
// `fails(n)` says so for the n-th run), reset after each attempt.
const fakeTs = (fails = () => false) => {
  const ts = {log: [], params: null, runs: 0,
    render(el, params) { ts.log.push('render'); ts.params = params; return 'w1'; },
    execute(id) { const n = ++ts.runs; ts.log.push('execute:' + id); queueMicrotask(() => fails(n) ? ts.params['error-callback']('300030') : ts.params.callback('tok-' + n)); },
    reset(id) { ts.log.push('reset:' + id); }};
  return ts;
};
const loadTs = async (page, ts, i = 0) => { page.window.turnstile = ts; page.appended[i].onload(); await settle(); };
const GUARDED = ['signUp', 'signIn', 'resend', 'recover'];
const tokensOf = log => log.filter(l => GUARDED.includes(l[0])).map(l => [l[0], (l[0] === 'recover' ? l[2] : l[1].options || {}).captchaToken]);
const withKey = (over = {}) => ({cfg: {turnstileSiteKey: SITE, ...over}});

test('Turnstile: no site key: no script, no widget, no token on the four calls (today, and every own backend)', async () => {
  const ts = fakeTs(), win = {turnstile: ts};
  const up = await auth({}, {win}); await toSignup(up.page); type(up.page); await submit(up.page); await clickResend(up.page);
  const inn = await auth({signIn: {data: {}, error: ERR.creds}}, {win}); await toSignin(inn.page); type(inn.page); await submit(inn.page);
  const fg = await atReset({}, {win});
  for (const s of [up, inn, fg]) { assert.deepEqual(s.page.appended, []); for (const [, t] of tokensOf(s.log)) assert.equal(t, undefined); }
  assert.deepEqual(tokensOf([...up.log, ...inn.log, ...fg.log]).map(l => l[0]), ['signUp', 'resend', 'signIn', 'recover']);
  assert.deepEqual(ts.log, [], 'Cloudflare never called');
  // an own backend, the hosted key set: still nothing
  const own = await auth({}, {remembered: {mode: 'own', url: ownUrl, key: ownKey}, ...withKey(), win});
  assert.equal(titleOf(own.page), 'Sign in'); type(own.page); await submit(own.page);
  assert.deepEqual(own.page.appended, []); assert.deepEqual(tokensOf(own.log), [['signIn', undefined]]); assert.deepEqual(ts.log, []);
});

test('Turnstile: the script loads on a guarded screen only, once, from Cloudflare, rendered invisible and run at the send', async () => {
  const s = await auth({}, withKey());
  assert.deepEqual(s.page.appended, [], 'not on the landing');
  await toSignup(s.page);
  assert.equal(s.page.appended.length, 1); assert.equal(s.page.appended[0].tagName, 'SCRIPT'); assert.equal(s.page.appended[0].src, TS_SRC);
  const ts = fakeTs(); await loadTs(s.page, ts);
  assert.deepEqual(ts.log, [], 'nothing run before the tap');
  type(s.page); await submit(s.page);
  assert.equal(titleOf(s.page), 'Enter your code');
  assert.equal(ts.params.sitekey, SITE); assert.equal(ts.params.appearance, 'interaction-only'); assert.equal(ts.params.execution, 'execute');
  assert.equal(s.page.appended.length, 1, 'loaded once');
});

test('Turnstile: a fresh token on each of the four calls, the widget reset after every success and every failure', async () => {
  // sign-up, then a resend from the code screen
  const up = await auth({}, withKey()); await toSignup(up.page); const ts = fakeTs(); await loadTs(up.page, ts);
  type(up.page); await submit(up.page); await clickResend(up.page);
  assert.deepEqual(tokensOf(up.log), [['signUp', 'tok-1'], ['resend', 'tok-2']]);
  assert.deepEqual(ts.log, ['render', 'execute:w1', 'reset:w1', 'execute:w1', 'reset:w1']);
  // sign-in refused (wrong password): reset all the same, and the next try has a new token
  const inn = await auth({signIn: {data: {}, error: ERR.creds}}, withKey()); await toSignin(inn.page); const t2 = fakeTs(); await loadTs(inn.page, t2);
  type(inn.page); await submit(inn.page); await submit(inn.page);
  assert.equal(inn.page.element('a-err').textContent, 'Wrong email or password.');
  assert.deepEqual(tokensOf(inn.log), [['signIn', 'tok-1'], ['signIn', 'tok-2']]);
  assert.deepEqual(t2.log.filter(l => l.startsWith('reset')).length, 2);
  // sign-in of an address never confirmed: two calls in a row, two tokens
  const un = await auth({signIn: {data: {}, error: ERR.unconfirmed}}, withKey()); await toSignin(un.page); const t3 = fakeTs(); await loadTs(un.page, t3);
  type(un.page); await submit(un.page);
  assert.equal(titleOf(un.page), 'Enter your code');
  assert.deepEqual(tokensOf(un.log), [['signIn', 'tok-1'], ['resend', 'tok-2']]);
  // forgot, and its resend from the reset screen
  const fg = await auth({}, withKey()); await toSignin(fg.page); const t4 = fakeTs(); await loadTs(fg.page, t4);
  fg.page.element('a-email').value = EMAIL; await fg.page.fire('a-forgot'); await settle(); await submit(fg.page);
  assert.equal(titleOf(fg.page), 'New password');
  await clickResend(fg.page);
  assert.deepEqual(tokensOf(fg.log), [['recover', 'tok-1'], ['recover', 'tok-2']]);
  assert.equal(fg.page.appended.length, 1, 'the same script from sign-in to forgot');
  // the code itself is not guarded (/verify): no token asked
  const before = ts.runs; await code(up.page, '123456'); assert.equal(ts.runs, before);
});

test('Turnstile: script blocked: the call goes without a token, so sign-in is never lost while the server does not ask for one', async () => {
  const s = await auth({signIn: {data: {session: {user: USER, access_token: 't'}, user: USER}, error: null}}, withKey()); await toSignin(s.page);
  s.page.appended[0].onerror(); await settle(); // loaded ahead, blocked
  type(s.page); const sent = submit(s.page); await settle();
  assert.equal(s.page.appended.length, 2, 'tried again at the tap'); s.page.appended[1].onerror(); await sent;
  assert.deepEqual(tokensOf(s.log), [['signIn', undefined]]);
  assert.ok(!shown(s.page, 'auth'), 'signed in');
});

test('Turnstile: script blocked and the server asks for a token: the Cloudflare message, the button live, a new load at the retry', async () => {
  let refuse = true;
  const s = await auth({signIn: () => refuse ? {data: {}, error: CAPTCHA} : {data: {session: {user: USER, access_token: 't'}, user: USER}, error: null}}, withKey({contact: 'hello@reelbook.example'}));
  await toSignin(s.page); s.page.appended[0].onerror(); await settle();
  type(s.page); const sent = submit(s.page); await settle(); s.page.appended[1].onerror(); await sent;
  assert.equal(s.page.element('a-err').innerHTML, 'The Cloudflare check didn’t go through. Turn off your content blocker or try another browser, then try again. Still stuck? <a href="mailto:hello@reelbook.example">Email us</a>.');
  assert.ok(shown(s.page, 'a-err')); assert.equal(s.page.element('a-submit').disabled, false); assert.equal(s.page.element('a-submit').textContent, 'Sign in');
  assert.equal(titleOf(s.page), 'Sign in', 'no loop, no other screen');
  // the retry loads the script again; it works this time
  refuse = false; const submitted = submit(s.page); await settle();
  assert.equal(s.page.appended.length, 3); await loadTs(s.page, fakeTs(), 2); await submitted;
  assert.deepEqual(tokensOf(s.log), [['signIn', undefined], ['signIn', 'tok-1']]);
  assert.ok(!shown(s.page, 'auth'));
  // no contact: the message without the link
  const n = await auth({signUp: {data: {}, error: CAPTCHA}}, withKey()); await toSignup(n.page); n.page.appended[0].onerror(); await settle();
  type(n.page); const sentUp = submit(n.page); await settle(); n.page.appended[1].onerror(); await sentUp;
  assert.equal(n.page.element('a-err').innerHTML, 'The Cloudflare check didn’t go through. Turn off your content blocker or try another browser, then try again.');
});

test('Turnstile: the widget fails (error-callback): sent without a token, the message on a refusal, a fresh token at the retry', async () => {
  const s = await auth({recover: (email, o) => o.captchaToken ? {data: {}, error: null} : {data: {}, error: CAPTCHA}}, withKey());
  await toSignin(s.page); const ts = fakeTs(n => n === 1); await loadTs(s.page, ts);
  s.page.element('a-email').value = EMAIL; await s.page.fire('a-forgot'); await settle(); await submit(s.page);
  assert.match(s.page.element('a-err').innerHTML, /^The Cloudflare check didn’t go through\./);
  assert.equal(titleOf(s.page), 'Forgot your password');
  await submit(s.page);
  assert.equal(titleOf(s.page), 'New password');
  assert.deepEqual(tokensOf(s.log), [['recover', undefined], ['recover', 'tok-2']]);
  assert.deepEqual(ts.log, ['render', 'execute:w1', 'reset:w1', 'execute:w1', 'reset:w1']);
  // the resend of the code screen has the same failure state
  const c = await auth({resend: {data: {}, error: CAPTCHA}}, {stored: stored(), ...withKey()}); await loadTs(c.page, fakeTs());
  await clickResend(c.page);
  assert.match(c.page.element('a-err').innerHTML, /^The Cloudflare check didn’t go through\./);
});

test('Turnstile: the service worker never caches Cloudflare\'s script, and the page has no CSP to widen', () => {
  const sw = fs.readFileSync(path.join(__dirname, '../app/sw.js'), 'utf8');
  assert.ok(!sw.includes('challenges.cloudflare.com'));
  const fetchHandler = sw.slice(sw.indexOf("self.addEventListener('fetch'"));
  assert.ok(fetchHandler.indexOf('if (url.origin !== location.origin) return;') < fetchHandler.indexOf('respondWith(shell('), 'other origins go straight to the network');
  assert.ok(!/http-equiv=["']?Content-Security-Policy/i.test(html), 'a CSP added later must allow https://challenges.cloudflare.com (script-src, frame-src)');
  const cfg = fs.readFileSync(path.join(__dirname, '../app/config.js'), 'utf8');
  assert.match(cfg, /turnstileSiteKey: '0x4[A-Za-z0-9_-]+'/, 'the hosted backend\'s public site key (widget for lt20.github.io)');
});
