---
layout: page
title: Hikes
permalink: /hikes/
tty_cwd: ~/hikes
tty_cmd: atlas --tiles opentopomap
---

{%- assign H = site.data.hikes.outings -%}
{%- assign S = H.summary -%}

# Hikes

<p class="page-intro" markdown="1">
{{ S.outings }} days on trails between {{ S.first | slice: 0, 7 }} and {{ S.last | slice: 0, 7 }} — hikes and treks, backcountry ski, the odd trail run — rebuilt from {{ S.files }} GPX files that YAMAP, Strava and Yamareco recorded, drawn where they happened. <span class="hike-hike">Cyan</span> is a hike or trek, <span class="hike-ski">amber</span> a backcountry ski, <span class="hike-run">green</span> a trail run; a <span class="hike-fail">red</span> ring is a day that turned back short of the summit. Every row links to the record on the app that made it.
</p>

<p class="tty-dim lab-updated">last updated {{ H.updated_at }} · {{ S.hike }} hikes · {{ S.ski }} backcountry ski · {{ S.run }} trail run{% if S.run != 1 %}s{% endif %} · {{ S.hyaku_done }} of the 100 famous mountains</p>

<div class="hike-ctl" id="hike-ctl" hidden>
  <span class="hike-ctl-group"><span class="tty-dim">view:</span>
    <button type="button" data-view="tracks" aria-pressed="true">tracks</button>
    <button type="button" data-view="peaks" aria-pressed="false">peaks</button></span>
  <span class="hike-ctl-group"><span class="tty-dim">layers:</span>
    <button type="button" data-layer="hike" aria-pressed="true">hike</button>
    <button type="button" data-layer="ski" aria-pressed="true">backcountry ski</button>
    <button type="button" data-layer="run" aria-pressed="true">trail run</button>
    <button type="button" data-layer="hyaku" aria-pressed="false">100 famous mountains</button></span>
  <span class="hike-ctl-group"><span class="tty-dim">fit:</span>
    <button type="button" data-fit="japan">japan</button>
    <button type="button" data-fit="world">world</button></span>
</div>

<link rel="stylesheet" href="{{ "/assets/leaflet/leaflet.css" | relative_url }}">
<figure class="lab-pane hike-pane">
  <figcaption class="lab-pane-bar">
    <span class="lab-pane-file">tracks.json · {{ S.outings }} tracks · {{ S.files }} files</span>
    <a class="lab-pane-open" href="{{ "/assets/hikes/tracks.json" | relative_url }}">raw data &rarr;</a>
  </figcaption>
  <div class="hike-map" id="hike-map" data-src="{{ "/assets/hikes/tracks.json" | relative_url }}" role="region" aria-label="Map of every recorded outing"></div>
  <noscript>
    <p class="lab-pane-fallback">The map needs JavaScript; the list below is the same data without it.</p>
  </noscript>
</figure>

<p class="tty-out tty-dim lab-note">Map tiles come from OpenTopoMap and are the only thing on this site that is fetched from a third party; the tracks themselves are served from here. <a href="{{ "/privacy/" | relative_url }}">Privacy</a> says what that means.</p>

<div class="hike-row">
<div class="hike-sel">
{% include tty-prompt.html cwd="~/hikes" cmd="cat selected.gpx" %}
<div id="hike-selected" class="hike-selected">
  <p class="tty-out tty-dim">Click a track or a row.</p>
</div>
</div>
<div class="hike-list-wrap">
{% include tty-prompt.html cwd="~/hikes" cmd="ls -t" %}
<ol class="hike-list" id="hike-list">
{%- for o in H.outings %}
  <li data-id="{{ o.id }}" data-sport="{{ o.sport }}" data-region="{{ o.region }}">
    <span class="hike-date">{{ o.date }}</span>
    <span class="hike-name">{{ o.en }}</span>
    <span class="hike-m">{{ o.summit_m }} m</span>
    <span class="hike-sport hike-{{ o.sport }}">{% if o.sport == "ski" %}backcountry ski{% elsif o.sport == "run" %}trail run{% else %}hike{% endif %}</span>
    {%- if o.status == "turned back" %}<span class="hike-fail">turned back</span>{% endif %}
    <span class="hike-src">
    {%- for s in o.sources %}<a href="{{ o.links[s] }}" rel="noopener">[{{ s }}]</a>{% endfor -%}
    </span>
  </li>
{%- endfor %}
</ol>
</div>
</div>

{% include tty-prompt.html cwd="~/hikes" cmd="ls -l overseas/" comment="same files, same treatment; fit: world shows them" %}

<ol class="hike-list hike-list-short">
{%- for o in H.outings %}{% if o.region == "overseas" %}
  <li data-id="{{ o.id }}">
    <span class="hike-date">{{ o.date }}</span>
    <span class="hike-name">{{ o.en }}</span>
    <span class="hike-m">{{ o.summit_m }} m</span>
    <span class="hike-sport hike-{{ o.sport }}">{% if o.sport == "ski" %}backcountry ski{% elsif o.sport == "run" %}trail run{% else %}hike{% endif %}</span>
    <span class="hike-src">{% for s in o.sources %}<a href="{{ o.links[s] }}" rel="noopener">[{{ s }}]</a>{% endfor %}</span>
  </li>
{%- endif %}{% endfor %}
</ol>

{% include tty-prompt.html cwd="~/hikes" cmd="cat HYAKUMEIZAN.md" comment="Fukada's 100 famous mountains, which are done and which are left" %}

{%- assign peaks = site.data.hikes.hyakumeizan.peaks -%}
{%- assign remaining = 100 | minus: S.hyaku_done -%}
<p class="hike-progress"><span class="hike-progress-bar" aria-hidden="true">{% for p in peaks %}{% if H.hyaku[p.id] %}<span class="on">#</span>{% else %}<span class="off">.</span>{% endif %}{% endfor %}</span><br>
<span class="tty-dim">{{ S.hyaku_done }} done · {{ remaining }} to go · counted from the tracks: a track that passes within a kilometre of the summit and reaches its height. A day that turned back does not count.</span></p>

<h2>Done</h2>

<ol class="hike-list hike-list-short">
{%- for p in peaks %}{% if H.hyaku[p.id] %}
  <li data-id="{{ H.hyaku[p.id].outing }}">
    <span class="hike-date">{{ H.hyaku[p.id].date }}</span>
    <span class="hike-name">{{ p.en }}</span>
    <span class="hike-m">{{ p.m }} m</span>
    <span class="tty-dim">{{ p.region }}{% if H.hyaku[p.id].times > 1 %} · ×{{ H.hyaku[p.id].times }}{% endif %}</span>
  </li>
{%- endif %}{% endfor %}
</ol>

<h2>To go</h2>

{%- assign regions = "hokkaido,tohoku,joetsu,kanto,chubu,kansai,west,kyushu" | split: "," -%}
{%- for r in regions %}
{%- assign left = peaks | where: "region", r -%}
{%- assign todo = "" -%}
<ul class="hike-todo">
  <li class="hike-todo-region"><span class="tty-group">{{ r }}/</span></li>
{%- for p in left %}{% unless H.hyaku[p.id] %}
  <li><span class="hike-name hike-todo-name">{{ p.en }}</span><span class="hike-m">{{ p.m }} m</span>{% if p.note %}<span class="tty-dim hike-todo-note">{{ p.note }}</span>{% endif %}</li>
{%- endunless %}{% endfor %}
</ul>
{%- endfor %}

<script src="{{ "/assets/leaflet/leaflet.js" | relative_url }}" defer></script>
<script src="{{ "/assets/hikes.js" | relative_url }}" defer></script>
