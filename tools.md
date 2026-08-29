---
layout: default
title: Tools
permalink: /tools/

tools:
  - name: Candy Spice Certificate Maker
    img: /assets/showcase/candy-spice.jpg
    url: https://candy-spice.vercel.app
    tags: [Image tool, Bilingual]
    blurb: >-
      Tsukuba's soup curry shop *candy spice* photographs anyone who clears
      spice level 15 and pins the print to the wall. This makes the same
      certificate from your own photo — level badge, date, name, and the big
      red 完食!! stamp — and exports it at L-size 300 dpi, ready to print.
    note: >-
      It finds the faces and shifts the crop so nobody ends up under the date
      or the badge; about 0.4 s, no upload. **Your photo never leaves the
      browser** — a `connect-src 'self'` policy means the browser itself
      refuses outbound requests, EXIF and GPS are dropped on import, and even
      the face detection model is served from the page. Japanese and English.
---

## 🛠 Tools

<p class="page-intro" markdown="1">
Small utilities that do one thing. Like the games, each runs entirely
client-side — **nothing you feed them leaves your device.**
</p>

{% include showcase.html items=page.tools %}
