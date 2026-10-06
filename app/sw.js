// Reelbook service worker: caches the app shell so the page opens instantly.
// Data (sheets, images) comes from Supabase and needs the network.
const VERSION = 'rb-shell-10';
const SHELL = ['./', './index.html', './config.js?v=5', './vendor/supabase.js?v=2', './manifest.webmanifest', './icons/reelbook-mark.svg', './icons/reelbook-mark-light.svg', './icons/reelbook-app.svg', './icons/reelbook-icon-180.png', './icons/reelbook-icon-192.png', './icons/reelbook-icon-512.png', './icons/reelbook-icon-512-maskable.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first for the shell (so updates land), cache as fallback
  e.respondWith(fetch(e.request, {cache: 'no-cache'}).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
