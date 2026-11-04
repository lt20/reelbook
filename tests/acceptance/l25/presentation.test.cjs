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

test('First screen when nobody is signed in: Reelbook is introduced before the account actions', async () => {
  const page = await app();
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('intro').hidden, false);
  assert.equal(page.element('setup').hidden, true);
  assert.equal(page.element('home').hidden, true);
  const intro = introMarkup();
  const summary = visibleText(elementMarkup('intro-summary'));
  assert.match(summary, /Reelbook/i);
  assert.equal((summary.match(/[.!?](?=\s|$)/g) || []).length, 1, 'the explanation is one sentence');
  assert.ok(intro.indexOf('id="intro-summary"') < intro.indexOf('id="intro-step-link"'));
  assert.ok(intro.indexOf('id="intro-step-workout"') < intro.indexOf('What you need'));
  assert.ok(intro.indexOf('What you need') < intro.indexOf('Create an account'));
});

test('First screen: three illustrated steps explain link, computer sheet, then workout without video frames', () => {
  const intro = introMarkup();
  const steps = ['intro-step-link', 'intro-step-claude', 'intro-step-workout'];
  assert.deepEqual([...intro.matchAll(/\bid="intro-step-(?:link|claude|workout)"/g)].map(m => m[0]), steps.map(id => `id="${id}"`));
  const [link, claude, workout] = steps.map(elementMarkup);
  assert.match(visibleText(link), /paste.*link/i);
  assert.match(visibleText(claude), /Claude.*computer.*sheet/i);
  assert.match(visibleText(workout), /read.*workout/i);
  for (const step of [link, claude, workout]) {
    assert.match(step, /<svg\b|<img\b[^>]*\bsrc="[^"]+\.svg"/i, 'each step has a drawn illustration');
    assert.doesNotMatch(step, /<video\b|<iframe\b|\bposter=|<img\b[^>]*\bsrc="[^"]+\.(?:jpg|jpeg|png|webp)"/i);
  }
});

test('What you need: Claude Pro or above with Claude Code, Chrome extension, and a computer that stays on', () => {
  const intro = visibleText(introMarkup());
  const needs = intro.slice(intro.indexOf('What you need'));
  assert.match(needs, /Claude Pro or above/);
  assert.match(needs, /Claude Code/);
  assert.match(needs, /Chrome/);
  assert.match(needs, /Claude in Chrome/);
  assert.match(needs, /computer.*stays on/i);
});

test('Create an account: the main path uses the hosted backend', async () => {
  const page = await app();
  assert.match(visibleText(elementMarkup('intro-signup')), /^Create an account$/);
  await page.fire('intro-signup');
  assert.equal(page.element('intro').hidden, true);
  assert.equal(page.element('setup').hidden, true);
  assert.equal(page.element('auth').hidden, false);
  assert.equal(page.element('auth-title').textContent, 'Create an account');
  assert.equal(page.clients.at(-1).url, hostedUrl);
  assert.equal(page.element('hosted-blurb').textContent, 'Free for now.');
});

test('Sign in: a new visitor can open the hosted sign-in form from the introduction', async () => {
  const page = await app();
  assert.match(visibleText(elementMarkup('intro-signin')), /^Sign in$/);
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
  assert.equal(page.element('intro-demo').hidden, true);
  const demo = html.match(/<a\b[^>]*\bid="intro-demo"[^>]*>\s*See a demo\s*<\/a>/i);
  if (demo) assert.match(demo[0], /\bhidden\b/i);
});
