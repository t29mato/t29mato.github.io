// tmux からくり屋敷: run records. Every run is kept (up to a cap per course), with
// the seconds each question took, so a player can see how far they have
// come. No DOM here: app.js draws, and a share card can reuse a run as is.
(function () {
  'use strict';

  var LV = ADV.levels;
  var STORE_KEY = 'tmux-da';
  var SCHEMA = 3, CAP = 100, HARD_CAP = 200;

  function recordKey(id) { return 'tmux:' + id; }
  function courseOf(id) {
    if (id === LV.KEIKO.id) return LV.KEIKO;
    return LV.COURSES.filter(function (c) { return c.id === id; })[0] || null;
  }

  function read() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function write(all) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(all));
      return;
    } catch (e) { /* fall through: try once without the per-question logs */ }
    try {
      all.runs = all.runs.map(function (r) { var c = {}; for (var k in r) if (k !== 'qs') c[k] = r[k]; c.qs = []; return c; });
      window.localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (e2) { /* storage is a convenience, not a requirement */ }
  }

  // Old saves kept only a best time per course. Each becomes one run, marked
  // legacy, so the history starts from it instead of from nothing. Schema 2
  // runs carry the old game's rank titles; schema 3 renames them.
  function migrate(all) {
    if (all.schema === SCHEMA && Array.isArray(all.runs)) return false;
    all.arena = all.arena || {};
    var hadRuns = Array.isArray(all.runs);
    all.runs = hadRuns ? all.runs : [];
    all.runs.forEach(function (r) { if (LV.OLD_RANKS[r.rank]) r.rank = LV.OLD_RANKS[r.rank]; });
    if (hadRuns) { all.schema = SCHEMA; return true; }
    Object.keys(all.arena).forEach(function (key) {
      var id = key.replace(/^tmux:/, ''), c = courseOf(id), b = all.arena[key];
      if (!c || !b || typeof b.time !== 'number') return;
      var n = c.qs.length;
      all.runs.unshift({
        id: 'legacy_' + id, course: id, ver: 1,
        at: (b.date || '2026-01-01') + 'T00:00:00Z',
        prefix: all.prefix || 'C-b',
        time: b.time, raw: null, misses: b.misses || 0, timeouts: 0, keys: null, n: n,
        rank: LV.rankFor(b.time / n, c.rankMul), rec: true, legacy: true, qs: []
      });
      b.runId = 'legacy_' + id;
      b.ver = 1;
    });
    all.schema = SCHEMA;
    return true;
  }

  function load() {
    var all = read();
    if (migrate(all)) write(all);
    return all;
  }

  function newId() {
    return 'r_' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  // Oldest first within a course; records are kept up to HARD_CAP.
  function prune(runs, course) {
    var mine = runs.filter(function (r) { return r.course === course; });
    var drop = {};
    var extra = mine.length - CAP;
    for (var i = 0; i < mine.length && extra > 0; i++) {
      if (!mine[i].rec) { drop[mine[i].id] = 1; extra--; }
    }
    var left = mine.filter(function (r) { return !drop[r.id]; });
    for (var j = 0; j < left.length - HARD_CAP; j++) drop[left[j].id] = 1;
    return runs.filter(function (r) { return !drop[r.id]; });
  }

  function runsOf(course, all) {
    all = all || load();
    return (all.runs || []).filter(function (r) { return r.course === course; }).reverse();
  }

  function best(course, all) {
    all = all || load();
    return (all.arena || {})[recordKey(course)] || null;
  }

  // Add one finished run. Returns what the result screen needs to say.
  function add(run) {
    var all = load();
    var c = courseOf(run.course);
    var prevRuns = runsOf(run.course, all);
    var prevBest = best(run.course, all);
    var skillFrom = skill(all), learntFrom = learnt();
    run.id = run.id || newId();
    run.ver = c ? c.ver : 1;
    run.at = run.at || new Date().toISOString();
    run.rank = LV.rankFor(run.time / run.n, c && c.rankMul);
    run.rec = !prevBest || run.time < prevBest.time;
    all.runs.push(run);
    if (run.rec) {
      all.arena[recordKey(run.course)] = { time: run.time, misses: run.misses, date: run.at.slice(0, 10), runId: run.id, ver: run.ver };
    }
    all.runs = prune(all.runs, run.course);
    write(all);
    var sum = summarize(run, prevRuns, prevBest);
    // What this run changed in the long run: the 腕前 and what is learnt.
    var learntNow = learnt();
    sum.skillFrom = skillFrom;
    sum.skill = skill();
    sum.learntNew = Object.keys(learntNow).filter(function (t) { return learntNow[t].learnt && !(learntFrom[t] && learntFrom[t].learnt); });
    sum.learntLost = Object.keys(learntFrom).filter(function (t) { return learntFrom[t].learnt && !(learntNow[t] && learntNow[t].learnt); });
    return sum;
  }

  function rankIndex(title) {
    for (var i = 0; i < LV.RANKS.length; i++) if (LV.RANKS[i].title === title) return i;
    return LV.RANKS.length;
  }

  function summarize(run, prevRuns, prevBest) {
    var c = courseOf(run.course);
    var prev = prevRuns[0] || null;
    var bestRank = null;
    prevRuns.forEach(function (r) { if (bestRank == null || rankIndex(r.rank) < rankIndex(bestRank)) bestRank = r.rank; });
    var par = c ? LV.par(c, run.n) : null;
    var parBefore = prevRuns.some(function (r) { return par != null && r.time <= par; });
    var spark = prevRuns.slice(0, 9).reverse().concat([run]).map(function (r) { return { time: r.time, rec: !!r.rec }; });
    var ao5 = function (list) { return list.length >= 5 ? list.slice(0, 5).reduce(function (s, r) { return s + r.time; }, 0) / 5 : null; };
    return {
      runId: run.id,
      count: prevRuns.length + 1,
      prev: prev ? prev.time : null,
      delta: prev ? run.time - prev.time : null,
      best: prevBest ? prevBest.time : null,
      bestDelta: prevBest ? run.time - prevBest.time : null,
      record: run.rec,
      rank: run.rank,
      rankFrom: bestRank,
      rankUp: bestRank != null && rankIndex(run.rank) < rankIndex(bestRank),
      par: par,
      parMet: par != null && run.time <= par,
      parFirst: par != null && run.time <= par && !parBefore,
      spark: spark,
      ao5: ao5([run].concat(prevRuns)),
      ao5Prev: ao5(prevRuns)
    };
  }

  function stats(course) {
    var all = load();
    var runs = runsOf(course, all);
    if (!runs.length) return null;
    var first = runs[runs.length - 1], last = runs[0];
    var recent = runs.slice(0, 5);
    var b = best(course, all);
    return {
      count: runs.length,
      best: b ? b.time : null,
      bestRank: b ? LV.rankFor(b.time / first.n, courseOf(course) && courseOf(course).rankMul) : null,
      first: first, last: last,
      recentAvg: recent.reduce(function (s, r) { return s + r.time; }, 0) / recent.length,
      runs: runs
    };
  }

  // Per question type over the latest n runs that logged questions. `o` marks
  // a question that ran past its 目安, `g` one where the 指南 came out; `to`
  // is a timeout from the old rules, counted at the limit.
  function weakness(course, n) {
    var c = courseOf(course);
    var runs = runsOf(course).filter(function (r) { return r.qs && r.qs.length; }).slice(0, n || 10);
    if (runs.length < 2) return null;
    var by = {}, total = 0, count = 0;
    runs.forEach(function (r) {
      r.qs.forEach(function (q) {
        var s = q.to ? (c ? c.limit : 10) : q.s;
        if (s == null) return;
        var e = by[q.t] || (by[q.t] = { type: q.t, sum: 0, n: 0, m: 0, overs: 0, guides: 0 });
        e.sum += s; e.n += 1; e.m += q.m || 0; e.overs += (q.o || q.to) ? 1 : 0; e.guides += q.g ? 1 : 0;
        total += s; count += 1;
      });
    });
    var mean = count ? total / count : 0;
    var list = Object.keys(by).map(function (k) {
      var e = by[k];
      return { type: e.type, avg: e.sum / e.n, missRate: e.m / e.n, overs: e.overs, guides: e.guides, n: e.n, ratio: mean ? (e.sum / e.n) / mean : 1 };
    }).filter(function (e) { return e.n >= 2; });
    list.sort(function (a, b) { return b.ratio - a.ratio; });
    return { runs: runs.length, mean: mean, weak: list.slice(0, 3), strong: list.length > 3 ? list[list.length - 1] : null };
  }

  // ---- learning, across every course -----------------------------------------

  // Every logged question, oldest first, with the 目安 of its course.
  function allQuestions() {
    var out = [];
    (load().runs || []).forEach(function (r) {
      var c = courseOf(r.course);
      if (!c || !r.qs) return;
      r.qs.forEach(function (q) { if (q && q.t && typeof q.s === 'number') out.push({ t: q.t, s: q.s, m: q.m || 0, o: !!(q.o || q.to), limit: c.limit }); });
    });
    return out;
  }

  // Per question type: how many clean solves in a row (within the 目安, no
  // wrong key) up to now, and whether that makes it learnt.
  function learnt() {
    var by = {};
    allQuestions().forEach(function (q) {
      var e = by[q.t] || (by[q.t] = { streak: 0, seen: 0 });
      e.seen += 1;
      e.streak = !q.o && !q.m && q.s <= q.limit ? e.streak + 1 : 0;
    });
    Object.keys(by).forEach(function (k) { by[k].learnt = by[k].streak >= LV.LEARNT_AFTER; });
    return by;
  }

  // The question types to practise: slowest relative to the others over the
  // latest 60 logged questions, then most 灯り. At most `n`.
  function weakTypes(n) {
    var qs = allQuestions().slice(-60);
    if (qs.length < 5) return [];
    var by = {}, total = 0;
    qs.forEach(function (q) {
      var rel = q.s / q.limit;
      var e = by[q.t] || (by[q.t] = { type: q.t, sum: 0, n: 0, overs: 0 });
      e.sum += rel; e.n += 1; e.overs += q.o ? 1 : 0; total += rel;
    });
    var mean = total / qs.length;
    var list = Object.keys(by).map(function (k) { var e = by[k]; return { type: e.type, score: e.sum / e.n / mean + e.overs / e.n, n: e.n }; });
    list.sort(function (a, b) { return b.score - a.score; });
    return list.slice(0, n || 3).map(function (e) { return e.type; });
  }

  // 腕前: the pace of the latest five runs on the three houses (seconds per
  // question, after penalties, over rankMul), its level and the next one.
  function skill(all) {
    all = all || load();
    var runs = (all.runs || []).filter(function (r) { var c = courseOf(r.course); return c && !c.practice && !r.legacy && r.n; }).slice(-5);
    if (!runs.length) return null;
    var pace = runs.reduce(function (s, r) { return s + r.time / r.n / (courseOf(r.course).rankMul || 1); }, 0) / runs.length;
    var lv = LV.levelFor(pace);
    var next = lv < LV.LV_MAX ? LV.paceFor(lv + 1) : null;
    return { pace: pace, lv: lv, title: LV.rankFor(pace), runs: runs.length, next: next, toNext: next != null ? pace - next : null };
  }

  // The best time of each day for a course, oldest first.
  function dailyBest(course) {
    var by = {};
    runsOf(course).forEach(function (r) {
      var d = LV.dayKey(new Date(r.at));
      if (!by[d] || r.time < by[d]) by[d] = r.time;
    });
    return Object.keys(by).sort().map(function (d) { return { day: d, time: by[d] }; });
  }

  // Runs from another device (through the 合言葉) join the history. The
  // record marks and bests are worked out again in the order runs were made.
  // Returns how many runs were new here.
  function merge(runs) {
    var all = load();
    var have = {};
    all.runs.forEach(function (r) { have[r.id] = 1; });
    var added = 0;
    (runs || []).forEach(function (r) {
      if (!r || typeof r.id !== 'string' || have[r.id] || !courseOf(r.course) || typeof r.time !== 'number') return;
      have[r.id] = 1;
      all.runs.push(r);
      added++;
    });
    if (!added) return 0;
    all.runs.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    all.arena = {};
    all.runs.forEach(function (r) {
      var key = recordKey(r.course), b = all.arena[key];
      r.rec = !b || r.time < b.time;
      if (r.rec) all.arena[key] = { time: r.time, misses: r.misses, date: r.at.slice(0, 10), runId: r.id, ver: r.ver };
    });
    LV.COURSES.forEach(function (c) { all.runs = prune(all.runs, c.id); });
    write(all);
    return added;
  }

  // The run to race as a ghost: the personal best that logged every question.
  function ghostOf(course) {
    var c = courseOf(course);
    var runs = runsOf(course).filter(function (r) {
      return c && r.ver === c.ver && r.qs && r.qs.length === c.qs.length && r.qs.every(function (q) { return typeof q.s === 'number'; });
    });
    if (!runs.length) return null;
    runs.sort(function (a, b) { return a.time - b.time; });
    var r = runs[0];
    return { name: '自分', time: r.time, at: r.at, splits: r.qs.map(function (q) { return +(q.s + 2 * (q.m || 0)).toFixed(2); }) };
  }

  function clearArena() {
    var all = load();
    all.arena = {};
    all.runs = [];
    write(all);
  }

  window.ADV = window.ADV || {};
  window.ADV.records = {
    SCHEMA: SCHEMA, CAP: CAP, HARD_CAP: HARD_CAP,
    load: load, add: add, runsOf: runsOf, best: best,
    stats: stats, weakness: weakness, clearArena: clearArena, merge: merge, ghostOf: ghostOf,
    learnt: learnt, weakTypes: weakTypes, skill: skill, dailyBest: dailyBest,
    recordKey: recordKey, courseOf: courseOf
  };
})();
