/*
 * Kill switch for the old World Express service worker.
 *
 * Until 2026-08-28 the game was served from /grand-express/ and installed a
 * service worker with that scope. People who added it to a home screen still
 * have that worker on their device, and it answers from its own cache — so
 * they would keep opening the old build forever, never see the moved page,
 * and never get another update. The game would look abandoned rather than
 * moved.
 *
 * A service worker can only be replaced by a worker at the same URL, so this
 * file has to sit exactly where the old one did. The browser fetches it on
 * navigation, which is the one moment the installed app gives us.
 *
 * `skipWaiting` on install is deliberate here, and the opposite of what the
 * real worker does. The real one waits for the reader to press Update because
 * swapping mid-game is rude. This one is not delivering a new version of
 * anything — it exists to get out of the way — so waiting for a button that
 * lives in the old cached UI would strand exactly the people it is meant to
 * rescue.
 */
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      // Drop everything the old worker precached.
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));

      // Take control of the open pages so they can be sent onward.
      await self.clients.claim();

      // Then step down: nothing should own this scope any more.
      await self.registration.unregister();

      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.navigate("/world-express/").catch(function () {});
      }
    })()
  );
});

/*
 * While this worker is briefly in charge, do not answer from any cache — the
 * caches are being deleted anyway. Let everything hit the network so the
 * redirect page is what people actually see.
 */
self.addEventListener("fetch", function (event) {
  if (event.request.mode === "navigate") {
    event.respondWith(Response.redirect("/world-express/", 302));
  }
});
