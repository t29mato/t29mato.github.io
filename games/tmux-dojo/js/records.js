// tmux 道場: run records. Every run is kept (up to a cap per course), with
// the seconds each question took, so a player can see how far they have
// come. No DOM here: app.js draws, and a share card can reuse a run as is.
(function () {
  'use strict';

  var LV = ADV.levels;
  var STORE_KEY = 'tmux-da';
  var SCHEMA = 5, CAP = 100, HARD_CAP = 200;

  function recordKey(id) { return 'tmux:' + id; }
  function courseOf(id) {
    if (id === LV.KEIKO.id) return LV.KEIKO;
    if (id === LV.DAILY.id) return LV.DAILY;
    return LV.COURSES.filter(function (c) { return c.id === id; })[0] || null;
  }

  function read() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var v = raw ? JSON.parse(raw) : {};
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }

  // A store another version or a hand wrote: entries that are not runs
  // (or bests that are not times) would break the drawing, so they go.
  // Returns whether anything had to.
  function sane(all) {
    var changed = false;
    if (all.runs != null && !Array.isArray(all.runs)) { delete all.runs; changed = true; }
    if (Array.isArray(all.runs)) {
      var runs = all.runs.filter(function (r) {
        return r && typeof r === 'object' && typeof r.course === 'string' && typeof r.time === 'number' && isFinite(r.time) &&
          (typeof r.at === 'string' || typeof r.at === 'number') && isFinite(new Date(r.at).getTime());
      });
      runs.forEach(function (r) {
        if (typeof r.at === 'number') { r.at = new Date(r.at).toISOString(); changed = true; }
        if (r.qs != null && !Array.isArray(r.qs)) { r.qs = []; changed = true; }
        if (r.qs && r.qs.some(function (q) { return !q || typeof q !== 'object'; })) { r.qs = r.qs.filter(function (q) { return q && typeof q === 'object'; }); changed = true; }
        if (r.klog != null && !(typeof r.klog === 'object' && Array.isArray(r.klog.keys) && Array.isArray(r.klog.q))) { delete r.klog; changed = true; }
      });
      if (runs.length !== all.runs.length) changed = true;
      all.runs = runs;
    }
    if (all.arena != null && typeof all.arena !== 'object') { delete all.arena; changed = true; }
    if (all.titles != null && (typeof all.titles !== 'object' || Array.isArray(all.titles))) { delete all.titles; changed = true; }
    Object.keys(all.arena || {}).forEach(function (k) {
      var b = all.arena[k];
      if (!b || typeof b.time !== 'number' || !isFinite(b.time)) { delete all.arena[k]; changed = true; }
    });
    return changed;
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

  // A run's title on the ladder of today: an old name is carried over, and
  // where the pace is known the run gets what it earns now if that is
  // higher. Never lower than the player had.
  function retitle(r) {
    var c = courseOf(r.course);
    var old = LV.OLD_RANKS[r.rank] || r.rank;
    var now = typeof r.time === 'number' && r.n ? LV.rankFor(r.time / r.n, c && c.rankMul) : null;
    r.rank = now && LV.rankIndex(now) < LV.rankIndex(old) ? now : old;
  }

  // Old saves kept only a best time per course. Each becomes one run, marked
  // legacy, so the history starts from it instead of from nothing. Schema 2
  // runs carry the old game's rank titles; schema 3 and 4 rename them;
  // schema 5 puts them on the belts and writes the 免状 (titles below).
  function migrate(all) {
    if (all.schema === SCHEMA && Array.isArray(all.runs)) return false;
    all.arena = all.arena || {};
    var hadRuns = Array.isArray(all.runs);
    all.runs = hadRuns ? all.runs : [];
    all.runs.forEach(retitle);
    if (hadRuns) { all.schema = SCHEMA; fillTitles(all); return true; }
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
    fillTitles(all);
    return true;
  }

  function load() {
    var all = read();
    var fixed = sane(all);
    var moved = migrate(all);
    if (!all.titles) { fillTitles(all); fixed = true; }
    if (moved || fixed) write(all);
    return all;
  }

  // ---- 免状: the titles reached, per house ----------------------------------

  // all.titles[course][title] is the first day (Japan time) a run on that
  // house reached the title, or any above it: the 免状. Kept apart from the
  // runs, which are pruned; a title once reached stays.
  function noteTitle(all, r) {
    var c = courseOf(r.course);
    if (!c || c.practice || c.daily || r.drill || !r.rank || LV.rankIndex(r.rank) >= LV.RANKS.length) return;
    var day = LV.dayKey(new Date(r.at));
    var mine = (all.titles = all.titles || {})[c.id] || (all.titles[c.id] = {});
    for (var i = LV.rankIndex(r.rank); i < LV.RANKS.length; i++) {
      var t = LV.RANKS[i].title;
      if (!mine[t] || day < mine[t]) mine[t] = day;
    }
  }

  // The 免状 from every run kept: a player from before gets theirs too.
  function fillTitles(all) {
    all.titles = all.titles || {};
    (all.runs || []).forEach(function (r) { noteTitle(all, r); });
  }

  // 到達: the highest title a house has reached, or null.
  function bestTitle(course, all) {
    var mine = ((all || load()).titles || {})[course] || {};
    var best = null;
    Object.keys(mine).forEach(function (t) { if (best == null || LV.rankIndex(t) < LV.rankIndex(best)) best = t; });
    return best;
  }

  // Every 免状, newest first: { course, title, day }.
  function menjo(all) {
    var out = [];
    var ts = (all || load()).titles || {};
    LV.COURSES.forEach(function (c) {
      Object.keys(ts[c.id] || {}).forEach(function (t) { if (LV.rankInfo(t)) out.push({ course: c.id, title: t, day: ts[c.id][t] }); });
    });
    out.sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : LV.rankIndex(a.title) - LV.rankIndex(b.title); });
    return out;
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

  // The key log (what was pressed, for the replay) is the biggest part of a
  // run: only the best of the course and the latest LOG_KEEP keep theirs.
  var LOG_KEEP = 3;
  function pruneLogs(all, course) {
    var mine = all.runs.filter(function (r) { return r.course === course && r.klog; });
    var b = (all.arena || {})[recordKey(course)];
    var keep = mine.slice(-LOG_KEEP);
    mine.forEach(function (r) { if (keep.indexOf(r) < 0 && !(b && b.runId === r.id)) delete r.klog; });
  }

  function runById(id, all) {
    return ((all || load()).runs || []).filter(function (r) { return r.id === id; })[0] || null;
  }

  function runsOf(course, all) {
    all = all || load();
    return (all.runs || []).filter(function (r) { return r.course === course; }).reverse();
  }

  function best(course, all) {
    all = all || load();
    var b = (all.arena || {})[recordKey(course)];
    if (b) return b;
    // A history without its best (a store out of step): the fastest run kept.
    var fast = null;
    (all.runs || []).forEach(function (r) { if (r.course === course && (!fast || r.time < fast.time)) fast = r; });
    return fast ? { time: fast.time, misses: fast.misses || 0, date: String(fast.at).slice(0, 10), runId: fast.id, ver: fast.ver } : null;
  }

  // Add one finished run. Returns what the result screen needs to say.
  function add(run) {
    var all = load();
    var c = courseOf(run.course);
    var prevRuns = runsOf(run.course, all);
    var prevBest = best(run.course, all);
    var titleFrom = bestTitle(run.course, all);
    var skillFrom = skill(all, run.course), learntFrom = learnt();
    run.id = run.id || newId();
    run.ver = c ? c.ver : 1;
    run.at = run.at || new Date().toISOString();
    run.rank = LV.rankFor(run.time / run.n, c && c.rankMul);
    run.rec = !prevBest || run.time < prevBest.time;
    all.runs.push(run);
    if (run.rec) {
      all.arena[recordKey(run.course)] = { time: run.time, misses: run.misses, date: run.at.slice(0, 10), runId: run.id, ver: run.ver };
    }
    noteTitle(all, run);
    all.runs = prune(all.runs, run.course);
    pruneLogs(all, run.course);
    write(all);
    var sum = summarize(run, prevRuns, prevBest, titleFrom);
    // What this run changed in the long run: the 腕前 and what is learnt.
    var learntNow = learnt();
    sum.skillFrom = skillFrom;
    sum.skill = skill(null, run.course);
    sum.learntNew = Object.keys(learntNow).filter(function (t) { return learntNow[t].learnt && !(learntFrom[t] && learntFrom[t].learnt); });
    sum.learntLost = Object.keys(learntFrom).filter(function (t) { return learntFrom[t].learnt && !(learntNow[t] && learntNow[t].learnt); });
    return sum;
  }

  // `bestRank` is the house's highest title before this run (the 免状);
  // `rankUp` says this run raised it: the 昇格.
  function summarize(run, prevRuns, prevBest, bestRank) {
    var c = courseOf(run.course);
    var prev = prevRuns[0] || null;
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
      rankUp: bestRank != null && LV.rankIndex(run.rank) < LV.rankIndex(bestRank),
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
      bestRank: bestTitle(course, all),
      first: first, last: last,
      recentAvg: recent.reduce(function (s, r) { return s + r.time; }, 0) / recent.length,
      runs: runs
    };
  }

  // The 目安 a logged question was measured against: its own (`l`, per
  // question since the 目安 went per type), else its course's old one.
  function limitOf(q, c) {
    return typeof q.l === 'number' ? q.l : c ? c.limit : 10;
  }

  // A type is weak when it ran past its 目安, took a wrong key, or is clearly
  // slow: past half its 目安 on average and over WEAK_RATIO times the pace of
  // the rest (each relative to its 目安). Never from nothing.
  var WEAK_RATIO = 1.3;
  function slow(rel, ratio) { return rel > 0.5 && ratio > WEAK_RATIO; }

  // Per question type over the latest n runs that logged questions. `o` marks
  // a question that ran past its 目安, `g` one where the 手順 came out; `to`
  // is a timeout from the old rules, counted at the limit. `ratio` is the
  // type's time over its 目安, against the same over every type.
  function weakness(course, n) {
    var c = courseOf(course);
    var runs = runsOf(course).filter(function (r) { return r.qs && r.qs.length; }).slice(0, n || 10);
    if (runs.length < 2) return null;
    var by = {}, total = 0, count = 0;
    runs.forEach(function (r) {
      r.qs.forEach(function (q) {
        var limit = limitOf(q, c);
        var s = q.to ? limit : q.s;
        if (s == null) return;
        var e = by[q.t] || (by[q.t] = { type: q.t, sum: 0, rel: 0, n: 0, m: 0, overs: 0, guides: 0 });
        e.sum += s; e.rel += s / limit; e.n += 1; e.m += q.m || 0; e.overs += (q.o || q.to) ? 1 : 0; e.guides += q.g ? 1 : 0;
        total += s / limit; count += 1;
      });
    });
    var mean = count ? total / count : 0;
    var list = Object.keys(by).map(function (k) {
      var e = by[k];
      return { type: e.type, avg: e.sum / e.n, rel: e.rel / e.n, missRate: e.m / e.n, overs: e.overs, guides: e.guides, n: e.n, ratio: mean ? (e.rel / e.n) / mean : 1 };
    }).filter(function (e) { return e.n >= 2; });
    list.sort(function (a, b) { return b.ratio - a.ratio; });
    var weak = list.filter(function (e) { return e.overs > 0 || e.missRate > 0 || slow(e.rel, e.ratio); });
    return { runs: runs.length, mean: mean, weak: weak.slice(0, 3), strong: list.length > 3 ? list[list.length - 1] : null };
  }

  // ---- learning, across every course -----------------------------------------

  // Every logged question, oldest first, with its 目安 (limitOf).
  function allQuestions() {
    var out = [];
    (load().runs || []).forEach(function (r) {
      var c = courseOf(r.course);
      if (!c || !r.qs) return;
      r.qs.forEach(function (q) { if (q && q.t && typeof q.s === 'number') out.push({ t: q.t, s: q.s, m: q.m || 0, o: !!(q.o || q.to), g: !!q.g, limit: limitOf(q, c) }); });
    });
    return out;
  }

  // A solve that counts towards learning a type: within half the 目安, no
  // wrong key, no overrun, and the folded 手順 never shown (`g`).
  function clean(q) {
    return !q.o && !q.m && !q.g && q.s <= q.limit / 2;
  }

  // Per question type: how many clean solves in a row up to now, and
  // whether that makes it learnt.
  function learnt() {
    var by = {};
    allQuestions().forEach(function (q) {
      var e = by[q.t] || (by[q.t] = { streak: 0, seen: 0 });
      e.seen += 1;
      e.streak = clean(q) ? e.streak + 1 : 0;
    });
    Object.keys(by).forEach(function (k) { by[k].learnt = by[k].streak >= LV.LEARNT_AFTER; });
    return by;
  }

  // The question types to practise, over the latest 60 logged questions:
  // only those that ran past the 目安 or are clearly slow (`slow` above),
  // worst first. At most `n`; often none.
  function weakTypes(n) {
    // As the records say: weak spots show after two runs, not one.
    var logged = (load().runs || []).filter(function (r) { return r.qs && r.qs.length; }).length;
    if (logged < 2) return [];
    var qs = allQuestions().slice(-60);
    if (qs.length < 5) return [];
    var by = {}, total = 0;
    qs.forEach(function (q) {
      var rel = q.s / q.limit;
      var e = by[q.t] || (by[q.t] = { type: q.t, sum: 0, n: 0, overs: 0 });
      e.sum += rel; e.n += 1; e.overs += q.o ? 1 : 0; total += rel;
    });
    var mean = total / qs.length;
    var list = Object.keys(by).map(function (k) { var e = by[k]; return { type: e.type, rel: e.sum / e.n, ratio: e.sum / e.n / mean, overs: e.overs, score: e.sum / e.n / mean + e.overs / e.n, n: e.n }; });
    list = list.filter(function (e) { return e.overs > 0 || slow(e.rel, e.ratio); });
    list.sort(function (a, b) { return b.score - a.score; });
    return list.slice(0, n || 3).map(function (e) { return e.type; });
  }

  // ---- 稽古 (the recall drill) ------------------------------------------------

  // The latest logged questions, oldest first, with `extra` (the drill's
  // own so far) after them: what the next pick is weighed against.
  var DRILL_RECENT = 80;
  function drillRecent(extra) {
    return allQuestions().slice(-DRILL_RECENT).concat(extra || []).slice(-DRILL_RECENT);
  }

  // How much a question type wants asking: how often its keys are needed
  // (LV.DRILL_FREQ) times how it has gone lately. A type missed, overrun or
  // peeked at every time weighs four times a clean one, a type never seen
  // weighs double, and one asked a moment ago weighs half, so the types
  // come spaced out.
  var DRILL_SPACE = 40;
  function drillWeight(type, recent) {
    var freq = LV.DRILL_FREQ[type] || 1;
    var n = 0, bad = 0, gap = recent.length;
    for (var i = 0; i < recent.length; i++) {
      var q = recent[i];
      if (q.t !== type) continue;
      n += 1;
      if (q.m || q.o || q.g) bad += 1;
      gap = recent.length - 1 - i;
    }
    var weak = n ? 1 + 3 * bad / n : 2;
    var space = n ? 0.5 + 0.5 * Math.min(gap, DRILL_SPACE) / DRILL_SPACE : 1;
    return freq * weak * space;
  }

  // The next type to ask, by weight; never `last` again.
  function drillPick(types, recent, last, rand) {
    var cands = types.filter(function (t) { return t !== last; });
    if (!cands.length) cands = types.slice();
    var ws = cands.map(function (t) { return drillWeight(t, recent); });
    var total = ws.reduce(function (s, w) { return s + w; }, 0);
    var r = (rand || Math.random)() * total;
    for (var i = 0; i < cands.length; i++) { r -= ws[i]; if (r < 0) return cands[i]; }
    return cands[cands.length - 1];
  }

  // The longest run of questions solved from memory: no 手順 shown, no
  // wrong key, within the 目安.
  function drillStreak(qs) {
    var best = 0, cur = 0;
    (qs || []).forEach(function (q) {
      if (q && typeof q.s === 'number' && !q.g && !q.m && !q.o) { cur += 1; if (cur > best) best = cur; } else cur = 0;
    });
    return best;
  }

  // The best such streak of any drill so far.
  function drillBest(all) {
    var best = 0;
    runsOf(LV.KEIKO.id, all).forEach(function (r) { if (r.drill) best = Math.max(best, drillStreak(r.qs)); });
    return best;
  }

  // 腕前: the pace of the latest five runs on a house (seconds per question,
  // after penalties, over rankMul), its level and the next one. Per house:
  // a harder house is slower at first even over rankMul (more to read), so
  // stepping up must not read as getting worse. Without `course`, the house
  // that stands highest: the Lv the top bar shows.
  function skill(all, course) {
    all = all || load();
    if (!course) {
      var top = null;
      LV.COURSES.forEach(function (c) { var s = skill(all, c.id); if (s && (!top || s.lv > top.lv || (s.lv === top.lv && s.pace < top.pace))) top = s; });
      return top;
    }
    var c = courseOf(course);
    if (!c || c.practice || c.daily) return null;
    var runs = (all.runs || []).filter(function (r) { return r.course === course && !r.legacy && r.n; }).slice(-5);
    if (!runs.length) return null;
    var pace = runs.reduce(function (s, r) { return s + r.time / r.n / (c.rankMul || 1); }, 0) / runs.length;
    var lv = LV.levelFor(pace);
    var next = lv < LV.LV_MAX ? LV.paceFor(lv + 1) : null;
    return { course: course, pace: pace, lv: lv, title: LV.rankFor(pace), runs: runs.length, next: next, toNext: next != null ? pace - next : null };
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

  // Days in a row with a course played (Japan time), up to today. A streak
  // is still alive today until midnight even if today is not played yet.
  // `only`: that course's days (今日の達人 keeps its own).
  function streak(all, now, only) {
    var days = {};
    ((all || load()).runs || []).forEach(function (r) {
      var c = courseOf(r.course);
      if (c && !c.practice && (only ? c.id === only : !c.daily)) days[LV.dayKey(new Date(r.at))] = 1;
    });
    var t = (now || new Date()).getTime(), n = 0;
    var today = !!days[LV.dayKey(new Date(t))];
    if (!today) t -= 86400 * 1000;
    while (days[LV.dayKey(new Date(t))]) { n += 1; t -= 86400 * 1000; }
    return { days: n, today: today };
  }

  // Today's best of a course here (Japan time), or null.
  function todayBest(course, all) {
    var d = LV.dayKey(), best = null;
    runsOf(course, all).forEach(function (r) { if (LV.dayKey(new Date(r.at)) === d && (best == null || r.time < best)) best = r.time; });
    return best;
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
      retitle(r);
      all.runs.push(r);
      noteTitle(all, r);
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
    LV.COURSES.concat([LV.DAILY]).forEach(function (c) { all.runs = prune(all.runs, c.id); });
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
    return { name: '自分', time: r.time, at: r.at, runId: r.id, keys: r.klog || null, splits: r.qs.map(function (q) { return +(q.s + 2 * (q.m || 0)).toFixed(2); }) };
  }

  function clearArena() {
    var all = load();
    all.arena = {};
    all.runs = [];
    all.titles = {};
    write(all);
  }

  window.ADV = window.ADV || {};
  window.ADV.records = {
    SCHEMA: SCHEMA, CAP: CAP, HARD_CAP: HARD_CAP,
    load: load, add: add, runsOf: runsOf, runById: runById, best: best, LOG_KEEP: LOG_KEEP,
    stats: stats, weakness: weakness, bestTitle: bestTitle, menjo: menjo, clearArena: clearArena, merge: merge, ghostOf: ghostOf,
    learnt: learnt, weakTypes: weakTypes, skill: skill, dailyBest: dailyBest, streak: streak, todayBest: todayBest,
    drillRecent: drillRecent, drillWeight: drillWeight, drillPick: drillPick, drillStreak: drillStreak, drillBest: drillBest,
    recordKey: recordKey, courseOf: courseOf, limitOf: limitOf, WEAK_RATIO: WEAK_RATIO
  };
})();
