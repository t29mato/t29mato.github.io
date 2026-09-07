#!/usr/bin/env node
/*
 * Build the data behind /hikes/ from the raw GPX exports.
 *
 *   node _scripts/build-hikes.mjs            # reads _gpx/{yamap,strava,yamareco}/*.gpx
 *
 * Writes:
 *   _data/hikes/outings.json     the index Liquid renders (never served itself)
 *   assets/hikes/tracks.json     what the map fetches: simplified tracks + the 100 peaks
 *
 * Reads:
 *   _data/hikes/names.json       peak keyword -> English name (+ summit height)
 *   _data/hikes/hyakumeizan.json the 100 famous mountains, with approximate summit points
 *   _data/hikes/overrides.json   optional per-outing corrections (sport, en, status)
 *
 * File names carry the facts: every export is {date}_{title}_{id}.gpx, and the
 * Strava ones are {date}_{Hike|BCSki}_{title}_{id}.gpx. The title inside the
 * GPX is usually just "track", so the file name is the source of truth for
 * the name and the id, and the id is what the service links are built from.
 *
 * No dependencies. Runs in a few seconds over ~130 files.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const RAW = path.join(ROOT, "_gpx");
const DATA = path.join(ROOT, "_data", "hikes");
const OUT_INDEX = path.join(DATA, "outings.json");
const OUT_TRACKS = path.join(ROOT, "assets", "hikes", "tracks.json");

const names = JSON.parse(fs.readFileSync(path.join(DATA, "names.json"), "utf8")).peaks;
const hyaku = JSON.parse(fs.readFileSync(path.join(DATA, "hyakumeizan.json"), "utf8")).peaks;
const overridesPath = path.join(DATA, "overrides.json");
const overrides = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, "utf8")) : {};

const SOURCES = ["yamap", "strava", "yamareco"];
const LINK = {
  strava: (id) => `https://www.strava.com/activities/${id}`,
  yamareco: (id) => `https://www.yamareco.com/modules/yamareco/detail-${id}.html`,
  yamap: (id) => `https://yamap.com/activities/${id}`
};

// ---------------------------------------------------------------- geometry
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Ramer–Douglas–Peucker on [lat, lon] with a tolerance in degrees (planar is
// fine at this scale: 0.00012° is about 13 m).
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const k = Math.cos(rad(pts[0][0])); // lon scale
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][1] * k, ay = pts[a][0], bx = pts[b][1] * k, by = pts[b][0];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let best = -1, bestD = 0;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][1] * k, py = pts[i][0];
      let d;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && bestD > tol) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------- parsing
const TRKPT = /<trkpt\s+lat="(-?[\d.]+)"\s+lon="(-?[\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
function parseGpx(text) {
  const pts = [];
  let m;
  while ((m = TRKPT.exec(text))) {
    const body = m[3];
    const ele = /<ele>(-?[\d.]+)<\/ele>/.exec(body);
    const time = /<time>([^<]+)<\/time>/.exec(body);
    pts.push([+m[1], +m[2], ele ? +ele[1] : null, time ? Date.parse(time[1]) : null]);
  }
  const type = /<type>([^<]+)<\/type>/.exec(text);
  return { pts, type: type ? type[1] : null };
}

function parseName(source, file) {
  const m = /^(\d{4}-\d{2}-\d{2})_(.+)_(\d+)\.gpx$/.exec(file);
  if (!m) return null;
  let title = m[2], type = null;
  if (source === "strava") {
    const t = /^(Hike|BCSki|Run)_(.+)$/.exec(title);
    if (t) { type = t[1]; title = t[2]; }
  }
  return { date: m[1], title, id: m[3], type };
}

function stats(pts) {
  let dist = 0, gain = 0, maxEle = -Infinity, minEle = Infinity, peak = null;
  let last = null, lastEle = null;
  for (const p of pts) {
    if (last) {
      const d = haversine(last, p);
      if (d < 500) dist += d; // a jump of half a kilometre between fixes is a glitch, not walking
    }
    last = p;
    if (p[2] != null) {
      if (p[2] > maxEle) { maxEle = p[2]; peak = [p[0], p[1]]; }
      if (p[2] < minEle) minEle = p[2];
      // 5 m hysteresis so GPS jitter does not count as climbing
      if (lastEle == null) lastEle = p[2];
      else if (p[2] - lastEle >= 5) { gain += p[2] - lastEle; lastEle = p[2]; }
      else if (lastEle - p[2] >= 5) lastEle = p[2];
    }
  }
  const times = pts.map((p) => p[3]).filter((t) => t != null);
  const hours = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3.6e6 : null;
  const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
  return {
    km: +(dist / 1000).toFixed(1),
    gain: Math.round(gain),
    max_ele: maxEle === -Infinity ? null : Math.round(maxEle),
    min_ele: minEle === Infinity ? null : Math.round(minEle),
    hours: hours == null ? null : +hours.toFixed(1),
    peak,
    bbox: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)],
    centroid: [lats.reduce((a, b) => a + b, 0) / lats.length, lons.reduce((a, b) => a + b, 0) / lons.length]
  };
}

// 64 elevation samples spaced by distance, for the profile under the map.
function profile(pts, n = 64) {
  const withEle = pts.filter((p) => p[2] != null);
  if (withEle.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < withEle.length; i++) cum.push(cum[i - 1] + Math.min(500, haversine(withEle[i - 1], withEle[i])));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < cum.length - 1 && cum[j + 1] < target) j++;
    out.push(Math.round(withEle[j][2]));
  }
  return out;
}

function minDistToTrack(pts, lat, lon) {
  let best = Infinity;
  const step = Math.max(1, Math.floor(pts.length / 4000));
  for (let i = 0; i < pts.length; i += step) {
    const d = haversine(pts[i], [lat, lon]);
    if (d < best) best = d;
  }
  return best;
}

function region(c) {
  const [lat, lon] = c;
  if (lat < 24 || lat > 46 || lon < 122 || lon > 147) return "overseas";
  if (lat >= 41.3) return "hokkaido";
  if (lat >= 37.4 && lon >= 139.3) return "tohoku";
  if (lat >= 36.7 && lon >= 138.4 && lon <= 139.5 && lat < 37.5) return "joetsu";
  if (lon >= 138.6) return "kanto";
  if (lon >= 136.5) return "chubu";
  if (lon >= 135) return "kansai";
  return "west";
}

// The highest known peak named in a title wins; ASCII keywords match
// case-insensitively so "azumaya san" and "Mt. Nasudake" resolve too.
function resolveName(title) {
  let best = null;
  for (const [kw, v] of Object.entries(names)) {
    const hit = /^[\x00-\x7f]+$/.test(kw) ? title.toLowerCase().includes(kw.toLowerCase()) : title.includes(kw);
    if (hit && (!best || v.m > best.m)) best = { kw, ...v };
  }
  return best;
}

// ---------------------------------------------------------------- read everything
const files = [];
for (const source of SOURCES) {
  const dir = path.join(RAW, source);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".gpx")).sort()) {
    const meta = parseName(source, file);
    if (!meta) { console.warn(`skip (name pattern): ${source}/${file}`); continue; }
    const { pts, type } = parseGpx(fs.readFileSync(path.join(dir, file), "utf8"));
    if (pts.length < 10) { console.warn(`skip (${pts.length} points): ${source}/${file}`); continue; }
    files.push({ source, file, ...meta, gpxType: type, pts, st: stats(pts) });
  }
}
if (!files.length) { console.error("no GPX files under _gpx/"); process.exit(1); }

// ---------------------------------------------------------------- dedup into outings
// Same day and centroids within 8 km → one outing recorded by several apps
// (or split into several Strava files). Otherwise a separate outing.
const outings = [];
for (const f of files) {
  let home = outings.find((o) => o.date === f.date && haversine(o.centroid, f.st.centroid) < 8000);
  if (!home) { home = { date: f.date, centroid: f.st.centroid, files: [] }; outings.push(home); }
  home.files.push(f);
}
outings.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const unnamed = [], guessed = [];
const built = outings.map((o) => {
  // Primary track: the file with the most points (a merged Strava upload beats a split one).
  const primary = o.files.reduce((a, b) => (b.pts.length > a.pts.length ? b : a));
  const titles = o.files.map((f) => f.title);
  const named = o.files.map((f) => resolveName(f.title)).filter(Boolean);
  const name = named.length ? named.reduce((a, b) => (b.m > a.m ? b : a)) : null;
  const id = `${o.date}_${primary.source}_${primary.id}`;
  const ov = overrides[id] || overrides[o.date] || {};

  const st = primary.st;
  const reg = region(st.centroid);
  const turnedBack = titles.some((t) => /撤退|turned back/i.test(t));

  // Sport: Strava's own type when present, a BC/ski word in a title, else a
  // seasonal guess that the report lists for correction.
  let sport = null, sportSource = "strava";
  const stravaType = o.files.map((f) => f.type || f.gpxType).find(Boolean);
  if (stravaType) sport = /ski/i.test(stravaType) ? "ski" : "hike";
  else if (titles.some((t) => /BC|スキー|ski/i.test(t))) { sport = "ski"; sportSource = "title"; }
  else {
    const month = +o.date.slice(5, 7);
    sport = month <= 4 || month === 12 ? "ski" : "hike";
    sportSource = "guess";
    if (sport === "ski") guessed.push(`${id}  ${titles.join(" / ")}`);
  }
  if (ov.sport) { sport = ov.sport; sportSource = "override"; }

  let en = ov.en || (name ? name.en : null);
  if (!en) {
    const ascii = titles.find((t) => /^[\x00-\x7f]+$/.test(t) && !/^(NO NAME|track)$/i.test(t));
    en = ascii ? ascii.replace(/\s+\d+$/, "") : "Unnamed outing";
    if (!ascii) unnamed.push(`${id}  ${titles.join(" / ")}`);
  }

  const status = ov.status || (turnedBack ? "turned back" : "summited");
  const links = {};
  const sources = [];
  for (const f of o.files) { if (!links[f.source]) { links[f.source] = LINK[f.source](f.id); sources.push(f.source); } }

  // Hyakumeizan: the track has to pass within a kilometre of the summit point
  // and get within 300 m of its height. A name match alone widens the radius
  // (the summit points here are approximate) but never overrides a turnback.
  const peaks = [];
  if (status !== "turned back") {
    for (const p of hyaku) {
      const d = minDistToTrack(primary.pts, p.lat, p.lon);
      const nameHit = named.some((n) => n.hyaku === p.id) || titles.some((t) => (p.aliases || []).concat(p.jp).some((a) => t.includes(a)));
      const closeEnough = d < 500 || (nameHit && d < 2500);
      const highEnough = st.max_ele != null && st.max_ele >= p.m - 150;
      if (closeEnough && highEnough) peaks.push({ id: p.id, d: Math.round(d) });
    }
  }

  const simp = simplify(primary.pts.map((p) => [p[0], p[1]]), 0.00012);
  const stride = Math.max(1, Math.ceil(simp.length / 600));
  const track = simp.filter((_, i) => i % stride === 0 || i === simp.length - 1).map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]);

  return {
    id, date: o.date, en, jp: primary.title, sport, sport_source: sportSource, status,
    region: reg,
    summit_m: name ? name.m : st.max_ele,
    max_ele: st.max_ele, km: st.km, gain: st.gain, hours: st.hours,
    points: primary.pts.length, files: o.files.length,
    sources, links,
    peaks: peaks.map((p) => p.id),
    peak_dist: Object.fromEntries(peaks.map((p) => [p.id, p.d])),
    peak: st.peak ? [+st.peak[0].toFixed(5), +st.peak[1].toFixed(5)] : null,
    bbox: st.bbox.map((v) => +v.toFixed(4)),
    profile: profile(primary.pts),
    track
  };
});

// One outing per (peak, first date) for the checklist; later repeats are listed too.
const done = {};
for (const o of built) for (const pid of o.peaks) {
  if (!done[pid]) done[pid] = { date: o.date, outing: o.id, times: 0 };
  done[pid].times += 1;
}

const counts = {};
for (const f of files) counts[f.source] = (counts[f.source] || 0) + 1;
const summary = {
  outings: built.length, files: files.length, sources: counts,
  first: built[0].date, last: built[built.length - 1].date,
  hike: built.filter((o) => o.sport === "hike").length,
  ski: built.filter((o) => o.sport === "ski").length,
  turned_back: built.filter((o) => o.status === "turned back").length,
  overseas: built.filter((o) => o.region === "overseas").length,
  hyaku_done: Object.keys(done).length
};

fs.mkdirSync(path.dirname(OUT_TRACKS), { recursive: true });
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(OUT_INDEX, JSON.stringify({
  updated_at: today, summary,
  hyaku: done,
  outings: built.map(({ track, ...rest }) => rest).reverse()
}, null, 1));
fs.writeFileSync(OUT_TRACKS, JSON.stringify({
  updated_at: today,
  outings: built.map((o) => ({ id: o.id, date: o.date, en: o.en, sport: o.sport, status: o.status, region: o.region, summit_m: o.summit_m, km: o.km, gain: o.gain, hours: o.hours, max_ele: o.max_ele, sources: o.sources, links: o.links, peaks: o.peaks, peak: o.peak, profile: o.profile, track: o.track })),
  hyaku: hyaku.map((p) => ({ id: p.id, jp: p.jp, en: p.en, m: p.m, lat: p.lat, lon: p.lon, region: p.region, done: done[p.id] || null }))
}));

console.log(`${files.length} files -> ${built.length} outings; ${summary.hike} hike / ${summary.ski} backcountry ski; ${summary.turned_back} turned back; ${summary.overseas} overseas; hyakumeizan ${summary.hyaku_done}/100`);
console.log(`tracks.json ${(fs.statSync(OUT_TRACKS).size / 1024).toFixed(0)} KB`);
if (unnamed.length) console.log(`\nUNNAMED (add a keyword to names.json or an override):\n  ${unnamed.join("\n  ")}`);
if (guessed.length) console.log(`\nSPORT GUESSED as backcountry ski from the month (confirm or override):\n  ${guessed.join("\n  ")}`);
const far = built.flatMap((o) => Object.entries(o.peak_dist).filter(([, d]) => d > 800).map(([p, d]) => `${o.id} ${p} ${d} m`));
if (far.length) console.log(`\nPEAK MATCHED BY NAME BUT >800 m FROM THE SUMMIT POINT (fix the coordinate in hyakumeizan.json):\n  ${far.join("\n  ")}`);
