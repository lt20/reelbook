// Reelbook sheet page: DOM helpers run on a sheet's parsed html before it is shown, used by the app
// (window.RBSheet) and by tests/sheet.test.cjs. Sheets are never regenerated: the order is changed at display time.
(root => {
  'use strict';
  const isEl = n => !!n && n.nodeType === 1;
  const tag = n => isEl(n) ? n.tagName.toUpperCase() : '';
  const classes = n => isEl(n) ? (n.getAttribute('class') || '').split(/\s+/).filter(Boolean) : [];
  const has = (n, sel) => isEl(n) && (n.matches(sel) || !!n.querySelector(sel));
  const blank = n => n.nodeType === 3 && !n.textContent.trim();
  const text = n => (n && n.textContent || '').replace(/\s+/g, ' ').trim();
  const MORE = 3; // key points shown before « +N more »
  // The why block is told by its heading, in the languages sheets are written in (« Why », « Pourquoi »…): another
  // section placed there (« Safety ») must stay open where it is.
  const WHY = new Set(['why', 'pourquoi', 'por que', 'porque', 'porquê', 'por qué', 'warum', 'perché', 'perche', 'waarom', 'dlaczego', 'varför', 'hvorfor', 'miksi', 'neden', 'почему', 'なぜ', '为什么']);
  const isWhy = h2 => {
    const own = [...h2.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');
    return WHY.has(own.toLowerCase().replace(/[?¿:!.]/g, ' ').replace(/\s+/g, ' ').trim());
  };

  // A unit is a run of sibling nodes that moves as one: the nodes of a container before its first <h2>
  // (pre), or an <h2> and what follows it up to the next <h2>. A top-level element that is not a
  // .wrap / .wide container is a unit on its own (box null).
  const unitsOf = body => {
    const units = [];
    for (const top of [...body.childNodes]) {
      if (top.nodeType === 8) continue; // a comment (the templates' header) is not content
      if (!isEl(top)) { if (!blank(top)) units.push({box: null, nodes: [top]}); continue; }
      const cls = classes(top);
      if (tag(top) !== 'DIV' || !(cls.includes('wrap') || cls.includes('wide'))) { units.push({box: null, nodes: [top]}); continue; }
      let cur = {box: top, nodes: [], pre: true};
      units.push(cur);
      for (const n of [...top.childNodes]) {
        if (tag(n) === 'H2') { cur = {box: top, nodes: [], h2: n}; units.push(cur); }
        cur.nodes.push(n);
      }
    }
    return units;
  };
  const holds = (u, sel) => u.nodes.some(n => has(n, sel));

  // Gesture first (templates/sheet.html and templates/exercise.html): header (title, lead, kit) → sequence →
  // dose → first 3 key points, the others in « +N more » → why, collapsed under its own heading → the rest in its
  // original order (variation, source, credits). A technique sheet (templates/technique.html, L16), told by its
  // .gonogo box: header → go / no-go → sequence → the rest in its original order (prerequisites, conditions,
  // mistakes, key points with « +N more », try plan, safety…). A part that is not found stays where it is;
  // nothing is dropped. Returns true when the sheet was rearranged.
  const arrange = doc => {
    const body = doc && doc.body;
    if (!body || !body.childNodes) return false;
    const units = unitsOf(body);
    const head = units.find(u => u.pre && u.box && u.nodes.some(n => tag(n) === 'HEADER'));
    if (!head) return false;
    const h2s = units.filter(u => u.h2);
    const seq = h2s.find(u => holds(u, '.steps') && holds(u, 'img'));
    const dose = h2s.find(u => u !== seq && holds(u, '.dose'));
    const keys = h2s.find(u => u !== seq && u !== dose && holds(u, 'ol.keys'));
    const gonogo = h2s.find(u => u !== seq && holds(u, '.gonogo'));
    const at = u => u ? units.indexOf(u) : Infinity;
    const why = !gonogo && h2s.find(u => u.box === head.box && ![seq, dose, keys].includes(u)
      && at(u) < Math.min(at(dose), at(keys), at(seq)) && isWhy(u.h2));
    if (!seq && !dose && !keys && !why && !gonogo) return false;

    if (keys) {
      const ol = keys.nodes.map(n => tag(n) === 'OL' && n.matches('ol.keys') ? n : isEl(n) && n.querySelector('ol.keys')).find(Boolean);
      const extra = [...ol.children].filter(li => tag(li) === 'LI').slice(MORE);
      if (extra.length) {
        const det = doc.createElement('details'), sum = doc.createElement('summary'), rest = doc.createElement('ol');
        det.setAttribute('class', 'rb-more'); det.setAttribute('data-rb', '');
        sum.setAttribute('data-rb', ''); sum.textContent = `+${extra.length} more`;
        rest.setAttribute('class', 'keys'); rest.setAttribute('data-rb', ''); rest.setAttribute('start', String(MORE + 1));
        rest.setAttribute('style', `counter-reset:k ${MORE}`);
        for (const li of extra) rest.appendChild(li);
        det.appendChild(sum); det.appendChild(rest);
        ol.parentNode.insertBefore(det, ol.nextSibling);
        // when the <ol> is the unit's node itself, the <details> joins the unit right after it
        const i = keys.nodes.indexOf(ol); if (i >= 0) keys.nodes.splice(i + 1, 0, det);
      }
    }
    if (why) {
      const det = doc.createElement('details'), sum = doc.createElement('summary');
      det.setAttribute('class', 'rb-why'); det.setAttribute('data-rb', ''); sum.setAttribute('data-rb', '');
      det.appendChild(sum);
      for (const n of why.nodes) (n === why.h2 ? sum : det).appendChild(n);
      why.nodes = [det];
    }

    const lead = (gonogo ? [head, gonogo, seq] : [head, seq, dose, keys, why]).filter(Boolean);
    const order = [...lead, ...units.filter(u => !lead.includes(u))];
    // Consecutive units of the same container share one box: the container itself the first time it is used,
    // a shallow copy (same classes, no id, no « fiche ») after that.
    const used = new Set(), out = [];
    let box = null, from = null;
    for (const u of order) {
      if (u.nodes.every(blank)) continue;
      if (!u.box) { out.push(...u.nodes); box = from = null; continue; }
      if (u.box !== from) {
        from = u.box;
        if (!used.has(u.box)) { used.add(u.box); box = u.box; while (box.firstChild) box.removeChild(box.firstChild); }
        else {
          box = u.box.cloneNode(false); box.removeAttribute('id'); box.setAttribute('data-rb', '');
          box.setAttribute('class', classes(u.box).filter(c => c !== 'fiche').join(' '));
        }
        out.push(box);
      }
      for (const n of u.nodes) box.appendChild(n);
    }
    while (body.firstChild) body.removeChild(body.firstChild);
    for (const n of out) body.appendChild(n);
    return true;
  };

  // Step photos open the full-screen viewer: focusable, announced as buttons.
  const markPhotos = doc => {
    const imgs = doc && doc.querySelectorAll ? [...doc.querySelectorAll('.step img')] : [];
    for (const img of imgs) {
      img.setAttribute('tabindex', '0'); img.setAttribute('role', 'button');
      img.setAttribute('data-ph', '');
    }
    return imgs.length;
  };
  // The photos of the viewer: every step photo of the page, in order, with the step's caption. A common mistake
  // (.step.bad, L15) is left out unless `mistakes` is true (the sheet page's viewer); kept, it is flagged `bad` and
  // its title starts with « ✕ ». The session player's carousel shows the movement only.
  const photosOf = (page, mistakes = false) => [...page.querySelectorAll('.step img')].map(img => {
    const step = img.closest('.step'), bad = !!(step && classes(step).includes('bad'));
    const h = step && step.querySelector('h3'), p = step && step.querySelector('p');
    return {img, src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '', title: (bad ? '✕ ' : '') + text(h), caption: text(p), bad};
  }).filter(ph => mistakes || !ph.bad);

  // The first key points of a page (L10, session player): the <li> of its ol.keys lists in order (after arrange,
  // the shown ones then those under « +N more »), each as {cue, text}: the bold lead (« <b>Cue.</b> rest ») and
  // the rest, plain text.
  const keyPoints = (page, n = MORE) => {
    const lis = page && page.querySelectorAll ? [...page.querySelectorAll('ol.keys')].flatMap(ol => [...ol.children].filter(li => tag(li) === 'LI')) : [];
    return lis.slice(0, n).map(li => {
      const first = [...li.childNodes].find(c => !blank(c) && c.nodeType !== 8);
      const lead = ['B', 'STRONG'].includes(tag(first)) ? text(first) : '';
      const all = text(li);
      return {cue: lead, text: lead && all.startsWith(lead) ? all.slice(lead.length).trim() : all};
    }).filter(k => k.cue || k.text);
  };

  // R11 (Codex #114): a sheet's html is shown inside the app's own page, and since R11 it can come from another account
  // (a shared session). clean keeps only what templates/ write, in place, before anything else reads the sheet — the
  // same lists as supabase/functions/share/clean.ts, which cleans a copy once more on the server:
  //   - the elements of DROP go with their content (scripts, styles, frames, objects, forms, base, meta, link, SVG…);
  //   - another element not in ALLOW is unwrapped (its content stays); comments go;
  //   - attributes: ATTRS and aria-* only (no on*, style, id, name, data-*); href relative, #anchor, http(s) or mailto;
  //     src relative (the sheet's own folder) or data:image/(png|jpeg|gif|webp) — with {signed: true}, also http(s):
  //     a sheet kept on the device (L19) already holds the app's signed photo URLs.
  const ALLOW = new Set(['A', 'ABBR', 'ARTICLE', 'ASIDE', 'B', 'BLOCKQUOTE', 'BR', 'CAPTION', 'CITE', 'CODE', 'DD', 'DEL',
    'DETAILS', 'DFN', 'DIV', 'DL', 'DT', 'EM', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
    'HR', 'I', 'IMG', 'INS', 'KBD', 'LI', 'MAIN', 'MARK', 'NAV', 'OL', 'P', 'PRE', 'Q', 'S', 'SECTION', 'SMALL', 'SPAN',
    'STRONG', 'SUB', 'SUMMARY', 'SUP', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TIME', 'TR', 'U', 'UL', 'WBR']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'TITLE', 'XMP', 'IFRAME', 'NOEMBED', 'NOFRAMES', 'NOSCRIPT', 'OBJECT',
    'EMBED', 'APPLET', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'OPTION', 'OPTGROUP', 'BASE', 'META', 'LINK', 'SVG', 'MATH',
    'TEMPLATE', 'FRAME', 'FRAMESET', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'DIALOG', 'PORTAL', 'PICTURE', 'MAP',
    'AREA', 'PARAM', 'SLOT', 'PLAINTEXT']);
  const ATTRS = new Set(['class', 'src', 'alt', 'title', 'href', 'width', 'height', 'loading', 'lang', 'dir', 'start',
    'reversed', 'type', 'colspan', 'rowspan', 'datetime', 'open', 'role']);
  const BLANKS = /[\u0000-\u0020\u007f-\u009f\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]/g;
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const safeUrl = (value, attr, signed) => {
    const bare = String(value).replace(BLANKS, ''), m = /^([a-z][a-z0-9+.-]*):/i.exec(bare), scheme = m ? m[1].toLowerCase() : '';
    if (attr === 'src') return m ? /^data:image\/(png|jpeg|gif|webp)[;,]/i.test(bare) || (!!signed && (scheme === 'https' || scheme === 'http')) : !/^[\/\\]{2}/.test(bare);
    return !m || ['http', 'https', 'mailto'].includes(scheme);
  };
  const attrNames = el => el.getAttributeNames ? el.getAttributeNames() : [...(el.attributes || [])].map(a => a.name);
  const clean = (doc, {signed = false} = {}) => {
    const walk = parent => {
      for (const n of [...parent.childNodes]) {
        if (n.nodeType === 8) { parent.removeChild(n); continue; }
        if (n.nodeType !== 1) continue;
        const t = tag(n);
        if (DROP.has(t) || (n.namespaceURI && n.namespaceURI !== HTML_NS)) { parent.removeChild(n); continue; }
        walk(n);
        if (!ALLOW.has(t)) { while (n.firstChild) parent.insertBefore(n.firstChild, n); parent.removeChild(n); continue; }
        for (const a of attrNames(n)) {
          const k = a.toLowerCase();
          if (!(ATTRS.has(k) || /^aria-[a-z]+$/.test(k)) || ((k === 'href' || k === 'src') && !safeUrl(n.getAttribute(a), k, signed))) n.removeAttribute(a);
        }
      }
    };
    walk(doc.body || doc);
    return doc;
  };

  // P8 R5: the first dose block of a page, as [number, label] pairs (« <b>3</b><span>séries</span> »), for the
  // single-sheet player (RBSessions.sheetItem reads them as sets, reps, seconds and rest).
  const doseOf = page => {
    const d = page && page.querySelector ? page.querySelector('div.dose') : null;
    return d ? [...d.querySelectorAll('.d')].map(x => [text(x.querySelector('b')), text(x.querySelector('span'))]).filter(([b, l]) => b || l) : [];
  };

  // ---------- P11 G3a: the glossary of a notebook, in a sheet (read only) ----------
  // Entries are the rows of glossary_words (docs/audit-design/P11-glossary.md › Data contract). Everything here runs
  // on the sheet as displayed, after arrange: the stored html is never changed.
  const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const str = v => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  const arr = v => Array.isArray(v) ? v : [];
  // A photo's file is a plain file name in the sheet's img/ folder, kept as written: whatever storage takes
  // (« 01-front(2).jpg », spaces, accents). Refused: no name, « . », what would leave the folder (/, \, ..), a
  // control character, and ? or # (the rest of a URL, not a name).
  const fileName = v => typeof v === 'string' && v.trim() && !/^\.$|\.\.|[\/\\?#\x00-\x1f\x7f]/.test(v) ? v : '';
  // The rows as the app uses them; a row without a term or a definition, or a second row with the same id, is left out.
  const readWords = rows => {
    const out = new Map();
    for (const r of arr(rows)) {
      if (!r || typeof r !== 'object') continue;
      const term = str(r.term), definition = str(r.definition), sense = str(r.sense);
      if (!term || !definition) continue;
      const key = String(r.id || `${term}|${sense}`), ph = r.photo && typeof r.photo === 'object' ? r.photo : null;
      if (out.has(key)) continue;
      out.set(key, {key, term, sense, definition, forms: arr(r.forms).map(str).filter(Boolean),
        unsure: r.confidence === 'unsure', doubt: str(r.doubt), spelling: str(r.spelling),
        photo: ph && str(ph.slug) && fileName(ph.file) ? {slug: str(ph.slug), file: fileName(ph.file)} : null,
        related: arr(r.related).map(str).filter(Boolean),
        sheets: arr(r.sheets).filter(s => s && typeof s === 'object' && typeof s.slug === 'string' && s.slug)
          .map(s => ({slug: s.slug, quote: typeof s.quote === 'string' ? s.quote : '', where: str(s.where)}))});
    }
    return [...out.values()];
  };
  const sameTerm = (a, b) => a.term.toLowerCase() === b.term.toLowerCase();
  // A word shows its sense (« aile · le kite ») where the notebook has another entry with the same term.
  const senseShown = (w, words) => !!w.sense && words.some(x => x !== w && sameTerm(x, w));
  const byName = (a, b) => a.term.localeCompare(b.term, undefined, {sensitivity: 'base', numeric: true}) || a.sense.localeCompare(b.sense);
  // The words of a sheet: every entry that lists it, whatever `where`, in alphabetical order.
  const wordsOf = (words, slug) => arr(words).filter(w => w.sheets.some(s => s.slug === slug)).sort(byName);
  // « See also »: `term` or `term (sense)`. A related word without an entry is not shown; a bare term that has
  // several entries shows each of them.
  const relatedOf = (w, words) => {
    const out = [];
    for (const r of w.related) {
      const low = r.toLowerCase(), m = /^(.*\S)\s*\(([^()]*)\)$/.exec(r);
      let hit = arr(words).filter(x => x.term.toLowerCase() === low);
      if (!hit.length && m) hit = words.filter(x => x.term.toLowerCase() === m[1].toLowerCase() && x.sense.toLowerCase() === m[2].trim().toLowerCase());
      for (const x of hit) if (x !== w && !out.includes(x)) out.push(x);
    }
    return out;
  };

  // Running text, defined by what it leaves out: every paragraph, list item, note and quotation block of the sheet's
  // body (the « Why » paragraph, the loop line and « easier / harder » included), never inside NOT_RUN: headings, what
  // is laid on a photo (figure), kit chips, the eyebrow, dose and condition tiles, links, the footer, and the app's
  // own blocks around the sheet (its top bar, actions row, « My notes », report, navigation).
  const RUN = 'p, li, .note, blockquote';
  const NOT_RUN = 'a, h1, h2, h3, h4, h5, h6, summary, footer, figure, button, textarea, nav, .kit, .eyebrow, .dose, .cond, .notes, .report, .acts2, .gw, .gl-end, #sheet-top';
  // The tags a form may run over (« sous <b>le</b> vent »): text-level ones, which never start a line of their own.
  const INLINE = /^(?:B|STRONG|EM|I|U|S|SPAN|MARK|SMALL|SUB|SUP|CODE|ABBR|CITE|Q|DFN|KBD|VAR|DEL|INS|TIME|BDI|BDO|FONT)$/;
  const SPACE = /\s/, LETTER = /[\p{L}\p{N}]/u, BREAK = '￼';
  // Text as it is compared: whitespace collapsed, case ignored (one character stays one character).
  const foldChar = ch => { const low = ch.toLowerCase(); return low.length === 1 ? low : ch; };
  const fold = s => [...String(s || '').replace(/\s+/g, ' ').trim()].map(c => c.length === 1 ? foldChar(c) : c).join('');
  // The running text of a block as one folded string, each character mapped back to its text node and offset. What
  // the block holds that is not its own running text (a link, a nested block) leaves a BREAK, mapped to nothing: no
  // quote and no form reaches across it.
  const runOf = block => {
    let s = ''; const at = [];
    const walk = n => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) {
          for (let i = 0; i < c.data.length; i++) {
            const ch = c.data[i];
            if (SPACE.test(ch) || ch === BREAK) { if (s && s[s.length - 1] !== ' ') { s += ' '; at.push([c, i]); } }
            else { s += foldChar(ch); at.push([c, i]); }
          }
        } else if (!isEl(c)) continue;
        else if (c.matches(NOT_RUN) || c.matches(RUN)) { if (s[s.length - 1] !== BREAK) { s += BREAK; at.push(null); } } // a nested block is a block of its own
        else walk(c);
      }
    };
    walk(block);
    return {s, at, block};
  };
  // The element that holds a text node once the inline tags around it are set aside.
  const holder = (node, block) => { let p = node.parentNode; while (p && p !== block && INLINE.test(p.tagName)) p = p.parentNode; return p; };
  // Where a form sits in s between from and to: whole words only. It may run over several text nodes of the block
  // when only inline tags separate them (one holder); never over a link or out of its block (a BREAK).
  const findForm = (run, form, from, to) => {
    for (let i = run.s.indexOf(form, from); i >= 0 && i + form.length <= to; i = run.s.indexOf(form, i + 1)) {
      const end = i + form.length;
      if ((i > 0 && LETTER.test(run.s[i - 1])) || (end < run.s.length && LETTER.test(run.s[end]))) continue;
      let ok = true, last = null, hold = null;
      for (let k = i; k < end && ok; k++) {
        const a = run.at[k];
        if (!a) ok = false;
        else if (a[0] !== last) { const h = holder(last = a[0], run.block); if (hold && h !== hold) ok = false; hold = h; }
      }
      if (ok) return i;
    }
    return -1;
  };
  // The places to underline in a sheet, [{word, block, start, end}] in display order:
  // - only a word whose `sheets` lists this sheet with where « text »; its place is the first occurrence of that quote
  //   in the running text, and inside it the longest of its forms; a quote that is not found gives nothing;
  // - two places that overlap: the longer wins; two places separated by a single space: only the first stays.
  const placesOf = (root, words, slug) => {
    if (!root || !root.querySelectorAll) return [];
    let runs = null;
    const hits = [];
    for (const w of arr(words)) {
      const it = w.sheets.find(s => s.slug === slug && s.where === 'text'), quote = it ? fold(it.quote) : '';
      const forms = [...new Set(w.forms.map(fold).filter(Boolean))].sort((a, b) => b.length - a.length);
      if (!quote || !forms.length || quote.includes(BREAK)) continue;
      runs = runs || [...root.querySelectorAll(RUN)].filter(b => !b.closest(NOT_RUN)).map(runOf);
      const block = runs.findIndex(r => r.s.includes(quote));
      if (block < 0) continue;
      const from = runs[block].s.indexOf(quote);
      for (const f of forms) {
        const start = findForm(runs[block], f, from, from + quote.length);
        if (start >= 0) { hits.push({word: w, block, start, end: start + f.length, run: runs[block]}); break; }
      }
    }
    const kept = [];
    for (const h of [...hits].sort((a, b) => (b.end - b.start) - (a.end - a.start)))
      if (!kept.some(k => k.block === h.block && h.start < k.end && k.start < h.end)) kept.push(h);
    kept.sort((a, b) => a.block - b.block || a.start - b.start);
    const out = [];
    for (const h of kept) {
      const p = out[out.length - 1];
      if (p && p.block === h.block && h.start === p.end + 1 && h.run.s[p.end] === ' ') continue;
      out.push(h);
    }
    return out;
  };
  // The text nodes a place covers, each with the part of it that is covered: [{node, a, b}].
  const piecesOf = h => {
    const out = [];
    for (let k = h.start; k < h.end; k++) {
      const [node, i] = h.run.at[k], p = out[out.length - 1];
      if (p && p.node === node) p.b = i + 1; else out.push({node, a: i, b: i + 1});
    }
    return out;
  };
  // Underlines the places: <span class="gw" role="button" tabindex="0" data-gw="<key>"><span>word</span></span>.
  // The outer span is the target (as tall as its line, see the CSS), the inner one carries the text and the line.
  // A word that runs over an inline tag (« sous <b>le</b> vent ») is one such span per text node, each inside its
  // own parent, so no tag of the sheet is moved or split: the first (.gw-a) is the button, named by the whole word;
  // the others (.gw-m, the last .gw-z) carry the same data-gw, no role and no tab stop, and are hidden from assistive
  // technology since the first one says them. Returns the keys underlined, in display order.
  const underline = (root, words, slug) => {
    const places = placesOf(root, words, slug);
    for (const h of [...places].reverse()) { // from the end: the offsets before a place stay true
      const pieces = piecesOf(h), n = pieces.length;
      const label = pieces.map(p => p.node.data.slice(p.a, p.b)).join('').replace(/\s+/g, ' ').trim();
      for (let k = n - 1; k >= 0; k--) {
        const {node, a, b} = pieces[k], parent = node.parentNode, doc = parent.ownerDocument, data = node.data;
        const outer = doc.createElement('span'), inner = doc.createElement('span'), tail = doc.createTextNode(data.slice(b));
        outer.setAttribute('class', n > 1 ? 'gw ' + (k === 0 ? 'gw-a' : k === n - 1 ? 'gw-z' : 'gw-m') : 'gw');
        if (k === 0) {
          outer.setAttribute('role', 'button'); outer.setAttribute('tabindex', '0'); outer.setAttribute('aria-haspopup', 'dialog');
          if (n > 1) outer.setAttribute('aria-label', label);
        } else outer.setAttribute('aria-hidden', 'true');
        outer.setAttribute('data-gw', h.word.key);
        inner.textContent = data.slice(a, b); outer.appendChild(inner);
        node.data = data.slice(0, a);
        parent.insertBefore(tail, node.nextSibling); parent.insertBefore(outer, tail);
      }
    }
    return places.map(h => h.word.key);
  };
  // Takes the words off a page: each underlined piece becomes plain text again, « Words in this sheet » leaves (with
  // the box the app put around it, [data-gl-box]). The page is then what it was before `underline`.
  const clear = root => {
    if (!root || !root.querySelectorAll) return;
    for (const g of [...root.querySelectorAll('.gw')]) {
      const parent = g.parentNode; if (!parent) continue;
      parent.insertBefore(parent.ownerDocument.createTextNode(g.textContent), g); parent.removeChild(g);
      if (parent.normalize) parent.normalize();
    }
    for (const x of [...root.querySelectorAll('[data-gl-box], .gl-end')]) if (x.parentNode) x.parentNode.removeChild(x);
  };

  const wordLabel = (w, words) => escH(w.term) + (senseShown(w, words) ? `<span class="gl-sense"> · ${escH(w.sense)}</span>` : '');
  const chip = (w, words, attr, lang) => `<button type="button" class="gl-chip" ${attr}="${escH(w.key)}"${lang}>${wordLabel(w, words)}</button>`;
  // « Words in this sheet · n », folded: one chip per word of the sheet. '' when the sheet has none.
  // `link`: the « Glossary n › » link of the notebook (linkHtml, P11 G3b), after the chips.
  const endBlock = (words, slug, link = '') => {
    const list = wordsOf(words, slug);
    return list.length ? `<details class="rb-more gl-end"><summary>Words in this sheet · ${list.length}</summary><div class="gl-chips">${list.map(w => chip(w, words, 'data-gw', '')).join('')}</div>${link ? `<p class="gl-all">${link}</p>` : ''}</details>` : '';
  };
  // The definition sheet's content. `back`: the word a « See also » came from; `caption`: the title of the photo's
  // sheet (« This sheet »), '' when the word has no photo to show; `lang`: the language of the sheets.
  const defHtml = (w, {words = [], back = null, caption = '', lang = ''} = {}) => {
    const l = lang ? ` lang="${escH(lang)}"` : '', see = relatedOf(w, words);
    const n = Math.max(1, w.spelling ? w.sheets.filter(s => fold(s.quote).includes(fold(w.spelling))).length : 0);
    return '<div class="gl-top">'
      + (back ? `<button type="button" class="gl-back" data-gl-back="${escH(back.key)}">‹ <span${l}>${escH(back.term)}</span></button>` : '')
      + `<h2 id="gl-h" tabindex="-1"${l}>${escH(w.term)}</h2>` + (w.sense ? `<p class="gl-of"${l}>${escH(w.sense)}</p>` : '')
      + '<button type="button" class="share-x" id="gl-close" aria-label="Close">✕</button></div>'
      + (w.spelling ? `<p class="gl-sp">Spelled “<span${l}>${escH(w.spelling)}</span>” in ${n} sheet${n > 1 ? 's' : ''}</p>` : '')
      + `<p class="gl-def"${l}>${escH(w.definition)}</p>`
      + (w.unsure ? `<p class="note"><b>Not sure</b>${w.doubt ? `<span${l}>${escH(w.doubt)}</span>` : ''}</p>` : '')
      + (w.photo && caption ? `<div class="gl-ph"><figure><img data-gl-ph alt="${escH(w.term)}" tabindex="0" role="button"></figure><p class="gl-cap">${escH(caption)}</p></div>` : '')
      + (see.length ? `<h3 class="gl-h">See also</h3><div class="gl-chips">${see.map(x => chip(x, words, 'data-gl-see', l)).join('')}</div>` : '');
  };
  // ---------- P11 G3b: the « Glossary » page of a notebook (read only) ----------
  // « 52 words », « 1 word »: the count counts entries (a word in two senses is two).
  const count = n => `${n} word${n === 1 ? '' : 's'}`;
  // « Glossary 52 › »: the same link on a notebook's count line and under « Words in this sheet ». '' without entry.
  const linkHtml = (href, n) => n > 0 ? `<a class="gl-go" href="${escH(href)}" aria-label="Glossary, ${count(n)}">Glossary ${n} ›</a>` : '';
  // The page's order: alphabetical in the notebook's language, accents and case ignored, digits first and by their
  // value (« 11 h » before « 360 », both before « aile »); two senses of one word by their label.
  const sorted = (words, lang = '') => {
    const opt = {sensitivity: 'base', numeric: true};
    let cmp;
    try { cmp = new Intl.Collator(lang || undefined, opt).compare; } catch { cmp = (a, b) => a.localeCompare(b, undefined, opt); }
    return [...arr(words)].sort((a, b) => cmp(a.term, b.term) || cmp(a.sense, b.sense));
  };
  // One row per entry: the word, its sense when the notebook has another entry with that term, « Not sure », then
  // the definition (one line, cut by the style sheet). `list`: the rows shown; `words`: every entry of the notebook.
  const rowsHtml = (list, words, lang = '') => {
    const l = lang ? ` lang="${escH(lang)}"` : '';
    return arr(list).map(w => `<li><button type="button" class="glp-row" data-gw="${escH(w.key)}"><span class="glp-w"><b${l}>${escH(w.term)}</b>`
      + (senseShown(w, words) ? `<span class="gl-sense"${l}> · ${escH(w.sense)}</span>` : '') + (w.unsure ? '<span class="glp-pill">Not sure</span>' : '')
      + `</span><span class="glp-def"${l}>${escH(w.definition)}</span></button></li>`).join('');
  };
  const glossary = {read: readWords, wordsOf, relatedOf, placesOf, underline, clear, endBlock, defHtml, count, linkHtml, sorted, rowsHtml};

  const api = {arrange, markPhotos, photosOf, keyPoints, doseOf, clean, MORE, glossary};
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RBSheet = api;
})(typeof window !== 'undefined' ? window : globalThis);
