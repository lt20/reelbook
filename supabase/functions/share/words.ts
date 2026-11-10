// share, the glossary (P11 G5, decision 6 of docs/audit-design/P11-glossary.md): a session sent to a partner carries
// the words of its sheets. No remote import (tested with the in-memory store, core.test.ts › G5).
//
// Runs once the copy is done (sessions.source.share_state 'done'), and never fails it: copyWords catches everything.
// A backend without the glossary table, or where the service role has no right on it yet, shares as before.
//   - What travels: for each sheet COPIED (never one the recipient kept), the sender's entries of that sheet's
//     notebook whose `sheets` lists it. Each arrives in the notebook the copy landed in, with only the items of the
//     copied sheets, their slugs rewritten to the recipient's.
//   - Merging (the identity of tools/rb.py, _glossary_key: term and sense, trimmed, case ignored): an entry the
//     recipient has keeps everything it has; its forms become the union (_glossary_merge: the stored ones, then the
//     new ones, case and spaces ignored) and it gains the items of the copied sheets (one item per slug). Nothing of
//     the recipient's glossary is replaced or deleted.
//   - The photo travels only when it comes from a copied sheet; an entry that exists keeps its own.
//   - The marks of the glossary pass (which sheets a pass has read) are neither read nor written here: a copied sheet
//     stays to read on the recipient's side, and the recipient's own pass reads it once. A mark written here raced
//     with the sender's pass and with a republication by the recipient, and a wrong one hides a sheet from the pass
//     for good (Codex pass 1 on #145).
import type { Row, Store, StoreError } from './core.ts';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const WHERE = new Set(['text', 'title', 'caption', 'chip']);

export const wordKey = (e: Row): string => JSON.stringify([str(e.term).trim().toLowerCase(), str(e.sense).trim().toLowerCase()]);

export type Copied = { from: Row; slug: string }; // the sender's sheet, and the slug of its copy

// What merging `row` into the stored entry `old` changes: forms and sheets only, and only when they change.
export function mergeWord(old: Row, row: Row): Row {
  const forms = [...list(old.forms)], seen = new Set(forms.filter(f => typeof f === 'string').map(f => squash(f as string)));
  for (const f of list(row.forms) as string[]) if (!seen.has(squash(f))) { seen.add(squash(f)); forms.push(f); }
  const sheets = [...list(old.sheets)];
  for (const it of list(row.sheets) as Row[]) {
    const at = sheets.findIndex(o => isObj(o) && o.slug === it.slug);
    if (at < 0) sheets.push(it); else sheets[at] = it;
  }
  const patch: Row = {};
  if (!same(forms, list(old.forms))) patch.forms = forms;
  if (!same(sheets, list(old.sheets))) patch.sheets = sheets;
  return patch;
}

// The entries to write in the recipient's notebook, one per identity. The sender's rows are another account's data:
// a field keeps its value when it has the contract's shape, an entry without term, definition, confidence or item is
// left out. Two entries of two sender notebooks with one identity: the first is the entry, the second merges into it.
export function planWords(words: Row[], copied: Copied[], caller: string, notebook: string): Row[] {
  const bySlug = new Map(copied.map(c => [str(c.from.slug), c]));
  const out = new Map<string, Row>();
  for (const w of words) {
    const term = str(w.term).trim(), definition = str(w.definition);
    if (!term || !definition.trim() || (w.confidence !== 'sure' && w.confidence !== 'unsure')) continue;
    const items: Row[] = [];
    for (const it of list(w.sheets)) {
      if (!isObj(it)) continue;
      const c = bySlug.get(str(it.slug));
      if (!c || str(c.from.theme) !== str(w.theme)) continue; // a copied sheet, of this entry's notebook
      if (typeof it.quote !== 'string' || !WHERE.has(str(it.where)) || items.some(i => i.slug === c.slug)) continue;
      items.push({ slug: c.slug, quote: it.quote, where: it.where });
    }
    if (!items.length) continue;
    const p = isObj(w.photo) ? w.photo : null, from = p ? bySlug.get(str(p.slug)) : undefined, file = p ? str(p.file) : '';
    const photo = from && file && !file.startsWith('/') && !file.split('/').includes('..') ? { slug: from.slug, file } : null;
    const row: Row = {
      user_id: caller, theme: notebook, term, sense: text(w.sense), forms: list(w.forms).filter(f => typeof f === 'string' && f.trim()),
      kind: text(w.kind), definition, confidence: w.confidence, doubt: text(w.doubt), spelling: text(w.spelling), photo,
      related: list(w.related).filter(r => typeof r === 'string'), sheets: items,
    };
    const key = wordKey(row), first = out.get(key);
    if (first) Object.assign(first, mergeWord(first, row)); else out.set(key, row);
  }
  return [...out.values()];
}

const codeOf = (e: unknown) => String((e as StoreError | null)?.code || 'unknown');
// The glossary table is not there: PostgREST's « not in the schema cache », Postgres' « relation does not exist ».
const absent = (e: unknown) => ['PGRST205', '42P01'].includes(codeOf(e));

// One entry into the recipient's notebook: inserted, or merged into the one that exists. An entry changed or
// inserted by somebody else meanwhile (the recipient's own pass) is read again and merged once more.
async function writeWord(store: Store, caller: string, notebook: string, known: Map<string, Row>, row: Row): Promise<void> {
  const key = wordKey(row);
  for (let attempt = 0; attempt < 3; attempt++) {
    const old = known.get(key);
    if (!old) {
      try { await store.insertWord(row); return; } catch (e) { if (codeOf(e) !== '23505') throw e; }
    } else {
      const patch = mergeWord(old, row);
      if (!Object.keys(patch).length || await store.updateWord(caller, str(old.id), str(old.updated_at), patch)) return;
    }
    known.clear();
    for (const r of await store.words(caller, [notebook])) known.set(wordKey(r), r);
  }
  throw { code: 'word_busy', message: 'the entry kept changing' };
}

// Never throws. Returns what it did, for the log and the tests.
export async function copyWords(store: Store, owner: string, caller: string, notebook: string, copied: Copied[]): Promise<{ words: number; failed: number }> {
  const done = { words: 0, failed: 0 };
  if (!copied.length) return done;
  try {
    const themes = [...new Set(copied.map(c => str(c.from.theme)).filter(Boolean))];
    const rows = planWords(themes.length ? await store.words(owner, themes) : [], copied, caller, notebook);
    if (rows.length) {
      const known = new Map<string, Row>();
      for (const r of await store.words(caller, [notebook])) known.set(wordKey(r), r);
      for (const row of rows) {
        try { await writeWord(store, caller, notebook, known, row); done.words++; } catch (e) {
          if (absent(e)) throw e;
          done.failed++;
          console.error('share: a word was not copied', codeOf(e));
        }
      }
    }
  } catch (e) {
    if (!absent(e)) { done.failed++; console.error('share: words not copied', codeOf(e)); }
  }
  return done;
}
