/**
 * ADAS F1RST Tech Portal - Service Worker
 * Provides offline caching and push notification support
 */

const CACHE_NAME = 'adas-tech-v1';
const STATIC_ASSETS = [
  '/tech/',
  '/tech/calendar.html',
  '/tech/js/calendar-app.jsx',
  '/logo192.svg'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.log('[SW] Cache failed:', err))
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(n => n !== CACHE_NAME)
          .map(n => {
            console.log('[SW] Deleting old cache:', n);
            return caches.delete(n);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API requests (always go to network)
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request);
      })
  );
});

// Push notification event
self.addEventListener('push', event => {
  console.log('[SW] Push received');

  let data = { title: 'ADAS F1RST', body: 'New notification' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/logo192.svg',
    badge: '/logo192.svg',
    tag: data.tag || 'adas-notification',
    data: data.data || {},
    vibrate: [200, 100, 200],
    requireInteraction: true,
    actions: [
      { action: 'view', title: 'View Job' },
      { action: 'accept', title: 'Accept' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  console.log('[SW] Notification clicked:', event.action);

  event.notification.close();

  const data = event.notification.data || {};
  let url = '/tech/calendar.html';

  if (data.roPo) {
    url = `/tech/calendar.html?job=${data.roPo}`;
  }

  if (event.action === 'accept' && data.roPo) {
    url = `/tech/calendar.html?job=${data.roPo}&action=accept`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Check if there's already an open window
        for (const client of windowClients) {
          if (client.url.includes('/tech') && 'focus' in client) {
            // Send message to existing window
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              action: event.action,
              data: data
            });
            return client.focus();
          }
        }
        // No existing window, open new one
        return clients.openWindow(url);
      })
  );
});

console.log('[SW] Service worker loaded');
