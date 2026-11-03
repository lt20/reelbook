// Reelbook sessions (v2): pure helpers, used by the app (window.RBSessions) and by tests/sessions.test.cjs.
// A v2 session is one row of the `sessions` table: title, format, why / key points / source for video
// sessions, and an ordered list of items [{slug, dose}] whose slug is the slug of an exercise sheet.
(root => {
  'use strict';
  // The app route of a v2 session: #session/<slug>. A sheet slug or a notebook id never holds a « / ».
  // One exercise of a session (L5): #session/<slug>/<n>, n counted from 1 over the items whose sheet exists
  // (resolveItems), so the sheet page knows its place in the session: dose banner, back link, previous / next.
  const ROUTE = 'session/';
  const sessionHref = slug => '#' + ROUTE + slug;
  const sessionItemHref = (slug, n) => '#' + ROUTE + slug + '/' + n;
  // {slug, n}: n is null on the session route itself; null when tok is not a session route (a sheet slug, a
  // notebook id, « session/x/0 », « session/x/nope », « session/x/2/extra »).
  const parseRoute = tok => {
    if (typeof tok !== 'string' || !tok.startsWith(ROUTE)) return null;
    const parts = tok.slice(ROUTE.length).split('/');
    if (!parts[0] || parts.length > 2) return null;
    if (parts.length === 1) return {slug: parts[0], n: null};
    return /^[1-9][0-9]*$/.test(parts[1]) ? {slug: parts[0], n: Number(parts[1])} : null;
  };
  const sessionSlugOf = tok => { const r = parseRoute(tok); return r ? r.slug : null; };
  // {slug, n} for an exercise route only (#session/<slug>/<n>), else null.
  const sessionItemOf = tok => { const r = parseRoute(tok); return r && r.n ? r : null; };

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

  // The items of a session, in order, whose sheet still exists: [{sheet, dose, n, sets, reps, seconds, rest_s,
  // per_side, given}], n counted from 1. An item whose sheet was deleted is skipped and does not take a number.
  // L9: the numbers the session player needs. A structured field written on the item (`given`, see givenOf) wins;
  // else it comes from the free-text dose (parseDose), and the rest from the session format (parseRest).
  const resolveItems = (session, bySlug) => {
    const out = [];
    let rest;
    for (const it of itemsOf(session)) {
      const sheet = bySlug.get(it.slug);
      if (!sheet) continue;
      const dose = typeof it.dose === 'string' ? it.dose : '', given = givenOf(it), p = parseDose(dose);
      if (rest === undefined) rest = parseRest(session.format);
      const pick = (k, v) => k in given ? given[k] : v;
      out.push({sheet, dose, n: out.length + 1, sets: pick('sets', p.sets), reps: pick('reps', p.reps),
        seconds: pick('seconds', p.seconds), rest_s: pick('rest_s', rest), per_side: pick('per_side', p.perSide), given});
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

  // A text the user did not change in Edit is saved as it was, even past its limit (rb.py publish and the schema
  // do not enforce the limits): only a text the user edited is trimmed and clipped.
  const keepOrClip = (v, was, n) => (typeof was === 'string' && v === was) ? was : clip(v, n);

  // What Edit saves: {slug, dose}; `was` (the dose when Edit opened) keeps an untouched dose whole. L9: an untouched
  // dose also keeps its structured fields (`given`, from resolveItems); an edited dose drops them, so the numbers
  // then come from the text the user wrote.
  const cleanItems = items => itemsOf({items}).map(it => {
    const dose = keepOrClip(it.dose, it.was, MAX.dose), kept = typeof it.was === 'string' && it.dose === it.was;
    return {slug: it.slug, dose, ...(kept ? givenOf(it.given) : {})};
  });

  // ---------- structured dose (L9, S2): pure, never throws ----------
  // The fields /reelbook writes on an item when the video states them (skill/reelbook/SKILL.md): whole numbers ≥ 0
  // for sets / reps / seconds / rest_s, a boolean for per_side. Any other value is ignored (the parser fills in).
  const GIVEN = ['sets', 'reps', 'seconds', 'rest_s', 'per_side'];
  const givenOf = it => {
    const out = {};
    if (!it || typeof it !== 'object') return out;
    for (const k of GIVEN) {
      const v = it[k];
      if (k === 'per_side' ? typeof v === 'boolean' : Number.isInteger(v) && v >= 0) out[k] = v;
    }
    return out;
  };

  // Lower case, one kind of dash, one kind of space: « 3 × 8–12 » and « 3 x 8-12 » read alike.
  const norm = s => s.normalize('NFC').toLowerCase().replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ');
  const RANGE = '(\\d+)(?:\\s*(?:-|à|to)\\s*(\\d+))?'; // « 8-12 », « 60 à 90 », « 8 to 12 »: the upper bound counts
  const SEC = '(?:secondes?|seconds?|secs?|s)';
  const MIN = '(?:minutes?|mins?|mn)';
  const END = '(?![a-zà-ÿ\\d])';
  const SIDE = /(?:chaque|par|each|per)\s+(?:côtés?|cotes?|sides?)/;
  const re = {
    min: new RegExp(`^${RANGE}\\s*${MIN}${END}(?:\\s*(\\d{1,2})(?:\\s*${SEC})?${END})?`),
    quote: /^(\d+)\s*['’′](?:\s*(\d{1,2})(?!\d))?/,
    sec: new RegExp(`^${RANGE}\\s*${SEC}${END}`),
    times: /^(\d+)\s*[×x*]\s*(?=\d)(.*)$/,
    range: new RegExp(`^${RANGE}`),
    rounds: new RegExp(`^(\\d+)\\s*(?:rounds?|tours?|séries?|series|sets?)${END}`),
    reps: new RegExp(`^${RANGE}\\s*(?:répétitions?|repetitions?|reps?)${END}`),
    side: new RegExp(`^${RANGE}\\s+(?:de\\s+)?${SIDE.source}`),
    twoSchemes: /\d\s*[×x*]\s*\d.*\d\s*[×x*]\s*\d/
  };
  // A duration at the start of s, in seconds: « 1 min », « 1 min 30 », « 2'30 », « 40 sec », « 30-45 s ».
  const timeAt = s => {
    let m = s.match(re.min);
    if (m) return Number(m[2] || m[1]) * 60 + Number(m[3] || 0);
    if ((m = s.match(re.quote))) return Number(m[1]) * 60 + Number(m[2] || 0);
    if ((m = s.match(re.sec))) return Number(m[2] || m[1]);
    return null;
  };
  const repsOf = m => ({reps: Number(m[2] || m[1]), repsMin: m[2] ? Number(m[1]) : null});
  // What a dose starts with: sets × reps or sets × time, rounds, a time, reps (named, or followed by a side).
  const coreOf = s => {
    let m = s.match(re.times);
    if (m) { const t = timeAt(m[2]); return t !== null ? {sets: Number(m[1]), seconds: t} : {sets: Number(m[1]), ...repsOf(m[2].match(re.range))}; }
    if ((m = s.match(re.rounds))) return {sets: Number(m[1])};
    const t = timeAt(s);
    if (t !== null) return {seconds: t};
    m = s.match(re.reps) || s.match(re.side);
    return m ? repsOf(m) : null;
  };

  // A free-text dose read as numbers: {sets, reps, repsMin, seconds, perSide, raw}, each null when the text does not
  // say it; raw = the trimmed text. The dose is cut at « · » and « ; » and the first part that starts with a dose
  // counts (« finition · 30 s par côté », « 3 × 8 · 4 s ↓ »: the tempo is not read); « suggestion : » is skipped.
  // Two set schemes in one dose (« 3 × 5 pompes, puis 3 × 20 s au mur ») are ambiguous: all null.
  const parseDose = text => {
    const raw = typeof text === 'string' ? text.trim() : '';
    const out = {sets: null, reps: null, repsMin: null, seconds: null, perSide: null, raw};
    try {
      const t = norm(raw);
      if (re.twoSchemes.test(t)) return out;
      for (const part of t.split(/[·;]/)) {
        const seg = part.trim().replace(/^suggestion\s*:?\s*/, ''), c = coreOf(seg);
        if (!c) continue;
        Object.assign(out, c);
        if (SIDE.test(seg)) out.perSide = true;
        break;
      }
    } catch { /* a dose the parser cannot read stays text */ }
    return out;
  };

  // The rest between sets or rounds stated in a session format, in seconds (upper bound of a range), else null:
  // « 60 à 90 s de repos » → 90, « repos 1 min » → 60, « 20 s rest » → 20, « no rest » / « sans repos » → 0.
  // No lookbehind (iOS < 16.4 would not even load this file): a non-capturing « start or other character » instead.
  const DUR = `${RANGE}\\s*(${MIN}|${SEC})${END}(?:\\s*(\\d{1,2})(?:\\s*${SEC})?${END})?`;
  const restRe = [
    new RegExp(`(?:^|\\D)${DUR}\\s*(?:de |of )?(?:repos|rest|récup(?:ération)?|recovery)${END}`),
    new RegExp(`(?:^|[^a-zà-ÿ])(?:repos|rest)\\s*:?\\s*(?:suggestion\\s*:?\\s*)?${DUR}`)
  ];
  const parseRest = text => {
    try {
      const t = norm(typeof text === 'string' ? text : '');
      for (const r of restRe) {
        const m = t.match(r);
        if (m) return /^m/.test(m[3]) ? Number(m[2] || m[1]) * 60 + Number(m[4] || 0) : Number(m[2] || m[1]);
      }
      return /\b(?:no|without) rest\b|sans repos/.test(t) ? 0 : null;
    } catch { return null; }
  };

  // L8, « To try »: the sheets added more than `minDays` calendar days before `today` (local YYYY-MM-DD; added_at is
  // read as a local date too) and never practised (`practised`: anything with .has(slug), e.g. the practice Map),
  // minus the `dismissed` slugs; at most `n`, ranked by a hash of today and the slug (not the catalogue's order).
  // `last` ({day, slugs}: the shelf last shown on this device) keeps the choice for the day: the same day, its sheets
  // stay, in their order, and only a sheet that left (dismissed, practised) is replaced by the next in rank; another
  // day, they go to the back, so the shelf never shows the same sheets twice running when more than `n` qualify.
  const DAY_MS = 86400000;
  const isoDay = s => { const [y, m, d] = String(s || '').split('-').map(Number); return y && m && d ? Date.UTC(y, m - 1, d) : NaN; };
  const localDay = v => { const d = new Date(v || ''); return isNaN(d) ? NaN : Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  const seedHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
  const toTry = (sheets, {today, practised = new Set(), dismissed = [], last = null, n = 3, minDays = 3} = {}) => {
    const t = isoDay(today);
    if (isNaN(t)) return [];
    const gone = new Set(dismissed);
    const ranked = (sheets || []).filter(s => s && s.slug && !practised.has(s.slug) && !gone.has(s.slug) && (t - localDay(s.added_at)) / DAY_MS > minDays)
      .map(s => ({s, h: seedHash(today + '|' + s.slug)}))
      .sort((a, b) => a.h - b.h || (a.s.slug < b.s.slug ? -1 : a.s.slug > b.s.slug ? 1 : 0)).map(x => x.s);
    const before = last && Array.isArray(last.slugs) ? last.slugs : [], was = new Set(before);
    const fresh = ranked.filter(s => !was.has(s.slug));
    if (last && last.day === today) {
      const bySlug = new Map(ranked.map(s => [s.slug, s]));
      return [...before.map(slug => bySlug.get(slug)).filter(Boolean), ...fresh].slice(0, n);
    }
    return [...fresh, ...ranked.filter(s => was.has(s.slug))].slice(0, n);
  };

  // ---------- session player (L10) ----------
  // #session/<slug>/play (exercise 1, or the resume prompt), #session/<slug>/play/<n>, #<sheet slug>/play (one
  // exercise). {session, n} (n null: no number given) or {sheet}; null for any other token.
  const PLAY = 'play';
  const playHref = (slug, n) => '#' + ROUTE + slug + '/' + PLAY + (n ? '/' + n : '');
  const sheetPlayHref = slug => '#' + slug + '/' + PLAY;
  const playRoute = tok => {
    if (typeof tok !== 'string') return null;
    const parts = tok.split('/');
    if (tok.startsWith(ROUTE)) {
      parts.shift();
      if (!parts[0] || parts[1] !== PLAY || parts.length > 3) return null;
      if (parts.length === 2) return {session: parts[0], n: null};
      return /^[1-9][0-9]*$/.test(parts[2]) ? {session: parts[0], n: Number(parts[2])} : null;
    }
    return parts.length === 2 && parts[0] && parts[1] === PLAY ? {sheet: parts[0]} : null;
  };
  // The dose of a resolved item as the player shows it, big: from its numbers (« 3 × 10 », « 3 × 40 s »,
  // « 10 / side », « 1 min », « 2:30 »), '' when it has none (the player then shows the free text). A range read
  // from the text keeps its lower bound (« 3 × 8-12 »).
  const secondsLabel = s => s >= 60 && !(s % 60) ? s / 60 + ' min' : s <= 90 ? s + ' s' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const doseLabel = it => {
    if (!it) return '';
    const min = 'reps' in (it.given || {}) ? null : parseDose(it.dose).repsMin;
    const count = it.reps ? (min ? min + '-' : '') + it.reps : it.seconds ? secondsLabel(it.seconds) : '';
    if (!count) return '';
    return (it.sets ? it.sets + ' × ' : '') + count + (it.per_side ? ' / side' : '');
  };

  const api = {ROUTE, sessionHref, sessionItemHref, sessionSlugOf, sessionItemOf, missingTable, splitV1, resolveItems, sessionsBySheet,
    MAX, clip, keepOrClip, noteKey, uniqueSlug, toggle, addItem, moveItem, removeItem, cleanItems, toTry, parseDose, parseRest,
    playHref, sheetPlayHref, playRoute, doseLabel};
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RBSessions = api;
})(typeof window !== 'undefined' ? window : globalThis);
