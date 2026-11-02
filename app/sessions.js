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

  const api = {ROUTE, sessionHref, sessionSlugOf, missingTable, resolveItems, sessionsBySheet};
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RBSessions = api;
})(typeof window !== 'undefined' ? window : globalThis);
