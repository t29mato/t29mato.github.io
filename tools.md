---
layout: page
title: Tools
permalink: /tools/
tty_cwd: ~/site/after-hours/tools
tty_cmd: ls -l

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

  - name: PlantUML Anywhere
    img: /assets/showcase/plantuml-anywhere.jpg
    url: https://github.com/t29mato/plantuml-anywhere
    action: View on GitHub
    tags: [VS Code extension, Diagrams]
    blurb: >-
      Open a `.puml` file and get a live diagram preview — no Java, no
      Graphviz, no server. The PlantUML engine and its Graphviz layout step
      both run client-side, compiled to WebAssembly, so it works the same in
      desktop VS Code and in a browser-based editor like github.dev.
    note: >-
      Not yet on the VS Code Marketplace — install from a local `.vsix`, or
      use the standalone Chrome/Brave extension to open `.puml` files
      straight off disk. MIT licensed.
---

# Tools

<p class="page-intro" markdown="1">
Small utilities that do one thing. Like the games, each runs entirely
client-side — **nothing you feed them leaves your device.**
</p>

{% include showcase.html items=page.tools %}
