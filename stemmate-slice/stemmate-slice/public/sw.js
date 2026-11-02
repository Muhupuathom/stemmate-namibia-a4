// sw.js - keeps the app's own files so the page opens with no connection.
// Strategy: try the network first (so changes show up), fall back to the saved copy.
// API calls are never cached here: plans are stored by app.js, not by this file.
var CACHE_NAME = "stemmate-shell-v2";
var FILES = ["/", "/index.html", "/styles.css", "/core.js", "/localserver.js", "/activities-data.js", "/app.js"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(FILES); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.indexOf("/api/") === 0) {
    return;
  }
  event.respondWith(
    fetch(event.request).then(function (response) {
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
      return response;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
