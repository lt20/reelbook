// L31: the hosted beta in the app — the two cards of #setup, the refusals of a sign-up and the waiting-list form, on
// both screens. The wording in French is checked against the dictionary by tests/landing.test.cjs.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, hostedUrl, ownUrl, ownKey} = require('./harness.cjs');

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
const OPEN = {taken: 14, total: 50, open: true, today_left: 7};
const FULL = {taken: 50, total: 50, open: false, today_left: 7};
const CLOSED = {taken: 14, total: 50, open: false, today_left: 7};
const NONE_TODAY = {taken: 14, total: 50, open: true, today_left: 0};
const NO_FUNCTION = {data: null, status: 404, error: {code: 'PGRST202', message: 'Could not find the function public.beta_seats in the schema cache'}};
const DB_ERROR = {status: 500, code: 'unexpected_failure', message: 'Database error saving new user'};
const answer = data => ({data, error: null});

// A new visitor, with `seatAnswers` read in turn by beta_seats() (the last one stays). Returns the page and the calls.
async function visitor(seatAnswers, {join = async () => answer('ok'), options = {}} = {}) {
  const asked = [], left = [...seatAnswers];
  const rpc = async (name, args) => {
    asked.push([name, args]);
    if (name === 'join_waitlist') return join(args);
    const next = left.length > 1 ? left.shift() : left[0];
    if (next instanceof Error) throw next;
    return next;
  };
  const page = await app({rpc, ...options});
  await settle();
  return {page, asked, seatCalls: () => asked.filter(c => c[0] === 'beta_seats').length, joins: () => asked.filter(c => c[0] === 'join_waitlist').map(c => c[1])};
}
const toSetup = async page => { await page.fire('intro-signin'); await page.fire('a-toggle'); await settle(); assert.equal(page.element('setup').hidden, false); };
// The hosted sign-up form, then its button, with signUp answering `error`.
async function signUp(page, error = null) {
  const client = page.clients.at(-1), calls = [];
  client.auth.signUp = async c => { calls.push(c); return error ? {data: {}, error} : {data: {session: null}, error: null}; };
  page.element('a-email').value = 'new@example.test';
  page.element('a-pass').value = 'example-password';
  const warn = console.warn; console.warn = () => {};
  try { await page.fire('auth-form', 'submit'); } finally { console.warn = warn; }
  await settle();
  return calls;
}
const hostedForm = async page => { await page.fire('intro-signup'); await settle(); assert.equal(page.element('auth-form').hidden, false); assert.equal(page.element('auth-title').textContent, 'Create an account'); };
const shown = (page, id) => page.element(id).hidden === false;
const FULL_MSG = 'The last spot has just been taken: your account was not created. Join the waiting list: we’ll let you know as soon as a spot opens.';
const SHUT_MSG = 'Sign-ups are closed for now: your account was not created. Join the waiting list: we’ll let you know as soon as a spot opens.';
const TODAY_MSG = 'Enough sign-ups for today: your account was not created. Try again tomorrow.';

test('L31 open — #setup: two cards, hosted picked, the seats line; its button creates the account after reading the seats', async () => {
  const {page, seatCalls} = await visitor([answer(OPEN)]);
  await toSetup(page);
  assert.equal(page.element('pick-hosted').checked, true); assert.equal(page.element('pick-own').checked, false);
  assert.ok(shown(page, 's-hosted-opt')); assert.ok(!shown(page, 's-full'));
  assert.ok(shown(page, 's-seatline')); assert.equal(page.element('s-seatline').textContent, '14 of 50 spots taken');
  assert.equal(page.element('s-go').textContent, 'Create my notebook');
  await page.fire('s-go'); await settle();
  assert.ok(shown(page, 'auth-form')); assert.equal(page.clients.at(-1).url, hostedUrl);
  const before = seatCalls();
  const calls = await signUp(page);
  assert.equal(seatCalls(), before + 1, 'read again just before the sign-up');
  assert.equal(calls.length, 1); assert.ok(!shown(page, 'a-err'));
});

test('L31 — « On my own Supabase » opens the project form in #setup; Back gives the hosted card back', async () => {
  const {page} = await visitor([answer(OPEN)]);
  await toSetup(page);
  await page.fire('pick-own', 'change');
  assert.ok(shown(page, 'own-form')); assert.ok(!shown(page, 's-go')); assert.equal(page.element('pick-own').checked, true);
  await page.fire('own-cancel');
  assert.ok(!shown(page, 'own-form')); assert.ok(shown(page, 's-go')); assert.equal(page.element('pick-hosted').checked, true);
  assert.equal(page.element('s-go').textContent, 'Create my notebook');
});

test('L31 — the hosted sign-up form no longer offers own Supabase; the sign-in form still does', async () => {
  const {page} = await visitor([answer(OPEN)]);
  await page.fire('intro-signin');
  assert.ok(shown(page, 'a-adv'), 'on sign-in');
  await page.fire('a-toggle'); await settle();
  await page.fire('s-go'); await settle();
  assert.ok(shown(page, 'auth-form')); assert.equal(page.element('auth-title').textContent, 'Create an account');
  assert.ok(!shown(page, 'a-adv'), 'not on the hosted sign-up');
});

test('L31 full — #setup: the waiting list instead of the hosted card, own Supabase picked, « Connect my Supabase » opens its form', async () => {
  const {page} = await visitor([answer(FULL)]);
  await toSetup(page);
  assert.ok(!shown(page, 's-hosted-opt')); assert.ok(shown(page, 's-full')); assert.ok(shown(page, 's-wl'));
  assert.equal(page.element('s-wlH').textContent, 'Beta full: 50 of 50 spots taken');
  assert.equal(page.element('pick-own').checked, true); assert.equal(page.element('pick-hosted').checked, false);
  assert.equal(page.element('s-go').textContent, 'Connect my Supabase'); assert.ok(!shown(page, 'own-form'));
  await page.fire('s-go');
  assert.ok(shown(page, 'own-form')); assert.ok(!shown(page, 's-go'));
  await page.fire('own-cancel');
  assert.ok(shown(page, 's-go'), 'Back: the button again, own Supabase still picked'); assert.equal(page.element('pick-own').checked, true);
  page.element('own-url').value = ownUrl; page.element('own-key').value = ownKey;
  await page.fire('own-form', 'submit'); await settle();
  assert.equal(page.clients.at(-1).url, ownUrl); assert.ok(shown(page, 'auth-form'));
});

test('L31 full — the landing: beta_seats() repaints step 2 from the choice landing.js has just made', async () => {
  const seat = {};
  const RBL = {t: () => null, onChange() {}, seats: () => { seat.page.element('lp-host-own').checked = true; }};
  const page = await app({win: {RBL}, rpc: async () => { await settle(); return answer(FULL); }});
  seat.page = page;
  assert.equal(page.element('lp-lines').hidden, false, 'hosted, until the answer');
  await settle(); await settle();
  assert.equal(page.element('lp-lines').hidden, true); assert.equal(page.element('lp-ownLine').hidden, false);
});

test('L31 closed — the heading says « Beta full » without a count of seats that are not taken', async () => {
  const {page} = await visitor([answer(CLOSED)]);
  await toSetup(page);
  assert.ok(shown(page, 's-full')); assert.equal(page.element('s-wlH').textContent, 'Beta full');
});

for (const [name, seat] of [['no function', NO_FUNCTION], ['an error', {data: null, error: {message: 'boom'}}], ['null, no settings row', answer(null)], ['no network', new Error('offline')]]) {
  test(`L31 without beta_seats (${name}) — today's behaviour: no count, no list, the sign-up goes on, and its error reads as today`, async () => {
    const {page} = await visitor([seat]);
    await toSetup(page);
    assert.ok(shown(page, 's-hosted-opt')); assert.ok(!shown(page, 's-full')); assert.ok(!shown(page, 's-seatline'));
    assert.equal(page.element('s-go').textContent, 'Create my notebook');
    await page.fire('s-go'); await settle();
    assert.equal((await signUp(page)).length, 1, 'the account is created');
    const {page: p2} = await visitor([seat]);
    await hostedForm(p2);
    assert.equal((await signUp(p2, DB_ERROR)).length, 1);
    assert.equal(p2.element('a-err').textContent, 'The server did not answer: check your connection and try again.');
    assert.ok(!shown(p2, 'a-wl'), 'no waiting list');
  });
}

test('L31 own Supabase — beta_seats() is not asked, neither on #setup nor before the sign-up', async () => {
  const rpcs = [];
  const page = await app({remembered: {mode: 'own', url: ownUrl, key: ownKey}, rpc: async name => { rpcs.push(name); return NO_FUNCTION; }});
  await settle();
  await page.fire('a-toggle'); await settle();
  assert.ok(shown(page, 'setup')); assert.ok(!shown(page, 's-full')); assert.ok(!shown(page, 's-seatline'));
  page.element('pick-own').checked = true;
  await page.fire('pick-own', 'change');
  page.element('own-url').value = ownUrl; page.element('own-key').value = ownKey;
  await page.fire('own-form', 'submit'); await settle();
  assert.ok(shown(page, 'a-adv'), 'an own backend keeps its links');
  assert.equal((await signUp(page, DB_ERROR)).length, 1);
  assert.equal(page.element('a-err').textContent, 'The server did not answer: check your connection and try again.');
  assert.deepEqual(rpcs, []);
});

for (const [name, seats, msg, link] of [['full', FULL, FULL_MSG, true], ['closed', CLOSED, SHUT_MSG, true], ['no slot left today', NONE_TODAY, TODAY_MSG, false]]) {
  test(`L31 refused before signUp — ${name}: its message, signUp not called, the state already known by then`, async () => {
    const {page} = await visitor([answer(OPEN), answer(seats)]);
    await hostedForm(page);
    assert.deepEqual(await signUp(page), [], 'no account attempted');
    assert.equal(page.element('a-err').textContent, msg);
    assert.equal(shown(page, 'a-wl'), link);
    assert.equal(page.element('a-submit').disabled, false, 'the button is back');
  });
}

test('L31 last seat taken meanwhile — read open, signUp refused, read full: the clear message and the way to the list', async () => {
  const {page, seatCalls} = await visitor([answer(OPEN), answer(OPEN), answer(FULL)]);
  await hostedForm(page);
  assert.equal((await signUp(page, DB_ERROR)).length, 1);
  assert.equal(seatCalls(), 3);
  assert.equal(page.element('a-err').textContent, FULL_MSG, 'never the generic message');
  assert.ok(shown(page, 'a-wl'));
  await page.fire('a-wl-go'); await settle();
  assert.ok(shown(page, 'setup')); assert.ok(shown(page, 's-full'));
  assert.equal(page.element('s-wl-email').value, 'new@example.test', 'the address typed follows');
  assert.ok(!shown(page, 'a-wl'), 'the link goes with the message');
});

test('L31 signUp refused — read again: closed today says so; still open is another error, the generic line; no answer says it may be full', async () => {
  for (const [after, msg] of [[answer(NONE_TODAY), TODAY_MSG], [answer(CLOSED), SHUT_MSG], [answer(OPEN), 'Could not create the account.'],
    [NO_FUNCTION, 'Your account was not created: the beta may have just filled up. Try again in a moment.'], [new Error('offline'), 'Your account was not created: the beta may have just filled up. Try again in a moment.']]) {
    const {page} = await visitor([answer(OPEN), answer(OPEN), after]);
    await hostedForm(page);
    await signUp(page, DB_ERROR);
    assert.equal(page.element('a-err').textContent, msg);
  }
});

test('L31 — each refusal is mapped from the message, should Auth pass it on; any other error stays as it was', async () => {
  for (const [message, msg, link] of [['beta: full', FULL_MSG, true], ['beta: closed today', TODAY_MSG, false], ['beta: closed', SHUT_MSG, true],
    ['beta: project limit, try tomorrow', 'Reelbook has taken enough videos for today, across all accounts: try again tomorrow.', false],
    ['beta: project limit of photos', 'The beta’s photo space is full for now: try again later.', false],
    ['Something else', 'Could not create the account.', false]]) {
    const {page} = await visitor([NO_FUNCTION]);
    await hostedForm(page);
    await signUp(page, {status: 400, message});
    assert.equal(page.element('a-err').textContent, msg, message);
    assert.equal(shown(page, 'a-wl'), link, message);
  }
});

test('L31 — the project-wide limit on « Add a video » is said in words, not as the generic error', async () => {
  const page = await app({remembered: {mode: 'own', url: ownUrl, key: ownKey}, sessions: {[ownUrl]: {id: 'u1', email: 'user@example.test'}}});
  await settle();
  const client = page.clients.at(-1), from = client.from;
  client.from = table => table === 'requests' ? {insert: async () => ({data: null, error: {code: 'P0001', message: 'beta: project limit, try tomorrow'}, status: 400})} : from(table);
  await page.fire('add-video-fab');
  page.element('f-url').value = 'https://www.instagram.com/reel/DeGBCfjsbTt/';
  await page.fire('sheet-new', 'submit');
  await settle();
  assert.equal(page.element('f-err').textContent, 'Reelbook has taken enough videos for today, across all accounts: try again tomorrow.');
});

for (const p of ['lp', 's']) {
  const fill = (page, first, email, consent) => { page.element(`${p}-wl-first`).value = first; page.element(`${p}-wl-email`).value = email; page.element(`${p}-wl-consent`).checked = consent; };
  const onCard = async page => { if (p === 's') await toSetup(page); };

  test(`L31 waiting list (${p}) ok — the call, then the message instead of the form, on both screens`, async () => {
    const {page, joins} = await visitor([answer(FULL)]);
    await onCard(page);
    fill(page, '  Camille ', ' camille@example.test ', true);
    await page.fire(`${p}-wl`, 'submit');
    assert.deepEqual(JSON.parse(JSON.stringify(joins())), [{first_name: 'Camille', email: 'camille@example.test', lang: 'en', consent: true}]);
    for (const q of ['lp', 's']) { assert.equal(page.element(`${q}-wl`).hidden, true); assert.equal(page.element(`${q}-wlP`).hidden, true); assert.equal(page.element(`${q}-wl-done`).hidden, false); }
    assert.ok(!shown(page, `${p}-wl-err`));
  });

  test(`L31 waiting list (${p}) duplicate — the same answer, the same message`, async () => {
    const seen = new Set();
    const {page, joins} = await visitor([answer(FULL)], {join: async a => { seen.add(a.email); return answer('ok'); }});
    await onCard(page);
    fill(page, 'Camille', 'camille@example.test', true);
    await page.fire(`${p}-wl`, 'submit');
    await page.fire(`${p}-wl`, 'submit');
    assert.equal(joins().length, 2); assert.equal(seen.size, 1);
    assert.equal(page.element(`${p}-wl-done`).hidden, false); assert.ok(!shown(page, `${p}-wl-err`));
  });

  test(`L31 waiting list (${p}) — no consent, no first name, a bad address: said here, nothing sent`, async () => {
    const {page, joins} = await visitor([answer(FULL)]);
    await onCard(page);
    for (const [first, email, consent, msg] of [
      ['Camille', 'camille@example.test', false, 'Tick the box so we can keep your first name and email.'],
      ['  ', 'camille@example.test', true, 'Enter your first name.'],
      ['Camille', 'camille@example', true, 'That email address is not valid.']]) {
      fill(page, first, email, consent);
      await page.fire(`${p}-wl`, 'submit');
      assert.equal(page.element(`${p}-wl-err`).textContent, msg); assert.ok(shown(page, `${p}-wl-err`));
      assert.equal(page.element(`${p}-wl-done`).hidden, true);
    }
    assert.deepEqual(joins(), []);
  });

  test(`L31 waiting list (${p}) — the server's refusals in words, and the form stays`, async () => {
    for (const [error, msg] of [
      [{code: 'P0001', message: 'waitlist: consent required'}, 'Tick the box so we can keep your first name and email.'],
      [{code: 'P0001', message: 'waitlist: first name'}, 'Enter your first name.'],
      [{code: 'P0001', message: 'waitlist: email'}, 'That email address is not valid.'],
      [{code: 'P0001', message: 'waitlist: full today'}, 'Too many requests today: try again tomorrow. If you already joined, you are still on the list.'],
      [{code: 'P0001', message: 'waitlist: seats open'}, 'A spot has just opened: reload the page to create your account.'],
      [{code: '500', message: 'boom'}, 'That did not work: check your connection and try again.'],
      [null, 'That did not work: check your connection and try again.']]) {
      const {page} = await visitor([answer(FULL)], {join: async () => { if (!error) throw new Error('offline'); return {data: null, error}; }});
      await onCard(page);
      fill(page, 'Camille', 'camille@example.test', true);
      const warn = console.warn; console.warn = () => {};
      try { await page.fire(`${p}-wl`, 'submit'); } finally { console.warn = warn; }
      assert.equal(page.element(`${p}-wl-err`).textContent, msg);
      assert.equal(page.element(`${p}-wl-done`).hidden, true);
      assert.equal(page.element(`${p}-wl-go`).disabled, false, 'it can be sent again');
    }
  });
}
