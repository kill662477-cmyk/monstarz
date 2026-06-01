const CACHE_NAME = "monstarz-mobile-v1";

const APP_SHELL = [
  "/mobile/",
  "/mobile/index.html",
  "/mobile/manifest.webmanifest",
  "/mobile/icons/icon-192.png",
  "/mobile/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  /*
    Firebase, LIVE API, GitHub raw JSON, Netlify 일정표는
    항상 최신 데이터를 받아야 하므로 캐시하지 않는다.
  */
  const isDynamicExternalRequest =
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("onrender.com") ||
    url.hostname.includes("raw.githubusercontent.com") ||
    url.hostname.includes("netlify.app");

  if (isDynamicExternalRequest) {
    event.respondWith(fetch(request));
    return;
  }

  /*
    모바일 앱 자체 파일은 캐시 우선.
    캐시에 없으면 네트워크에서 받아 저장한다.
  */
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        const clonedResponse = networkResponse.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, clonedResponse);
        });

        return networkResponse;
      });
    })
  );
});
