/*
 * The live band on /homelab/.
 *
 * The rest of the page is the inventory as a person wrote it down. This one
 * block is the lab as it is right now, read from /api/status — which the lab
 * pushes to and this page only ever reads.
 *
 * Three rules it tries hard to keep:
 *
 * 1. Never invent green. A subject nobody is currently reporting on is
 *    `unknown`, and so is everything on the page when the fetch itself fails.
 *    The failure mode of a status page is to look healthy while blind, and the
 *    only defence is to treat silence as its own state rather than as good
 *    news.
 * 2. Poll only while someone is looking. Same reasoning as the live view wall
 *    in the inventory: a background tab has no reader to serve, and every poll
 *    is a function invocation somebody pays for.
 * 3. Degrade to nothing. Without JavaScript the band renders one line of text
 *    saying where the live view is, and the hand-written page below is
 *    untouched and complete on its own.
 * 4. Show what is wrong, and count what is not. Two machines make eleven rows
 *    and four will make twenty, nearly all of them permanently green — and a
 *    list that is always green teaches the eye to skip the band, which is the
 *    same as having no band. So anything not `up` is a row, and everything
 *    that is collapses into one line you can open. Nothing is hidden; the
 *    healthy majority just stops competing with the exception for attention.
 */
(function () {
  var root = document.getElementById("lab-live");
  if (!root) return;

  var endpoint = root.getAttribute("data-endpoint");
  if (!endpoint) return;

  var POLL_MS = 15000;
  var BACKOFF_MAX_MS = 120000;
  var backoff = POLL_MS;
  var timer = null;
  var inFlight = false;

  var body = document.createElement("ul");
  body.className = "lab-live-grid";

  /* <details> rather than a button and a flag: the open/closed state is the
     element's own, so it survives every refresh without this file tracking it,
     and it is keyboard-reachable without any of that being written here. */
  var fine = document.createElement("details");
  fine.className = "lab-live-fine";
  var fineSummary = document.createElement("summary");
  var fineList = document.createElement("ul");
  fineList.className = "lab-live-grid";
  fine.appendChild(fineSummary);
  fine.appendChild(fineList);

  var foot = document.createElement("p");
  foot.className = "lab-live-foot tty-dim";
  root.textContent = "";
  root.appendChild(body);
  root.appendChild(fine);
  root.appendChild(foot);

  /* Seconds, as a terminal would print them: short, and never more precise
     than the number deserves. */
  function ago(s) {
    if (typeof s !== "number" || !isFinite(s)) return "";
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }

  /* Mirrors the endpoint's whitelist, in the order it should read. Event
     recency and event counts are absent from both on purpose — see the note in
     api/status.js: they describe the house, not the machines. */
  var DETAIL_LABELS = {
    last_upload_age_seconds: "last upload",
    rtsp_probe_ms: "rtsp",
    load1: "load",
    disk_used_percent: "disk",
    memory_used_percent: "mem",
    uptime_seconds: "up"
  };

  function detailText(d) {
    var parts = [];
    for (var k in DETAIL_LABELS) {
      if (!d || !(k in d)) continue;
      var v = d[k];
      if (k === "rtsp_probe_ms") parts.push("rtsp " + Math.round(v) + "ms");
      else if (k === "uptime_seconds") parts.push("up " + ago(v).replace(" ago", ""));
      else if (/_age_seconds$/.test(k)) parts.push(DETAIL_LABELS[k] + " " + ago(v));
      else if (/_percent$/.test(k)) parts.push(DETAIL_LABELS[k] + " " + Math.round(v) + "%");
      else parts.push(DETAIL_LABELS[k] + " " + v);
    }
    return parts.join("  ");
  }

  function row(subject) {
    var li = document.createElement("li");
    li.className = "lab-live-item";

    var name = document.createElement("span");
    name.className = "lab-live-id";
    name.textContent = subject.id;

    var state = document.createElement("span");
    state.className = "lab-status";
    state.setAttribute("data-status", subject.state);
    state.textContent = subject.state;

    var note = document.createElement("span");
    note.className = "lab-live-detail";
    /* Reporter-supplied text. textContent, always — this is the one string on
       the page that did not come out of the repo. */
    note.textContent = subject.note || detailText(subject.detail);

    var by = document.createElement("span");
    by.className = "lab-live-by";
    if (subject.observed_by) {
      by.textContent = "via " + subject.observed_by +
        (subject.observation_age_seconds != null ? " · " + ago(subject.observation_age_seconds) : "");
    }

    li.appendChild(name);
    li.appendChild(state);
    li.appendChild(note);
    li.appendChild(by);
    return li;
  }

  /* Worst first. `unknown` outranks `up` deliberately — not knowing is a thing
     to look at, and it is the state a subject takes when the only host that
     could see it went quiet. The endpoint returns them in id order and keeps
     doing so; ordering by how much attention a row deserves is a question
     about reading, which belongs here. */
  var RANK = { down: 3, degraded: 2, unknown: 1, up: 0 };

  function summaryText(list) {
    var names = list.map(function (s) { return s.id; });
    var shown = names.slice(0, 4).join(", ");
    if (names.length > 4) shown += ", +" + (names.length - 4) + " more";
    return list.length + " up · " + shown;
  }

  function render(data) {
    var subjects = (data.subjects || []).slice().sort(function (a, b) {
      var d = (RANK[b.state] || 0) - (RANK[a.state] || 0);
      return d || a.id.localeCompare(b.id);
    });
    var wrong = subjects.filter(function (s) { return s.state !== "up"; });
    var well = subjects.filter(function (s) { return s.state === "up"; });

    body.textContent = "";
    fineList.textContent = "";

    if (!subjects.length) {
      var li = document.createElement("li");
      li.className = "lab-live-item lab-live-empty";
      li.textContent = "no host is reporting yet — the agents that push this are not installed";
      body.appendChild(li);
      fine.hidden = true;
    } else {
      wrong.forEach(function (s) { body.appendChild(row(s)); });
      well.forEach(function (s) { fineList.appendChild(row(s)); });
      fine.hidden = well.length === 0;
      fineSummary.textContent = summaryText(well);
    }

    var reporters = (data.reporters || []).map(function (r) {
      return r.id + " " + r.state + " " + ago(r.age_seconds);
    });
    foot.textContent = reporters.length
      ? "reporters: " + reporters.join("  ·  ")
      : "no reporter has checked in";
  }

  /* Everything unknown, and said out loud. Used when the endpoint itself is
     unreachable, which from a reader's side is indistinguishable from the lab
     being off — so the page claims only what it can defend. */
  function blind(reason) {
    body.textContent = "";
    fine.hidden = true;
    var li = document.createElement("li");
    li.className = "lab-live-item lab-live-empty";
    li.textContent = "status is unreachable, so nothing below it is known";
    body.appendChild(li);
    foot.textContent = reason;
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  function tick() {
    if (document.hidden || inFlight) return;
    inFlight = true;
    fetch(endpoint, { headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("status " + r.status);
        return r.json();
      })
      .then(function (data) {
        render(data);
        backoff = POLL_MS;
      })
      .catch(function (e) {
        blind("could not reach " + endpoint + " — " + e.message);
        /* Back off rather than hammer: whatever is broken is not going to be
           fixed by asking again in fifteen seconds, and the reader can see
           that it is broken. */
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
      })
      .then(function () {
        inFlight = false;
        schedule(backoff);
      });
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) tick();
  });

  tick();
})();
