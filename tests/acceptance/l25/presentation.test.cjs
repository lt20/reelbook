const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app, html, hostedUrl, ownUrl, ownKey} = require('../../harness.cjs');

function introMarkup() {
  const start = html.indexOf('id="intro"');
  const end = html.indexOf('id="auth-form"', start);
  assert.ok(start >= 0 && end > start, 'the introduction precedes the sign-in form');
  return html.slice(start, end);
}

function elementMarkup(id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bid="${escaped}"[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'));
  assert.ok(match, `#${id} exists in the HTML`);
  return match[2];
}

function visibleText(markup) {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// L30 replaced the L25 presentation with the landing of mockup v2 (docs/audit-design/lots/L30.md, decision 13):
// the five cases below follow its copy (English by default) and keep L25's intent; the others are L25's as written.
test('First screen when nobody is signed in: Reelbook is introduced before the account actions', async () => {
  const page = await app();
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('intro').hidden, false);
  assert.equal(page.element('setup').hidden, true);
  assert.equal(page.element('home').hidden, true);
  const intro = introMarkup();
  // P8 R8: the hero says what Reelbook does for an athlete (the headline, then three steps); its old summary is gone
  const summary = visibleText(intro.match(/<h1\b[^>]*\bdata-k="h1"[^>]*>([\s\S]*?)<\/h1>/)[1]);
  assert.match(summary, /videos?\b[\s\S]*notebook/i);
  assert.ok(intro.indexOf('data-k="hp.3"') < intro.indexOf('id="lp-how"'), 'what Reelbook is, then how it works');
  assert.ok(intro.indexOf('id="lp-how"') < intro.indexOf('data-k="i2.n"'), 'how it works, then what you need');
  assert.ok(intro.indexOf('data-k="i2.n"') > intro.indexOf('id="lp-install"'));
  assert.ok(intro.indexOf('id="lp-install"') < intro.indexOf('id="intro-signup"'), 'the installation leads to the account');
});

test('First screen: the skill route explains the link, the computer making the sheet, then the notebook, without video frames', () => {
  const intro = introMarkup();
  const route = intro.slice(intro.indexOf('id="lp-how"'), intro.indexOf('id="lp-install"'));
  const steps = [...route.matchAll(/<li><div class="lp-stage"[\s\S]*?<\/li>/g)].map(m => m[0]);
  assert.equal(steps.length, 5);
  assert.match(visibleText(steps[0]), /send the video/i);
  assert.match(visibleText(steps[1]), /Claude/);
  assert.match(visibleText(steps[3]), /sequence of images/i);
  assert.match(visibleText(steps[4]), /notebook/i);
  assert.doesNotMatch(intro, /<video\b|<iframe\b|\bposter=|<img\b[^>]*\bsrc="[^"]+\.(?:jpg|jpeg|png|webp)"/i);
});

test('What you need: Claude Pro or above with Claude Code, and Chrome with the Claude in Chrome extension', () => {
  const needs = visibleText(introMarkup().match(/<p\b[^>]*\bdata-k="i2.n"[^>]*>([\s\S]*?)<\/p>/)[1]);
  assert.match(needs, /Claude Pro or above/);
  assert.match(needs, /Claude Code/);
  assert.match(needs, /Chrome/);
  assert.match(needs, /Claude in Chrome/);
});

test('Create an account: the main path uses the hosted backend', async () => {
  const page = await app();
  assert.match(visibleText(elementMarkup('intro-signup')), /^Create my notebook$/);
  await page.fire('intro-signup');
  assert.equal(page.element('intro').hidden, true);
  assert.equal(page.element('setup').hidden, true);
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('auth-title').textContent, 'Create your account');
  assert.equal(page.clients.at(-1).url, hostedUrl);
  assert.equal(page.element('hosted-blurb').textContent, 'Free for now.');
});

test('Sign in: a new visitor can open the hosted sign-in form from the introduction', async () => {
  const page = await app();
  assert.match(visibleText(elementMarkup('intro-signin')), /\bSign in$/);
  await page.fire('intro-signin');
  assert.equal(page.element('intro').hidden, true);
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('auth-form').hidden, false);
  assert.equal(page.element('auth-title').textContent, 'Sign in');
  assert.equal(page.clients.at(-1).url, hostedUrl);
});

test('Returning user with rb.backend stored: go straight to Sign in', async () => {
  for (const remembered of [{mode: 'hosted'}, {mode: 'own', url: ownUrl, key: ownKey}]) {
    const page = await app({remembered});
    assert.equal(page.element('intro').hidden, true);
    assert.equal(page.element('setup').hidden, true);
    assert.equal(page.element('auth').hidden, false);
    assert.equal(page.element('auth-form').hidden, false);
    assert.equal(page.element('auth-title').textContent, 'Sign in');
    assert.equal(page.clients[0].url, remembered.mode === 'hosted' ? hostedUrl : ownUrl);
  }
});

test('Use my own Supabase: an advanced link under the form opens own-backend entry', async () => {
  const form = html.indexOf('id="auth-form"');
  const own = html.indexOf('id="a-own"', form);
  assert.ok(form >= 0 && own > form);
  assert.match(elementMarkup('a-own'), /^Use my own Supabase$/);
  const page = await app();
  await page.fire('intro-signin');
  await page.fire('a-own');
  assert.equal(page.element('login-own-form').hidden, false);
});

test('See a demo: the link stays hidden until L27 is merged', async () => {
  const page = await app();
  assert.equal(page.element('intro-demo').hidden, false);
  const demo = html.match(/<a\b[^>]*\bid="intro-demo"[^>]*>\s*See a demo\s*<\/a>/i);
  if (demo) assert.match(demo[0], /\bhidden\b/i);
});
