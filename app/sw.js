// Reelbook service worker (L19, instant start).
// - App shell: stale-while-revalidate. The cached copy answers at once and the network refreshes it in the
//   background, so a new version shows on the next start, without any prompt. Uncached: the network, as with no
//   worker. Every change to a module bumps its ?v= here and in index.html, and VERSION (COORDINATION, pitfalls).
// - Signed photos from Supabase Storage: cache-first, keyed by their URL without the token (a new token is
//   signed at each start; the app's rbv parameter, the sheet's updated_at, stays in the key so a republished
//   photo is fetched again; the request to Storage goes without it), PHOTO_MAX at most (oldest out), cleared on sign-out (message CLEAR_USER_CACHE), a deleted sheet's dropped (DROP_PHOTOS).
// - The demo notebook (app/demo/, L27): stale-while-revalidate too, in a cache of its own (DEMO) that a new
//   VERSION keeps. On the first visit of #demo the app sends the list of its files (message KEEP_DEMO), fetched
//   here even when the page is not controlled yet, so the demo opens offline afterwards. Not precached: most
//   visitors never open it. A new DEMO (new content) keeps the previous demo cache until KEEP_DEMO has filled
//   the new one with every listed file: meanwhile a demo file the new cache lacks offline comes from the old one
//   (the whole old demo, coherent), so an updated device does not lose its offline demo (L37).
// Data (rows) never goes through here: the app keeps its own last catalogue (IndexedDB, per user).
const VERSION = 'rb-shell-46';
const PHOTOS = 'rb-photos-1', PHOTO_MAX = 300, DEMO = 'rb-demo-2';
const SHELL = ['./', './index.html', './config.js?v=10', './sessions.js?v=10', './sheet.js?v=4', './landing.js?v=5', './vendor/supabase.js?v=2', './manifest.webmanifest',
  './fonts/barlow-condensed-600-latin.woff2', './fonts/barlow-condensed-700-latin.woff2', './fonts/source-sans-3-latin.woff2',
  './icons.svg', './icons/reelbook-mark.svg', './icons/reelbook-mark-light.svg', './icons/reelbook-wordmark.svg', './icons/reelbook-wordmark-light.svg', './icons/reelbook-app.svg', './icons/reelbook-icon-180.png', './icons/reelbook-icon-192.png', './icons/reelbook-icon-512.png', './icons/reelbook-icon-512-maskable.png'];

// cache: 'reload' so a new version is not built from stale HTTP-cached files.
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting())); });
// Old shells go; the photo cache stays across versions (only a sign-out empties it).
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== PHOTOS && k !== DEMO && !oldDemo(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

// epoch: bumped at each sign-out and each deleted sheet, so a photo still downloading then is not put back in the
// emptied cache (another sheet's photo in flight is only left uncached).
let epoch = 0;
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CLEAR_USER_CACHE') { epoch++; e.waitUntil(caches.delete(PHOTOS)); }
  // A deleted sheet: its photos (path '<user id>/<slug>/') go too.
  if (e.data && e.data.type === 'DROP_PHOTOS' && typeof e.data.path === 'string' && /^[^/]+\/[^/]+\/$/.test(e.data.path)) {
    const part = '/storage/v1/object/sign/sheets/' + e.data.path; epoch++;
    e.waitUntil(caches.open(PHOTOS).then(async c => Promise.all((await c.keys()).filter(k => k.url.includes(part)).map(k => c.delete(k)))).catch(() => {}));
  }
  if (e.data && e.data.type === 'KEEP_DEMO' && Array.isArray(e.data.urls)) e.waitUntil(keepDemo(e.data.urls).catch(() => {}));
});

// A demo file: same origin, under <scope>/demo/.
const demoFile = url => url.origin === location.origin && /\/demo\/[\w.\/-]+$/.test(url.pathname) && !url.pathname.includes('..');
// A previous demo cache (an older DEMO): kept until the new one is complete.
const oldDemo = k => /^rb-demo-/.test(k) && k !== DEMO;
const keepDemo = async urls => {
  const c = await caches.open(DEMO);
  let missed = 0, kept = 0;
  await Promise.all(urls.slice(0, 300).map(async u => {
    let url; try { url = new URL(String(u)); } catch { return; }
    if (!demoFile(url)) return;
    try { const r = await fetch(url.href, {cache: 'no-cache'}); if (keep(r)) { await c.put(url.href, r); kept++; } else missed++; } catch { missed++; }
  }));
  // Every file of the new demo is here: the old demo can go.
  if (kept && !missed) await Promise.all((await caches.keys()).filter(oldDemo).map(k => caches.delete(k)));
};
// Offline, a demo file the new cache does not hold yet: the old demo's copy, if any.
const fromOldDemo = async req => {
  for (const k of (await caches.keys()).filter(oldDemo)) { const hit = await (await caches.open(k)).match(req); if (hit) return hit; }
  throw new Error('not in an old demo cache');
};

// A redirected response cannot answer a navigation (Safari), an error page must not replace a good copy.
const keep = r => r && r.ok && !r.redirected;

const shell = async (e, store = VERSION) => {
  const req = e.request, url = new URL(req.url);
  // A navigation with a query (the sign-up confirmation link) is the same page.
  const key = req.mode === 'navigate' ? url.origin + url.pathname : req;
  const refresh = fetch(key, {cache: 'no-cache'}).then(async r => {
    if (keep(r)) { const copy = r.clone(); await (await caches.open(store)).put(key, copy); }
    return r;
  });
  refresh.catch(() => {}); // handled below (offline with a cached copy) or by the caller
  let cached = null;
  try { cached = await (await caches.open(store)).match(key) || null; } catch {}
  if (!cached) return refresh;
  e.waitUntil(refresh.catch(() => {})); // offline: the cached copy stays
  return cached;
};

const trim = async c => {
  const keys = await c.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - PHOTO_MAX)).map(k => c.delete(k)));
};
// rbv is the app's own parameter: Storage gets the signed URL as it was signed. The fallback keeps the page's mode.
const noRbv = href => { const u = new URL(href); u.searchParams.delete('rbv'); return u.href; };
const bare = req => fetch(noRbv(req.url), {mode: req.mode === 'cors' ? 'cors' : 'no-cors', credentials: 'omit'});
const photo = async e => {
  const href = noRbv(e.request.url), url = new URL(e.request.url), at = epoch;
  url.searchParams.delete('token');
  const key = url.origin + url.pathname + url.search;
  try { const hit = await (await caches.open(PHOTOS)).match(key); if (hit) return hit; } catch {}
  // CORS, so the copy is readable (an opaque one would weigh megabytes in the quota); a storage without CORS
  // headers still gets its photo, uncached.
  let r;
  try { r = await fetch(href, {mode: 'cors', credentials: 'omit'}); } catch { return bare(e.request); }
  if (keep(r)) {
    const copy = r.clone();
    e.waitUntil(caches.open(PHOTOS).then(async c => { if (at !== epoch) return; await c.put(key, copy); await trim(c); }).catch(() => {}));
  }
  return r;
};

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.includes('/storage/v1/object/sign/')) { e.respondWith(photo(e).catch(() => bare(e.request))); return; }
  if (url.origin !== location.origin) return;
  // Never stuck on a broken cache: any failure goes to the network.
  if (demoFile(url)) { e.respondWith(shell(e, DEMO).catch(() => fromOldDemo(e.request)).catch(() => fetch(e.request))); return; }
  e.respondWith(shell(e, VERSION).catch(() => fetch(e.request)));
});
