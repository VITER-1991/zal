const CACHE = "zal-v5";
const CORE_ASSETS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.webmanifest",
  "data/programs.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-180.png",
  "img/t-fri-1.jpg",
  "img/t-fri-2.jpg",
  "img/t-fri-3.jpg",
  "img/t-fri-4.jpg",
  "img/t-fri-5.jpg",
  "img/t-fri-6.jpg",
  "img/t-fri-7.jpg",
  "img/t-fri-8.jpg",
  "img/t-mon-1.jpg",
  "img/t-mon-2.jpg",
  "img/t-mon-3.jpg",
  "img/t-mon-4.jpg",
  "img/t-mon-5.jpg",
  "img/t-mon-6.jpg",
  "img/t-mon-7.jpg",
  "img/t-mon-8.jpg",
  "img/t-wed-1.jpg",
  "img/t-wed-2.jpg",
  "img/t-wed-3.jpg",
  "img/t-wed-4.jpg",
  "img/t-wed-5.jpg",
  "img/t-wed-6.jpg",
  "img/t-wed-7.jpg",
  "img/t-wed-8.jpg",
  "img/v-fri-1.jpg",
  "img/v-fri-2.jpg",
  "img/v-fri-3.jpg",
  "img/v-fri-4.jpg",
  "img/v-fri-5.jpg",
  "img/v-fri-6.jpg",
  "img/v-fri-7.jpg",
  "img/v-fri-8.jpg",
  "img/v-mon-1.jpg",
  "img/v-mon-2.jpg",
  "img/v-mon-3.jpg",
  "img/v-mon-4.jpg",
  "img/v-mon-5.jpg",
  "img/v-mon-6.jpg",
  "img/v-mon-7.jpg",
  "img/v-mon-8.jpg",
  "img/v-thu-1.jpg",
  "img/v-thu-2.jpg",
  "img/v-thu-3.jpg",
  "img/v-thu-4.jpg",
  "img/v-thu-5.jpg",
  "img/v-thu-6.jpg",
  "img/v-thu-7.jpg",
  "img/v-thu-8.jpg",
  "img/v-tue-1.jpg",
  "img/v-tue-2.jpg",
  "img/v-tue-3.jpg",
  "img/v-tue-4.jpg",
  "img/v-tue-5.jpg",
  "img/v-tue-6.jpg",
  "img/v-tue-7.jpg",
  "img/v-wed-1.jpg",
  "img/v-wed-2.jpg",
  "img/v-wed-3.jpg",
  "img/v-wed-4.jpg",
  "img/v-wed-5.jpg",
  "img/v-wed-6.jpg",
  "img/v-wed-7.jpg",
  "img/v-wed-8.jpg"
];

// Код і програма — спершу з мережі (з таймаутом), щоб оновлення приходили одразу.
// Картинки й іконки — з кешу: вони не змінюються.
const FRESH = /\.(?:js|json|css|webmanifest|html)$|\/$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("zal-") && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then((hit) =>
    hit || (req.mode === "navigate" ? caches.match("index.html") : undefined)
  );
}

function networkFirst(event, req) {
  const net = fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
    }
    return res;
  });
  // слабкий інтернет у залі: через 3 с віддаємо збережену копію
  const slow = new Promise((resolve) => setTimeout(resolve, 3000)).then(() => fromCache(req));
  return Promise.race([net.catch(() => fromCache(req)), slow])
    .then((res) => res || net)
    .catch(() => fromCache(req));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate" || FRESH.test(url.pathname)) {
    event.respondWith(networkFirst(event, req));
    return;
  }
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
      }
      return res;
    }))
  );
});
