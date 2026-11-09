// Reelbook story card (P8 R7): a 1080 × 1920 typographic image of a session or a sheet, drawn on a canvas, for a
// phone's story. Text and the notebook's flat colour only: never a photo or a frame of a video (P8 decision 4,
// « Socle commun » item 25), never a note or the practice log. Loaded lazily by the app (window.RBCard); the pure
// layout is used by tests/p8-r7.test.cjs.
//
// Every text is measured and wrapped, never clipped: the title steps down in size until it holds in 3 lines (then,
// at the smallest size, its third line ends with « … »), a word wider than the card breaks between letters, and the
// list keeps the exercises that fit (8 at most, each name and dose 3 lines at most), then « + n more ». The credits
// keep the names that fit in 3 lines, then « and n more ». A card whose layout does not fit is never exported
// (Codex #116: a 1 000-character title ran into the credits).
(function (root) {
  'use strict';
  const W = 1080, H = 1920, PAD = 96, INNER = W - 2 * PAD;
  // The light values of the app's notebook colours (--p0 … --p7 in index.html): a shared image does not follow the
  // sender's dark theme.
  const PALETTE = ['#5f7d1a', '#3f8f5f', '#b4432f', '#1d7a8c', '#c2651d', '#b23a6e', '#8a6a12', '#6b4fa3'];
  const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
  const TEXT = '"Source Sans 3", "Source Sans Pro", system-ui, sans-serif';
  const BRAND = '"Helvetica Neue", Arial, sans-serif';
  const URL_LINE = 'lt20.github.io/reelbook/?r=story'; // P8 R13: the origin of a sign-up typed from the card
  const MAX_ITEMS = 8, MAX_TITLE_LINES = 3, MAX_CREDIT_LINES = 3, MAX_OVER_LINES = 2, MAX_ITEM_LINES = 3;
  const TITLE_SIZES = [168, 148, 128, 112, 96, 84, 72, 64, 56];
  // The mark of app/icons/reelbook-mark.svg (viewBox 256), drawn in the ink colour (its second part at 70 %).
  const MARK_A = 'M16 8h143c51 0 81 29 81 71 0 37-22 67-63 70l76 87c6 7 4 12-5 12h-81c-10 0-19-4-29-15l-69-76v87c0 3-1 4-4 4H20c-3 0-4-1-4-4Zm53 81v51h94c26 0 38-10 38-25 0-17-12-26-29-26Z';
  const MARK_B = 'M59 99c6-7 10-5 10 9v87l-39-33c-15-12-15-17-2-31Z';
  // The card's own words follow the content's language, as R6's text share does (the app's interface stays English).
  const WORDS = {
    en: {set: n => n === 1 ? '1 set' : `${n} sets`, exercise: n => n === 1 ? '1 exercise' : `${n} exercises`, today: 'today',
      video: 'Video:', videos: 'Videos:', more: n => `+ ${n} more`, others: n => `and ${n} more`},
    fr: {set: n => n === 1 ? '1 série' : `${n} séries`, exercise: n => n === 1 ? '1 exercice' : `${n} exercices`, today: 'aujourd’hui',
      video: 'Vidéo :', videos: 'Vidéos :', more: n => `+ ${n} de plus`, others: n => `et ${n} de plus`}
  };
  const words = lang => lang === 'fr' ? WORDS.fr : WORDS.en;
  const oneLine = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  // A credit as R6 writes it: « @ » added to a one-word handle that lacks it (« Coach Démo » stays as is); distinct.
  const handle = a => { const s = oneLine(a); return !s || s.startsWith('@') || /\s/.test(s) ? s : '@' + s; };
  const credits = authors => [...new Set((authors || []).map(handle).filter(Boolean))];

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
  // Lines of `text` no wider than `max` (measure(font, text) -> px). A word wider than `max` breaks between letters.
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
  const ELL = '\u2026';
  const clamp = (measure, f, lines, max, width) => {
    if (lines.length <= max) return lines;
    let last = lines[max - 1];
    while (last && measure(f, last + ELL) > width) last = last.slice(0, -1);
    return [...lines.slice(0, max - 1), last.replace(/\s+$/, '') + ELL];
  };
  // A dose as the card's language writes it: the app's « 3 × 10 / side » reads « / côté » on a French card.
  const doseIn = (dose, lang) => { const d = oneLine(dose); return lang === 'fr' ? d.replace(/\/\s*sides?\b/gi, '/ côté') : d; };

  // The card's content, from what the app knows. card: {title, over (the notebook's name), items [{title, dose}],
  // sets (a play: the sets checked), today (a play), exercises (no play: the session's count), authors, colour, lang}.
  const metaOf = card => {
    const Wd = words(card.lang), parts = [];
    if (card.today) { parts.push(Wd.set(Math.max(0, card.sets | 0)), Wd.today); }
    else if (card.exercises != null) parts.push(Wd.exercise(card.exercises | 0));
    return parts.join(' · ');
  };
  // The accessible name of the card where the app shows it.
  const label = card => `Story card: ${oneLine(card.title)}${metaOf(card) ? ', ' + metaOf(card) : ''}. Text and colour only, no photo.`;

  // The list's sizes, largest first, and the title's largest size with each: the first pair that shows every exercise
  // (8 at most) wins; the last one shows what fits, then « + n more ».
  const TIERS = [
    {cap: 168, name: 64, nameLH: 68, dose: 44, doseLH: 54, gap: 32},
    {cap: 148, name: 56, nameLH: 60, dose: 40, doseLH: 48, gap: 22},
    {cap: 128, name: 50, nameLH: 54, dose: 38, doseLH: 44, gap: 14},
    {cap: 112, name: 46, nameLH: 50, dose: 36, doseLH: 42, gap: 10}
  ];
  const MORE_H = 62;
  // The drawing as a list of operations, measured with `measure` (a canvas's measureText, or a test's): {w, h, bg, ink,
  // ops: [{t: 'text', font, size, text, x, y, alpha} | {t: 'mark', x, y, size} | {t: 'rule', x, y, w}], title {size,
  // lines}, shown, more, fit}. y is a text's alphabetic baseline. fit: every text inside the card's margins and the list above the credits.
  // The first tier that shows every exercise and fits wins, else the first that fits; with 3 title lines, then 2, then 1.
  const layout = (card, measure) => {
    let first = null;
    for (const titleMax of [MAX_TITLE_LINES, 2, 1]) {
      let fits = null;
      for (const tier of TIERS) {
        const L = build(card || {}, measure, tier, titleMax);
        if (!first) first = L;
        if (L.fit && L.shown === L.wanted) return L;
        if (L.fit && !fits) fits = L;
      }
      if (fits) return fits;
    }
    return first; // fit: false, never exported (render rejects it)
  };
  const build = (c, measure, tier, titleMax = MAX_TITLE_LINES) => {
    const Wd = words(c.lang), {bg, ink} = colours(c.colour), ops = [];
    const text = (f, size, s, x, y, alpha = 1) => ops.push({t: 'text', font: f, size, text: s, x, y, alpha});
    // the wordmark, top left
    const markS = 72;
    ops.push({t: 'mark', x: PAD, y: PAD, size: markS});
    text(font(800, 56, BRAND), 56, 'reelbook', PAD + markS + 18, PAD + 56);
    let y = PAD + markS + 104;
    // the notebook's name, in capitals
    const over = oneLine(c.over).toUpperCase();
    if (over) {
      const f = font(600, 40, TEXT);
      for (const l of clamp(measure, f, wrap(measure, f, over, INNER), MAX_OVER_LINES, INNER)) { text(f, 40, l, PAD, y, 0.9); y += 50; }
      y += 22;
    }
    // the title: the largest size (up to the tier's) that holds in titleMax lines; at the smallest, ellipsised there
    const title = oneLine(c.title) || 'Reelbook';
    let size = 0, lines = [];
    for (const s of TITLE_SIZES.filter(s => s <= tier.cap)) { size = s; lines = wrap(measure, font(700, s, DISPLAY), title, INNER); if (lines.length <= titleMax) break; }
    const lh = Math.round(size * 0.94), tf = font(700, size, DISPLAY);
    lines = clamp(measure, tf, lines, titleMax, INNER);
    y += Math.round(size * 0.72); // the first line's baseline: its cap height under the line above
    lines.forEach((l, i) => text(tf, size, l, PAD, y + i * lh));
    y += (lines.length - 1) * lh + Math.round(size * 0.3) + 60; // clear of the descenders
    // « 12 sets · today »
    const meta = metaOf(c);
    if (meta) {
      const f = font(600, 48, TEXT);
      for (const l of wrap(measure, f, meta, INNER)) { text(f, 48, l, PAD, y); y += 60; }
    }
    const listTop = y + 20;
    // from the bottom up: the address, the rule, the credits
    const urlY = H - PAD;
    text(font(600, 40, TEXT), 40, URL_LINE, PAD, urlY, 0.9);
    const ruleY = urlY - 40 - 34;
    ops.push({t: 'rule', x: PAD, y: ruleY, w: INNER});
    const by = credits(c.authors), credF = font(400, 40, TEXT), credLH = 52;
    let credLines = [];
    for (let k = by.length; k > 0; k--) {
      const head = (by.length === 1 ? Wd.video : Wd.videos) + ' ' + by.slice(0, k).join(', ') + (k < by.length ? ' ' + Wd.others(by.length - k) : '');
      credLines = wrap(measure, credF, head, INNER);
      if (credLines.length <= MAX_CREDIT_LINES) break;
    }
    credLines = clamp(measure, credF, credLines, MAX_CREDIT_LINES, INNER); // one handle longer than 3 lines
    const credTop = ruleY - 34 - credLines.length * credLH;
    credLines.forEach((l, i) => text(credF, 40, l, PAD, credTop + (i + 1) * credLH - 12));
    const listBottom = (credLines.length ? credTop : ruleY) - 30;
    // the exercises that fit (8 at most), then « + n more »
    const items = (Array.isArray(c.items) ? c.items : []).filter(it => it && oneLine(it.title));
    const nameF = font(700, tier.name, DISPLAY), doseF = font(400, tier.dose, TEXT);
    const cut = (f, s) => clamp(measure, f, wrap(measure, f, s, INNER), MAX_ITEM_LINES, INNER);
    const blocks = items.slice(0, MAX_ITEMS).map(it => ({name: cut(nameF, it.title), dose: doseIn(it.dose, c.lang) ? cut(doseF, doseIn(it.dose, c.lang)) : []}))
      .map(b => ({...b, h: b.name.length * tier.nameLH + b.dose.length * tier.doseLH}));
    let shown = 0, used = 0;
    const room = listBottom - listTop;
    for (let i = 0; i < blocks.length; i++) {
      const left = items.length - (i + 1), next = used + (shown ? tier.gap : 0) + blocks[i].h;
      if (next + (left ? MORE_H : 0) > room) break;
      used = next; shown++;
    }
    let ly = listTop;
    for (let i = 0; i < shown; i++) {
      if (i) ly += tier.gap;
      for (const l of blocks[i].name) { ly += tier.nameLH; text(nameF, tier.name, l, PAD, ly - Math.round(tier.nameLH * 0.2)); }
      for (const l of blocks[i].dose) { ly += tier.doseLH; text(doseF, tier.dose, l, PAD, ly - Math.round(tier.doseLH * 0.25), 0.92); }
    }
    const more = items.length - shown;
    if (more) { ly += MORE_H; text(font(600, 44, TEXT), 44, Wd.more(more), PAD, ly - 16); }
    const texts = ops.filter(o => o.t === 'text');
    // and the vertical budget: the head (title, meta) above the list's top, the list above the credits
    const fit = texts.every(o => o.x >= PAD - 0.5 && o.x + measure(o.font, o.text) <= W - PAD + 0.5 && o.y - o.size >= 0 && o.y <= H - PAD + 0.5)
      && listTop <= listBottom + 0.5 && ly <= listBottom + 0.5;
    return {w: W, h: H, bg, ink, ops, title: {size, lines}, shown, more, wanted: Math.min(items.length, MAX_ITEMS), fit, tier: TIERS.indexOf(tier)};
  };

  // ---------- drawing ----------
  // The two families of the card, loaded (document.fonts.load) before drawing; a font that never comes (offline
  // first visit) gives way after `ms`, and the card is drawn in the fallback family.
  const fontsReady = (doc, ms = 3000) => {
    const fonts = doc && doc.fonts;
    if (!fonts || typeof fonts.load !== 'function') return Promise.resolve(false);
    const all = Promise.all([font(700, 64, DISPLAY), font(400, 44, TEXT), font(600, 44, TEXT)].map(f => fonts.load(f, 'Reelbook 0123'))).then(() => true, () => false);
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
      else if (o.t === 'rule') { ctx.globalAlpha = 0.45; ctx.fillRect(o.x, o.y, o.w, 3); }
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

  const api = {W, H, PALETTE, MAX_ITEMS, URL_LINE, colours, contrast: (a, b) => contrast(rgb(a), rgb(b)), wrap, clamp, doseIn, credits, metaOf, label, layout, fontsReady, paint, render};
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RBCard = api;
})(typeof self !== 'undefined' ? self : this);
