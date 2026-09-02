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
not seconds — nothing here is scraped live, and nothing on this page is
reachable from outside the LAN.
</p>

<p class="tty-dim lab-updated">last updated {{ site.data.homelab.inventory.updated_at }}</p>

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

{% include tty-prompt.html cwd="~/lab" cmd="xdg-open topology/" %}

<nav class="tty-block" aria-label="Topology diagram">
  <a class="tty-trow" href="{{ "/homelab/topology/" | relative_url }}"><span class="tty-node">topology/</span><span class="tty-desc">The wiring, drawn from <code>spec/current.architecture.json</code> — pan, zoom, trace a link, or switch the theme.</span></a>
</nav>

<p class="tty-out tty-dim lab-note">{{ site.data.homelab.inventory.network.topology }}<br>
{{ site.data.homelab.inventory.network.disclosure }}</p>

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
    <p class="lab-log-delta"><a href="{{ entry.delta | relative_url }}">what changed in the topology →</a></p>
    {%- endif %}
  </li>
{%- endfor %}
</ol>
