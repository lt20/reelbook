// Reelbook sessions (v2): pure helpers, used by the app (window.RBSessions) and by tests/sessions.test.cjs.
// A v2 session is one row of the `sessions` table: title, format, why / key points / source for video
// sessions, and an ordered list of items [{slug, dose}] whose slug is the slug of an exercise sheet.
(root => {
  'use strict';
  // The app route of a v2 session: #session/<slug>. A sheet slug or a notebook id never holds a « / ».
  const ROUTE = 'session/';
  const sessionHref = slug => '#' + ROUTE + slug;
  const sessionSlugOf = tok => (typeof tok === 'string' && tok.startsWith(ROUTE) && tok.length > ROUTE.length) ? tok.slice(ROUTE.length) : null;

  // A backend set up before sessions v2 has no `sessions` table. PostgREST answers 42P01 (undefined table),
  // PGRST205 (table not in the schema cache) or a bare 404, depending on its version.
  const missingTable = (error, status) => !!error && (status === 404 || error.status === 404 || error.code === '42P01' || error.code === 'PGRST205');

  // Old one-page sessions (v1: a `sheets` row with kind 'session') are not shown any more. An older self-hosted
  // backend may still hold some: the app keeps the other rows and counts these for a hint in Settings
  // (`rb.py requeue-sessions`, then /reelbook, rebuilds them as v2 sessions). {sheets, v1}.
  const splitV1 = rows => {
    const sheets = [];
    let v1 = 0;
    for (const r of rows || []) if (r && r.kind === 'session') v1++; else if (r) sheets.push(r);
    return {sheets, v1};
  };

  const itemsOf = s => (s && Array.isArray(s.items) ? s.items : []).filter(it => it && typeof it.slug === 'string' && it.slug);

  // The items of a session, in order, whose sheet still exists: [{sheet, dose, n}], n counted from 1.
  // An item whose sheet was deleted is skipped and does not take a number.
  const resolveItems = (session, bySlug) => {
    const out = [];
    for (const it of itemsOf(session)) {
      const sheet = bySlug.get(it.slug);
      if (sheet) out.push({sheet, dose: typeof it.dose === 'string' ? it.dose : '', n: out.length + 1});
    }
    return out;
  };

  // sheet slug -> the sessions that list it, each session once, in the order of `sessions`.
  const sessionsBySheet = sessions => {
    const m = new Map();
    for (const s of sessions || []) for (const it of itemsOf(s)) {
      const l = m.get(it.slug) || [];
      if (!l.includes(s)) l.push(s);
      m.set(it.slug, l);
    }
    return m;
  };

  // ---------- composition (S3): pure, the app saves what they return in one update ----------
  // Free-text limits of a session: its title and format line, and an item's dose. Video sessions carry formats
  // of up to ~210 characters and doses of up to ~55: the limits stay above them, so saving an edit never cuts
  // a text the user did not touch. The Edit inputs carry the same `maxlength`.
  const MAX = {title: 80, format: 240, dose: 60};
  const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

  // The notes of a v2 session live in `notes` under « session/<slug> »: a sheet slug never holds a « / ».
  const noteKey = slug => ROUTE + slug;

  // A slug from a title, unique among `taken` (the user's session slugs, and the slugs of notes left by
  // deleted sessions, so an old note never shows up on a new session): « my-shoulders-monday », then « -2 »…
  // The « my- » prefix keeps user sessions apart from video sessions (« session-… », written by rb.py publish
  // as an upsert on the slug): a video session can never overwrite a session the user built.
  const slugBase = title => String(title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 45).replace(/-+$/, '') || 'session';
  const uniqueSlug = (title, taken) => {
    const has = taken instanceof Set ? s => taken.has(s) : s => (taken || []).includes(s);
    const base = 'my-' + slugBase(title);
    if (!has(base)) return base;
    for (let i = 2; ; i++) if (!has(`${base}-${i}`)) return `${base}-${i}`;
  };

  // Ticking in the « + New session » list: a tick appends the sheet, an untick removes it; order = tick order.
  const toggle = (picked, slug) => picked.includes(slug) ? picked.filter(s => s !== slug) : [...picked, slug];

  // « Add to session »: the sheet goes last, never twice. {items, added}; `items` is a new array when added.
  const addItem = (items, slug) => {
    const list = itemsOf({items});
    if (list.some(it => it.slug === slug)) return {items: list, added: false};
    return {items: [...list, {slug, dose: ''}], added: true};
  };

  // Edit mode: ↑ (delta -1) / ↓ (+1) swaps an item with its neighbour; out of range changes nothing.
  const moveItem = (items, i, delta) => {
    const out = [...items], j = i + delta;
    if (i < 0 || i >= out.length || j < 0 || j >= out.length) return out;
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  };
  const removeItem = (items, i) => items.filter((_, k) => k !== i);

  // What Edit saves: {slug, dose} only, dose trimmed to its limit.
  const cleanItems = items => itemsOf({items}).map(it => ({slug: it.slug, dose: clip(it.dose, MAX.dose)}));

  const api = {ROUTE, sessionHref, sessionSlugOf, missingTable, splitV1, resolveItems, sessionsBySheet,
    MAX, clip, noteKey, uniqueSlug, toggle, addItem, moveItem, removeItem, cleanItems};
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RBSessions = api;
})(typeof window !== 'undefined' ? window : globalThis);
