---
layout: page
title: Privacy
permalink: /privacy/
tty_cwd: ~/site
tty_cmd: cat PRIVACY
---

# Privacy

<p class="page-intro" markdown="1">
What this site sends anywhere, and what it does not. Short, because there
is not much of it.
</p>

{% include tty-prompt.html cwd="~/site" cmd="grep -rn 'third party' ." %}

<ul class="lab-list">
  <li>
    <span class="lab-key">Analytics</span>
    <span class="lab-desc">Google Analytics records page views, roughly where in the world the request came from, and which browser made it. It cannot see who you are, and there is no advertising or profiling on this site.</span>
  </li>
  <li>
    <span class="lab-key">Contact form</span>
    <span class="lab-desc">The form on <a href="{{ "/contact/" | relative_url }}">/contact/</a> posts your name, email and message through Web3Forms, which relays it to my inbox. Send it only if you are happy for it to pass through a third party on the way.</span>
  </li>
  <li>
    <span class="lab-key">Map tiles</span>
    <span class="lab-desc">The map on <a href="{{ "/hikes/" | relative_url }}">/hikes/</a> draws its background from CARTO's free basemap, so opening that page fetches tile images from CARTO's servers: they see your address, the tile coordinates, and the page that asked. The tracks, peaks and the map library itself are served from here. Every other page on this site makes no third-party request.</span>
  </li>
  <li>
    <span class="lab-key">Hosting</span>
    <span class="lab-desc">GitHub Pages serves these files, so GitHub sees the ordinary web-server record of the request: address, time, page.</span>
  </li>
  <li>
    <span class="lab-key">Your browser</span>
    <span class="lab-desc">A light or dark preference is kept in this site's own storage on your device. Nothing else is stored, and nothing is sent to me.</span>
  </li>
</ul>

{% include tty-prompt.html cwd="~/site" cmd="cat NOT-COLLECTED" %}

<div class="tty-block lab-rules">
  <span class="tty-line tty-dim">There are no accounts here. Nothing asks you to sign in, and nothing to sign in to.</span>
  <span class="tty-line tty-dim">The tools and games run entirely in your browser. Whatever you feed them — a photo, a diagram, a save file — stays on your device, and one of them enforces that with a policy the browser applies for you rather than a promise I make.</span>
  <span class="tty-line tty-dim">Nothing here is sold, shared or used to build a profile of you.</span>
</div>

{% include tty-prompt.html cwd="~/site" cmd="cat OAUTH-APP" %}

<p class="tty-out tty-dim lab-note" markdown="1">
An OAuth client registered as **homelab-rclone** belongs to this site's owner.
It is a personal backup client for the machines described on
<a href="{{ "/homelab/" | relative_url }}">/homelab/</a>: it copies files from a
home server into that owner's own Google Drive, and nobody else uses it or can.
</p>

<p class="tty-out tty-dim lab-note" markdown="1">
It holds the **`drive.file`** scope, which lets an application read and write
only the files it created itself. It cannot see the rest of the Drive it writes
to. It collects nothing from anyone, has no users other than its owner, and
sends nothing to any third party.
</p>

{% include tty-prompt.html cwd="~/site" cmd="mail t29mato" comment="questions, corrections, removals" %}

<p class="tty-out tty-dim lab-note" markdown="1">
Anything above wrong, or want something removed? The
<a href="{{ "/contact/" | relative_url }}">contact form</a> reaches me.
</p>
