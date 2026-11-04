// Reelbook service worker (L19, instant start).
// - App shell: stale-while-revalidate. The cached copy answers at once and the network refreshes it in the
//   background, so a new version shows on the next start, without any prompt. Uncached: the network, as with no
//   worker. Every change to a module bumps its ?v= here and in index.html, and VERSION (COORDINATION, pitfalls).
// - Signed photos from Supabase Storage: cache-first, keyed by their URL without the token (a new token is
//   signed at each start; the app's rbv parameter, the sheet's updated_at, stays in the key so a republished
//   photo is fetched again; the request to Storage goes without it), PHOTO_MAX at most (oldest out), cleared on sign-out (message CLEAR_USER_CACHE), a deleted sheet's dropped (DROP_PHOTOS).
// Data (rows) never goes through here: the app keeps its own last catalogue (IndexedDB, per user).
const VERSION = 'rb-shell-35';
const PHOTOS = 'rb-photos-1', PHOTO_MAX = 300;
const SHELL = ['./', './index.html', './config.js?v=6', './sessions.js?v=10', './sheet.js?v=4', './vendor/supabase.js?v=2', './manifest.webmanifest',
  './fonts/barlow-condensed-600-latin.woff2', './fonts/barlow-condensed-700-latin.woff2', './fonts/source-sans-3-latin.woff2',
  './icons/reelbook-mark.svg', './icons/reelbook-mark-light.svg', './icons/reelbook-wordmark.svg', './icons/reelbook-wordmark-light.svg', './icons/reelbook-app.svg', './icons/reelbook-icon-180.png', './icons/reelbook-icon-192.png', './icons/reelbook-icon-512.png', './icons/reelbook-icon-512-maskable.png'];

// cache: 'reload' so a new version is not built from stale HTTP-cached files.
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting())); });
// Old shells go; the photo cache stays across versions (only a sign-out empties it).
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== PHOTOS).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

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
});

// A redirected response cannot answer a navigation (Safari), an error page must not replace a good copy.
const keep = r => r && r.ok && !r.redirected;

const shell = async e => {
  const req = e.request, url = new URL(req.url);
  // A navigation with a query (the sign-up confirmation link) is the same page.
  const key = req.mode === 'navigate' ? url.origin + url.pathname : req;
  const refresh = fetch(key, {cache: 'no-cache'}).then(async r => {
    if (keep(r)) { const copy = r.clone(); await (await caches.open(VERSION)).put(key, copy); }
    return r;
  });
  refresh.catch(() => {}); // handled below (offline with a cached copy) or by the caller
  let cached = null;
  try { cached = await (await caches.open(VERSION)).match(key) || null; } catch {}
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
  e.respondWith(shell(e).catch(() => fetch(e.request)));
});
