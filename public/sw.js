// Service Worker para PWA del mago
const CACHE_NAME = 'mago-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// No cachear nada - siempre datos en tiempo real
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
