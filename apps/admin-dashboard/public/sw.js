/*
 * MerchOS admin service worker: shows Support inbox push alerts (new or
 * waiting live chats) even when the inbox tab is in the background or closed.
 * Clicking the notification opens (or focuses) the inbox on that chat.
 */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'MerchOS support', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'MerchOS support';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'A visitor is waiting in the Support inbox.',
      tag: data.tag || 'merchos-support',
      renotify: true,
      requireInteraction: true,
      data: { url: data.url || '/support' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/support', self.location.origin);
  // Only ever navigate within this site.
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).pathname.startsWith('/support') && 'focus' in w) {
          w.navigate(url.href);
          return w.focus();
        }
      }
      return self.clients.openWindow(url.href);
    }),
  );
});
