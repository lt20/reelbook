// Reelbook story card (P8 R7, P8 R19): a 1080 × 1920 typographic image for a phone's story, drawn on a canvas. P8
// R19 makes it a « proud » card, offered when the person has just done something: « Share my progress » on Session
// done (a repetition session: « Neck routine — done ✓ / 3rd session this week / 11 sessions in November · 4 weeks in a
// row ») and on New move (a technique sheet: « New move: Jab-cross / 5 of 9 / learned in Fight techniques »). The
// flattering number is the big line. Text and the notebook's flat colour only: never a photo or a frame of a video
// (P8 decision 4, « Socle commun » item 25), never a note. Loaded lazily by the app (window.RBCard); the pure parts
// (progress, lines, layout) are used by tests/p8-r19.test.cjs.
//
// Every text is measured and wrapped, never clipped: each block steps down in size until it holds in its lines (then,
// at the smallest size, the title is shortened with « … », its « — done ✓ » kept), a word wider than the card breaks
// between letters. A card whose layout does not fit is never exported (Codex #116).
(function (root) {
  'use strict';
  const W = 1080, H = 1920, PAD = 96, INNER = W - 2 * PAD;
  // The light values of the app's notebook colours (--p0 … --p7 in index.html): a shared image does not follow the
  // sender's theme, it reads the same on a light or a dark story viewer.
  const PALETTE = ['#5f7d1a', '#3f8f5f', '#b4432f', '#1d7a8c', '#c2651d', '#b23a6e', '#8a6a12', '#6b4fa3'];
  const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
  const TEXT = '"Source Sans 3", "Source Sans Pro", system-ui, sans-serif';
  const BRAND = '"Helvetica Neue", Arial, sans-serif';
  // Printed small under the wordmark (P8 R19). The link the app copies when the card is shared carries ?r=story (R13).
  const URL_LINE = 'lt20.github.io/reelbook';
  // Only flattering numbers (P8 R19): a line shows only when its number is at least its threshold here, so « 1 session
  // this month » or « 1 week in a row » never shows. week: the rank of this session in its ISO week; month: the
  // sessions of the calendar month; weeks: the ISO weeks in a row (this one included) with at least one session;
  // learned: the moves learned (« Got it ») in the notebook. Below every threshold the card keeps its title and
  // « done ✓ » (« New move: <title> »).
  const MIN = Object.freeze({week: 2, month: 2, weeks: 2, learned: 2});
  // The mark of app/icons/reelbook-mark.svg (viewBox 256), drawn in the ink colour (its second part at 70 %).
  const MARK_A = 'M16 8h143c51 0 81 29 81 71 0 37-22 67-63 70l76 87c6 7 4 12-5 12h-81c-10 0-19-4-29-15l-69-76v87c0 3-1 4-4 4H20c-3 0-4-1-4-4Zm53 81v51h94c26 0 38-10 38-25 0-17-12-26-29-26Z';
  const MARK_B = 'M59 99c6-7 10-5 10 9v87l-39-33c-15-12-15-17-2-31Z';
  const NB = ' '; // keeps « — done ✓ » and « : » on the line of the word before
  // The card's own words follow the content's language (the session's, or the sheet's), as R7's did.
  const MONTHS = {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
  };
  const ordEn = n => { const t = n % 100, u = n % 10; return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'); };
  const WORDS = {
    en: {done: `${NB}—${NB}done${NB}✓`, week: n => `${ordEn(n)} session this week`, month: (n, m) => `${n} sessions in ${MONTHS.en[m]}`,
      weeks: n => `${n} weeks in a row`, newMove: 'New move:', of: (k, n) => `${k} of ${n}`, learned: nb => nb ? `learned in ${nb}` : 'learned'},
    fr: {done: `${NB}—${NB}fait${NB}✓`, week: n => `${n}${n === 1 ? 'ʳᵉ' : 'ᵉ'} séance cette semaine`, month: (n, m) => `${n} séances en ${MONTHS.fr[m]}`,
      weeks: n => `${n} semaines d’affilée`, newMove: `Nouveau mouvement${NB}:`, of: (k, n) => `${k} sur ${n}`, learned: nb => nb ? `appris en ${nb}` : 'appris'}
  };
  const words = lang => lang === 'fr' ? WORDS.fr : WORDS.en;
  // spaces collapsed, the non-breaking ones kept
  const oneLine = v => String(v == null ? '' : v).replace(/[^\S ]+/g, ' ').trim();

  // ---------- the numbers (repetition) ----------
  // Days are local calendar days, YYYY-MM-DD, counted as UTC dates (no daylight saving step).
  const DAY_MS = 86400000;
  const isoDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? Date.parse(d + 'T00:00:00Z') : NaN;
  const mondayOf = t => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS;
  // From the days of the account's sessions (practice_log rows session/<slug>, their done_on; this session included
  // once, today): {week (this session's rank in the ISO week of today), month (the sessions of today's calendar
  // month), monthIndex (0-11), weeks (ISO weeks in a row up to this one with a session)}. Days after today are out.
  const progress = (days, today) => {
    const now = isoDay(today), out = {week: 0, month: 0, monthIndex: -1, weeks: 0};
    if (isNaN(now)) return out;
    const d = new Date(now), mon = mondayOf(now), weeksOn = new Set();
    out.monthIndex = d.getUTCMonth();
    for (const day of Array.isArray(days) ? days : []) {
      const t = isoDay(day); if (isNaN(t) || t > now) continue;
      const x = new Date(t);
      if (t >= mon) out.week++;
      if (x.getUTCFullYear() === d.getUTCFullYear() && x.getUTCMonth() === d.getUTCMonth()) out.month++;
      weeksOn.add(mondayOf(t));
    }
    for (let w = mon; weeksOn.has(w); w -= 7 * DAY_MS) out.weeks++;
    return out;
  };

  // ---------- the lines ----------
  // card: {kind: 'repetition', title, lang, colour, stats (progress)} or {kind: 'technique', title, lang, colour,
  // notebook (its name), learned, total}. The lines, top to bottom: {kicker, head (+ suffix), hero, line (its parts:
  // the numbers it joins)}; '' for a line not shown. head always holds the title (« Reelbook » when it has none).
  const lines = card => {
    const c = card || {}, Wd = words(c.lang), title = oneLine(c.title) || 'Reelbook';
    if (c.kind === 'technique') {
      const k = c.learned | 0, n = c.total | 0, ok = k >= MIN.learned && n >= k;
      const line = ok ? Wd.learned(oneLine(c.notebook)) : '';
      return {kicker: Wd.newMove, head: title, suffix: '', hero: ok ? Wd.of(k, n) : '', line, parts: line ? [line] : []};
    }
    const s = c.stats || {};
    const small = [(s.month | 0) >= MIN.month && s.monthIndex >= 0 && s.monthIndex < 12 ? Wd.month(s.month | 0, s.monthIndex) : '',
      (s.weeks | 0) >= MIN.weeks ? Wd.weeks(s.weeks | 0) : ''].filter(Boolean);
    return {kicker: '', head: title, suffix: Wd.done, hero: (s.week | 0) >= MIN.week ? Wd.week(s.week | 0) : '', line: small.join(' · '), parts: small};
  };
  // The accessible name of the card where the app shows it, and the texts it holds.
  const label = card => {
    const L = lines(card), said = [L.kicker, L.head + L.suffix, L.hero, L.line].filter(Boolean).map(s => s.replace(/ /g, ' ')).join(' ');
    return `Story card: ${said}. Text and colour only, no photo.`;
  };

  // ---------- colour ----------
  const rgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const INKS = ['#ffffff', '#0b0c0e'];
  // A notebook colour (its palette index, or a #rrggbb), and the ink that reads best on it.
  const colours = c => {
    const bg = typeof c === 'number' && PALETTE[((c % 8) + 8) % 8] || (rgb(c) ? String(c) : PALETTE[3]);
    const ink = INKS.reduce((best, k) => contrast(rgb(k), rgb(bg)) > contrast(rgb(best), rgb(bg)) ? k : best, INKS[0]);
    return {bg, ink};
  };

  // ---------- text ----------
  const font = (weight, size, family) => `${weight} ${size}px ${family}`;
  // Lines of `text` no wider than `max` (measure(font, text) -> px), broken at plain spaces (never at a non-breaking
  // one). A word wider than `max` breaks between letters.
  const wrap = (measure, f, text, max) => {
    const out = []; let line = '';
    const fits = s => measure(f, s) <= max;
    for (const word of oneLine(text).split(' ').filter(Boolean)) {
      const tryLine = line ? line + ' ' + word : word;
      if (fits(tryLine)) { line = tryLine; continue; }
      if (line) out.push(line);
      line = '';
      let w = word;
      while (w.length > 1 && !fits(w)) {
        let k = w.length - 1;
        while (k > 1 && !fits(w.slice(0, k))) k--;
        out.push(w.slice(0, k)); w = w.slice(k);
      }
      line = w;
    }
    if (line) out.push(line);
    return out;
  };
  // At most `max` of `lines`; when some are left out, the last kept one ends with « … » (shortened until it fits).
  const ELL = '…';
  const clamp = (measure, f, lines, max, width) => {
    if (lines.length <= max) return lines;
    let last = lines[max - 1];
    while (last && measure(f, last + ELL) > width) last = last.slice(0, -1);
    return [...lines.slice(0, max - 1), last.replace(/\s+$/, '') + ELL];
  };
  // The title and its suffix (« — done ✓ ») in `max` lines: the suffix ends the title's last line when it fits there,
  // else it takes a line of its own (never one word of the title left with it); a title too long is shortened with
  // « … », the suffix kept: {lines, cut (shortened)}. null when even that does not hold.
  const headLines = (measure, f, title, suffix, max) => {
    const tl = wrap(measure, f, title, INNER);
    if (!suffix) return {lines: clamp(measure, f, tl, max, INNER), cut: tl.length > max};
    const join = ls => {
      const last = ls[ls.length - 1], tail = last + suffix;
      return measure(f, tail) <= INNER ? [...ls.slice(0, -1), tail] : [...ls, suffix.trim()];
    };
    for (const keep of [tl.length, max, max - 1]) {
      if (keep < 1) break;
      const out = join(clamp(measure, f, tl, keep, INNER));
      if (out.length <= max) return {lines: out, cut: keep < tl.length};
    }
    return null;
  };

  // ---------- layout ----------
  // The sizes, largest first: the first tier where every block holds (and the whole fits above the wordmark) wins.
  const TIERS = [
    {head: 120, hero: 200, line: 56},
    {head: 104, hero: 176, line: 52},
    {head: 92, hero: 152, line: 48},
    {head: 80, hero: 128, line: 46},
    {head: 68, hero: 112, line: 44},
    {head: 56, hero: 96, line: 40}
  ];
  const MAX_HEAD = 4, MAX_HERO = 3, MAX_LINE = 3, GAP = 56;
  // The drawing as a list of operations, measured with `measure` (a canvas's measureText, or a test's): {w, h, bg, ink,
  // ops: [{t: 'text', font, size, text, x, y, alpha, role} | {t: 'mark', x, y, size} | {t: 'rule', x, y, w}], lines,
  // fit, tier}. y is a text's alphabetic baseline. fit: every text inside the card's margins, the block above the
  // wordmark. The block is centred a little above the middle of the room above the wordmark.
  const layout = (card, measure) => {
    let first = null;
    for (let i = 0; i < TIERS.length; i++) {
      const L = build(card || {}, measure, TIERS[i], i);
      if (!first) first = L;
      if (L.fit) return L;
    }
    return first; // fit: false, never exported (render rejects it)
  };
  const build = (c, measure, tier, tierIndex) => {
    const {bg, ink} = colours(c.colour), T = lines(c), ops = [], blocks = [];
    // the blocks, measured: [{role, font, size, lh, lines, alpha, gapBefore}]
    const add = (role, f, size, lh, ls, alpha = 1, gapBefore = GAP) => { if (ls && ls.length) blocks.push({role, f, size, lh, lines: ls, alpha, gapBefore}); };
    let ok = true;
    if (T.kicker) { const f = font(600, 56, TEXT); add('kicker', f, 56, 66, clamp(measure, f, wrap(measure, f, T.kicker, INNER), 2, INNER), 0.92, 0); }
    // a title shortened at this size first tries the smaller ones (Codex #127): « … » only at the smallest
    const hf = font(700, tier.head, DISPLAY), head = headLines(measure, hf, T.head, T.suffix, MAX_HEAD);
    if (!head || (head.cut && tierIndex < TIERS.length - 1)) ok = false;
    if (head) add('head', hf, tier.head, Math.round(tier.head * 0.98), head.lines, 1, T.kicker ? 20 : 0);
    if (T.hero) {
      const f = font(700, tier.hero, DISPLAY), ls = wrap(measure, f, T.hero, INNER);
      if (ls.length > MAX_HERO) ok = false;
      add('hero', f, tier.hero, Math.round(tier.hero * 0.92), ls, 1, GAP + 40); // the rule sits in this gap
    }
    if (T.line) {
      // one line « 11 sessions in November · 4 weeks in a row », else one line per number (never broken at a number)
      const f = font(600, tier.line, TEXT), one = wrap(measure, f, T.line, INNER), ls = one.length === 1 ? one : T.parts.flatMap(p => wrap(measure, f, p, INNER));
      if (ls.length > MAX_LINE) ok = false;
      add('line', f, tier.line, Math.round(tier.line * 1.25), ls, 0.94, T.hero ? 36 : GAP + 40);
    }
    // the wordmark and the address, at the bottom
    const urlY = H - PAD, markS = 80, brandY = urlY - 40 - 44; // the wordmark's baseline
    const room = brandY - markS - 80; // the block ends above this
    // heights: a block's first baseline is its cap height (≈ 0.72 em) under its top; its last line's descenders
    // (≈ 0.25 em) close it
    const hOf = b => Math.round(b.size * 0.72) + (b.lines.length - 1) * b.lh + Math.round(b.size * 0.25);
    const total = blocks.reduce((s, b) => s + b.gapBefore + hOf(b), 0);
    let y = Math.max(PAD, Math.round(PAD + (room - PAD - total) * 0.42));
    for (const b of blocks) {
      if (b.role === 'hero' || (b.role === 'line' && !T.hero)) ops.push({t: 'rule', x: PAD, y: y + Math.round(b.gapBefore / 2) - 5, w: 120});
      y += b.gapBefore + Math.round(b.size * 0.72);
      b.lines.forEach((l, i) => ops.push({t: 'text', font: b.f, size: b.size, text: l, x: PAD, y: y + i * b.lh, alpha: b.alpha, role: b.role}));
      y += (b.lines.length - 1) * b.lh + Math.round(b.size * 0.25);
    }
    const blockEnd = y;
    ops.push({t: 'mark', x: PAD, y: brandY - 62, size: markS});
    ops.push({t: 'text', font: font(800, 60, BRAND), size: 60, text: 'reelbook', x: PAD + markS + 20, y: brandY, alpha: 1, role: 'brand'});
    ops.push({t: 'text', font: font(600, 38, TEXT), size: 38, text: URL_LINE, x: PAD, y: urlY, alpha: 0.88, role: 'url'});
    const texts = ops.filter(o => o.t === 'text');
    const fit = ok && texts.every(o => o.x >= PAD - 0.5 && o.x + measure(o.font, o.text) <= W - PAD + 0.5 && o.y - o.size >= 0 && o.y <= H - PAD + 0.5)
      && blockEnd <= room + 0.5;
    return {w: W, h: H, bg, ink, ops, lines: T, fit, tier: tierIndex};
  };

  // ---------- drawing ----------
  // The two families of the card, loaded (document.fonts.load) before drawing; a font that never comes (offline
  // first visit) gives way after `ms`, and the card is drawn in the fallback family.
  const fontsReady = (doc, ms = 3000) => {
    const fonts = doc && doc.fonts;
    if (!fonts || typeof fonts.load !== 'function') return Promise.resolve(false);
    const all = Promise.all([font(700, 64, DISPLAY), font(600, 44, TEXT)].map(f => fonts.load(f, 'Reelbook 0123'))).then(() => true, () => false);
    return Promise.race([all, new Promise(ok => setTimeout(() => ok(false), ms))]);
  };
  const paint = (canvas, card) => {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const measure = (f, s) => { ctx.font = f; return ctx.measureText(s).width; };
    const L = layout(card, measure);
    ctx.fillStyle = L.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = L.ink; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    for (const o of L.ops) {
      if (o.t === 'text') { ctx.globalAlpha = o.alpha; ctx.font = o.font; ctx.fillText(o.text, o.x, o.y); }
      else if (o.t === 'rule') { ctx.globalAlpha = 0.5; ctx.fillRect(o.x, o.y, o.w, 10); }
      else if (o.t === 'mark' && typeof Path2D === 'function') {
        ctx.save(); ctx.translate(o.x, o.y); ctx.scale(o.size / 256, o.size / 256);
        ctx.globalAlpha = 1; ctx.fill(new Path2D(MARK_A), 'evenodd'); ctx.globalAlpha = 0.7; ctx.fill(new Path2D(MARK_B));
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    return L;
  };
  // {canvas, blob (image/png), layout} once the fonts are there; rejects when the canvas cannot make an image.
  const render = async (card, doc) => {
    await fontsReady(doc);
    const canvas = doc.createElement('canvas'), L = paint(canvas, card);
    if (!L.fit) throw new Error('card does not fit'); // never an image with texts on top of each other
    const blob = await new Promise((ok, ko) => {
      if (typeof canvas.toBlob !== 'function') return ko(new Error('no toBlob'));
      canvas.toBlob(b => b ? ok(b) : ko(new Error('no image')), 'image/png');
    });
    return {canvas, blob, layout: L};
  };

  const api = {W, H, PALETTE, URL_LINE, MIN, colours, contrast: (a, b) => contrast(rgb(a), rgb(b)), wrap, clamp, progress, lines, label, layout, fontsReady, paint, render};
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RBCard = api;
})(typeof self !== 'undefined' ? self : this);
