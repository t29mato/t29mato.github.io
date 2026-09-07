/*
 * /api/status — the one live thing on this site.
 *
 * Everything else under /homelab/ is written by hand and ships with the
 * build. This endpoint exists because a page that reports a failure must not
 * be inside the thing that failed: if the status view were served from a mini,
 * "mini is down" would render as a connection timeout and nothing else.
 *
 * So the lab pushes, and this holds the last thing it said.
 *
 *   POST  a heartbeat from one reporter inside the lab. Bearer token.
 *   GET   the merged public view. No auth, no addresses.
 *
 * Nothing here reaches into the LAN, and the LAN opens no port to be reached
 * on — the only direction of travel is outward, which is what lets the house
 * rule about inbound connections stay true.
 *
 * Absence is the signal. A reporter that stops pushing goes `stale`, and
 * everything it was the sole observer of goes `unknown` — not `down`, because
 * a dead observer is not evidence about the thing observed. That distinction
 * is the whole point; a status page that prints `up` because nobody is left to
 * contradict it is worse than no status page.
 *
 * Environment (set in the Vercel project, not here):
 *   KV_REST_API_URL / KV_REST_API_TOKEN        Upstash REST credentials, as the
 *   or UPSTASH_REDIS_REST_URL / ..._TOKEN      Vercel integration and the
 *                                              Upstash console respectively
 *                                              name them. Either pair works.
 *   HOMELAB_INGEST_TOKEN                       the shared secret reporters send
 */

const BEAT_PREFIX = "beat:";

/* A beat is kept a good deal longer than it takes to go stale, so the page can
   say "mini-1, last seen 40 minutes ago" instead of forgetting it existed. */
const BEAT_TTL_SECONDS = 86400;

/* Stale at three missed beats rather than one: a single missed push is a
   scheduler jittering or a timer landing on a busy second, not an outage. */
const STALE_BEATS = 3;
const STALE_FLOOR_SECONDS = 90;

/* Ids are published as-is, so they are constrained to what the site already
   shows: mini-1, cam-2, pi-1. Anything else is dropped rather than printed. */
const ID = /^[a-z][a-z0-9-]{1,15}$/;

const KINDS = new Set(["host", "camera", "service", "link"]);
const STATES = new Set(["up", "down", "degraded", "unknown"]);

/*
 * What a reporter is allowed to publish about a subject.
 *
 * This is a whitelist and not a blocklist on purpose. The inventory's own
 * disclosure rule says addresses, hostnames and key material stay off the
 * site, and the way to keep that true is for the public endpoint to decide
 * what is publishable rather than to trust every agent that ever gets a token.
 * A reporter that starts sending `ip` publishes nothing new; it just gets the
 * field dropped.
 */
const DETAIL_NUMBERS = new Set([
  "last_upload_age_seconds",
  "rtsp_probe_ms",
  "load1",
  "disk_used_percent",
  "memory_used_percent",
  "uptime_seconds"
]);

/*
 * Two fields are deliberately not in that list: how long ago the last event
 * was, and how many there have been today.
 *
 * They are the obvious things to want, and they are the one thing on this
 * endpoint that would be about the house rather than about the machines. A
 * camera event is a person walking past a camera, so "last event 40s ago" on a
 * public URL is an occupancy sensor with a nice font, and a day of them is a
 * schedule. AGENTS.md has always said this page must not answer "is anyone
 * home right now"; publishing uptime and disk does not answer it, and event
 * recency answers nothing else.
 *
 * Nothing operational is lost. Events are sparse and their absence was never a
 * failure signal — a quiet camera is a quiet room. What proves the recording
 * chain is alive is last_upload_age_seconds and the RTSP probe, and both are
 * above.
 */

/*
 * The page that reads this is served from GitHub Pages and this function is
 * not, so every read is cross-origin and needs to say so. The GET payload is
 * the same public information the page renders, so `*` costs nothing: there is
 * no cookie, no session and nothing here that is not already on a public URL.
 *
 * It protects the write side not at all, and is not meant to — POST is guarded
 * by the bearer token, and comes from a script on a mini where CORS does not
 * apply in the first place.
 */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.STATUS_ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function bad(res, code, message) {
  res.status(code).json({ error: message });
}

/* Upstash's REST API takes a command as a JSON array. Keeping it to this one
   helper means there is no client library to pin, and no cold-start cost for
   the two commands this file actually uses. */
async function redis(command) {
  /* Two names for one thing: a database created through the Vercel
     marketplace arrives as KV_REST_API_*, and one created in the Upstash
     console as UPSTASH_REDIS_REST_*. Accepting both is a line of code; getting
     it wrong is a 500 that looks like the lab being down. */
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("KV credentials are not configured");

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  if (!r.ok) throw new Error(`KV responded ${r.status}`);
  const body = await r.json();
  if (body.error) throw new Error(body.error);
  return body.result;
}

function cleanSubject(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!ID.test(String(raw.id || ""))) return null;
  if (!KINDS.has(raw.kind)) return null;
  if (!STATES.has(raw.state)) return null;

  const out = { id: raw.id, kind: raw.kind, state: raw.state };

  /* One sentence, when the reporter has something to say that a state cannot
     carry — "node_exporter is not installed here", say. Truncated rather than
     rejected, and never rendered as markup by the page. */
  if (typeof raw.note === "string" && raw.note.trim()) {
    out.note = raw.note.trim().slice(0, 120);
  }

  const detail = {};
  for (const [k, v] of Object.entries(raw.detail || {})) {
    if (!DETAIL_NUMBERS.has(k)) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    detail[k] = Math.round(v * 100) / 100;
  }
  if (Object.keys(detail).length) out.detail = detail;

  return out;
}

async function ingest(req, res) {
  const expected = process.env.HOMELAB_INGEST_TOKEN;
  if (!expected) return bad(res, 503, "ingest is not configured");

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${expected}`) return bad(res, 401, "unauthorized");

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || !ID.test(String(body.reporter || ""))) {
    return bad(res, 400, "reporter must be an id like mini-1");
  }

  /* The reporter states its own cadence, and that is what staleness is judged
     against — pi-1 on a 30s timer and a mini on a 5m one should not need the
     same threshold, and hard-coding one here would mean editing this file
     every time a host changes its mind. */
  const interval = Number(body.interval_seconds);
  const subjects = Array.isArray(body.subjects)
    ? body.subjects.map(cleanSubject).filter(Boolean).slice(0, 32)
    : [];

  const beat = {
    reporter: body.reporter,
    interval_seconds: Number.isFinite(interval) ? Math.min(Math.max(interval, 5), 3600) : 60,
    received_at: new Date().toISOString(),
    subjects
  };

  await redis(["SET", BEAT_PREFIX + body.reporter, JSON.stringify(beat), "EX", String(BEAT_TTL_SECONDS)]);
  res.status(202).json({ ok: true, subjects: subjects.length });
}

async function view(req, res) {
  const keys = (await redis(["KEYS", BEAT_PREFIX + "*"])) || [];
  const raw = keys.length ? await redis(["MGET", ...keys]) : [];
  const now = Date.now();

  const reporters = [];
  const subjects = new Map();

  for (const entry of raw) {
    if (!entry) continue;
    let beat;
    try {
      beat = JSON.parse(entry);
    } catch (e) {
      continue;
    }

    const age = Math.max(0, Math.round((now - Date.parse(beat.received_at)) / 1000));
    const limit = Math.max(beat.interval_seconds * STALE_BEATS, STALE_FLOOR_SECONDS);
    const stale = age > limit;

    reporters.push({
      id: beat.reporter,
      state: stale ? "stale" : "reporting",
      age_seconds: age,
      interval_seconds: beat.interval_seconds
    });

    for (const s of beat.subjects) {
      /* A stale reporter's claims are demoted, not dropped: the subject stays
         on the page so a reader can see it is still expected, and its state
         becomes the honest one. */
      const state = stale ? "unknown" : s.state;
      const existing = subjects.get(s.id);

      /* Two reporters can watch the same camera — that is the point of having
         pi-1 probe it as well as the mini that records it. A live observation
         beats a stale one; between two live ones, the worse state wins, so a
         camera one host cannot reach is never painted green by the host that
         can. */
      const rank = { up: 0, degraded: 1, unknown: 2, down: 3 };
      if (!existing || rank[state] > rank[existing.state]) {
        subjects.set(s.id, {
          ...s,
          state,
          observed_by: beat.reporter,
          observation_age_seconds: age
        });
      }
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    stale_after_beats: STALE_BEATS,
    reporters: reporters.sort((a, b) => a.id.localeCompare(b.id)),
    subjects: [...subjects.values()].sort((a, b) => a.id.localeCompare(b.id))
  };

  /* Ten seconds of shared cache: the page polls every fifteen, so a handful of
     readers cost about what one does.

     The revalidation window is short on purpose. `age_seconds` is computed when
     the payload is generated, so a cached copy under-reports how long a
     reporter has been silent by exactly its own age — and staleness is the
     mechanism the whole endpoint rests on. At the 60s this started with, a
     reporter that died could still read as `reporting` for the 180s window plus
     70s of cache. Twenty seconds keeps the benefit for an unvisited page and
     bounds the lie. */
  res.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=20");
  res.status(200).json(payload);
}

module.exports = async function handler(req, res) {
  cors(res);
  try {
    if (req.method === "OPTIONS") return res.status(204).json(null);
    if (req.method === "POST") return await ingest(req, res);
    if (req.method === "GET") return await view(req, res);
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return bad(res, 405, "method not allowed");
  } catch (err) {
    /* The page treats a failed fetch as "unknown", which is the correct thing
       for it to show when this endpoint is the part that is broken. */
    return bad(res, 500, err.message || "status is unavailable");
  }
};
