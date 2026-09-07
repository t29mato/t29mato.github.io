/*
 * The map on /hikes/.
 *
 * Leaflet is vendored (assets/leaflet/), so the only requests that
 * leave this site are the OpenTopoMap basemap tiles. Everything else — tracks,
 * peaks, the 100 famous mountains — comes from assets/hikes/tracks.json,
 * written by _scripts/build-hikes.mjs.
 *
 * Colours are read from the site's own custom properties at draw time and
 * re-read when the theme toggle flips data-theme, so the map follows the
 * site instead of carrying a palette of its own.
 */
(function () {
  var mapEl = document.getElementById("hike-map");
  if (!mapEl || typeof L === "undefined") return;

  var root = document.documentElement;
  var ctl = document.getElementById("hike-ctl");
  var selEl = document.getElementById("hike-selected");
  var list = document.getElementById("hike-list");
  var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");

  function theme() {
    var set = root.getAttribute("data-theme");
    if (set === "dark" || set === "light") return set;
    return systemDark && systemDark.matches === false ? "light" : "dark";
  }
  function ink(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  var JAPAN = [[30.0, 128.5], [45.7, 146.0]];
  // OpenTopoMap: relief, contours, kanji and romaji labels, no key. The dark
  // theme is the same tiles through a filter (--tile-filter in main.scss),
  // so a theme flip repaints nothing but the vectors.
  var TILE = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";

  var map = L.map(mapEl, { zoomControl: false, attributionControl: true, worldCopyJump: true });
  map.attributionControl.setPrefix("");
  L.control.zoom({ position: "topleft" }).addTo(map);
  L.tileLayer(TILE, {
    subdomains: "abc", maxZoom: 17,
    attribution: 'map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, SRTM · style &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)'
  }).addTo(map);
  map.fitBounds(JAPAN);

  var state = { view: "tracks", layers: { hike: true, ski: true, run: true, hyaku: false }, selected: null };
  var data = null;
  var lines = {}, dots = {}, hyakuDots = [];

  function colorFor(o) {
    if (o.status === "turned back") return ink("--danger");
    return o.sport === "ski" ? ink("--amber") : o.sport === "run" ? ink("--green") : ink("--accent");
  }

  function draw() {
    Object.keys(lines).forEach(function (k) { map.removeLayer(lines[k]); map.removeLayer(dots[k]); });
    hyakuDots.forEach(function (d) { map.removeLayer(d); });
    lines = {}; dots = {}; hyakuDots = [];

    data.outings.forEach(function (o) {
      var c = colorFor(o), sel = state.selected === o.id;
      var on = state.layers[o.sport];
      var line = L.polyline(o.track, { color: c, weight: sel ? 4 : 2, opacity: sel ? 1 : 0.85 });
      var dot = L.circleMarker(o.peak || o.track[0], { radius: sel ? 7 : 5, color: c, weight: 2, fillColor: c, fillOpacity: o.status === "turned back" ? 0 : 0.9 });
      [line, dot].forEach(function (layer) {
        layer.bindTooltip(o.en + " · " + o.date, { direction: "top", className: "hike-tip" });
        layer.on("click", function () { select(o.id, false); });
      });
      // The line is the track; the dot is the high point, drawn in both views
      // so an outing is findable when the whole country is on screen.
      if (on && state.view === "tracks") line.addTo(map);
      if (on) {
        if (state.view === "tracks" && !sel && o.status !== "turned back") dot.setRadius(3.5);
        dot.addTo(map);
      }
      lines[o.id] = line; dots[o.id] = dot;
    });

    if (state.layers.hyaku) {
      var green = ink("--green"), dim = ink("--text-dim");
      data.hyaku.forEach(function (p) {
        var d = L.circleMarker([p.lat, p.lon], p.done
          ? { radius: 6, color: green, weight: 2, fillColor: green, fillOpacity: 0.9 }
          : { radius: 5, color: dim, weight: 1.5, fillOpacity: 0, dashArray: "2 2" });
        d.bindTooltip(p.en + " · " + p.m + " m" + (p.done ? " · " + p.done.date : " · to go"), { direction: "top", className: "hike-tip" });
        if (p.done) d.on("click", function () { select(p.done.outing, true); });
        d.addTo(map);
        hyakuDots.push(d);
      });
    }
  }

  function fmtHours(h) {
    if (h == null) return "";
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return hh + " h " + (mm < 10 ? "0" : "") + mm + " min";
  }

  function profileSvg(o) {
    var p = o.profile || [];
    if (p.length < 2) return "";
    var W = 420, H = 120, L_ = 44, R_ = 10, T = 18, B = 22;
    var lo = Math.min.apply(null, p), hi = Math.max.apply(null, p);
    var span = Math.max(1, hi - lo);
    var x = function (i) { return L_ + (i / (p.length - 1)) * (W - L_ - R_); };
    var y = function (v) { return T + (1 - (v - lo) / span) * (H - T - B); };
    var d = p.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
    var area = d + " L" + x(p.length - 1).toFixed(1) + " " + (H - B) + " L" + x(0).toFixed(1) + " " + (H - B) + " Z";
    var peakI = p.indexOf(hi);
    var c = colorFor(o);
    return '<svg class="hike-profile" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Elevation profile, ' + lo + ' to ' + hi + ' metres">' +
      '<line x1="' + L_ + '" x2="' + (W - R_) + '" y1="' + y(hi).toFixed(1) + '" y2="' + y(hi).toFixed(1) + '" class="grid"/>' +
      '<line x1="' + L_ + '" x2="' + (W - R_) + '" y1="' + (H - B) + '" y2="' + (H - B) + '" class="grid"/>' +
      '<path d="' + area + '" fill="' + c + '" opacity="0.18"/>' +
      '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="' + x(peakI).toFixed(1) + '" cy="' + y(hi).toFixed(1) + '" r="3" fill="' + c + '"/>' +
      '<text x="' + (L_ - 6) + '" y="' + (y(hi) + 4).toFixed(1) + '" text-anchor="end">' + hi + '</text>' +
      '<text x="' + (L_ - 6) + '" y="' + (H - B + 4) + '" text-anchor="end">' + lo + '</text>' +
      '<text x="' + L_ + '" y="' + (H - 6) + '">0</text>' +
      '<text x="' + (W - R_) + '" y="' + (H - 6) + '" text-anchor="end">' + o.km + ' km</text>' +
      '</svg>';
  }

  function select(id, fly) {
    var o = null;
    data.outings.forEach(function (x) { if (x.id === id) o = x; });
    if (!o) return;
    state.selected = id;
    draw();
    if (fly) map.fitBounds(L.latLngBounds(o.track), { padding: [30, 30], maxZoom: 13 });
    var srcs = o.sources.map(function (s) { return '<a href="' + o.links[s] + '" target="_blank" rel="noopener">[' + s + ']</a>'; }).join(" ");
    selEl.innerHTML =
      '<p class="hike-sel-head"><span class="hike-date">' + o.date + '</span> <span class="hike-name">' + o.en + '</span> ' +
      '<span class="hike-sport hike-' + o.sport + '">' + (o.sport === "ski" ? "backcountry ski" : o.sport === "run" ? "trail run" : "hike") + '</span> ' +
      (o.status === "turned back" ? '<span class="hike-fail">turned back</span> ' : "") +
      '<span class="hike-src">' + srcs + '</span></p>' +
      profileSvg(o) +
      // Joined rather than concatenated: a Yamareco export can carry no <time>
      // at all, and a bare fmtHours("") used to leave a separator with nothing
      // on either side of it.
      '<p class="tty-dim hike-sel-stats">' + [
        o.km + ' km', '+' + o.gain + ' m', fmtHours(o.hours),
        o.max_ele ? 'high point ' + o.max_ele + ' m' : "",
        o.peaks.length ? '100 famous: ' + o.peaks.join(", ") : ""
      ].filter(Boolean).join(' · ') + '</p>';
    document.querySelectorAll(".hike-list li").forEach(function (li) {
      li.classList.toggle("cur", li.getAttribute("data-id") === id);
    });
    if (history.replaceState) history.replaceState(null, "", "#" + id);
  }

  // "japan" fits the outings inside Japan, not the archipelago: the point is
  // to see the tracks, and a frame from Okinawa to Etorofu makes them dust.
  function fit(which) {
    var pts = [];
    data.outings.forEach(function (o) { if (o.peak && (which === "world" || o.region !== "overseas")) pts.push(o.peak); });
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 9 });
    else map.fitBounds(JAPAN);
  }

  function wireControls() {
    ctl.hidden = false;
    ctl.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-view")) {
        state.view = b.getAttribute("data-view");
        ctl.querySelectorAll("[data-view]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        draw();
      } else if (b.hasAttribute("data-layer")) {
        var k = b.getAttribute("data-layer");
        state.layers[k] = !state.layers[k];
        b.setAttribute("aria-pressed", state.layers[k] ? "true" : "false");
        draw();
      } else if (b.hasAttribute("data-fit")) {
        fit(b.getAttribute("data-fit"));
      }
    });
    document.querySelectorAll(".hike-list li[data-id]").forEach(function (li) {
      li.setAttribute("tabindex", "0");
      li.addEventListener("click", function (e) {
        if (e.target.closest("a")) return;
        select(li.getAttribute("data-id"), true);
      });
      li.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(li.getAttribute("data-id"), true); }
      });
    });
  }

  fetch(mapEl.getAttribute("data-src"))
    .then(function (r) { return r.json(); })
    .then(function (json) {
      data = json;
      wireControls();
      draw();
      var hash = decodeURIComponent(location.hash.slice(1));
      if (hash) select(hash, true);
      else fit("japan");
    })
    .catch(function () {
      mapEl.innerHTML = '<p class="lab-pane-fallback">Could not load tracks.json.</p>';
    });

  // Follow the site toggle: the tiles are filtered by CSS, the vectors are repainted.
  function sync() { if (data) draw(); }
  if (window.MutationObserver) {
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }
  if (systemDark && systemDark.addEventListener) {
    systemDark.addEventListener("change", function () { if (!root.getAttribute("data-theme")) sync(); });
  }
})();
