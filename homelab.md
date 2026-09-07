---
layout: page
title: Homelab
permalink: /homelab/
tty_cwd: ~/lab
tty_cmd: cat STATUS.md
---

# Homelab

<p class="page-intro" markdown="1">
{{ site.data.homelab.inventory.blurb }}
**Written by hand from a machine inside the lab**, so it moves in days and
not seconds. The one exception is the status band below, which is the lab as
it is right now — and it gets here by being *pushed out*: nothing on this page
is scraped, nothing in the lab accepts a connection from outside it, and no
port is forwarded to reach anything.
</p>

<p class="tty-dim lab-updated">last updated {{ site.data.homelab.inventory.updated_at }}</p>

{% include tty-prompt.html cwd="~/lab" cmd="watch -n15 labstat" %}

<div class="lab-live" id="lab-live" data-endpoint="{{ site.status_endpoint | default: '/api/status' | relative_url }}">
  <p class="tty-out tty-dim lab-live-fallback">The status band is live and needs JavaScript. The rest of this page is written by hand and is complete without it.</p>
</div>

<p class="tty-out tty-dim lab-note">A host that stops pushing goes <span class="lab-status" data-status="unknown">unknown</span>, not <span class="lab-status" data-status="down">down</span> — and so does anything it was the only one watching. A dead observer is not evidence about the thing it was observing, and a page that prints <span class="lab-status" data-status="up">up</span> because nobody is left to contradict it would be worse than no page at all.</p>

{% include tty-prompt.html cwd="~/lab" cmd="open topology/index.html" %}

<figure class="lab-pane">
  <figcaption class="lab-pane-bar">
    <span class="lab-pane-file">topology/index.html</span>
    <a class="lab-pane-open" href="{{ "/homelab/topology/" | relative_url }}">open full &rarr;</a>
  </figcaption>
  <iframe class="lab-pane-frame" id="lab-topology"
          title="Homelab topology — four Mac minis on one switch"
          data-src="{{ "/homelab/topology/" | relative_url }}"></iframe>
  <noscript>
    <p class="lab-pane-fallback">The diagram is interactive and needs JavaScript. <a href="{{ "/homelab/topology/" | relative_url }}">Open it in its own page &rarr;</a></p>
  </noscript>
</figure>

<p class="tty-out tty-dim lab-note">{{ site.data.homelab.inventory.network.topology }}<br>
{{ site.data.homelab.inventory.network.addressing }}<br>
{{ site.data.homelab.inventory.network.disclosure }}</p>

{% include tty-prompt.html cwd="~/lab" cmd="hosts" %}

<table class="lab-hosts">
  <thead>
    <tr><th>NAME</th><th>HARDWARE</th><th>RAM</th><th>OS</th><th>ROLE</th><th>STATUS</th></tr>
  </thead>
  <tbody>
  {%- for host in site.data.homelab.inventory.hosts %}
    <tr>
      <td class="lab-name">{{ host.id }}</td>
      <td>{{ host.hardware }}</td>
      <td>{{ host.ram }}</td>
      <td>{{ host.os }}</td>
      <td class="lab-role">{{ host.role }}</td>
      <td><span class="lab-status" data-status="{{ host.status }}">{{ host.status }}</span></td>
    </tr>
  {%- endfor %}
  </tbody>
</table>

{% include tty-prompt.html cwd="~/lab" cmd="cat stack.txt" %}

<ul class="lab-list">
{%- for item in site.data.homelab.inventory.stack %}
  <li>
    <span class="lab-key">{{ item.name }}</span>
    <span class="lab-desc">{{ item.note }}</span>
    <span class="lab-status" data-status="{{ item.status }}">{{ item.status }}</span>
  </li>
{%- endfor %}
</ul>

{% include tty-prompt.html cwd="~/lab" cmd="ls services/" %}

{% if site.data.homelab.inventory.services.size > 0 %}
<ul class="lab-list">
{%- for svc in site.data.homelab.inventory.services %}
  <li>
    <span class="lab-key">{{ svc.name }}</span>
    <span class="lab-desc">{{ svc.note }}</span>
    <span class="lab-status" data-status="{{ svc.status }}">{{ svc.status }}</span>
  </li>
{%- endfor %}
</ul>
{% else %}
<p class="tty-out tty-dim lab-note">nothing here yet — the minis run agent sessions, they do not host anything</p>
{% endif %}

{% include tty-prompt.html cwd="~/lab" cmd="cat RULES" %}

<div class="tty-block lab-rules">
{%- for rule in site.data.homelab.inventory.house_rules %}
  <span class="tty-line tty-dim">{{ rule }}</span>
{%- endfor %}
</div>

{% include tty-prompt.html cwd="~/lab" cmd="git log --date=short STATUS.md" %}

<ol class="lab-log">
{%- for entry in site.data.homelab.changelog %}
  <li>
    <p class="lab-log-head"><span class="lab-log-date">{{ entry.date }}</span><span class="lab-log-title">{{ entry.title }}</span></p>
    <p class="lab-log-body">{{ entry.body }}</p>
    {%- if entry.delta %}
    <p class="lab-log-delta"><a href="{{ entry.delta | relative_url }}">what changed in the topology &rarr;</a></p>
    {%- endif %}
  </li>
{%- endfor %}
</ol>

<script src="{{ "/assets/lab.js" | relative_url }}" defer></script>
<script src="{{ "/assets/lab-status.js" | relative_url }}" defer></script>
