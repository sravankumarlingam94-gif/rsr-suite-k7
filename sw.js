/* APGENCO RSR Suite service worker: offline-first, updates itself.
   VER is the build id written by build.py. index.html carries the same id in
   <meta name="rsr-build">. Every build has a new sw.js, so the browser installs it. */
var VER = '80a0e400';
var CACHE = 'rsr-suite-' + VER;
var PAGE = './index.html';
var FILES = ['./manifest.webmanifest', './icon-192.png', './icon-512.png',
  './icon-maskable-192.png', './icon-maskable-512.png', './apple-touch-icon.png'];

// Fetch past the browser cache and the CDN cache (the server ignores ?v=).
function fresh(url) { return fetch(new Request(url + '?v=' + VER, { cache: 'reload' })); }

// First 8 KB of the page as text (the build id meta is at the top of <head>).
function headOf(res) {
  var rd = res.clone().body.getReader(), dec = new TextDecoder(), s = '';
  function pump() {
    return rd.read().then(function (r) {
      if (r.done) return s;
      s += dec.decode(r.value, { stream: true });
      if (s.length >= 8192) { rd.cancel().catch(function () {}); return s; }
      return pump();
    });
  }
  return pump();
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    var page = fresh(PAGE).then(function (res) {
      if (!res.ok) throw new Error('page ' + res.status);
      return headOf(res).then(function (h) {
        // Refuse a half-deployed site: the page must be the same build as this worker.
        if (h.indexOf('name="rsr-build" content="' + VER + '"') < 0) throw new Error('page is not build ' + VER);
        return c.put(PAGE, res);
      });
    });
    var rest = FILES.map(function (u) {
      return fresh(u).then(function (res) { if (!res.ok) throw new Error(u + ' ' + res.status); return c.put(u, res); });
    });
    return Promise.all([page].concat(rest));
  }).then(function () { return self.skipWaiting(); }).catch(function (err) {
    // Install failed: drop the partial cache. The running version stays; the next check retries.
    return caches.delete(CACHE).then(function () { throw err; });
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('rsr-suite-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.rsr === 'ver' && e.ports && e.ports[0]) e.ports[0].postMessage({ ver: VER });
  if (d.rsr === 'skip') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  var base = new URL(self.registration.scope).pathname;
  var nav = req.mode === 'navigate';
  var isPage = nav && url.pathname.indexOf(base) === 0 && /^(index\.html)?$/.test(url.pathname.slice(base.length));
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(isPage ? PAGE : req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic' && !nav) c.put(req, res.clone());
        return res;
      }).catch(function (err) {
        if (nav) return c.match(PAGE).then(function (p) { if (p) return p; throw err; });
        throw err;
      });
    });
  }));
});
