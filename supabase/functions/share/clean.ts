// share (P8 R11): a sheet's html, cut down to what templates/ write, before it is copied into another account.
// The app cleans every sheet again when it shows it (app/sheet.js, RBSheet.clean, with the browser's own parser):
// this is the second guard, for a copy made from a sheet written by hand or by an older tool.
//
// The output is rebuilt token by token, so that whatever the input, it holds only:
//   - allowed tags (ALLOW), with allowed attributes (ATTRS, aria-*), each value in double quotes;
//   - text without « < »;
//   - no comment, doctype or processing instruction.
// The elements of DROP go with everything inside them; any other tag is left out and its content kept.
// URLs: href relative, #anchor, http(s) or mailto; src relative (img/01.jpg, the sheet's own folder) or
// data:image/(png|jpeg|gif|webp), never another host. Anything else, or a named entity that could hide a scheme
// (&colon;, &Tab;…), drops the attribute.

const ALLOW = new Set([
  'html', 'head', 'body', 'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'del',
  'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 's', 'section', 'small', 'span',
  'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'wbr',
]);
// Gone with their content. RAW: the browser reads their content as text up to the closing tag.
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
const DROP = new Set([...RAW, 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'option', 'optgroup',
  'base', 'meta', 'link', 'svg', 'math', 'template', 'frame', 'frameset', 'audio', 'video', 'source', 'track', 'canvas',
  'dialog', 'portal', 'picture', 'map', 'area', 'param', 'slot', 'plaintext']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'frame']);
const ATTRS = new Set(['class', 'src', 'alt', 'title', 'href', 'width', 'height', 'loading', 'lang', 'dir', 'start',
  'reversed', 'type', 'colspan', 'rowspan', 'datetime', 'open', 'role']);
const URL_ATTRS = new Set(['href', 'src']);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (v: string): string =>
  v.replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (_, h, d) => {
    const n = h ? parseInt(h, 16) : parseInt(d, 10);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  }).replace(/&(amp|lt|gt|quot|apos);/gi, (_, k) => NAMED[k.toLowerCase()]);

// A safe URL for this attribute (href or src), or null.
export function safeUrl(raw: string, attr: string): string | null {
  // a named reference other than the five plain ones (&colon; &Tab; &NewLine;…) could hide the scheme: refused
  if (/&[a-z][a-z0-9]*;/i.test(raw.replace(/&#(?:x[0-9a-f]+|[0-9]+);?|&(?:amp|lt|gt|quot|apos);/gi, ''))) return null;
  const v = decode(raw);
  const bare = v.replace(/[\u0000-\u0020\u007f-\u009f\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(bare);
  if (attr === 'src') {
    if (!scheme) return /^[\/\\]{2}/.test(bare) ? null : v; // not another host
    return /^data:image\/(png|jpeg|gif|webp)[;,]/i.test(bare) ? v : null;
  }
  if (!scheme) return v; // relative, #anchor
  return ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase()) ? v : null;
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[^>]*>?|<\/([a-zA-Z][\w:-]*)[^>]*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;
const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export function cleanHtml(input: string): string {
  const src = String(input || ''), out: string[] = [];
  let skip: string | null = null, depth = 0; // inside a dropped element: its name and how deep
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(src); m; m = TOKEN.exec(src)) {
    const tok = m[0], close = m[1] && m[1].toLowerCase(), open = m[2] && m[2].toLowerCase();
    if (skip) {
      if (open === skip && !VOID.has(open) && !/\/\s*$/.test(m[3] || '')) depth++;
      else if (close === skip && --depth === 0) skip = null;
      continue;
    }
    if (open) {
      if (open === 'plaintext') break; // the rest of the page is text for a browser
      if (DROP.has(open)) {
        if (RAW.has(open)) { // up to its closing tag, whatever is inside
          const end = src.toLowerCase().indexOf('</' + open, TOKEN.lastIndex);
          if (end < 0) break;
          const gt = src.indexOf('>', end);
          TOKEN.lastIndex = gt < 0 ? src.length : gt + 1;
        } else if (!VOID.has(open) && !/\/\s*$/.test(m[3] || '')) { skip = open; depth = 1; }
        continue;
      }
      if (!ALLOW.has(open)) continue;
      const attrs: string[] = [];
      ATTR.lastIndex = 0;
      for (let a = ATTR.exec(m[3] || ''); a; a = ATTR.exec(m[3] || '')) {
        const name = a[1].toLowerCase(), value = a[2] ?? a[3] ?? a[4] ?? '';
        if (!(ATTRS.has(name) || /^aria-[a-z]+$/.test(name)) || attrs.some(x => x.startsWith(` ${name}=`))) continue;
        if (URL_ATTRS.has(name)) {
          const u = safeUrl(value, name);
          if (u !== null) attrs.push(` ${name}="${esc(u)}"`);
        } else attrs.push(` ${name}="${value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`);
      }
      out.push(`<${open}${attrs.join('')}>`);
    } else if (close) {
      if (ALLOW.has(close) && !VOID.has(close)) out.push(`</${close}>`);
    } else if (tok === '<') out.push('&lt;');
    else if (!tok.startsWith('<')) out.push(tok);
    // comments, doctypes and <? … > are left out
  }
  return out.join('');
}
