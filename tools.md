---
layout: default
title: Tools
permalink: /tools/
---

## 🛠 Tools

Small utilities that do one thing. Like the games, each runs entirely client-side — nothing you feed them leaves your device.

- [**Candy Spice Certificate Maker**](https://candy-spice.vercel.app)
  Tsukuba's soup curry shop *candy spice* goes up to spice level 30, and if you clear level 15 or above they photograph you and pin the print to the wall. This makes the same certificate from your own photo — the red level badge, the date, your name, and the big red 完食!! stamp — and exports it at L-size 300dpi so you can actually print it.

  Point it at a photo and it finds the faces, then shifts the crop so nobody ends up under the date or the level badge — about 0.4 s, no upload.

  **Your photo never leaves the browser.** No upload, no server, no AI. The page ships a `connect-src 'self'` content security policy, so outbound requests are refused by the browser itself; open the network tab and watch it stay empty, or switch to airplane mode and keep using it. EXIF (including GPS) is dropped on import, so the exported image carries no location data. Even the face detection runs locally — the model is served from the site itself, never a third party.
