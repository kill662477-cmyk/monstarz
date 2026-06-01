const CACHE_NAME = "monstarz-mobile-v3";
const STATIC_CACHE = [
  "/mobile/manifest.webmanifest",
  "/mobile/icons/icon-192.png",
  "/mobile/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("monstarz-mobile-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 앱 본문은 항상 네트워크에서 최신 파일을 받는다.
  if (
    request.mode === "navigate" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith("/mobile/")
  ) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // Firebase, LIVE API, 공지 JSON 등 갱신 데이터는 캐시하지 않는다.
  const isDynamicRequest =
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("onrender.com") ||
    url.hostname.includes("raw.githubusercontent.com") ||
    url.hostname.includes("netlify.app");

  if (isDynamicRequest) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // 앱 아이콘과 매니페스트만 캐시 우선으로 제공한다.
  if (url.origin === self.location.origin && STATIC_CACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});
