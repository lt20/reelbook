// A small DOM for tests/sheet.test.cjs (the repo has no package.json, so no jsdom): parses well-formed html
// such as templates/*.html and offers what app/sheet.js uses. Selectors: compound selectors (tag, .class,
// [attr]) joined by spaces (descendant), several separated by commas.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

class Node {
  constructor(type) { this.nodeType = type; this.parentNode = null; this.childNodes = []; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(n => n.nodeType === 8 ? '' : n.textContent).join(''); }
  set textContent(v) { if (this.nodeType === 3) { this.data = String(v); return; } this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; this.appendChild(new Text(String(v))); }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i < 0) throw new Error('not a child'); this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    if (i < 0) throw new Error('ref not a child');
    this.childNodes.splice(i, 0, n); n.parentNode = this; return n;
  }
  appendChild(n) { return this.insertBefore(n, null); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}
class Text extends Node { constructor(data) { super(3); this.data = data; } get outerHTML() { return this.data; } }
class Comment extends Node { constructor(data) { super(8); this.data = data; } get outerHTML() { return `<!--${this.data}-->`; } }

const parseSel = sel => sel.split(',').map(s => s.trim().split(/\s+/).map(part => {
  const m = {tag: null, cls: [], attrs: []};
  for (const [, kind, name] of part.matchAll(/([.#[]?)([\w-]+)\]?/g)) {
    if (kind === '.') m.cls.push(name); else if (kind === '[') m.attrs.push(name); else if (kind === '#') m.attrs.push('id=' + name); else m.tag = name.toUpperCase();
  }
  return m;
}));
const matchOne = (el, m) => (!m.tag || el.tagName === m.tag) && m.cls.every(c => el.classList.contains(c))
  && m.attrs.every(a => a.startsWith('id=') ? el.getAttribute('id') === a.slice(3) : el.hasAttribute(a));
const matchChain = (el, chain) => {
  if (!matchOne(el, chain[chain.length - 1])) return false;
  let i = chain.length - 2;
  for (let p = el.parentNode; i >= 0 && p && p.nodeType === 1; p = p.parentNode) if (matchOne(p, chain[i])) i--;
  return i < 0;
};

class Element extends Node {
  constructor(name, doc) { super(1); this.tagName = name.toUpperCase(); this.attrs = new Map(); this.ownerDocument = doc; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  get classList() { const list = (this.getAttribute('class') || '').split(/\s+/).filter(Boolean); return {contains: c => list.includes(c)}; }
  matches(sel) { return parseSel(sel).some(chain => matchChain(this, chain)); }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) { const out = []; const walk = n => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  cloneNode(deep) {
    const c = new Element(this.tagName, this.ownerDocument); for (const [k, v] of this.attrs) c.attrs.set(k, v);
    if (deep) for (const n of this.childNodes) c.appendChild(n.nodeType === 1 ? n.cloneNode(true) : n.nodeType === 3 ? new Text(n.data) : new Comment(n.data));
    return c;
  }
  get innerHTML() { return this.childNodes.map(n => n.outerHTML).join(''); }
  get outerHTML() {
    const name = this.tagName.toLowerCase(), attrs = [...this.attrs].map(([k, v]) => v === '' ? ` ${k}` : ` ${k}="${v}"`).join('');
    return VOID.has(name) ? `<${name}${attrs}>` : `<${name}${attrs}>${this.innerHTML}</${name}>`;
  }
}

class Document {
  constructor() { this.body = new Element('body', this); this.documentElement = this.body; }
  createElement(name) { return new Element(name, this); }
  querySelectorAll(sel) { return this.body.querySelectorAll(sel); }
  querySelector(sel) { return this.body.querySelector(sel); }
}

const parse = html => {
  const doc = new Document();
  let cur = doc.body;
  for (const [tok, comment, close, open, attrs] of String(html).matchAll(/<!--([\s\S]*?)-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w-:]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|[^<]+|</g)) {
    if (comment != null) cur.appendChild(new Comment(comment));
    else if (close) { const name = close.toUpperCase(); let n = cur; while (n !== doc.body && n.tagName !== name) n = n.parentNode; if (n !== doc.body) cur = n.parentNode; }
    else if (open) {
      const el = doc.createElement(open);
      for (const [, k, v1, v2, v3] of (attrs || '').matchAll(/([\w-:]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) el.setAttribute(k, v1 ?? v2 ?? v3 ?? '');
      cur.appendChild(el);
      if (!VOID.has(open.toLowerCase())) cur = el;
    } else cur.appendChild(new Text(tok));
  }
  return doc;
};

module.exports = {parse};
