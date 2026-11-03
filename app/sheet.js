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
  // original order (variation, source, credits). A part that is not found stays where it is; nothing is dropped.
  // Returns true when the sheet was rearranged.
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
    const at = u => u ? units.indexOf(u) : Infinity;
    const why = h2s.find(u => u.box === head.box && ![seq, dose, keys].includes(u)
      && at(u) < Math.min(at(dose), at(keys), at(seq)) && isWhy(u.h2));
    if (!seq && !dose && !keys && !why) return false;

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

    const lead = [head, seq, dose, keys, why].filter(Boolean);
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
  // The photos of the viewer: every step photo of the page, in order, with the step's caption.
  const photosOf = page => [...page.querySelectorAll('.step img')].map(img => {
    const step = img.closest('.step');
    const h = step && step.querySelector('h3'), p = step && step.querySelector('p');
    return {img, src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '', title: text(h), caption: text(p)};
  });

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

  const api = {arrange, markPhotos, photosOf, keyPoints, MORE};
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RBSheet = api;
})(typeof window !== 'undefined' ? window : globalThis);
