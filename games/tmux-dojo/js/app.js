// tmux 道場, browser edition: screens, input, the fake shells and
// the run loop. The tmux model is in tmux.js, the courses and keys in
// levels.js, the records in records.js, the sound in audio.js.
(function () {
  'use strict';

  var T = ADV.tmux, LV = ADV.levels, AU = ADV.audio, REC = ADV.records, NET = ADV.net || null;
  var I18N = ADV.i18n, tx = I18N.t, EN = I18N.lang === 'en';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- storage: optional, never required ---------------------------------

  var STORE_KEY = 'tmux-da';
  var store = {
    load: function () {
      try {
        var raw = window.localStorage.getItem(STORE_KEY);
        var v = raw ? JSON.parse(raw) : {};
        // A store that is not an object (broken, hand-edited) counts as empty.
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch (e) { return {}; }
    },
    save: function (patch) {
      try {
        var cur = store.load();
        for (var k in patch) cur[k] = patch[k];
        window.localStorage.setItem(STORE_KEY, JSON.stringify(cur));
      } catch (e) { /* storage is a convenience, not a requirement */ }
    }
  };

  // ---- state ---------------------------------------------------------------

  var S = {
    screen: 'title',       // 'title' | 'game' | 'result' | 'records'
    prefix: 'C-b',
    sessions: [],          // by name, as tmux keeps them (tmux ls, ( and ), the list)
    session: null,
    lastSession: null,     // the session before the last switch (prefix L)
    armed: false,          // prefix pressed, waiting for the key
    repeatUntil: 0,        // tmux repeat-time window for -r bindings
    graceUntil: 0,         // trailing repeat keys after a solve are ignored
    confirm: null,         // {text, yes}
    prompt: null,          // {label, value, done}
    picker: null,          // {idx}: choose-tree
    clipboard: '',
    detached: false,
    outer: null,           // the shell outside tmux
    target: null,          // pane id the question is about
    qText: null,           // the order as asked, with the names it targets
    qGoal: null,           // what it targets, for the tests
    qNote: [],             // what the house had to add for it, if anything
    lastAction: null,      // what the last key did, for the miss check
    run: null,             // the course being played
    result: null,          // the last finished run, for the result screen
    message: null,
    messageTimer: 0,
    cols: 80, rows: 24, cellW: 8, cellH: 18,
    hinted: false,
    sound: true,
    confText: '',          // the pasted .tmux.conf
    conf: null,            // what of it the game uses (conf.js); null: the defaults
    ghostPick: 'top',      // the 影 to race: 'top' 今日の 1 位 | 'next' 1 つ上の人 | 'own' 自己ベスト
    replay: null,          // a run being watched (startReplay)
    legacy: false,         // that run is from before SIM_V: the game as it was then
    free: false,           // 練習: the house with no questions and no clock
    msgLog: [],            // what the status line said (show-messages)
    sim: false             // the house is being tried on (parKeys): no screen, no timers
  };

  // The version of the house's rules a key log was made on. A log without
  // it is from before shortened command names, renumber-windows, break-pane
  // -d, the vi word moves and the views (list-keys, show-messages): its
  // replay keeps the game as it was, so the same keys do the same things.
  var SIM_V = 2;

  // The clock the key handling reads (repeat windows, Esc twice): the
  // replay's own time while it feeds a run's keys, so a -r key repeats
  // there as it did.
  function nowMs() { return S.replay ? (S.replay.now != null ? S.replay.now : S.replay.t) : Date.now(); }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var CF = ADV.conf;
  var MAC = /^Option/.test(LV.KEYS.resize[0]);
  function prefixSpec() { return S.conf ? S.conf.prefix : CF.parseKey('C-b'); }
  function prefixEvent() { var p = prefixSpec(); return { key: p.key, ctrl: p.ctrl, alt: p.alt, shift: p.shift }; }
  function prefixLabel() { return prefixSpec().label; }

  function syncBody() {
    var b = document.body;
    b.dataset.screen = S.screen;
    b.dataset.armed = S.armed ? '1' : (Date.now() < S.repeatUntil ? 'repeat' : '0');
    b.dataset.detached = S.detached ? '1' : '0';
    b.dataset.stage = S.run && S.run.phase === 'play' ? String(S.run.stage) : '0';
    b.dataset.detail = S.detail ? '1' : '0';
    // A replay has its own controls: やめる and the 手順 detail are for play.
    b.dataset.watching = S.replay ? '1' : '0';
    // status-position top: the bar above the panes, as the player has it.
    b.dataset.status = S.conf && S.conf.statusTop ? 'top' : 'bottom';
    var dt = $('.detail-toggle');
    if (dt) { dt.setAttribute('aria-pressed', S.detail ? 'true' : 'false'); dt.textContent = S.detail ? tx('手順の詳細をしまう') : tx('手順の詳細を出す'); }
    var cs = $('#conf-state');
    if (cs) cs.textContent = S.conf ? tx('自分の設定（prefix {0}）', prefixLabel()) : tx('既定');
  }

  // ---- theme and sound ------------------------------------------------------

  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var dark = t === 'dark' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    $$('.theme-toggle').forEach(function (b) {
      b.setAttribute('aria-label', dark ? tx('明るい画面にする') : tx('暗い画面にする'));
      b.textContent = dark ? '☀' : '☾';
    });
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var dark = cur === 'dark' || (!cur && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var next = dark ? 'light' : 'dark';
    applyTheme(next);
    store.save({ theme: next });
  }

  function applySound(on) {
    S.sound = on;
    AU.setEnabled(on);
    $$('.sound-toggle').forEach(function (b) {
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? tx('音を消す') : tx('音を出す'));
      b.textContent = on ? '♪' : '×';
    });
  }

  // The tune that belongs to where the player is.
  function music() { AU.play(S.screen === 'game' ? 'play' : 'title'); }

  // ---- the fake shells ---------------------------------------------------

  function lineText(l) {
    if (typeof l === 'string') return l;
    if (!l || l.clear) return '';
    if (l.text != null) return l.text;
    return String(l.html || '').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }

  function runPaneCommand(pane, line) {
    var win = T.activeWindow(S.session);
    pane.lines.push({ html: '<span class="sh-prompt">' + esc(promptText(pane)) + '</span>' + esc(line) });
    var argv = line.trim().split(/\s+/);
    var cmd = argv[0] || '';
    if (!cmd) return;
    switch (cmd) {
      case 'help':
        pane.lines.push(tx('使えるコマンド: ls  echo  cat  pwd  date  uptime  hostname  clear  exit  tmux  help'));
        pane.lines.push(tx('tmux の操作は {0} を押して離してからキーを押す。押すキーは画面の手順に出ている', prefixLabel()));
        break;
      case 'ls':
        pane.lines.push('kakejiku.txt  makimono.txt  tokonoma/');
        break;
      case 'pwd':
        pane.lines.push('/home/dojo/' + (pane.name || 'ma'));
        break;
      case 'date':
        pane.lines.push(new Date().toString().slice(0, 24));
        break;
      case 'hostname':
        pane.lines.push('dojo');
        break;
      case 'uptime':
        pane.lines.push(hhmm(new Date()) + '  up 3 days,  2 users,  load averages: 0.12 0.08 0.05');
        break;
      case 'echo':
        pane.lines.push(argv.slice(1).join(' '));
        break;
      case 'cat':
        if (argv[1] === 'makimono.txt') printScroll(pane);
        else if (argv[1] === 'kakejiku.txt') pane.lines.push(tx('「デタッチしても、セッションはそのまま。」'));
        else pane.lines.push('cat: ' + (argv[1] || '') + ': ' + tx('そんなファイルはない'));
        break;
      case 'clear':
        pane.lines.push({ clear: true });
        break;
      case 'exit':
        if (!T.killPane(win, pane.id)) {
          if (!T.killWindow(S.session, win.id)) pane.lines.push(tx('最後のペインは閉じられない。'));
        }
        S.lastAction = 'close';
        break;
      case 'tmux':
        if (argv[1] === 'ls' || argv[1] === 'list-sessions') sessionLines().forEach(function (l) { pane.lines.push(l); });
        // new -d makes a session in the background, which works from inside too.
        else if (!argv[1] || /^(a|attach|attach-session|new|new-session)$/.test(argv[1]) && (S.legacy || /^a/.test(argv[1]) || !argv.slice(2).some(function (a) { return /^-[A-Za-z]*d/.test(a); }))) {
          pane.lines.push('sessions should be nested with care, unset $TMUX to force');
          pane.lines.push({ html: '<span class="sh-dim">' + esc(tx('（もう tmux の中にいる。デタッチは {0} → {1}）', prefixLabel(), LV.HINTS.detach)) + '</span>' });
        } else if (!S.legacy) tmuxFromShell(pane, line.trim().replace(/^tmux\s+/, ''));
        else pane.lines.push('usage: tmux [attach|ls]');
        break;
      default:
        pane.lines.push('zsh: command not found: ' + cmd);
    }
  }

  // `tmux <command>` typed in a pane runs on this server, as in a real
  // tmux; its errors print in the pane. new -s / attach (nesting) are above.
  function tmuxFromShell(pane, rest) {
    var argv = CF.words(rest)[0] || [];
    var named = CF.resolve(argv[0]);
    if (named.error) { pane.lines.push(named.error); return; }
    var was = S.message;
    S.message = null;
    runTmuxCommand(rest);
    // What it said goes to the pane, as the client prints it.
    if (S.message && S.message !== was && !/^(list-|show-)/.test(named.name)) pane.lines.push(S.message);
    if (S.lastAction === 'unbound') S.lastAction = 'brief';
  }

  function promptText() { return '~ $ '; }

  function sessionLines() {
    return S.sessions.map(function (s) {
      var d = s.createdAt;
      return s.name + ': ' + s.windows.length + ' windows (created ' + d.toDateString() + ' ' + d.toTimeString().slice(0, 8) + ')' + (s === S.session && !S.detached ? ' (attached)' : '');
    });
  }

  function runOuterCommand(line) {
    var o = S.outer;
    o.lines.push({ html: '<span class="sh-prompt">$ </span>' + esc(line) });
    var argv = line.trim().split(/\s+/);
    var cmd = argv[0] || '';
    if (!cmd) return;
    if (cmd === 'tmux' && !S.legacy) { outerTmux(o, line.trim().replace(/^tmux\s*/, '')); return; }
    if (cmd === 'tmux') {
      var sub = argv[1] || '';
      if (/^(a|attach|attach-session)$/.test(sub)) {
        // -t names the session; without it tmux takes the one last used.
        var ti = argv.indexOf('-t'), tn = ti > 0 ? (argv[ti + 1] || '') : null;
        if (tn === null) { attach(); return; }
        var ts = sessionByName(tn);
        if (ts) attach(ts);
        else o.lines.push('can\'t find session: ' + tn);
        return;
      }
      if (sub === 'ls' || sub === 'list-sessions') { sessionLines().forEach(function (l) { o.lines.push(l); }); o.ls = true; return; }
      if (sub === '' || sub === 'new' || sub === 'new-session') {
        o.lines.push({ html: '<span class="sh-dim">' + esc(tx('それは新しいセッションを作るコマンド。セッションは裏でそのまま残っている —— tmux attach で戻ろう。')) + '</span>' });
        return;
      }
      o.lines.push('usage: tmux [attach [-t name]|ls]');
      return;
    }
    switch (cmd) {
      case 'help':
        o.lines.push(tx('使えるコマンド: tmux attach  tmux attach -t 名前  tmux ls  ls  echo  clear  help'));
        break;
      case 'ls':
        o.lines.push('README.md');
        break;
      case 'pwd':
        o.lines.push('/home/dojo');
        break;
      case 'echo':
        o.lines.push(argv.slice(1).join(' '));
        break;
      case 'clear':
        o.lines.push({ clear: true });
        break;
      default:
        o.lines.push('zsh: command not found: ' + cmd);
    }
  }

  // tmux typed outside tmux (after a detach), as tmux 3.x takes it: a
  // command name may be shortened; attach takes no words but -t (prefix
  // of a name too); new (or tmux alone) makes a session and goes into it
  // unless -d; the commands that need no client run on the server.
  var OUTER_OK = /^(kill-pane|kill-window|kill-session|new-window|split-window|rename-window|rename-session|select-window|select-pane|swap-pane|swap-window|move-window|join-pane|move-pane|break-pane|resize-pane|select-layout|next-layout|previous-layout|set-option|set-window-option|has-session|rotate-window|display-message)$/;
  function outerTmux(o, rest) {
    var argv = CF.words(rest)[0] || [];
    var named = argv.length ? CF.resolve(argv[0]) : { name: 'new-session' };
    if (named.error) { o.lines.push(named.error); return; }
    argv = [named.name].concat(argv.slice(1));
    var f = CF.flags(argv), name = named.name;
    if (name === 'attach-session') {
      if (f.rest.length) { o.lines.push('command attach-session: too many arguments (need at most 0)'); return; }
      if (f.f.t == null) { attach(); return; }
      var ts = sessionTarget(f.f.t);
      if (ts) attach(ts);
      else o.lines.push('can\'t find session: ' + f.f.t);
      return;
    }
    if (name === 'list-sessions') { sessionLines().forEach(function (l) { o.lines.push(l); }); o.ls = true; return; }
    if (name === 'new-session') {
      var nm = typeof f.f.s === 'string' ? f.f.s : freshName();
      if (sessionByName(nm)) { o.lines.push('duplicate session: ' + nm); return; }
      var ns = makeSession(nm);
      if (!f.f.d) attach(ns);
      return;
    }
    if (name === 'kill-server') { o.lines.push(tx('{0}: ゲームでは再現していない（ミスにはならない）', name)); return; }
    if (!OUTER_OK.test(name)) { o.lines.push('no current client'); return; }
    var was = S.message;
    S.message = null;
    runTmuxCommand(argv);
    if (S.message && S.message !== was) o.lines.push(S.message);
    if (S.lastAction === 'unbound') S.lastAction = 'brief';
  }

  // Emacs-style line editing, as in zsh, bash and tmux's own prompts.
  // o[field] is the text; o.cur the cursor (null means the end).
  // Returns true when the key was an editing key.
  var killRing = '';

  function wordLeft(t, c) { while (c > 0 && /\s/.test(t[c - 1])) c--; while (c > 0 && !/\s/.test(t[c - 1])) c--; return c; }
  function wordRight(t, c) { while (c < t.length && /\s/.test(t[c])) c++; while (c < t.length && !/\s/.test(t[c])) c++; return c; }

  // Option on a Mac turns Option+b into "∫"; the physical key is in e.code.
  function metaKey(k) {
    if (!k.alt) return null;
    var m = /^Key([A-Z])$/.exec(k.code || '');
    if (m) return m[1].toLowerCase();
    if (k.key === 'Backspace') return 'Backspace';
    return k.key.length === 1 ? k.key.toLowerCase() : null;
  }

  function lineEdit(o, field, k) {
    var t = o[field] || '';
    var c = o.cur == null || o.cur > t.length ? t.length : o.cur;
    var key = k.key;
    var done = true;
    if (k.ctrl && !k.alt && !k.meta) {
      var lk = key.toLowerCase();
      if (lk === 'a') c = 0;
      else if (lk === 'e') c = t.length;
      else if (lk === 'b') c = Math.max(0, c - 1);
      else if (lk === 'f') c = Math.min(t.length, c + 1);
      else if (lk === 'd') t = t.slice(0, c) + t.slice(c + 1);
      else if (lk === 'h') { if (c > 0) { t = t.slice(0, c - 1) + t.slice(c); c--; } }
      else if (lk === 'k') { killRing = t.slice(c) || killRing; t = t.slice(0, c); }
      else if (lk === 'u') { killRing = t.slice(0, c) || killRing; t = t.slice(c); c = 0; }
      else if (lk === 'w') { var w = wordLeft(t, c); killRing = t.slice(w, c) || killRing; t = t.slice(0, w) + t.slice(c); c = w; }
      else if (lk === 'y') { t = t.slice(0, c) + killRing + t.slice(c); c += killRing.length; }
      else if (lk === 't') { if (c > 0 && t.length > 1) { var at = c === t.length ? c - 1 : c; t = t.slice(0, at - 1) + t[at] + t[at - 1] + t.slice(at + 1); c = Math.min(t.length, at + 1); } }
      else done = false;
    } else if (k.alt && !k.ctrl && !k.meta) {
      var mk = metaKey(k);
      if (mk === 'b') c = wordLeft(t, c);
      else if (mk === 'f') c = wordRight(t, c);
      else if (mk === 'd') { var e = wordRight(t, c); killRing = t.slice(c, e) || killRing; t = t.slice(0, c) + t.slice(e); }
      else if (mk === 'Backspace') { var w2 = wordLeft(t, c); killRing = t.slice(w2, c) || killRing; t = t.slice(0, w2) + t.slice(c); c = w2; }
      else done = false;
    } else if (k.meta) {
      done = false;
    } else if (key === 'ArrowLeft') c = Math.max(0, c - 1);
    else if (key === 'ArrowRight') c = Math.min(t.length, c + 1);
    else if (key === 'Home') c = 0;
    else if (key === 'End') c = t.length;
    else if (key === 'Backspace') { if (c > 0) { t = t.slice(0, c - 1) + t.slice(c); c--; } }
    else if (key === 'Delete') t = t.slice(0, c) + t.slice(c + 1);
    else if (key.length === 1) { t = t.slice(0, c) + key + t.slice(c); c++; }
    else done = false;
    o[field] = t;
    o.cur = c;
    return done;
  }

  // The text with the cursor drawn at its position.
  function withCursor(text, cur, show) {
    var t = text || '';
    var c = cur == null || cur > t.length ? t.length : cur;
    if (!show) return esc(t);
    return esc(t.slice(0, c)) + '<span class="cursor' + (c < t.length ? ' on-char' : '') + '">' + (c < t.length ? esc(t[c]) : '') + '</span>' + esc(t.slice(c + 1));
  }

  // The shells: line editing, history, and the keys a shell itself handles.
  function editLine(obj, k, submit) {
    var key = k.key;
    if (k.ctrl && !k.alt && !k.meta) {
      var lk = key.toLowerCase();
      if (lk === 'c') { obj.lines.push({ html: '<span class="sh-prompt">' + esc(obj === S.outer ? '$ ' : promptText(obj)) + '</span>' + esc(obj.input) + '^C' }); obj.input = ''; obj.cur = null; return true; }
      if (lk === 'l') { obj.lines.push({ clear: true }); return true; }
      if (lk === 'p' || lk === 'n') return history(obj, lk === 'p' ? -1 : 1);
    }
    if (!k.ctrl && !k.alt && !k.meta && (key === 'ArrowUp' || key === 'ArrowDown')) return history(obj, key === 'ArrowUp' ? -1 : 1);
    if (key === 'Enter' && !k.ctrl && !k.alt) {
      var line = obj.input;
      obj.input = ''; obj.cur = null;
      if (line.trim()) { obj.hist = (obj.hist || []).concat([line]); }
      obj.hi = null;
      submit(line);
      return true;
    }
    if (key === 'Tab') return true;
    return lineEdit(obj, 'input', k);
  }

  function history(obj, dir) {
    var h = obj.hist || [];
    if (!h.length) return true;
    var i = obj.hi == null ? h.length : obj.hi;
    i = Math.max(0, Math.min(h.length, i + dir));
    obj.hi = i;
    obj.input = i === h.length ? '' : h[i];
    obj.cur = null;
    return true;
  }

  // ---- detach / attach --------------------------------------------------

  function detach() {
    S.detached = true;
    S.session.attached = false;
    S.armed = false;
    S.outer = { lines: [{ html: '<span class="sh-dim">[detached (from session ' + esc(S.session.name) + ')]</span>' }], input: '' };
    S.hinted = false;
    clearTimeout(S.hintTimer);
    if (S.sim) return;
    S.hintTimer = setTimeout(function () {
      if (!S.detached) return;
      // Several sessions: -t picks one; without it tmux takes the last used.
      S.outer.lines.push({ html: '<span class="sh-dim">' + esc(tx(S.sessions.length > 1 ? 'ヒント: セッションは裏でそのまま残っている。tmux ls で一覧、tmux attach -t 名前 で入る（-t なしなら最後にいたセッションへ）。' : 'ヒント: セッションは裏でそのまま残っている。tmux attach と打てば戻れる（tmux ls で確かめられる）。')) + '</span>' });
      render();
    }, S.run && S.run.phase === 'play' ? 300 : 12000);
    $('#term').classList.add('powering-down');
    setTimeout(function () { $('#term').classList.remove('powering-down'); }, reduceMotion ? 0 : 700);
  }

  // `s`: the session named with -t; none: the one detached from.
  function attach(s) {
    S.detached = false;
    if (s) switchSession(s);
    S.session.attached = true;
    clearTimeout(S.hintTimer);
    if (S.sim) return;
    $('#term').classList.add('powering-up');
    setTimeout(function () { $('#term').classList.remove('powering-up'); }, reduceMotion ? 0 : 900);
  }

  // ---- sessions ------------------------------------------------------------

  function makeSession(name) {
    var s = T.createSession({ name: name, baseIndex: S.conf ? S.conf.baseIndex : 0, paneBaseIndex: S.conf ? S.conf.paneBaseIndex : 0 });
    // renumber-windows: the file's, or what : set -g made of it since.
    s.renumber = S.renumberOpt != null ? S.renumberOpt : !!(S.conf && S.conf.renumber);
    var w = T.createWindow(s, name === 'dojo' ? 'main' : 'zsh');
    s.active = w.id;
    S.sessions.push(s);
    sortSessions();
    return s;
  }

  // tmux keeps its sessions by name: tmux ls, the list and ( ) go in that order.
  function sortSessions() {
    S.sessions.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  }

  function renameSession(s, name) {
    if (!name || sessionByName(name)) return false;
    s.name = name;
    sortSessions();
    return true;
  }

  function sessionByName(name) {
    for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].name === name) return S.sessions[i];
    return null;
  }

  // A session as a target names it as tmux finds it: the whole name, else
  // the one session whose name starts so (-t wo for work); "sess:win" is the
  // session part. Null when none or several.
  function sessionTarget(t) {
    if (t == null) return S.session;
    var n = String(t).replace(/^=/, '').replace(/:.*$/, '');
    if (n === '') return S.session;
    var whole = sessionByName(n);
    if (whole) return whole;
    var hits = S.sessions.filter(function (s) { return s.name.indexOf(n) === 0; });
    return hits.length === 1 ? hits[0] : null;
  }

  function switchSession(s) {
    if (!s || s === S.session) return false;
    S.session.attached = false;
    S.lastSession = S.session;
    S.session = s;
    s.attached = true;
    return true;
  }

  // kill-session: the last one cannot go (tmux would exit; the game stays).
  // Killing the one you are in moves you to the next, as tmux does.
  function killSession(s) {
    if (S.sessions.length < 2) { message('最後のセッションは閉じられない'); S.lastAction = 'brief'; return; }
    if (s === S.session) {
      var others = S.sessions.filter(function (x) { return x !== s; });
      switchSession(S.lastSession && others.indexOf(S.lastSession) >= 0 ? S.lastSession : others[0]);
    }
    S.sessions = S.sessions.filter(function (x) { return x !== s; });
    if (S.lastSession === s) S.lastSession = null;
    S.lastAction = 'kill_session';
  }

  function freshName() {
    var n = S.sessions.length;
    while (sessionByName(String(n))) n++;
    return String(n);
  }

  function newSession() {
    S.renumberOpt = null;
    S.opts = {};
    S.marked = null;
    dropBinds();
    S.sessions = [];
    S.lastSession = null;
    S.session = makeSession('dojo');
    S.session.attached = true;
    S.detached = false;
    S.armed = false;
    S.confirm = null;
    S.prompt = null;
    S.picker = null;
    S.syncAll = false;
  }

  // ---- the house: the rooms and wings of one run ----------------------------

  var WINGS = ['main', 'logs', 'build', 'test', 'docs', 'db'];

  // Panes have no names: they are their numbers, as tmux shows them
  // (prefix q). A pane named with select-pane -T keeps its name.
  function nameRoom(pane) { if (pane) pane.name = ''; }

  // How the order names a pane: its number (or its -T name).
  function paneLabel(pane) {
    if (pane.name) return pane.name;
    var h = T.findPane(S.session, pane.id);
    if (!h) return tx('ペイン {0}', '?');
    // Pane numbers start again in every window: one in another window says which.
    if (S.session && h.win !== T.activeWindow(S.session)) return tx('ウィンドウ {0} のペイン {1}', winLabel(h.win), T.paneIndex(S.session, h.win, pane));
    return tx('ペイン {0}', T.paneIndex(S.session, h.win, pane));
  }

  // A pane as the order named it when asked, kept: a swap or a pane closed
  // renumbers the panes, and the order must not start naming another one.
  // Once renumbered, its number now follows: "ペイン 2（いまは 1）".
  function askedLabel(p) {
    var asked = paneLabel(p);
    return function () {
      var h = T.findPane(S.session, p.id);
      if (!h || p.name) return asked;
      var now = paneLabel(p);
      if (now === asked) return asked;
      return tx('{0}（いまは {1}）', asked, h.win === T.activeWindow(S.session) ? T.paneIndex(S.session, h.win, p) : now);
    };
  }

  // How the order names a window: as the status bar shows it, "1:蔵".
  function winLabel(w) { return w.index + ':' + w.name; }

  // The scroll: a long file printed into a pane, as `cat makimono.txt`
  // would. Long enough that its top is well off the screen.
  function printScroll(pane) {
    var total = 160;
    var head = tx('==== log 先頭 ===='), gold = tx('「デタッチしても、セッションはそのまま。」');
    pane.lines.push({ html: '<span class="sh-head">' + esc(head) + '</span>', text: head });
    pane.lines.push({ html: '<span class="sh-gold">' + esc(gold) + '</span>', text: gold });
    for (var i = 3; i <= total; i++) {
      // Short enough for a half-width pane on a phone (about 22 cells).
      var txt = i % 50 === 0 ? tx('—— 第{0}巻 ——', i / 50 + 1) : i % 17 === 0 ? tx('……墨がかすれる……') : tx('……長い文が続く……');
      var n = (i < 100 ? ' ' : '') + (i < 10 ? ' ' : '') + i;
      pane.lines.push({ html: '<span class="sh-dim">' + n + '</span>  ' + esc(txt), text: n + '  ' + txt });
    }
    pane.lines.push('');
  }

  // A log file printed into a pane, as `cat server.log` would. `marks` puts
  // given lines in: {from: log lines above the last one, text, cls}.
  function printLog(pane, total, marks) {
    var by = {};
    (marks || []).forEach(function (m) { by[total - 1 - m.from] = m; });
    for (var i = 0; i < total; i++) {
      var m = by[i];
      var txt = m ? m.text : i % 23 === 0 ? tx('INFO  起動して待っている') : i % 7 === 0 ? tx('INFO  問い合わせに答えた') : tx('INFO  ……ログが続く……');
      var n = (i < 99 ? ' ' : '') + (i < 9 ? ' ' : '') + (i + 1);
      pane.lines.push({ html: '<span class="sh-dim">' + n + '</span>  ' + (m ? '<span class="' + m.cls + '">' + esc(txt) + '</span>' : esc(txt)), text: n + '  ' + txt });
    }
    pane.lines.push('');
  }

  // Where a printed line stands against the pane's view in copy mode:
  // 'visible', 'above' or 'below' it (null without the DOM).
  function lineWhere(pane, ln) {
    var el = paneBodyEl(pane.id);
    var line = el && $('[data-ln="' + ln + '"]', el);
    if (!line) return null;
    var top = line.offsetTop, h = line.offsetHeight, bottom = el.scrollTop + el.clientHeight;
    // The line's first row in view is enough: a narrow pane wraps a line
    // over more rows than fit, and a pane of one row shows just that.
    var row = Math.min(h, S.cellH);
    // A view under two rows tall shows what it can: any part of the line.
    if (el.clientHeight < 2 * row) return top >= bottom ? 'below' : top + h <= el.scrollTop ? 'above' : 'visible';
    if (top < el.scrollTop) return 'above';
    if (top + row > bottom) return 'below';
    return 'visible';
  }

  // How many page moves (as PageDown makes them) a line is below the view.
  function linePages(pane, ln) {
    var el = paneBodyEl(pane.id);
    var line = el && $('[data-ln="' + ln + '"]', el);
    if (!line) return 0;
    return (line.offsetTop - (el.scrollTop + el.clientHeight)) / Math.max(S.cellH, el.clientHeight - S.cellH);
  }

  // The house at the start of a run, the same for everyone: window main with one
  // pane on the left and two on the right (the classic editor-and-shells
  // layout), logs and build with two panes each. The focus starts on the big
  // pane of main and from then on goes only where the player takes it.
  function buildHouse() {
    newSession();
    S.houseAt = Date.now();
    var home = S.session.windows[0];
    var p0 = T.activePane(home);
    var p1 = T.splitPane(home, p0.id, 'lr', null, true);
    T.splitPane(home, p1.id, 'tb', null, true);
    var w1 = T.createWindow(S.session, WINGS[1]);
    T.splitPane(w1, T.activePane(w1).id, 'tb', null, true);
    var w2 = T.createWindow(S.session, WINGS[2]);
    T.splitPane(w2, T.activePane(w2).id, 'lr', null, true);
    S.session.windows.forEach(function (w) { T.panesOf(w).forEach(nameRoom); });
  }

  // ---- what a question needs of the live house ------------------------------
  // The house carries on from question to question: the panes, the windows,
  // the zoom and the focus stay as the player left them, and the next
  // question is asked about what is on screen. A question that needs
  // something the house lacks (a second pane, a second window, the walls
  // back from a zoom) gets it here with the smallest change, never a change
  // of focus, and says so in a note under the order.

  function note(text) { S.qNote.push(tx(text)); }

  function needUnzoom() {
    var win = T.activeWindow(S.session);
    if (!win.zoomed) return;
    win.zoomed = false;
    note(tx('全画面を戻した'));
  }

  // At least `n` panes in the active window: the biggest pane is split, the
  // long way, until there are enough. The focus stays where it is.
  function needPanes(n) {
    var win = T.activeWindow(S.session);
    var added = 0;
    while (T.panesOf(win).length < n) {
      if (win.zoomed) needUnzoom();
      var lay = T.layout(win, S.cols, S.rows);
      var big = lay.panes[0];
      lay.panes.forEach(function (r) { if (r.w * r.h > big.w * big.h) big = r; });
      // A cell is about twice as tall as it is wide.
      nameRoom(T.splitPane(win, big.pane.id, big.w >= big.h * 2.2 ? 'lr' : 'tb', null, true));
      added++;
    }
    if (added) note(tx('ペインを {0} つ足した', added));
  }

  function needZoom() {
    needPanes(2);
    var win = T.activeWindow(S.session);
    if (win.zoomed) return;
    win.zoomed = true;
    note(tx('このペインを全画面にした'));
  }

  // At least `n` windows in the session, the new ones behind the active one.
  function needWindows(n) {
    var added = [];
    while (S.session.windows.length < n) {
      var w = T.createWindow(S.session, freeWing());
      nameRoom(T.activePane(w));
      added.push(winLabel(w));
    }
    if (added.length) note(tx('ウィンドウ {0} を足した', added.join(tx('、'))));
  }

  function freeWing() {
    var used = {};
    S.session.windows.forEach(function (w) { used[w.name] = true; });
    for (var i = 0; i < WINGS.length; i++) if (!used[WINGS[i]]) return WINGS[i];
    return 'zsh';
  }

  // Session names the orders use: short words a real session might be called.
  var SESSION_NAMES = ['work', 'ssh', 'memo', 'log', 'sub', 'test'];

  function freeSessionName() {
    for (var i = 0; i < SESSION_NAMES.length; i++) if (!sessionByName(SESSION_NAMES[i])) return SESSION_NAMES[i];
    return freshName();
  }

  // At least `n` sessions, made in the background: the player stays where they are.
  function needSessions(n) {
    var added = [];
    while (S.sessions.length < n) added.push(makeSession(freeSessionName()).name);
    if (added.length) note(tx('セッション {0} を足した', added.join(tx('、'))));
  }

  function otherSessions() {
    return S.sessions.filter(function (s) { return s !== S.session; });
  }

  // The panes of the active window other than the one the player is in,
  // and the windows other than the active one: what a question may target.
  function otherPanes() {
    var win = T.activeWindow(S.session);
    return T.panesOf(win).filter(function (p) { return p.id !== win.active; });
  }

  function otherWindows() {
    return S.session.windows.filter(function (w) { return w.id !== S.session.active; });
  }

  function pick(r, list) { return list[pickInt(r, list.length)]; }

  // The rectangle a pane would have with the window unzoomed.
  function rectUnzoomed(win, id) {
    var z = win.zoomed;
    win.zoomed = false;
    var r = T.rectOf(win, id, S.cols, S.rows);
    win.zoomed = z;
    return r;
  }

  function paneExists(id) { return !!T.findPane(S.session, id); }

  // Whether a pane has an ancestor split along `axis`: whether a resize on
  // that axis can move anything.
  function hasAxis(win, id, axis) {
    var found = false;
    (function walk(node, on) {
      if (node.type === 'pane') { if (node.pane.id === id) found = on; return; }
      walk(node.a, on || node.dir === axis); walk(node.b, on || node.dir === axis);
    })(win.root, false);
    return found;
  }

  // The first pane in layout order is the top-left one.
  function isFirst(id) {
    var h = T.findPane(S.session, id);
    return !!h && T.panesOf(h.win)[0].id === id;
  }

  function scrollInfo(pane) {
    var el = paneBodyEl(pane.id);
    if (!el) return null;
    var lh = S.cellH;
    var history = Math.round((el.scrollHeight - el.clientHeight) / lh);
    var pos = Math.round((el.scrollHeight - el.clientHeight - el.scrollTop) / lh);
    return { history: Math.max(0, history), pos: Math.max(0, pos) };
  }

  function paneBodyEl(id) {
    var el = $('#term [data-pane-id="' + id + '"] .pane-body');
    return el || null;
  }

  // ---- key handling ------------------------------------------------------

  // k: {key, code, ctrl, alt, shift, meta}. Returns true when consumed.
  function handleKey(k) {
    if (S.screen !== 'game') return false;
    if (S.replay) return replayKey(k);
    if (S.run && S.run.phase === 'clear' && !isModifierOnly(k.key)) afterClear();
    if (S.run && S.run.phase !== 'play') return !isModifierOnly(k.key);
    if (isModifierOnly(k.key)) return false;
    S.lastAction = null;
    S.lastKey = k;
    var consumed = handleGameKey(k);
    if (consumed) {
      if (S.run) { S.run.keys += 1; logKey(S.run, k); }
      if (S.lastAction && S.lastAction !== 'unbound' && S.lastAction !== 'brief') AU.se('cmd');
      render();
      runTick();
    }
    return consumed;
  }

  // Every key of a run with its ms on the run's clock (the ghost's hands,
  // the replay), and how many keys each question took. Past the cap the log
  // stops and says so (cut), so the server does not count it.
  var LOG_MAX = 1500;
  function logKey(b, k) {
    if (b.phase !== 'play' || !b.klog) return;
    if (b.qlog[b.i]) b.qlog[b.i].k = (b.qlog[b.i].k || 0) + 1;
    if (b.klog.keys.length >= LOG_MAX) { b.klog.cut = 1; return; }
    b.klog.keys.push([Math.max(0, Math.round(performance.now() - b.start)), CF.keyLabel({ key: k.key, ctrl: !!k.ctrl, alt: !!k.alt, shift: !!k.shift })]);
  }

  function isModifierOnly(key) {
    return key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta' || key === 'CapsLock' || key === 'Dead' || key === 'Unidentified' || key === 'Process';
  }

  function isPrefix(k) { return CF.isPrefix(S.conf, k); }

  function handleGameKey(k) {
    if (S.detached) {
      if (isPrefix(k)) {
        if (!S.hinted) {
          S.hinted = true;
          S.outer.lines.push({ html: '<span class="sh-dim">' + esc(tx('（ここは tmux の外。prefix は効かない。tmux attach で戻ろう）')) + '</span>' });
        }
        return true;
      }
      if (k.meta) return false;
      return editLine(S.outer, k, runOuterCommand);
    }

    var win = T.activeWindow(S.session);
    var pane = T.activePane(win);

    // Cmd+V pastes the system clipboard, not tmux's buffer.
    if ((k.meta && !k.ctrl && k.key.toLowerCase() === 'v') || (k.ctrl && k.shift && k.key.toLowerCase() === 'v')) {
      message(tx('tmux のコピーは tmux の中にある。{0} → {1} で貼る', prefixLabel(), ownKey(']').label || ']'));
      return true;
    }
    // Cmd+b on a Mac: the prefix letter with the wrong modifier.
    var ps = prefixSpec();
    if (k.meta && !k.ctrl && ps.ctrl && k.key.toLowerCase() === ps.key) {
      message(tx('Cmd ではなく Ctrl を押しながら {0}', ps.key));
      S.lastAction = 'brief';
      return true;
    }
    if (k.meta) return false;

    // confirm-before: y runs it; any other key cancels, as in tmux.
    if (S.confirm) {
      if ((k.key === 'y' || k.key === 'Y') && !k.ctrl && !k.alt) { var yes = S.confirm.yes; S.confirm = null; yes(); }
      else S.confirm = null;
      return true;
    }
    if (S.prompt) {
      // command-prompt -1 (f, t in copy mode): the first key is the answer.
      if (S.prompt.one && k.key.length === 1 && !k.ctrl && !k.alt) { var p1 = S.prompt; S.prompt = null; p1.done(k.key); return true; }
      if (k.key === 'Enter') { var p = S.prompt; S.prompt = null; p.done(p.value); return true; }
      if (k.key === 'Escape' || (k.ctrl && (k.key === 'c' || k.key === 'g'))) { S.prompt = null; return true; }
      lineEdit(S.prompt, 'value', k);
      return true;
    }
    if (S.picker) return pickerKey(k);

    // display-panes (prefix q): a number while the numbers show goes to that
    // pane; any other key takes the numbers away and does its own work.
    if (S.panesShown) {
      hidePaneNumbers();
      if (/^[0-9]$/.test(k.key) && !k.ctrl && !k.alt) {
        var dps = T.panesOf(win), dp = dps[Number(k.key) - S.session.paneBaseIndex];
        if (dp) T.selectPane(win, dp.id);
        S.lastAction = 'focus';
        return true;
      }
    }

    if (isPrefix(k)) {
      S.repeatUntil = 0;
      if (S.armed) {
        S.armed = false;
        S.graceUntil = 0;
        // Prefix twice: the prefix key's own binding in the prefix table
        // first (bind C-a last-window), as tmux looks it up.
        var pp = CF.lookup(S.conf, 'prefix', k);
        if (pp && pp.act.run !== 'send-prefix') return runBinding(pp, win, pane);
        // Else send-prefix (tmux's default for C-b C-b). The shell gets the
        // key itself, so C-b (or C-a) still moves the cursor, as in a real tmux.
        if (pane.mode !== 'copy') lineEdit(pane, 'input', prefixEvent());
        // Nothing shows on an empty line, so a beginner who pressed it twice
        // "to make sure" is told where the second one went.
        message(tx('{0} を 2 回押した。2 回目はシェルに入る。もう一度 {0} から', prefixLabel()));
        S.lastAction = 'brief';
        return true;
      }
      AU.se('prefix');
      S.armed = true;
      return true;
    }

    if (S.armed) {
      S.armed = false;
      S.graceUntil = 0;
      var pb = CF.lookup(S.conf, 'prefix', k);
      if (pb) return runBinding(pb, win, pane);
      if (CF.overridden(S.conf, k)) { unbound(k); return true; }
      return prefixedKey(k, win, pane);
    }

    // The player's own keys with no prefix (bind -n, vim-tmux-navigator).
    var rb = CF.lookup(S.conf, 'root', k);
    if (rb) {
      S.graceUntil = 0;
      S.repeatUntil = 0;
      return runBinding(rb, win, pane);
    }

    // Resize keys still coming after the last question was solved belong to
    // that question: swallow them instead of counting a 操作ミス here.
    if (nowMs() < S.graceUntil && repeatBinding(k)) {
      S.graceUntil = nowMs() + 500;
      return true;
    }
    S.graceUntil = 0;

    if (nowMs() < S.repeatUntil) {
      var rp = repeatBinding(k);
      if (rp && rp.bind) return runBinding(rp.bind, win, pane);
      if (rp) { resize(win, pane, rp); armRepeat(); S.lastAction = 'resize'; return true; }
      S.repeatUntil = 0;
    }

    if (pane.mode === 'copy') return copyModeKey(k, pane);
    if (pane.mode === 'view') return viewKey(k, pane);

    // Esc twice in a row with nothing open: back to the title (the mouse-free
    // way to やめる).
    if (k.key === 'Escape') {
      var now = nowMs();
      if (now - (S.escAt || 0) < 1000) { S.escAt = 0; if (!endDrill()) { leaveRun(); showScreen('title'); } return true; }
      S.escAt = now;
      message('もう一度 Esc でやめる');
      S.lastAction = 'brief';
      return true;
    }
    var nx = S.run && S.run.phase === 'play' && S.run.q ? guideMove(S.run) : null;
    // The guide's key pressed without the prefix (an arrow is shown as ↓).
    var kl = ARROWS[{ ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D' }[k.key]] || k.key;
    if (nx && nx.pfx && nx.keys.indexOf(kl) >= 0 && !k.ctrl && !k.alt) message(tx('{0} がシェルに入った。先に {1}（prefix）を押す', kl, prefixLabel()));
    // Backspace on an empty line where the prefix is due: Ctrl+b may be
    // remapped before the browser sees it (Karabiner, Emacs-style keys).
    if (nx && nx.pfx && k.key === 'Backspace' && !k.ctrl && !k.alt && !pane.input && ps.ctrl) {
      message(tx('{0} が Backspace に変わっているかも（Karabiner などのキー変更）。ブラウザをその設定の例外にするか、キー設定で prefix を変えて遊べる', prefixLabel()));
      S.lastAction = 'brief';
      return true;
    }
    var typed = editLine(pane, k, function (line) { runPaneCommand(pane, line); });
    // synchronize-panes: the key goes to every other synchronized pane on
    // screen too (not one in copy mode, nor one hidden by a zoom).
    if (syncOn(win, pane) && !win.zoomed) {
      T.panesOf(win).forEach(function (p) {
        if (p !== pane && !p.mode && syncOn(win, p)) editLine(p, k, function (line) { runPaneCommand(p, line); });
      });
    }
    return typed;
  }

  // Whether a pane takes the keys typed in its window (synchronize-panes):
  // its own pane option, else the window's, else the global one.
  function syncOn(win, pane) {
    if (pane && pane.sync != null) return pane.sync;
    if (win && win.sync != null) return win.sync;
    return !!S.syncAll;
  }

  // A key that repeats without the prefix inside the repeat window: one of
  // the player's -r bindings ({bind}), or the default resize keys.
  function repeatBinding(k) {
    var b = CF.lookup(S.conf, 'prefix', k);
    if (b) return b.repeat ? { bind: b } : null;
    if (CF.overridden(S.conf, k)) return null;
    return resizeBinding(k);
  }

  // Runs one of the player's bindings. Its action is the default key that
  // does the same in the game, so it goes through the default table.
  function runBinding(b, win, pane) {
    var a = b.act;
    // A key bound to something the game lacks (未対応): nothing, said. Not
    // a miss: the game, not the player, is short here.
    if (a.none) { message(tx('{0} の割り当てはゲームでは使えない（未対応）', b.key.label)); S.lastAction = 'brief'; return true; }
    if (a.run === 'send-prefix') { if (pane.mode !== 'copy') lineEdit(pane, 'input', prefixEvent()); S.lastAction = 'brief'; return true; }
    if (a.run === 'clear') { if (pane.mode !== 'copy') pane.lines.push({ clear: true }); S.lastAction = 'brief'; return true; }
    if (a.run === 'noop') { message('source-file: ゲームでは何も起きない'); S.lastAction = 'brief'; return true; }
    if (a.run === 'say') { message(S.legacy ? a.text || '' : expandFormat(a.text || ''), true); S.lastAction = 'brief'; return true; }
    // A command with no key of its own (join-pane, setw synchronize-panes…).
    if (a.run === 'cmd') { runTmuxCommand(a.argv.slice()); if (b.repeat) armRepeat(); return true; }
    // command-prompt -p "label" "template": what is typed fills in %%.
    if (a.run === 'prompt') {
      S.lastAction = 'cmd';
      S.prompt = { label: a.label, value: '', done: function (v) { runTmuxCommand(a.tpl.replace(/%%|%1/g, v)); } };
      return true;
    }
    if (a.resize) {
      resize(win, pane, { dir: a.resize, n: a.n });
      S.lastAction = 'resize';
    } else {
      prefixedKey({ key: a.key, code: /^[0-9]$/.test(a.key) ? 'Digit' + a.key : a.alt && /^[a-z]$/.test(a.key) ? 'Key' + a.key.toUpperCase() : undefined, ctrl: !!a.ctrl, alt: !!a.alt, shift: false, meta: false }, win, pane);
      // kill-pane / kill-window with no confirm-before: at once.
      if (a.now && S.confirm) { var yes = S.confirm.yes; S.confirm = null; yes(); }
    }
    if (b.repeat) armRepeat(); else if (a.resize) S.repeatUntil = 0;
    return true;
  }

  // tmux's resize bindings (repeatable).
  function resizeBinding(k) {
    var arrows = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D' };
    if (arrows[k.key] && (k.ctrl || k.alt)) return { dir: arrows[k.key], n: k.alt ? 5 : 1 };
    return null;
  }

  // resize-pane -x / -y: the pane made that many cells (or that % of the
  // window) wide or tall, by whichever way its border can move.
  function resizeTo(win, pane, axis, want) {
    var size = function (w) { var r = T.rectOf(w, pane.id, S.cols, S.rows); return r ? (axis === 'lr' ? r.w : r.h) : 0; };
    var total = axis === 'lr' ? S.cols : S.rows, cur = size(win);
    var n = /%$/.test(want) ? Math.round(total * parseInt(want, 10) / 100) : parseInt(want, 10);
    if (!(n > 0) || n === cur) return;
    var best = 0, bestOff = Math.abs(cur - n);
    [n - cur, cur - n].forEach(function (d) {
      var copy = JSON.parse(JSON.stringify(win));
      T.resizePane(copy, pane.id, axis, d, S.cols, S.rows);
      var off = Math.abs(size(copy) - n);
      if (off < bestOff) { bestOff = off; best = d; }
    });
    if (best) T.resizePane(win, pane.id, axis, best, S.cols, S.rows);
  }

  function resize(win, pane, r) {
    var axis = (r.dir === 'L' || r.dir === 'R') ? 'lr' : 'tb';
    var n = (r.dir === 'L' || r.dir === 'U') ? -r.n : r.n;
    // resize-pane unzooms the window first, as tmux does.
    if (!T.resizePane(win, pane.id, axis, n, S.cols, S.rows)) {
      var other = axis === 'lr' ? '↑ / ↓' : '← / →';
      message(T.panesOf(win).length < 2 ? 'ペインが 1 つだけなので動かせない。先に分割しよう'
        : tx('この向きにはもう動かせない。反対向きか、{0} を試そう', other));
    }
  }

  function prefixedKey(k, win, pane) {
    var key = k.key;
    var rz = resizeBinding(k);
    // Ctrl still held from the prefix on an arrow the guide wants plain: as
    // in tmux it resizes by a cell and the prefix is used up; not a miss,
    // and said how to go on.
    if (rz && k.ctrl && !k.alt && guideWants(ARROWS[rz.dir])) {
      resize(win, pane, rz);
      message(tx('Ctrl+矢印は大きさを変えるキー。prefix が外れた。もう一度 {0}、Ctrl を離して {1}', prefixLabel(), ARROWS[rz.dir]));
      S.lastAction = 'brief';
      return true;
    }
    if (rz) { resize(win, pane, rz); armRepeat(); S.lastAction = 'resize'; return true; }
    // Shift forgotten: 5 for %, 7 for &… (US and JIS keyboards). Said, not
    // counted. A digit that names a window there is still goes to it.
    var want = guideWants(null);
    if (want && !k.ctrl && !k.alt && (UNSHIFTED[key] || '').indexOf(want) >= 0 && !(/^[0-9]$/.test(key) && T.windowByIndex(S.session, Number(key)))) {
      message(tx('Shift を押しながら {0}（{1}）', key, want));
      S.lastAction = 'brief';
      return true;
    }

    // Alt+1..7: select-layout (tmux). e.code survives Option's character remap on a Mac.
    if (k.alt && !k.ctrl && /^Digit[1-7]$/.test(k.code || '')) {
      T.applyLayout(win, T.LAYOUT_KEYS[Number(k.code.slice(5)) - 1]);
      S.lastAction = 'layout';
      return true;
    }
    // C-o rotate-window, M-o rotate-window -D.
    if (k.ctrl && !k.alt && key.toLowerCase() === 'o') { T.rotateWindow(win); S.lastAction = 'swap'; return true; }
    if (k.alt && !k.ctrl && (k.code === 'KeyO' || key === 'o')) { T.rotateWindow(win, true); S.lastAction = 'swap'; return true; }
    // Ctrl still held from the prefix: Ctrl+z is not z, and the prefix is
    // used up by it, as in tmux. Said how to go on, not counted.
    if (k.ctrl && !k.alt && DEFAULT_KEYS.indexOf(key.length === 1 ? key.toLowerCase() : key) >= 0) {
      message(tx('prefix が外れた。もう一度 {0}、Ctrl を離して {1}', prefixLabel(), key.length === 1 ? key.toLowerCase() : key));
      S.lastAction = 'brief';
      return true;
    }
    // tmux 3.x's other default keys that only show something or that the
    // game does not act out: never a miss.
    var other = notActed(k);
    if (other && !S.legacy) { if (other !== '-') message(tx('{0}: ゲームでは再現していない（ミスにはならない）', other)); S.lastAction = 'brief'; return true; }
    if (k.alt && !k.ctrl && !S.legacy && (k.code === 'KeyN' || k.code === 'KeyP' || key === 'n' || key === 'p')) { message(k.code === 'KeyP' || key === 'p' ? 'no previous window' : 'no next window'); S.lastAction = 'brief'; return true; }
    if (k.ctrl || k.alt) { unbound(k); return true; }

    var moves = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D' };
    if (moves[key] && k.shift && !S.legacy) { message(tx('{0}: ゲームでは再現していない（ミスにはならない）', 'refresh-client')); S.lastAction = 'brief'; return true; }
    if (moves[key]) {
      // As select-pane does: the neighbour is found on the unzoomed layout,
      // and moving there unzooms.
      var z = win.zoomed;
      win.zoomed = false;
      var nb = T.neighbour(win, S.cols, S.rows, moves[key]);
      win.zoomed = z;
      if (nb) T.selectPane(win, nb.id);
      else {
        // The split keys in the player's own words.
        var sk = [ownKey('%'), ownKey('"')].filter(function (o) { return !o.none; }).map(function (o) { return o.label; });
        message(sk.length ? tx('そちらにペインはない（{0} → {1} で分割）', prefixLabel(), sk.join(tx(' か '))) : 'そちらにペインはない');
      }
      S.lastAction = 'focus';
      return true;
    }

    if (key === '%') { nameRoom(T.splitPane(win, pane.id, 'lr', null, false)); S.lastAction = 'split_lr'; return true; }
    if (key === '"') { nameRoom(T.splitPane(win, pane.id, 'tb', null, false)); S.lastAction = 'split_tb'; return true; }
    if (key === 'z') {
      // resize-pane -Z on a window of one pane does nothing in tmux.
      if (T.panesOf(win).length < 2) message('ペインが 1 つだけなので全画面にはならない');
      else win.zoomed = !win.zoomed;
      S.lastAction = 'zoom';
      return true;
    }
    if (key === 'q') { showPaneNumbers(); S.lastAction = 'brief'; return true; }
    // clock-mode: a look at the time, nothing changed, not a miss.
    if (key === 't') { message(tx('{0}（clock-mode: 時計を出すキー。どのキーでも戻る）', hhmm(new Date()))); S.lastAction = 'brief'; return true; }
    if (key === "'") {
      // command-prompt -p index "select-window -t ':%%'"
      S.lastAction = 'select_window';
      S.prompt = { label: INDEX_PROMPT, value: '', done: function (v) {
        var w = /^\d+$/.test(v.trim()) ? T.windowByIndex(S.session, Number(v.trim())) : null;
        if (w) T.selectWindow(S.session, w.id);
        else if (v.trim()) message(tx('ウィンドウ {0} はない', v.trim()));
        S.lastAction = 'select_window';
      } };
      return true;
    }
    if (key === 'PageUp') { enterCopy(pane); copyModeKey({ key: 'PageUp' }, pane); S.lastAction = 'copy'; return true; }
    if (key === '=' || key === '#') {
      // choose-buffer / list-buffers: the game has one buffer.
      S.lastAction = 'brief';
      if (!S.clipboard) { if (key === '#') message('no buffers'); return true; }
      if (key === '#') message('buffer0: ' + S.clipboard.length + ' bytes: "' + S.clipboard.split('\n')[0].slice(0, 30) + '"');
      else S.picker = { kind: 'buffer', idx: 0 };
      return true;
    }
    if (key === 'x') {
      var idx = T.paneIndex(S.session, win, pane);
      S.lastAction = 'close';
      S.confirm = {
        pane: pane.id,
        text: 'kill-pane ' + idx + '? (y/n)',
        yes: function () {
          if (!T.killPane(win, pane.id)) {
            if (!T.killWindow(S.session, win.id)) message('最後のペインは閉じられない');
          }
        }
      };
      return true;
    }
    if (key === '&') {
      S.lastAction = 'kill_window';
      S.confirm = {
        win: win.id,
        text: 'kill-window ' + win.name + '? (y/n)',
        yes: function () { if (!T.killWindow(S.session, win.id)) message('最後のウィンドウは閉じられない'); }
      };
      return true;
    }
    if (key === 'c') { var w = T.createWindow(S.session, 'zsh'); T.selectWindow(S.session, w.id); nameRoom(T.activePane(w)); S.lastAction = 'new_window'; return true; }
    if (key === '!') {
      // break-pane: the pane becomes a window of its own, and you go with it.
      breakPane(win, pane);
      S.lastAction = 'break_pane';
      return true;
    }
    if (key === 'n') { T.nextWindow(S.session, 1); S.lastAction = 'select_window'; return true; }
    if (key === 'p') { T.nextWindow(S.session, -1); S.lastAction = 'select_window'; return true; }
    if (/^[0-9]$/.test(key)) {
      var target = T.windowByIndex(S.session, Number(key));
      if (target) T.selectWindow(S.session, target.id);
      else message(tx('ウィンドウ {0} はない', key));
      S.lastAction = 'select_window';
      return true;
    }
    if (key === ',') {
      S.lastAction = 'rename';
      S.prompt = { label: '(rename-window)', value: win.name, done: function (v) { if (v.trim()) win.name = v.trim(); } };
      return true;
    }
    if (key === '[') { enterCopy(pane); S.lastAction = 'copy'; return true; }
    if (key === 'd') { detach(); S.lastAction = 'detach'; return true; }
    // display-message, list-keys, show-messages: only something to see.
    if (!S.legacy && (key === 'i' || key === '?' || key === '~')) { runTmuxCommand([key === 'i' ? 'display-message' : key === '?' ? 'list-keys' : 'show-messages']); return true; }
    if (key === 'i' || key === '?') {
      S.lastAction = 'brief';
      message('押すキーは画面の手順に出ている');
      return true;
    }
    if (key === '$') {
      S.lastAction = 'rename_session';
      var sess = S.session;
      S.prompt = { label: '(rename-session)', value: sess.name, done: function (v) { renameSession(sess, v.trim()); } };
      return true;
    }
    // Opening the list changes nothing yet (Esc closes it): not a miss.
    if (key === 's' || key === 'w') { openPicker(key === 'w'); S.lastAction = 'brief'; return true; }
    if (key === '(' || key === ')') {
      var at = S.sessions.indexOf(S.session);
      var n = S.sessions.length;
      switchSession(S.sessions[((at + (key === ')' ? 1 : -1)) % n + n) % n]);
      S.lastAction = 'choose';
      return true;
    }
    if (key === 'L') {
      // switch-client -l: the session you were in before.
      if (S.lastSession && S.sessions.indexOf(S.lastSession) >= 0) switchSession(S.lastSession);
      else message('no last session');
      S.lastAction = 'choose';
      return true;
    }
    if (key === '{' || key === '}') { T.swapStep(win, key === '{' ? -1 : 1); S.lastAction = 'swap'; return true; }
    if (!S.legacy && key === 'E') { T.spreadOut(win, pane.id); S.lastAction = 'layout'; return true; }
    if (!S.legacy && (key === '.' || key === 'T' || key === 'f')) {
      // command-prompt { move-window -t "%%" }, -I "#T" { select-pane -T "%%" }, { find-window -Z "%%" }.
      S.lastAction = 'cmd';
      if (key === '.') S.prompt = { label: '(move-window)', value: '', done: function (v) { if (v.trim()) runTmuxCommand(['move-window', '-t', v.trim()]); } };
      else if (key === 'T') S.prompt = { label: '(select-pane)', value: pane.name || '', done: function (v) { pane.name = v; S.lastAction = 'rename_pane'; } };
      else S.prompt = { label: '(find-window)', value: '', done: function (v) { findWindow(v); } };
      return true;
    }
    if (!S.legacy && (key === 'm' || key === 'M')) { markPane(key === 'm' ? pane : null); return true; }
    if (!S.legacy && key === '-') { S.clipboard = ''; S.lastAction = 'brief'; return true; }
    if (!S.legacy && key === 'r') { S.lastAction = 'brief'; return true; }
    if (key === ' ') { T.nextLayout(win); S.lastAction = 'layout'; return true; }
    if (key === ']') { paste(pane); return true; }
    if (key === ':') { S.lastAction = 'cmd'; S.prompt = { label: ':', value: '', done: runTmuxCommand }; return true; }
    if (key === 'l') {
      // vim hands reach for l to go right: say where it went (not when the
      // 手順 asked for l, nor when the player's own key, Tab say, ran it).
      var wantL = guideWants('l') || !!(S.run && S.run.phase === 'play' && S.run.type === 'last_window') || !(S.lastKey && S.lastKey.key === 'l' && !S.lastKey.ctrl && !S.lastKey.alt);
      if (S.session.last && T.windowById(S.session, S.session.last)) { T.selectWindow(S.session, S.session.last); if (!wantL) message('l は直前のウィンドウへ移るキー。隣のペインへは矢印か o'); }
      else message(wantL ? 'no last window' : 'no last window ― l は直前のウィンドウへ戻るキー。隣のペインへは矢印か o');
      S.lastAction = 'select_window';
      return true;
    }
    if (key === ';') {
      if (win.last && T.findPane(S.session, win.last)) T.selectPane(win, win.last);
      else message('no last pane');
      S.lastAction = 'focus';
      return true;
    }
    if (key === 'o') {
      var ps = T.panesOf(win);
      var at2 = ps.findIndex(function (p) { return p.id === pane.id; });
      T.selectPane(win, ps[(at2 + 1) % ps.length].id);
      S.lastAction = 'focus';
      return true;
    }
    if (key === 'Escape') return true;
    unbound(k);
    return true;
  }

  // A window of one pane is not refused: as in tmux 3.x it just moves to
  // the next free number, which is said, since nothing else shows.
  // -d (`stay`): the new window is made, the focus stays where it was.
  function breakPane(win, pane, stay) {
    if (T.breakPane(S.session, win, pane.id, stay) === win) message(tx('ペインが 1 つだけなので、ウィンドウの番号が {0} に変わっただけ', win.index));
  }

  // The default prefix keys the game has: a Ctrl+key of one of them is a
  // slip of the finger, not a miss.
  var DEFAULT_KEYS = '%"zxc&np,[]d$sw(){} :l;oi?qt\'=#!0123456789E.Tfm-'.split('').concat(['PageUp']);

  // tmux 3.8's default prefix keys the game does not act out (list-keys -T
  // prefix): the command each runs, or '-' for one that shows nothing.
  var NOT_ACTED = { D: 'choose-client', C: 'customize-mode', '/': 'list-keys -1N', '<': 'display-menu', '>': 'display-menu', '@': 'break-pane -W', '*': 'new-pane', Tab: 'new-pane', g: 'switch-client -T move', Delete: '-' };
  function notActed(k) {
    if (k.ctrl && !k.alt && k.key.toLowerCase() === 'z') return 'suspend-client';
    if (k.ctrl || k.alt) return null;
    if (k.key === 'Tab' && k.shift) return 'new-pane';
    return NOT_ACTED[k.key] || null;
  }

  // select-pane -m / -M (prefix m, M): the marked pane, which join-pane and
  // swap-pane take when -s is left out.
  function markPane(p) {
    var was = S.marked;
    S.marked = p && was !== p.id ? p.id : null;
    message(S.marked ? 'ペインに印を付けた（join-pane と swap-pane が -s なしで使う）' : was ? 'ペインの印を外した' : 'no marked pane');
    S.lastAction = 'brief';
  }

  // find-window (prefix f): the window whose name has the text.
  function findWindow(v) {
    S.lastAction = 'brief';
    if (!v) return;
    var hit = S.session.windows.filter(function (w) { return w.name.indexOf(v) >= 0; })[0];
    if (!hit) { message('No windows matching: ' + v); return; }
    T.selectWindow(S.session, hit.id);
    S.lastAction = 'select_window';
  }

  // The key under each shifted prefix key, on a US and on a JIS keyboard.
  var UNSHIFTED = { '5': '%', '2': '"', "'": '"', '7': '&', '6': '&', '4': '$', '[': '{', ']': '}', '9': '()', '8': '(', '0': ')', '1': '!' };

  // The one key the guide asks for after the prefix right now (null when it
  // asks for none, or for something else); with `key`, whether it is that key.
  function guideWants(key) {
    var b = S.run;
    if (!b || b.phase !== 'play' || !b.q) return null;
    var m = guideMove(b);
    if (!m || !m.pfx || m.keys.length !== 1) return null;
    return key == null ? m.keys[0] : m.keys[0] === key;
  }

  var INDEX_PROMPT = 'index';

  function unbound(k) {
    S.lastAction = 'unbound';
    message(tx('{0} には割り当てがない', CF.keyLabel({ key: k.key, ctrl: !!k.ctrl, alt: !!k.alt, shift: !!k.shift })));
  }

  // display-panes: the numbers show for display-panes-time (1 s by default).
  function showPaneNumbers() {
    var ms = S.legacy ? 1000 : optMs('display-panes-time', 1000);
    S.panesShown = Date.now() + ms;
    if (S.sim) return;
    clearTimeout(S.dpTimer);
    S.dpTimer = setTimeout(function () { if (S.panesShown) { S.panesShown = null; if (S.screen === 'game') renderTerm(); } }, ms);
  }

  function hidePaneNumbers() {
    S.panesShown = null;
    clearTimeout(S.dpTimer);
  }

  function withUnzoom(win) {
    if (win.zoomed) win.zoomed = false;
    return win;
  }

  // The tmux command prompt (prefix → :). The commands the game has, with
  // their tmux aliases; the rest is "unknown command", as tmux says it.
  // `line` may be the words already (a binding's command). Commands joined
  // with ; run one after the other, as tmux runs them.
  function runTmuxCommand(line) {
    if (!Array.isArray(line) && !S.legacy) {
      var all = CF.words(line);
      // bind x a \; b keeps the rest: the line goes whole, as in a file.
      if (all.length > 1 && /^(bind-key|unbind-key)$/.test(CF.resolve(all[0][0]).name || '')) { bindNow(line); return; }
      if (all.length > 1) { all.forEach(function (c) { runTmuxCommand(c); }); return; }
    }
    var argv = Array.isArray(line) ? line.slice() : (CF.words(line)[0] || []).slice();
    if (!argv.length) return;
    // A name may be shortened as far as only one command starts so (kill-ses).
    var named = CF.resolve(argv[0], S.legacy);
    if (named.error) { message(named.error, true); S.lastAction = 'unbound'; return; }
    argv[0] = named.name;
    var cmd = argv[0];
    var win = T.activeWindow(S.session);
    var pane = T.activePane(win);
    var o = CF.flags(argv);
    function flag(f) { var v = o.f[f.slice(1)]; return typeof v === 'string' ? v : v ? '' : null; }
    function has(f) { return !!o.f[f.slice(1)]; }
    var dir = has('-L') ? 'L' : has('-R') ? 'R' : has('-U') ? 'U' : has('-D') ? 'D' : null;
    var ARROW = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown' };
    // A default key's work, as if pressed after the prefix.
    function asKey(key, ctrl) { prefixedKey({ key: key, ctrl: !!ctrl, alt: false, shift: false, meta: false, code: /^[0-9]$/.test(key) ? 'Digit' + key : undefined }, win, pane); }
    // -t names a pane (or a window) the way tmux finds it; none: here.
    function paneOr(f, what) {
      var t = flag(f);
      var h = t === null || S.legacy ? { win: win, pane: pane } : paneTarget(t);
      if (!h) { message("can't find pane: " + t); S.lastAction = 'brief'; }
      return h;
    }
    function winOr(f) {
      var t = flag(f);
      var w = t === null || S.legacy ? win : windowTarget(t);
      if (!w) { message("can't find window: " + t); S.lastAction = 'brief'; }
      return w;
    }
    if (!cmd) return;
    if (/^(select-pane|selectp)$/.test(cmd) && flag('-T') === null) {
      if (has('-m') || has('-M')) { markPane(has('-M') ? null : pane); return; }
      var pt = flag('-t');
      if (pt === ':.+' || pt === '+' || pt === '.+') { asKey('o'); return; }
      if (pt !== null && !S.legacy) {
        // Another window's pane becomes its window's own, the focus stays here (tmux).
        var sh = paneOr('-t');
        if (!sh) return;
        if (dir || has('-l')) { message(tx('その select-pane はゲームにない')); S.lastAction = 'brief'; return; }
        if (sh.win === win) { withUnzoom(win); T.selectPane(win, sh.pane.id); } else if (sh.win.active !== sh.pane.id) { sh.win.last = sh.win.active; sh.win.active = sh.pane.id; }
        S.lastAction = 'focus';
        return;
      }
      if (dir) { asKey(ARROW[dir]); return; }
      if (has('-l')) { asKey(';'); return; }
      if (/^\d+$/.test(pt || '')) {
        var sp = T.panesOf(win)[Number(pt) - S.session.paneBaseIndex];
        if (sp) { T.selectPane(win, sp.id); S.lastAction = 'focus'; } else { message("can't find pane: " + pt); S.lastAction = 'brief'; }
        return;
      }
      message(tx('その select-pane はゲームにない')); S.lastAction = 'brief';
      return;
    }
    if (/^(resize-pane|resizep)$/.test(cmd)) {
      var rh = paneOr('-t');
      if (!rh) return;
      // -Z on another pane: that one is zoomed (and becomes its window's own).
      if (has('-Z') && rh.pane === pane) { asKey('z'); return; }
      if (has('-Z')) {
        if (T.panesOf(rh.win).length < 2) message('ペインが 1 つだけなので全画面にはならない');
        else { if (rh.win.active !== rh.pane.id) { rh.win.last = rh.win.active; rh.win.active = rh.pane.id; rh.win.zoomed = true; } else rh.win.zoomed = !rh.win.zoomed; }
        S.lastAction = 'zoom';
        return;
      }
      if (dir) { var rn = parseInt(o.rest[0], 10); resize(rh.win, rh.pane, { dir: dir, n: rn > 0 ? Math.min(rn, 50) : 1 }); S.lastAction = 'resize'; return; }
      if (!S.legacy && (flag('-x') !== null || flag('-y') !== null)) {
        if (flag('-x') !== null) resizeTo(rh.win, rh.pane, 'lr', flag('-x'));
        if (flag('-y') !== null) resizeTo(rh.win, rh.pane, 'tb', flag('-y'));
        S.lastAction = 'resize';
        return;
      }
      message(tx('その resize-pane はゲームにない')); S.lastAction = 'brief';
      return;
    }
    if (/^(last-pane|lastp)$/.test(cmd)) { asKey(';'); return; }
    if (/^(rotate-window|rotatew)$/.test(cmd)) { if (has('-D')) { T.rotateWindow(win, true); S.lastAction = 'swap'; } else asKey('o', true); return; }
    if (/^(next-window|next)$/.test(cmd)) { if (has('-a') && !S.legacy) { message('no next window'); S.lastAction = 'brief'; return; } asKey('n'); return; }
    if (/^(previous-window|prev)$/.test(cmd)) { if (has('-a') && !S.legacy) { message('no previous window'); S.lastAction = 'brief'; return; } asKey('p'); return; }
    if (/^(select-window|selectw)$/.test(cmd)) {
      var wt = flag('-t');
      if (wt !== null && !S.legacy) {
        // A window of another session (sess:2) takes you to that session too.
        var ws = /:/.test(wt) ? sessionTarget(wt) : S.session;
        if (!ws) { message("can't find session: " + wt); S.lastAction = 'brief'; return; }
        var keep = S.session;
        S.session = ws;
        var tw2 = windowTarget(wt.replace(/^[^:]*:/, '').replace(/^=/, ''));
        S.session = keep;
        if (!tw2) { message("can't find window: " + wt); S.lastAction = 'select_window'; return; }
        switchSession(ws);
        T.selectWindow(S.session, tw2.id);
        S.lastAction = 'select_window';
        return;
      }
      var wn = /^:?(\d+)$/.exec(wt || '');
      if (wn) { var tw = T.windowByIndex(S.session, Number(wn[1])); if (tw) T.selectWindow(S.session, tw.id); else message("can't find window: " + wn[1]); S.lastAction = 'select_window'; return; }
      asKey(has('-l') ? 'l' : has('-p') ? 'p' : 'n');
      return;
    }
    if (/^(copy-mode)$/.test(cmd)) { asKey(has('-u') ? 'PageUp' : '['); return; }
    if (/^(paste-buffer|pasteb)$/.test(cmd)) { asKey(']'); return; }
    if (/^(display-panes|displayp)$/.test(cmd)) { asKey('q'); return; }
    if (/^(clock-mode)$/.test(cmd)) { asKey('t'); return; }
    if (/^(choose-window)$/.test(cmd)) { asKey('w'); return; }
    if (/^(kill-session)$/.test(cmd)) {
      var ks = flag('-t') !== null ? (S.legacy ? sessionByName(flag('-t')) : sessionTarget(flag('-t'))) : S.session;
      if (!ks) { message("can't find session: " + flag('-t')); S.lastAction = 'brief'; return; }
      killSession(ks);
      return;
    }
    if (/^(has-session|has)$/.test(cmd) && !S.legacy) {
      if (!sessionTarget(flag('-t'))) message("can't find session: " + flag('-t'));
      S.lastAction = 'brief';
      return;
    }
    // bind / unbind at the prompt: for this session, as a line of the file would.
    if (/^(bind-key|unbind-key)$/.test(cmd) && !S.legacy) { bindNow(argv); return; }
    // join-pane (move-pane): -s the pane to bring, -t the pane to split
    // (this one), -h side by side, -b before it, -d the focus stays.
    if (/^(join-pane|joinp|move-pane|movep)$/.test(cmd)) {
      var src0 = o.f.s == null && !S.legacy && S.marked && paneExists(S.marked) ? T.findPane(S.session, S.marked) : null;
      if (o.f.s == null && !src0) { message('no marked pane'); S.lastAction = 'brief'; return; }
      var js = src0 || paneTarget(o.f.s), jd = paneTarget(o.f.t);
      if (!js || !jd) { message("can't find pane: " + (!js ? o.f.s : o.f.t)); S.lastAction = 'brief'; return; }
      if (js.pane.id === jd.pane.id) { message('source and target panes must be different'); S.lastAction = 'brief'; return; }
      T.joinPane(S.session, js.win, js.pane.id, jd.win, jd.pane.id, o.f.h ? 'lr' : 'tb', !!o.f.b, !!o.f.d);
      if (!o.f.d && jd.win !== win) T.selectWindow(S.session, jd.win.id);
      if (src0) S.marked = null;
      S.lastAction = 'join';
      return;
    }
    if (/^(swap-window|swapw)$/.test(cmd)) {
      var sa = o.f.s != null ? windowTarget(o.f.s) : win, sb = windowTarget(o.f.t);
      if (!sa || !sb) { message("can't find window: " + (!sa ? o.f.s : o.f.t)); S.lastAction = 'brief'; return; }
      T.swapWindows(S.session, sa.id, sb.id, !!o.f.d);
      S.lastAction = 'swap_window';
      return;
    }
    if (/^(move-window|movew)$/.test(cmd)) {
      var mw = o.f.s != null ? windowTarget(o.f.s) : win;
      if (!mw) { message("can't find window: " + o.f.s); S.lastAction = 'brief'; return; }
      S.lastAction = 'move_window';
      if (o.f.r) { T.renumberWindows(S.session); return; }
      var mt = /^(?:[^:]*:)?(\d+)$/.exec(o.f.t || '');
      if (!mt) { message(o.f.t ? "can't find window: " + o.f.t : 'index in use: ' + mw.index); S.lastAction = 'brief'; return; }
      var mi = Number(mt[1]), there = T.windowByIndex(S.session, mi);
      if (there && there !== mw && o.f.k) T.killWindow(S.session, there.id);
      if (!T.moveWindow(S.session, mw.id, mi)) { message('index in use: ' + mi); S.lastAction = 'brief'; }
      return;
    }
    // set / setw: synchronize-panes (-g every window, -p this pane, -u
    // unset; no value turns it over); renumber-windows; the times the game
    // keeps. Any other option changes nothing here, and says so.
    if (/^(set|set-option|setw|set-window-option)$/.test(cmd)) {
      var on = o.rest[0], val = o.rest[1];
      if (on === 'renumber-windows' && !S.legacy) {
        S.renumberOpt = !/^(off|no|0)$/i.test(val || 'on');
        S.sessions.forEach(function (x) { x.renumber = S.renumberOpt; });
        S.lastAction = 'brief';
        return;
      }
      if ((on === 'display-panes-time' || on === 'repeat-time') && !S.legacy) {
        var ms = parseInt(val, 10);
        if (!(ms >= 0 && ms <= 60000)) message('bad value: ' + val);
        else S.opts[on] = on === 'display-panes-time' ? Math.max(1, ms) : ms;
        S.lastAction = 'brief';
        return;
      }
      if (on !== 'synchronize-panes') { message(tx('{0}: ゲームでは何も変わらない設定', on || cmd)); S.lastAction = 'brief'; return; }
      var v = val == null ? null : /^(on|yes|1)$/i.test(val) ? true : /^(off|no|0)$/i.test(val) ? false : 'bad';
      if (v === 'bad') { message('bad value: ' + val); S.lastAction = 'brief'; return; }
      if (o.f.g) S.syncAll = v == null ? !S.syncAll : v;
      else if (o.f.p) pane.sync = o.f.u ? null : v == null ? !syncOn(win, pane) : v;
      else win.sync = o.f.u ? null : v == null ? !syncOn(win, null) : v;
      S.lastAction = 'sync';
      return;
    }
    if (/^(new|new-session|news)$/.test(cmd)) {
      var name = flag('-s') || freshName();
      if (sessionByName(name)) { message('duplicate session: ' + name); return; }
      var s = makeSession(name);
      if (!has('-d')) switchSession(s);
      S.lastAction = 'new_session';
    } else if (/^(attach-session|attach)$/.test(cmd) && !S.legacy) {
      // From inside, attach -t moves this client there (switch-client).
      var as = sessionTarget(flag('-t'));
      if (!as) { message("can't find session: " + flag('-t')); S.lastAction = 'brief'; return; }
      switchSession(as);
      S.lastAction = 'choose';
    } else if (/^(rename-session|rename)$/.test(cmd)) {
      var rs = S.legacy ? S.session : sessionTarget(flag('-t'));
      if (!rs) { message("can't find session: " + flag('-t')); S.lastAction = 'brief'; return; }
      renameSession(rs, (S.legacy ? argv.slice(1) : o.rest).join(' ').trim());
      S.lastAction = 'rename_session';
    } else if (/^(switch-client|switchc)$/.test(cmd)) {
      var st = flag('-t');
      var sw = st !== null ? (S.legacy ? sessionByName(st) : sessionTarget(st))
        : has('-l') ? S.lastSession
        : S.sessions[((S.sessions.indexOf(S.session) + (has('-p') ? -1 : 1)) % S.sessions.length + S.sessions.length) % S.sessions.length];
      if (sw && S.sessions.indexOf(sw) >= 0) {
        switchSession(sw);
        // sess:2 picks the window there too.
        var sww = st && !S.legacy && /:./.test(st) ? windowTarget(st) : null;
        if (sww) T.selectWindow(S.session, sww.id);
      } else message(st !== null ? 'can\'t find session: ' + st : 'no last session');
      S.lastAction = 'choose';
    } else if (/^(new-window|neww)$/.test(cmd)) {
      var nt = S.legacy ? null : /^(?:[^:]*:)?(\d+)$/.exec(flag('-t') || '');
      if (nt && T.windowByIndex(S.session, Number(nt[1]))) { message('index in use: ' + nt[1]); S.lastAction = 'brief'; return; }
      var w = T.createWindow(S.session, flag('-n') || 'zsh');
      if (nt) T.moveWindow(S.session, w.id, Number(nt[1]));
      if (!has('-d') || S.legacy) T.selectWindow(S.session, w.id);
      nameRoom(T.activePane(w));
      S.lastAction = 'new_window';
    } else if (/^(rename-window|renamew)$/.test(cmd)) {
      var rw = winOr('-t');
      if (!rw) return;
      var nm = (S.legacy ? argv.slice(1) : o.rest).join(' ');
      if (nm) rw.name = nm;
      S.lastAction = 'rename';
    } else if (/^(split-window|splitw)$/.test(cmd)) {
      var lr = has('-h');
      var sph = paneOr('-t');
      if (!sph) return;
      nameRoom(T.splitPane(sph.win, sph.pane.id, lr ? 'lr' : 'tb', null, has('-d') && !S.legacy));
      S.lastAction = lr ? 'split_lr' : 'split_tb';
    } else if (/^(kill-pane|killp)$/.test(cmd)) {
      var kh = paneOr('-t');
      if (!kh) return;
      if (has('-a') && !S.legacy) T.panesOf(kh.win).forEach(function (p) { if (p !== kh.pane) T.killPane(kh.win, p.id); });
      else if (!T.killPane(kh.win, kh.pane.id)) message('最後のペインは閉じられない');
      S.lastAction = 'close';
    } else if (/^(kill-window|killw)$/.test(cmd)) {
      var kw = winOr('-t');
      if (!kw) return;
      if (has('-a') && !S.legacy) S.session.windows.slice().forEach(function (x) { if (x !== kw) T.killWindow(S.session, x.id); });
      else if (!T.killWindow(S.session, kw.id)) message('最後のウィンドウは閉じられない');
      S.lastAction = 'kill_window';
    } else if (/^(break-pane|breakp)$/.test(cmd)) {
      var bh = paneOr('-s');
      if (!bh) return;
      breakPane(bh.win, bh.pane, !S.legacy && has('-d'));
      S.lastAction = 'break_pane';
    } else if (/^(last-window|last)$/.test(cmd)) {
      if (S.session.last && T.windowById(S.session, S.session.last)) T.selectWindow(S.session, S.session.last);
      else message('no last window');
      S.lastAction = 'select_window';
    } else if (/^(select-layout|selectl)$/.test(cmd)) {
      // A name, or the start of one (even-h); -n / -p next and previous; -E
      // spread evenly; none: the last one again.
      var lay = o.rest[0] || '';
      var hits = T.LAYOUTS.filter(function (n) { return lay && n.indexOf(lay) === 0; });
      if (T.LAYOUTS.indexOf(lay) >= 0) hits = [lay];
      if (o.f.E && !S.legacy) { asKey('E'); return; }
      if (o.f.n || o.f.p) T.nextLayout(win, !!o.f.p);
      else if (!lay && win.lastLayout >= 0) T.applyLayout(win, T.LAYOUTS[win.lastLayout]);
      else if (hits.length === 1) T.applyLayout(win, hits[0]);
      else { message('unknown layout: ' + lay); S.lastAction = 'brief'; return; }
      S.lastAction = 'layout';
    } else if (/^(next-layout|nextl|previous-layout|prevl)$/.test(cmd)) {
      T.nextLayout(win, /^prev/.test(cmd));
      S.lastAction = 'layout';
    } else if (/^(swap-pane|swapp)$/.test(cmd)) {
      if (!S.legacy && !has('-U') && !has('-D') && (flag('-s') !== null || flag('-t') !== null || S.marked)) {
        // -s (else the marked pane, else this one) trades places with -t
        // (else this one); without -d the focus goes to -t's pane, as tmux does.
        var ss = flag('-s') !== null ? paneOr('-s') : S.marked && paneExists(S.marked) && flag('-t') !== null ? T.findPane(S.session, S.marked) : { win: win, pane: pane };
        var sd = ss && paneOr('-t');
        if (!ss || !sd) return;
        if (ss.win !== sd.win) { message(tx('ほかのウィンドウとのペインの入れ替えはゲームにない')); S.lastAction = 'brief'; return; }
        T.swapPanes(ss.win, ss.pane.id, sd.pane.id);
        if (!has('-d') && ss.win.active !== sd.pane.id) { ss.win.last = ss.win.active; ss.win.active = sd.pane.id; }
        S.lastAction = 'swap';
        return;
      }
      T.swapStep(win, has('-U') ? -1 : 1);
      S.lastAction = 'swap';
    } else if (/^(select-pane|selectp)$/.test(cmd) && flag('-T') !== null) {
      pane.name = argv.slice(argv.indexOf('-T') + 1).join(' ');
      S.lastAction = 'rename_pane';
    } else if (/^(detach|detach-client)$/.test(cmd)) {
      detach();
      S.lastAction = 'detach';
    } else if (/^(choose-tree|choose-session)$/.test(cmd)) {
      openPicker(has('-w'));
      S.lastAction = 'choose';
    } else if (/^(list-sessions|ls)$/.test(cmd)) {
      message(sessionLines().join(' / '));
    } else if (S.legacy) {
      // As the game was then: the commands below did not exist.
      message('unknown command: ' + cmd);
      S.lastAction = 'unbound';
    } else freeCommand(cmd, argv, o, win, pane);
  }

  // bind / unbind typed at the prompt: read as one more line of the file,
  // for this run (or 練習) only; what it did is said, as the file's report says it.
  function bindNow(line) {
    S.lastAction = 'brief';
    var text = typeof line === 'string' ? line : line.map(function (w) { return /[\s;"']/.test(w) ? "'" + w.replace(/'/g, '') + "'" : w; }).join(' ');
    S.extraConf = (S.extraConf || []).concat([text]);
    var base = S.confText || '';
    var c = CF.parse(base + '\n' + S.extraConf.join('\n'));
    var no = base.split('\n').length + S.extraConf.length;
    S.conf = c.custom ? c : null;
    var used = c.used.filter(function (u) { return u.no === no; })[0], cant = c.unsupported.filter(function (u) { return u.no === no; })[0];
    message(used ? used.say : cant ? tx('未対応: {0}', cant.why) : text, true);
  }

  // The keys bound at the prompt go when the run (or 練習) ends: the file's own come back.
  function dropBinds() {
    if (!S.extraConf || !S.extraConf.length) return;
    S.extraConf = [];
    var c = CF.parse(S.confText || '', { legacy: S.legacy });
    S.conf = c.custom ? c : null;
  }

  // display-panes-time and repeat-time: set at the prompt, else the file's, else tmux's.
  function optMs(name, def) {
    if (S.opts && S.opts[name] != null) return S.opts[name];
    var v = S.conf && S.conf[name === 'repeat-time' ? 'repeatTime' : 'displayPanesTime'];
    return v != null ? v : def;
  }

  // The commands that only show something, and the real tmux commands the
  // game does not act out: never a miss (S.lastAction 'brief'), whatever
  // the question. send-keys types into a pane and counts as typing there.
  function freeCommand(cmd, argv, o, win, pane) {
    S.lastAction = 'brief';
    if (cmd === 'display-message') {
      var text = o.rest.join(' ');
      // -p prints to the client; the game has the status line for both.
      message(expandFormat(text || '[#S] #I:#W, current pane #P - (%H:%M %d-%b-%y)'), true);
      return;
    }
    if (cmd === 'send-keys') {
      var to = paneTarget(o.f.t);
      if (!to) { message("can't find pane: " + o.f.t, true); return; }
      if (o.f.X) {
        // A copy-mode command, as a key of that mode would run it.
        var cc = o.rest[0] || '';
        if (to.pane.mode !== 'copy') { message('not in a mode', true); return; }
        if (/^search-(backward|forward)/.test(cc) && o.rest[1]) {
          to.pane.search = { term: o.rest.slice(1).join(' '), dir: /backward/.test(cc) ? -1 : 1 };
          search(to.pane, to.pane.search.dir);
          S.lastAction = 'search';
          return;
        }
        if (COPY_AS_KEY[cc] || /^(cancel|clear-selection|begin-selection|select-line|copy-|rectangle-toggle)/.test(cc)) { copyCommand(to.pane, cc, S.conf && S.conf.modeKeys === 'emacs'); return; }
        message(tx('{0}: ゲームでは再現していない（ミスにはならない）', 'send-keys -X ' + cc), true);
        return;
      }
      sendKeys(to.win, to.pane, o.rest, !!o.f.l);
      return;
    }
    if (cmd === 'show-messages') { openView(pane, S.msgLog.length ? S.msgLog.slice() : ['']); return; }
    if (cmd === 'list-keys') { openView(pane, listKeys(o.f.T), S.free ? 'キーと tmux コマンド（英語）。日本語は下の「覚えたキー」。q で閉じる' : 'キーと tmux コマンド（英語）の一覧。q で閉じる'); return; }
    if (cmd === 'list-windows') { openView(pane, S.session.windows.map(function (w) { return w.index + ': ' + w.name + (w.id === S.session.active ? '*' : w.id === S.session.last ? '-' : '') + (w.zoomed ? 'Z' : '') + ' (' + T.panesOf(w).length + ' panes)' + (w.id === S.session.active ? ' (active)' : ''); })); return; }
    if (cmd === 'list-panes') { openView(pane, T.panesOf(win).map(function (p) { return T.paneIndex(S.session, win, p) + ':' + (p.id === win.active ? ' (active)' : ''); })); return; }
    if (cmd === 'list-buffers') { message(S.clipboard ? 'buffer0: ' + S.clipboard.length + ' bytes: "' + S.clipboard.split('\n')[0].slice(0, 30) + '"' : 'no buffers', true); return; }
    if (cmd === 'show-options' || cmd === 'show-window-options') { openView(pane, optionLines()); return; }
    if (cmd === 'source-file') { message(tx('{0}: ゲームでは使えない（ミスにはならない）', 'source-file'), true); return; }
    message(tx('{0}: ゲームでは再現していない（ミスにはならない）', cmd), true);
  }

  // display-message's formats, the common ones: #S #W #I #P #H #T ##,
  // #{name}, #{?name,yes,no}, and strftime's %H %M %S %d %m %b %y %Y. A
  // name the game does not know is empty, as tmux makes it.
  function expandFormat(text) {
    var win = T.activeWindow(S.session), pane = T.activePane(win), now = new Date();
    var V = {
      session_name: S.session.name, window_name: win.name, window_index: win.index, pane_index: T.paneIndex(S.session, win, pane),
      pane_id: '%' + String(pane.id).replace(/\D/g, ''), pane_title: 'dojo', host: 'dojo', host_short: 'dojo', pane_current_path: '/home/dojo',
      pane_current_command: 'zsh', session_windows: S.session.windows.length, window_panes: T.panesOf(win).length,
      pane_synchronized: syncOn(win, pane) ? 1 : 0, window_zoomed_flag: win.zoomed ? 1 : 0, pane_in_mode: pane.mode ? 1 : 0,
      client_prefix: S.armed ? 1 : 0, session_attached: 1, version: '3.8'
    };
    var SHORT = { S: 'session_name', W: 'window_name', I: 'window_index', P: 'pane_index', H: 'host', h: 'host_short', T: 'pane_title', D: 'pane_id' };
    var val = function (n) { return V[n] == null ? '' : String(V[n]); };
    var out = String(text).replace(/#\{\?([\w]+),([^,}]*),([^}]*)\}/g, function (m, n, a, b) { return val(n) && val(n) !== '0' ? a : b; })
      .replace(/#\{([\w]+)\}/g, function (m, n) { return val(n); })
      .replace(/#([SWIPHhTD#])/g, function (m, c) { return c === '#' ? '#' : val(SHORT[c]); });
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var F = { H: two(now.getHours()), M: two(now.getMinutes()), S: two(now.getSeconds()), d: two(now.getDate()), m: two(now.getMonth() + 1), b: MON[now.getMonth()], y: two(now.getFullYear() % 100), Y: String(now.getFullYear()), '%': '%' };
    return out.replace(/%([HMSdmbyY%])/g, function (m, c) { return F[c]; });
  }

  // send-keys: each word a key name (Enter, C-c, Space…) or text typed as
  // it is (-l: all of them as text). It goes to the pane's shell, and to
  // the others there if their window has synchronize-panes on (tmux does).
  function sendKeys(win, pane, words, literal) {
    var evs = [];
    words.forEach(function (w) {
      var k = !literal && w.length > 1 && CF.parseKey(w);
      if (k) evs.push({ key: k.key, ctrl: k.ctrl, alt: k.alt, shift: k.shift, meta: false });
      else String(w).split('').forEach(function (ch) { evs.push({ key: ch, ctrl: false, alt: false, shift: false, meta: false }); });
    });
    var to = [pane];
    if (syncOn(win, pane) && !win.zoomed) T.panesOf(win).forEach(function (p) { if (p !== pane && syncOn(win, p)) to.push(p); });
    to.forEach(function (p) {
      if (p.mode) return;
      evs.forEach(function (ev) { editLine(p, ev, function (line) { runPaneCommand(p, line); }); });
    });
    // A command run there (exit, say) said what it was; typing is not a miss.
    if (S.lastAction === 'brief' || S.lastAction == null) S.lastAction = 'brief';
  }

  // ---- views (list-keys, show-messages): read-only text over the pane ---
  // As tmux's view mode: the lines from the top, [position/lines] at the
  // top right, j k and the page keys move, q or Esc leaves.

  // `hint`: one line of plain words above the list (not tmux's own).
  function openView(pane, lines, hint) {
    pane.mode = 'view';
    pane.view = { lines: lines, top: 0, hint: hint || null };
  }

  function viewRows(pane) {
    var el = paneBodyEl(pane.id);
    return el ? Math.max(1, Math.floor(el.clientHeight / S.cellH) - (pane.view && pane.view.hint ? 1 : 0)) : 20;
  }

  function viewKey(k, pane) {
    var v = pane.view, key = k.key, rows = viewRows(pane);
    var max = Math.max(0, v.lines.length - rows);
    S.lastAction = 'brief';
    if (key === 'q' || key === 'Escape' || (k.ctrl && (key === 'c' || key === 'g'))) { pane.mode = null; pane.view = null; return true; }
    if (key === 'ArrowDown' || key === 'j' || key === 'Enter' || (k.ctrl && (key === 'n' || key === 'e'))) v.top += 1;
    else if (key === 'ArrowUp' || key === 'k' || (k.ctrl && (key === 'p' || key === 'y'))) v.top -= 1;
    else if (key === 'PageDown' || key === ' ' || (k.ctrl && key === 'f')) v.top += rows - 1;
    else if (key === 'PageUp' || (k.ctrl && key === 'b')) v.top -= rows - 1;
    else if (k.ctrl && key === 'd') v.top += Math.floor(rows / 2);
    else if (k.ctrl && key === 'u') v.top -= Math.floor(rows / 2);
    else if (key === 'g' || (k.alt && k.code === 'Comma')) v.top = 0;
    else if (key === 'G' || (k.alt && k.code === 'Period')) v.top = max;
    v.top = Math.max(0, Math.min(max, v.top));
    return true;
  }

  // list-keys as tmux prints it: the default keys the game has (or what the
  // player's file made of them), then the file's own.
  var DEFAULT_BINDS = [
    ['Space', 'next-layout'], ['!', 'break-pane'], ['\\"', 'split-window'], ['\\#', 'list-buffers'], ['\\$', 'command-prompt -I "#S" { rename-session "%%" }'],
    ['\\%', 'split-window -h'], ['&', 'confirm-before -p "kill-window #W? (y/n)" kill-window'], ["\\'", 'command-prompt -p index { select-window -t ":%%" }'],
    ['(', 'switch-client -p'], [')', 'switch-client -n'], [',', 'command-prompt -I "#W" { rename-window "%%" }'],
    ['0', 'select-window -t :=0'], ['1', 'select-window -t :=1'], ['2', 'select-window -t :=2'], ['3', 'select-window -t :=3'], ['4', 'select-window -t :=4'],
    ['5', 'select-window -t :=5'], ['6', 'select-window -t :=6'], ['7', 'select-window -t :=7'], ['8', 'select-window -t :=8'], ['9', 'select-window -t :=9'],
    [':', 'command-prompt'], ['\\;', 'last-pane'], ['=', 'choose-buffer -Z'], ['?', 'list-keys -N'], ['L', 'switch-client -l'], ['[', 'copy-mode'], [']', 'paste-buffer -p'],
    ['c', 'new-window'], ['d', 'detach-client'], ['i', 'display-message'], ['l', 'last-window'], ['n', 'next-window'], ['o', 'select-pane -t :.+'],
    ['p', 'previous-window'], ['q', 'display-panes'], ['s', 'choose-tree -Zs'], ['t', 'clock-mode'], ['w', 'choose-tree -Zw'],
    ['x', 'confirm-before -p "kill-pane #P? (y/n)" kill-pane'], ['z', 'resize-pane -Z'], ['\\{', 'swap-pane -U'], ['\\}', 'swap-pane -D'], ['\\~', 'show-messages'],
    ['PPage', 'copy-mode -u'], ['Up', 'select-pane -U', 1], ['Down', 'select-pane -D', 1], ['Left', 'select-pane -L', 1], ['Right', 'select-pane -R', 1],
    ['M-1', 'select-layout even-horizontal'], ['M-2', 'select-layout even-vertical'], ['M-3', 'select-layout main-horizontal'], ['M-4', 'select-layout main-vertical'],
    ['M-5', 'select-layout tiled'], ['M-6', 'select-layout main-horizontal-mirrored'], ['M-7', 'select-layout main-vertical-mirrored'], ['M-o', 'rotate-window -D'],
    ['M-Up', 'resize-pane -U 5', 1], ['M-Down', 'resize-pane -D 5', 1], ['M-Left', 'resize-pane -L 5', 1], ['M-Right', 'resize-pane -R 5', 1],
    ['C-b', 'send-prefix'], ['C-o', 'rotate-window'], ['C-Up', 'resize-pane -U', 1], ['C-Down', 'resize-pane -D', 1], ['C-Left', 'resize-pane -L', 1], ['C-Right', 'resize-pane -R', 1]
  ];

  function listKeys(table) {
    var rows = [], c = S.conf;
    var line = function (r, t, key, cmd) { return 'bind-key ' + (r ? '-r ' : '   ') + '-T ' + (t + '        ').slice(0, Math.max(8, t.length)) + ' ' + (key + '        ').slice(0, Math.max(8, key.length)) + ' ' + cmd; };
    var tmuxKey = function (k) {
      var AK = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'BSpace', PageUp: 'PPage', PageDown: 'NPage', Home: 'Home', End: 'End' };
      var base = AK[k.key] || k.key;
      if (/^["#$%';{}~\\]$/.test(base)) base = '\\' + base;
      return (k.ctrl ? 'C-' : '') + (k.alt ? 'M-' : '') + (k.shift && base.length > 1 ? 'S-' : '') + base;
    };
    if (!table || table === 'prefix') {
      DEFAULT_BINDS.forEach(function (d) {
        var k = CF.parseKey(d[0].replace(/^\\/, ''));
        if (c && k && CF.overridden(c, { key: k.key, ctrl: k.ctrl, alt: k.alt, shift: k.shift, code: /^[0-9]$/.test(k.key) ? 'Digit' + k.key : undefined })) return;
        if (c && d[1] === 'send-prefix') return;
        rows.push(line(d[2], 'prefix', d[0], d[1]));
      });
    }
    if (c) c.binds.forEach(function (b) { if (!table || b.table === table) rows.push(line(b.repeat, b.table, tmuxKey(b.key), b.cmd || '')); });
    if (c && (!table || table === 'prefix')) rows.push(line(false, 'prefix', tmuxKey(c.prefix), 'send-prefix'));
    return rows.length ? rows : ['unknown key table: ' + table];
  }

  // show-options: the options the game follows, as tmux lists them.
  function optionLines() {
    var c = S.conf, win = T.activeWindow(S.session);
    return ['base-index ' + S.session.baseIndex, 'mode-keys ' + (c && c.modeKeys || 'vi'), 'pane-base-index ' + S.session.paneBaseIndex,
      'prefix ' + (c ? CF.keyLabel(c.prefix).replace(/^Ctrl\+/, 'C-').replace(/^(Alt|Option)\+/, 'M-') : 'C-b'),
      'renumber-windows ' + (S.session.renumber ? 'on' : 'off'), 'status-position ' + (c && c.statusTop ? 'top' : 'bottom'),
      'synchronize-panes ' + (syncOn(win, null) ? 'on' : 'off')];
  }

  // A window as a target names it: 2, :2, a name, sess:2, + / - (the next
  // or the previous), +N / -N. Null when there is none.
  function windowTarget(t) {
    var cur = T.activeWindow(S.session);
    if (t == null) return cur;
    var w = String(t).replace(/^[^:]*:/, '');
    if (w === '') return cur;
    var rel = /^([+-])(\d*)$/.exec(w);
    if (rel) {
      var list = S.session.windows, at = list.indexOf(cur), n = list.length, step = (rel[2] ? Number(rel[2]) : 1) * (rel[1] === '+' ? 1 : -1);
      return list[((at + step) % n + n) % n];
    }
    if (/^\d+$/.test(w)) return T.windowByIndex(S.session, Number(w));
    return S.session.windows.filter(function (x) { return x.name === w; })[0] || null;
  }

  // A pane as a target: 2 (window 2's active pane), 2.1, :2.1, .1 (pane 1
  // here). {win, pane}, or null.
  function paneTarget(t) {
    var cur = T.activeWindow(S.session);
    if (t == null || t === '') return { win: cur, pane: T.activePane(cur) };
    // A bare number is a pane of this window first, then a window (tmux).
    if (!S.legacy && /^\d+$/.test(String(t))) {
      var own = T.panesOf(cur)[Number(t) - S.session.paneBaseIndex];
      if (own) return { win: cur, pane: own };
    }
    var m = /^(.*?)(?:\.(\d+))?$/.exec(String(t));
    var win = windowTarget(m[1] === '' ? null : m[1]);
    if (!win) return null;
    var pane = m[2] == null ? T.activePane(win) : T.panesOf(win)[Number(m[2]) - S.session.paneBaseIndex];
    return pane ? { win: win, pane: pane } : null;
  }

  // ---- copy mode -----------------------------------------------------------

  // The lines copy mode can stand on: the printed ones, then the prompt line
  // (index lines.length), which is where the cursor is when copy mode begins.
  function realLines(pane) {
    var out = [];
    for (var i = 0; i < pane.lines.length; i++) if (!(pane.lines[i] && pane.lines[i].clear)) out.push(i);
    out.push(pane.lines.length);
    return out;
  }

  function lineAt(pane, j) {
    return j === pane.lines.length ? promptText(pane) + pane.input : lineText(pane.lines[j]);
  }

  // As tmux: the copy cursor starts where the shell cursor is, on the prompt.
  function enterCopy(pane) {
    pane.mode = 'copy';
    var el = paneBodyEl(pane.id);
    pane.scrollTop = el ? el.scrollHeight - el.clientHeight : 0;
    pane.cy = pane.lines.length;
    pane.cx = promptText(pane).length + (pane.cur == null ? pane.input.length : pane.cur);
    pane.sel = null;
  }

  function stepLine(pane, from, dir) {
    var ls = realLines(pane);
    var at = ls.indexOf(from);
    if (at < 0) return ls.length ? ls[ls.length - 1] : 0;
    var j = Math.max(0, Math.min(ls.length - 1, at + dir));
    return ls[j];
  }

  // The cursor onto line j; the column stays where it can.
  function goLine(pane, j) {
    pane.cy = j;
    pane.cx = Math.min(pane.cx || 0, lineAt(pane, j).length);
  }

  // The selection, start before end: {a: [line, col], b: [line, col]}, both ends in it.
  function selRange(p) {
    if (p.sel == null) return null;
    var a = [p.sel, p.selx || 0], b = [p.cy, Math.min(p.cx || 0, lineAt(p, p.cy).length)];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) { var t = a; a = b; b = t; }
    return { a: a, b: b };
  }

  // The copy-mode commands of the player's own bindings, as the default key
  // that does the same here (run through copyModeKey again).
  var COPY_AS_KEY = {
    'cursor-up': { key: 'ArrowUp' }, 'cursor-down': { key: 'ArrowDown' }, 'cursor-left': { key: 'ArrowLeft' }, 'cursor-right': { key: 'ArrowRight' },
    'start-of-line': { key: 'Home' }, 'end-of-line': { key: 'End' }, 'history-top': { key: 'g' }, 'history-bottom': { key: 'G' },
    'page-up': { key: 'PageUp' }, 'page-down': { key: 'PageDown' }, 'halfpage-up': { key: 'u', ctrl: true }, 'halfpage-down': { key: 'd', ctrl: true },
    'search-backward': { key: '?' }, 'search-forward': { key: '/' }, 'search-again': { key: 'n' }, 'search-reverse': { key: 'N' },
    'next-word': { key: 'w' }, 'previous-word': { key: 'b' }, 'next-word-end': { key: 'e' }, 'next-space': { key: 'W' }, 'previous-space': { key: 'B' }, 'next-space-end': { key: 'E' },
    'back-to-indentation': { key: '^' }, 'top-line': { key: 'H' }, 'middle-line': { key: 'M' }, 'bottom-line': { key: 'L' }, 'jump-again': { key: ';' }, 'jump-reverse': { key: ',' }
  };

  // ---- the vi moves (tmux 3.x): words, the screen, f/t ----------------------

  // next-word (w), next-word-end (e), previous-word (b); `big`: W E B.
  function wordMove(pane, what, big) {
    var ls = realLines(pane);
    var to = T.copyWord(ls.map(function (j) { return lineAt(pane, j); }), Math.max(0, ls.indexOf(pane.cy)), pane.cx || 0, what, big);
    pane.cy = ls[to.j];
    pane.cx = to.c;
    pane.reveal = 'edge';
  }

  // f F t T on the cursor's line; ; again, , the other way.
  function jumpMove(pane, type, ch) {
    pane.jump = { type: type, ch: ch };
    pane.cx = T.copyJump(lineAt(pane, pane.cy), pane.cx || 0, type, ch);
  }

  // Where end-of-line puts the cursor: on the last character with the vi
  // keys, past it with emacs, as tmux does.
  function endCol(text) {
    var emacs = S.conf && S.conf.modeKeys === 'emacs';
    return S.legacy || emacs ? text.length : Math.max(0, text.length - 1);
  }

  // The keys above, from copyModeKey; true when the key was one of them.
  function viMove(k, pane) {
    var key = k.key, mk = metaKey(k);
    if (k.ctrl) return false;
    if (mk === 'f' || mk === 'b') {
      // emacs M-f: past the end of the word; M-b: to its start.
      wordMove(pane, mk === 'f' ? 'e' : 'b', false);
      if (mk === 'f' && pane.cx < lineAt(pane, pane.cy).length) pane.cx += 1;
      return true;
    }
    if (k.alt) return false;
    if (key === 'w' || key === 'e' || key === 'b') { wordMove(pane, key, false); return true; }
    if (key === 'W' || key === 'E' || key === 'B') { wordMove(pane, key.toLowerCase(), true); return true; }
    if (key === '^') { var t = lineAt(pane, pane.cy); pane.cx = Math.max(0, t.search(/\S/)); return true; }
    if (key === 'H' || key === 'M' || key === 'L') { pane.syncCursor = { H: 'top', M: 'mid', L: 'bottom' }[key]; return true; }
    if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
      var label = { f: '(jump forward)', F: '(jump backward)', t: '(jump to forward)', T: '(jump to backward)' }[key];
      S.prompt = { label: label, value: '', one: true, done: function (v) { if (v) jumpMove(pane, key, v); } };
      S.lastAction = 'search';
      return true;
    }
    if ((key === ';' || key === ',') && pane.jump) {
      var j = pane.jump, back = { f: 'F', F: 'f', t: 'T', T: 't' };
      jumpMove(pane, key === ';' ? j.type : back[j.type], j.ch);
      // , leaves the jump as it was: ; still goes the first way.
      pane.jump = j;
      return true;
    }
    return false;
  }

  // history-top (g, M-<) and history-bottom (G, M->), as tmux puts the
  // cursor: the first line's start, the last line's end.
  function historyEnd(pane, bottom) {
    var ls = realLines(pane);
    if (bottom) { pane.cy = ls[ls.length - 1]; pane.cx = endCol(lineAt(pane, pane.cy)); pane.scrollTop = 1e9; pane.reveal = 'edge'; }
    else { pane.cy = ls[0]; pane.cx = 0; pane.scrollTop = 0; }
  }

  // `own`: the key event came from one of the player's copy-mode bindings
  // already (no second lookup).
  function copyModeKey(k, pane, own) {
    var el = paneBodyEl(pane.id);
    // Tried on away from the screen (今日の達人's fewest keys on the title):
    // no scroll to measure, the rest as on screen.
    if (!el && !S.sim) { pane.mode = null; return true; }
    var max = el ? el.scrollHeight - el.clientHeight : 0;
    var page = el ? Math.max(S.cellH, el.clientHeight - S.cellH) : S.cellH * 10;
    var key = k.key;
    var mk = metaKey(k);
    var cb = own ? null : CF.copyLookup(S.conf, k);
    if (cb) {
      if (cb.act.none) { message(tx('{0} の割り当てはゲームでは使えない（未対応）', cb.key.label)); return true; }
      return copyCommand(pane, cb.act.copy, cb.table === 'copy-mode');
    }
    // Copy keys: Space/Enter (vi) or C-Space/M-w (emacs).
    var begins = key === ' ' || (k.ctrl && key === ' ');
    // V (vi): select-line, the whole line, the cursor at its end.
    if (key === 'V' && !k.ctrl && !k.alt) { pane.sel = pane.cy; pane.selx = 0; pane.cx = lineAt(pane, pane.cy).length; S.lastAction = 'yank_start'; return true; }
    var copies = (key === 'Enter' && !k.ctrl) || mk === 'w' || (k.ctrl && key === 'w');
    if ((key === 'Escape' || (k.ctrl && key === 'g')) && pane.sel != null) { pane.sel = null; return true; }
    if (copies && pane.sel != null) { yank(pane, key !== 'Enter'); return true; }
    if ((key === 'v' || key === 'y') && !k.ctrl && !k.alt) { message(key === 'v' ? 'tmux の v は矩形選択（四角く選ぶ）の切り替え。選び始めは Space（emacs 式は C-Space）' : 'tmux の y には割り当てがない。コピーは Enter（emacs 式は M-w）'); return true; }
    if (key === 'q' || key === 'Escape' || key === 'Enter' || (k.ctrl && (key === 'c' || key === 'g'))) { pane.mode = null; return true; }
    if (begins) { pane.sel = pane.cy; pane.selx = Math.min(pane.cx || 0, lineAt(pane, pane.cy).length); S.lastAction = 'yank_start'; return true; }
    if (!S.legacy && viMove(k, pane)) return true;
    // An Alt key the copy mode has no use for is not its plain letter
    // (M-v is page-up, M-< M-> the ends, below).
    if (!S.legacy && k.alt && !k.ctrl && mk !== 'v' && k.code !== 'Comma' && k.code !== 'Period') return true;
    if (k.ctrl && key === 'p') { goLine(pane, stepLine(pane, pane.cy, -1)); pane.reveal = 'edge'; return true; }
    if (k.ctrl && key === 'n') { goLine(pane, stepLine(pane, pane.cy, 1)); pane.reveal = 'edge'; return true; }
    // Along the line: ←/→ (h/l), the head (Home, 0, C-a) and the end (End, $, C-e).
    var len = lineAt(pane, pane.cy).length;
    if (key === 'ArrowLeft' || key === 'h') { pane.cx = Math.max(0, Math.min(pane.cx || 0, len) - 1); return true; }
    if (key === 'ArrowRight' || key === 'l') { pane.cx = Math.min(len, (pane.cx || 0) + 1); return true; }
    if (key === 'Home' || key === '0' || (k.ctrl && key === 'a')) { pane.cx = 0; return true; }
    if (key === 'End' || key === '$') { pane.cx = endCol(lineAt(pane, pane.cy)); return true; }
    if (k.ctrl && key === 'e') { pane.cx = len; return true; }
    if (!S.legacy && (key === 'g' || key === 'G' || (k.alt && (k.code === 'Comma' || k.code === 'Period')))) { historyEnd(pane, key === 'G' || k.code === 'Period'); return true; }
    if (k.alt && (k.code === 'Comma' || k.code === 'Period')) {
      pane.scrollTop = k.code === 'Comma' ? 0 : max;
      pane.syncCursor = true;
      return true;
    }
    if (key === '/' || key === '?' || (k.ctrl && (key === 's' || key === 'r'))) {
      var dir = (key === '?' || key === 'r') ? -1 : 1;
      S.prompt = {
        label: dir < 0 ? '(search up)' : '(search down)',
        value: '',
        done: function (v) {
          if (!v) return;
          pane.search = { term: v, dir: dir };
          search(pane, dir);
        }
      };
      S.lastAction = 'search';
      return true;
    }
    if ((key === 'n' || key === 'N') && pane.search) { search(pane, key === 'n' ? pane.search.dir : -pane.search.dir); S.lastAction = 'search'; return true; }
    if (key === 'ArrowUp' || key === 'k') { goLine(pane, stepLine(pane, pane.cy, -1)); pane.reveal = 'edge'; return true; }
    if (key === 'ArrowDown' || key === 'j') { goLine(pane, stepLine(pane, pane.cy, 1)); pane.reveal = 'edge'; return true; }
    // A page or half a page: the cursor keeps its row on the screen (tmux),
    // so it moves with the text; at the end of the history it goes there.
    var curEl = el && !S.legacy && $('[data-ln="' + pane.cy + '"]', el);
    var row = curEl ? Math.max(0, curEl.offsetTop - (el ? el.scrollTop : 0)) : null;
    var from = pane.scrollTop;
    if (key === 'PageUp' || (k.alt && mk === 'v') || (k.ctrl && key === 'b')) pane.scrollTop -= page;
    else if (key === 'PageDown' || (k.ctrl && key === 'v') || (k.ctrl && key === 'f')) pane.scrollTop += page;
    else if (k.ctrl && key === 'u') pane.scrollTop -= page / 2;
    else if (k.ctrl && key === 'd') pane.scrollTop += page / 2;
    else if (key === 'g') pane.scrollTop = 0;
    else if (key === 'G') pane.scrollTop = max;
    else return true;
    if (pane.scrollTop < 0) pane.scrollTop = 0;
    if (pane.scrollTop > max) pane.scrollTop = max;
    if (row == null) { pane.syncCursor = true; return true; }
    if (pane.scrollTop === from) { historyEnd(pane, pane.scrollTop >= max); pane.scrollTop = from; return true; }
    pane.syncCursor = { row: row };
    return true;
  }

  // One copy-mode command (a binding's, or send-keys -X typed at :).
  // `emacs`: the emacs table's, whose copy stops before the cursor.
  function copyCommand(pane, cc, emacs) {
    if (COPY_AS_KEY[cc]) return copyModeKey({ key: COPY_AS_KEY[cc].key, ctrl: !!COPY_AS_KEY[cc].ctrl, alt: false, shift: false, meta: false }, pane, true);
    if (cc === 'cancel') { pane.mode = null; return true; }
    if (cc === 'clear-selection') { pane.sel = null; return true; }
    if (cc === 'rectangle-toggle') { message('矩形選択（四角く選ぶ）はゲームにない'); return true; }
    if (cc === 'begin-selection') { pane.sel = pane.cy; pane.selx = Math.min(pane.cx || 0, lineAt(pane, pane.cy).length); S.lastAction = 'yank_start'; return true; }
    if (cc === 'select-line') { pane.sel = pane.cy; pane.selx = 0; pane.cx = lineAt(pane, pane.cy).length; S.lastAction = 'yank_start'; return true; }
    // copy-line / copy-end-of-line need no selection; the others do.
    if (/^copy-line/.test(cc)) { pane.sel = pane.cy; pane.selx = 0; pane.cx = lineAt(pane, pane.cy).length; }
    else if (/^copy-end-of-line/.test(cc)) { pane.sel = pane.cy; pane.selx = Math.min(pane.cx || 0, lineAt(pane, pane.cy).length); pane.cx = lineAt(pane, pane.cy).length; }
    if (pane.sel == null) { message(tx('まだ選んでいない。先に {0} で選び始める', copyKeyLabel('begin'))); return true; }
    // The vi keys copy the character under the cursor too; the emacs keys stop before it.
    yank(pane, emacs, !/-and-cancel$/.test(cc));
    return true;
  }

  function search(pane, dir) {
    var term = pane.search.term.toLowerCase();
    var ls = realLines(pane);
    var at = ls.indexOf(pane.cy);
    for (var step = 1; step <= ls.length; step++) {
      var j = ls[((at + dir * step) % ls.length + ls.length) % ls.length];
      if (lineAt(pane, j).toLowerCase().indexOf(term) >= 0) {
        goLine(pane, j);
        // As tmux: the cursor on the start of the match.
        pane.cx = lineAt(pane, j).toLowerCase().indexOf(term);
        if (pane.sel == null) pane.reveal = 'center';
        else pane.reveal = 'edge';
        return;
      }
    }
    message(tx('見つからない: {0}', pane.search.term));
  }

  // From where Space was pressed to the cursor, the character under it
  // included, as tmux's vi keys copy; the emacs keys (`excl`) stop before
  // the end, as a real M-w does. `stay`: copy-pipe without -and-cancel
  // keeps you in copy mode.
  function yank(pane, excl, stay) {
    var r = selRange(pane);
    var out = [];
    for (var i = r.a[0]; i <= r.b[0]; i++) {
      if (pane.lines[i] && pane.lines[i].clear) continue;
      var t = lineAt(pane, i);
      var to = i === r.b[0] ? r.b[1] + (excl ? 0 : 1) : t.length;
      out.push(t.slice(i === r.a[0] ? r.a[1] : 0, to).replace(to >= t.length ? /\s+$/ : /$/, ''));
    }
    S.clipboard = out.join('\n');
    S.clipAt = new Date();
    pane.sel = null;
    if (!stay) pane.mode = null;
    S.lastAction = 'yank';
    message(tx('コピーした: {0}', S.clipboard.split('\n')[0].trim().slice(0, 40)));
  }

  function paste(pane) {
    S.lastAction = 'paste';
    if (!S.clipboard) { message('まだ何もコピーしていない'); return; }
    if (pane.mode === 'copy') pane.mode = null;
    // Only the first line; a real paste of a newline would run the command.
    var text = S.clipboard.split('\n')[0].replace(/^\s*\d+\s{2}/, '').trim();
    var c = pane.cur == null ? pane.input.length : pane.cur;
    pane.input = pane.input.slice(0, c) + text + pane.input.slice(c);
    pane.cur = c + text.length;
    if (text) pane.pasted = true;
    S.pasted = text;
  }

  // ---- the session picker (choose-tree) ---------

  // `wins`: choose-tree -w, the windows shown under each session; the
  // list opens on the current window there, else on the current session.
  function openPicker(wins) {
    S.picker = { idx: 0, wins: !!wins };
    var rows = pickerRows(), cur = T.activeWindow(S.session);
    for (var i = 0; i < rows.length; i++) if (rows[i].sess === S.session && (wins ? rows[i].win === cur : !rows[i].win)) S.picker.idx = i;
  }

  // The rows of the tree: {sess} for a session, {sess, win} for a window.
  function pickerRows() {
    var rows = [];
    S.sessions.forEach(function (s) {
      rows.push({ sess: s });
      if (S.picker.wins) s.windows.forEach(function (w, i) { rows.push({ sess: s, win: w, tail: i === s.windows.length - 1 }); });
    });
    return rows;
  }

  function pickRow(row) {
    switchSession(row.sess);
    if (row.win) T.selectWindow(row.sess, row.win.id);
    S.picker = null;
    S.lastAction = 'choose';
  }

  function pickerKey(k) {
    var key = k.key;
    // choose-buffer: Enter pastes the one buffer.
    if (S.picker.kind === 'buffer') {
      if (key === 'Enter') { S.picker = null; paste(T.activePane(T.activeWindow(S.session))); }
      else if (key === 'Escape' || key === 'q' || (k.ctrl && key === 'c')) S.picker = null;
      return true;
    }
    var rows = pickerRows(), n = rows.length;
    if (key === 'ArrowUp' || key === 'k') S.picker.idx = (S.picker.idx - 1 + n) % n;
    else if (key === 'ArrowDown' || key === 'j') S.picker.idx = (S.picker.idx + 1) % n;
    else if (key === 'Enter') pickRow(rows[S.picker.idx]);
    else if (key === 'x' && !S.legacy) pickerKill(rows[S.picker.idx]);
    else if (/^[0-9]$/.test(key) && Number(key) < n) pickRow(rows[Number(key)]);
    else if (key === 'Escape' || key === 'q' || (k.ctrl && key === 'c')) S.picker = null;
    return true;
  }

  // x in the tree: kill the session or window on the row, after y (tmux
  // asks "Kill session work? "). The tree stays open on what is left.
  function pickerKill(row) {
    if (!row) return;
    var w = row.win;
    S.confirm = {
      text: w ? 'Kill window ' + w.index + '? ' : 'Kill session ' + row.sess.name + '? ',
      yes: function () {
        // A session's last window takes the session with it, as in tmux.
        if (w && row.sess.windows.length > 1) {
          T.killWindow(row.sess, w.id);
          S.lastAction = 'kill_window';
        } else killSession(row.sess);
        if (S.picker) S.picker.idx = Math.max(0, Math.min(S.picker.idx, pickerRows().length - 1));
      }
    };
    S.lastAction = 'brief';
  }

  // The repeat window ends on its own; the badge and the glow must follow.
  function armRepeat() {
    var ms = S.legacy ? 500 : optMs('repeat-time', 500);
    S.repeatUntil = ms ? nowMs() + ms : 0;
    clearTimeout(S.repeatTimer);
    if (ms) S.repeatTimer = setTimeout(function () { if (S.screen === 'game') render(); }, ms + 20);
  }

  // message, note, chip and banner take Japanese and show it in the page's
  // language (`raw`: the player's own text, as it is).
  function message(text, raw) {
    // Tried on (parKeys): nothing to say, and no timer that would clear a real one.
    if (S.sim) return;
    S.message = raw ? text : tx(text);
    // show-messages keeps the last of them (message-limit), with the time.
    if (S.msgLog.length && S.msgLog[S.msgLog.length - 1].slice(7) === S.message) { /* the same again */ }
    else S.msgLog.push(hhmm(new Date()) + ': ' + S.message);
    if (S.msgLog.length > 100) S.msgLog.shift();
    clearTimeout(S.messageTimer);
    // The tabs are back: the arrow to a wanted tab too.
    S.messageTimer = setTimeout(function () { S.message = null; renderStatus(); renderTabArrow(); }, 1800);
  }

  // Real keyboard events become the normalised key object.
  function onKeyDown(e) {
    AU.unlock();
    if (S.screen !== 'game') { navKey(e); return; }
    var t = e.target;
    if (t && t !== document.body && t.id !== 'sink' && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    // Paused: any key resumes. Space, Enter and Esc only resume; any other
    // key also does its work, so the first Ctrl+l after coming back moves.
    if (S.run && S.run.phase === 'pause') {
      if (isModifierOnly(e.key)) return;
      resumeRun();
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); return; }
    }
    // A soft keyboard's keydown carries no key; its text comes as input.
    if (e.key === 'Unidentified') return;
    // Japanese input is on: the keys go to the IME, not the game. Said, not a miss.
    if (e.key === 'Process' || e.isComposing) { imeNote(); return; }
    var k = { key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
    // A key typed into the focused sink is handled here, never again as input.
    if (t && t.id === 'sink' && !e.metaKey && (e.key.length === 1 || e.key === 'Enter')) e.preventDefault();
    if (handleKey(k)) e.preventDefault();
  }

  // Outside the house the keyboard moves between screens, so a player can
  // go round and round without the mouse:
  //   コース選択  Enter 入る, 1〜3 コースを選んではじめる, K 稽古, R 記録
  //   記録      Enter / Space もう一度, K 稽古, R 記録, Esc コース選択
  //   記録      Esc 戻る
  function navKey(e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    // Keys still held from the last question must not start the next run.
    if (performance.now() < (S.navAfter || 0)) return;
    var go = function (fn) { e.preventDefault(); AU.se('cursor'); fn(); };
    if (S.screen === 'title') {
      if (k === 'Enter') return go(function () { startRun($('#btn-enter').dataset.course || 'easy'); });
      var i = '1234'.indexOf(k);
      if (i >= 0 && LV.COURSES[i]) return go(function () { startRun(LV.COURSES[i].id); });
      if (k === 'd' || k === 'D') return go(function () { startRun('daily'); });
      if (k === 'k' || k === 'K') return go(function () { startRun('keiko'); });
      if (k === 'p' || k === 'P') return go(startFree);
      if (k === 'r' || k === 'R') return go(function () { S.recTab = 'growth'; openRecords(null, 'title'); });
      if (k === 'b' || k === 'B') return go(openBoard);
    } else if (S.screen === 'result' && S.result) {
      if (k === 'Enter' || k === ' ') return go(function () { startRun(S.result.course); });
      if (k === 'k' || k === 'K') return go(function () { startRun('keiko'); });
      if ((k === 'p' || k === 'P') && REC.courseOf(S.result.course).practice) return go(startFree);
      if ((k === 'n' || k === 'N') && nextCourse(S.result)) return go(function () { startRun(nextCourse(S.result).id); });
      if (k === 'r' || k === 'R') return go(function () { S.recTab = 'growth'; openRecords(REC.courseOf(S.result.course).practice ? lastCourse(REC.load()) : S.result.course, 'result'); });
      if (k === 'Escape') return go(function () { showScreen('title'); });
    } else if (S.screen === 'records') {
      if (k === 'Escape') return go(function () { showScreen(S.recordsFrom === 'result' && S.result ? 'result' : 'title'); });
    }
  }

  function imeNote() {
    if (S.screen !== 'game') return;
    message('日本語入力がオンになっている。英数に切り替える');
    renderStatus();
  }

  // Soft keyboards may not produce usable keydown events; take the text.
  function onSinkInput(e) {
    var sink = e.target;
    // Text being composed by an IME is not keys; it is dropped when it ends.
    if (e.isComposing || S.composing || /Composition/.test(e.inputType || '')) {
      if (!e.isComposing && !S.composing) sink.value = '';
      return;
    }
    var data = sink.value;
    sink.value = '';
    if (!data) return;
    for (var i = 0; i < data.length; i++) {
      var ch = data[i];
      if (ch === '\n') handleKey({ key: 'Enter' });
      else handleKey({ key: ch });
    }
  }

  // ---- the run --------------------------------------------------------------
  // A run is a fixed list of questions (問題) asked on one live house: each
  // is asked about the panes and windows as the player left them, asks for
  // one result, and checks the state after every key. A question is never
  // skipped: past its 目安 the keys light up (行灯); the step-by-step guide
  // (手順) is on screen from the start unless the type is learnt.

  function rng(seed) {
    var h = 1779033703 ^ seed.length;
    for (var i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  function pickInt(r, n) { return Math.floor(r() * n); }

  function splitCount(win, dir) {
    var c = 0;
    (function walk(node) { if (node.type === 'pane') return; if (node.dir === dir) c++; walk(node.a); walk(node.b); })(win.root);
    return c;
  }

  // (window names: WINGS, above)

  // A move the guide can show: the prefix first or not, the key labels to
  // light (as in LV.KEYS), and what to do in words.
  function mv(keys, text, noPrefix) { return { pfx: !noPrefix, keys: keys, text: tx(text) }; }

  // A move that types into an open prompt: when what is typed so far is the
  // start of it (swap-windo… of swap-window -t 1), go on typing the rest
  // rather than clear it with Ctrl+u.
  function onTrack(m) {
    var v = S.prompt && S.prompt.value;
    if (!v || typeof m.type !== 'string' || m.type.indexOf(v) !== 0) return m;
    var rest = m.type.slice(v.length);
    m.text = rest ? tx('続けて {0} と打って Enter', rest) : tx('Enter を押す');
    m.type = rest; m.cont = true;
    return m;
  }

  var ARROWS = { L: '←', R: '→', U: '↑', D: '↓' };
  var DIR_WORDS = { L: '左', R: '右', U: '上', D: '下' };

  // The arrow that brings the focus closest to pane `id`, or null if it is
  // already there. Works on the unzoomed layout, as select-pane does.
  function moveTo(id) {
    var win = T.activeWindow(S.session);
    if (win.active === id) return null;
    // The pane is in another window (prefix → l, n, p took you away): that window first.
    var h = T.findPane(S.session, id);
    if (h && h.win !== win) return windowMove(h.win.id);
    var z = win.zoomed;
    win.zoomed = false;
    var goal = T.rectOf(win, id, S.cols, S.rows);
    var best = null;
    ['L', 'R', 'U', 'D'].forEach(function (d) {
      // The 手順 points the plain way, never round the edge.
      var nb = T.neighbour(win, S.cols, S.rows, d, true);
      if (!nb || !goal) return;
      var r = T.rectOf(win, nb.id, S.cols, S.rows);
      var dist = nb.id === id ? -1 : Math.abs((r.x + r.w / 2) - (goal.x + goal.w / 2)) + Math.abs((r.y + r.h / 2) - (goal.y + goal.h / 2));
      if (!best || dist < best.dist) best = { d: d, dist: dist };
    });
    // The shortest way by tmux's own moves, so the arrows never swing back
    // and forth (the nearest step can: ↓ to a wide pane, ↑ back again).
    var way = T.arrowPath(win, S.cols, S.rows, id);
    if (way) { var nb1 = T.neighbour(win, S.cols, S.rows, way, true); best = { d: way, dist: nb1 && nb1.id === id ? -1 : 0 }; }
    win.zoomed = z;
    if (!best) return null;
    var p = T.findPane(S.session, id);
    var dir = tx(DIR_WORDS[best.d]);
    var where = best.dist < 0 && p ? tx('{0}の{1} へ', dir, paneLabel(p.pane)) : tx('{0}へ', dir);
    var m = mv([ARROWS[best.d]], tx('{0} を押す（{1}）', ARROWS[best.d], where));
    m.alt = altMoves(win, id, best.dist >= 0);
    return m;
  }

  // Other ways to the pane in one step: o (the next pane in order) and ;
  // (the pane you were in last). Shown beside the 手順, never required.
  // `far`: more than one arrow away, where q and the number get there in one go.
  function altMoves(win, id, far) {
    var out = [];
    if (win.last === id && T.findPane(S.session, id)) {
      out.push(mv([';'], '直前のペインへ戻る'));
    }
    var ps = T.panesOf(win);
    var at = ps.findIndex(function (q) { return q.id === win.active; });
    if (ps.length > 2 && ps[(at + 1) % ps.length].id === id) out.push(mv(['o'], '次のペインへ'));
    else if (ps.length === 2) out.push(mv(['o'], 'もう一つのペインへ'));
    var h = far && T.findPane(S.session, id);
    if (h && h.win === win) { var qi = T.paneIndex(S.session, win, h.pane); out.push(mv(['q', String(qi)], tx('q で番号を出し、{0} を押す', qi))); }
    return out;
  }

  // ---- the 手順 in the player's own keys ----------------------------------

  // The default key labels of the 手順, as what they do.
  var LABEL_SIG = {
    '%': 'k:%', '"': 'k:"', '←': 'k:ArrowLeft', '→': 'k:ArrowRight', '↑': 'k:ArrowUp', '↓': 'k:ArrowDown',
    z: 'k:z', x: 'k:x', c: 'k:c', ',': 'k:,', n: 'k:n', p: 'k:p', l: 'k:l', '[': 'k:[', ']': 'k:]',
    '{': 'k:{', '}': 'k:}', '&': 'k:&', o: 'k:o', ';': 'k:;', ':': 'k::', $: 'k:$', s: 'k:s', d: 'k:d', Space: 'k: ',
    q: 'k:q', PageUp: 'k:PageUp', "'": "k:'", '(': 'k:(', ')': 'k:)', L: 'k:L', '!': 'k:!'
  };
  ['L', 'R', 'U', 'D'].forEach(function (d) { LABEL_SIG['Ctrl+' + ARROWS[d]] = 'r:' + d + ':1'; LABEL_SIG['Option+' + ARROWS[d]] = 'r:' + d + ':5'; });
  // rotate-window and the M-1 … M-7 layouts.
  LABEL_SIG['Ctrl+o'] = 'k:C-o';
  ['Option+', 'Alt+'].forEach(function (m) { LABEL_SIG[m + 'o'] = 'k:M-o'; for (var i = 1; i <= 7; i++) LABEL_SIG[m + i] = 'k:M-' + i; });
  var ARROW_KEY = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' };
  // What to type at : when the player's file leaves an action with no key.
  var CMD_FOR = { 'k:%': 'split-window -h', 'k:"': 'split-window', 'k:x': 'kill-pane', 'k:&': 'kill-window', 'k:c': 'new-window', 'k:,': tx('rename-window 名前'), 'k:{': 'swap-pane -U', 'k:}': 'swap-pane -D', 'k: ': 'next-layout', 'k:d': 'detach', 'k:!': 'break-pane', 'k:l': 'last-window', 'k:q': 'display-panes', 'k:C-o': 'rotate-window', 'k:M-o': 'rotate-window -D' };
  T.LAYOUT_KEYS.forEach(function (n, i) { CMD_FOR['k:M-' + (i + 1)] = 'select-layout ' + n; });

  function sigOf(act) { return act.key != null ? 'k:' + (act.ctrl ? 'C-' : '') + (act.alt ? 'M-' : '') + act.key : act.resize ? 'r:' + act.resize : null; }

  // ---- the copy-mode keys in the player's own words --------------------------

  // The game's copy-mode moves by name: the tmux commands behind them and
  // the default key of each mode. The player's own binding comes first,
  // then the key of the mode-keys they set, else the vi key (what the
  // game shows by default).
  var COPY_MOVES = {
    begin: { cmds: ['begin-selection'], vi: 'Space', emacs: 'Ctrl+Space' },
    copy: { cmds: ['copy-selection-and-cancel', 'copy-pipe-and-cancel', 'copy-selection', 'copy-pipe', 'copy-selection-no-clear', 'copy-pipe-no-clear'], vi: 'Enter', emacs: MAC ? 'Option+w' : 'Alt+w' },
    // q leaves in both modes and the questions name it: the player's own
    // cancel key (Escape, say) is accepted but not shown.
    cancel: { cmds: [], vi: 'q', emacs: 'q' },
    top: { cmds: ['history-top'], vi: 'g', emacs: MAC ? 'Option+<' : 'Alt+<' },
    searchUp: { cmds: ['search-backward'], vi: '?', emacs: 'Ctrl+r' },
    searchDown: { cmds: ['search-forward'], vi: '/', emacs: 'Ctrl+s' },
    again: { cmds: ['search-again'], vi: 'n', emacs: 'n' },
    home: { cmds: ['start-of-line'], vi: 'Home', emacs: 'Home' },
    end: { cmds: ['end-of-line'], vi: 'End', emacs: 'End' },
    pageUp: { cmds: ['page-up'], vi: 'PageUp', emacs: 'PageUp' },
    pageDown: { cmds: ['page-down'], vi: 'PageDown', emacs: 'PageDown' }
  };
  var COPY_LABEL = { Space: 'begin', Enter: 'copy', q: 'cancel', g: 'top', '?': 'searchUp', '/': 'searchDown', n: 'again', Home: 'home', End: 'end', PageUp: 'pageUp', PageDown: 'pageDown' };

  function copyKeyLabel(name) {
    var m = COPY_MOVES[name];
    var own = S.conf && CF.copyKey(S.conf, m.cmds);
    if (own) return own;
    return S.conf && S.conf.modeKeys === 'emacs' ? m.emacs : m.vi;
  }

  // Whether the player's copy key for `name` leaves copy mode (copy-pipe
  // without -and-cancel stays, as does copy-selection).
  function copyKeyStays(name) {
    var own = S.conf && CF.copyKey(S.conf, COPY_MOVES[name].cmds);
    if (!own) return false;
    return S.conf.binds.some(function (b) { return b.key.label === own && b.act.copy && !/-and-cancel$/.test(b.act.copy); });
  }

  // A copy-mode guide move: the key in the player's words, and the note on
  // the other mode's key only while no mode-keys is set.
  function copyMove(name, text, note) {
    var label = copyKeyLabel(name);
    var tail = !S.conf || !S.conf.modeKeys ? note || '' : '';
    return mv([label], tx('{0} を押す（{1}{2}）', label, tx(text), tail ? tx('。') + tx(tail) : ''), true);
  }

  // A whole line to copy, the cursor on it: the fewest keys the player's
  // bindings have for it lead (a copy-line key copies it at once; V, or the
  // player's select-line key, takes it whole), the head-to-end way beside.
  // `slow`: that way's first move (Home or Space).
  function lineMove(slow) {
    var own = S.conf && CF.copyKey(S.conf, ['copy-line', 'copy-line-and-cancel']);
    var m = null;
    if (own) m = mv([own], tx('{0} を押す（行ごとコピーする）', own), true);
    else {
      var sel = S.conf && CF.copyKey(S.conf, ['select-line']);
      var vEv = { key: 'V', ctrl: false, alt: false, shift: true };
      // vi's V, unless the file took V for something else or uses the emacs keys (no V there).
      if (!sel && !(S.conf && (S.conf.modeKeys === 'emacs' || CF.copyLookup(S.conf, vEv)))) sel = 'V';
      if (sel) m = mv([sel], tx('{0} を押す（行ごと選ぶ）', sel), true);
    }
    if (!m) return slow;
    m.alt = [slow];
    return m;
  }

  // A default copy-mode key label (LV.KEYS) in the player's own key.
  function copyOwn(label) {
    return COPY_LABEL[label] ? copyKeyLabel(COPY_LABEL[label]) : label;
  }

  // The default key event behind a label, to see whether the file took it away.
  function labelEvent(label) {
    var r = /^(Ctrl|Option|Alt)\+(.)$/.exec(label);
    if (r) return { key: ARROW_KEY[r[2]] || r[2], ctrl: r[1] === 'Ctrl', alt: r[1] !== 'Ctrl', shift: false, code: /^[0-9]$/.test(r[2]) ? 'Digit' + r[2] : /^[a-z]$/.test(r[2]) ? 'Key' + r[2].toUpperCase() : undefined };
    var key = label === 'Space' ? ' ' : ARROW_KEY[label] || label;
    return { key: key, ctrl: false, alt: false, shift: false };
  }

  // A prefixed default label → {label, pfx, n} in the player's keys, the
  // same label if it still works, or {none} if the file left no key for it.
  function ownKey(label) {
    var sig = LABEL_SIG[label];
    if (!S.conf || !sig) return { label: label, pfx: true, same: true };
    var want = sig.replace(/:\d+$/, ''), found = null;
    S.conf.binds.forEach(function (b) {
      if (sigOf(b.act) !== want) return;
      if (!found || (b.table === 'root' && found.table !== 'root') || (b.table === found.table)) found = b;
    });
    if (found) return { label: found.key.label, pfx: found.table === 'prefix', n: found.act.n, root: found.table === 'root', now: !!found.act.now };
    if (!CF.overridden(S.conf, labelEvent(label))) return { label: label, pfx: true, same: true };
    return { none: true, cmd: CMD_FOR[want] };
  }

  // The default key in a guide text → the player's key, as a whole word
  // only: "Press s" must not become "PreCtrl+ss s".
  function swapKey(text, key, label) {
    var re = new RegExp('(^|[\\s（(「、,])' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[\\s）)」、。,.:])');
    return text.replace(re, function (all, pre) { return pre + label; });
  }

  function ownMove(m) {
    // `own`: already the player's own key (a prompt of their file, say).
    if (!m || !m.pfx || m.keys.length !== 1 || m.own) return m;
    var o = ownKey(m.keys[0]);
    if (o.same) return m;
    if (o.none) {
      if (!o.cmd) return mv([], 'この設定ではこの操作のキーがない', true);
      // The command prompt is open: the command itself is the step.
      if (S.prompt && S.prompt.label === ':') {
        var pm = mv([], tx(S.prompt.value ? 'Ctrl+u で消して {0} と打って Enter' : '{0} と打って Enter', o.cmd), true);
        pm.prompt = true;
        pm.type = o.cmd;
        return onTrack(pm);
      }
      return mv([':'], tx('この設定ではキーがない。: を押して {0} と打ち Enter', o.cmd));
    }
    var text = swapKey(m.text, m.keys[0], o.label).replace(/（Shift\+\d）|（ダブルクォート）| \(Shift\+\d\)| \(double quote\)/g, '');
    if (o.n) text = text.replace(/（1 回[^）]*）| \(\d+ cells? per press[^)]*\)/, tx('（1 回 {0} マス{1}）', o.n, o.n < 5 ? tx('。続けて押す') : ''));
    // kill-pane with no confirm-before: it closes at once.
    if (o.now) text = text.replace(/（確認が出る）| \(it asks to confirm\)/, tx('（すぐ閉じる）'));
    // Said inside the move's own brackets: "Ctrl+j を押す（prefix なし。下へ）".
    if (o.root) text = /（/.test(text) ? text.replace('（', '（' + tx('prefix なし。')) : / \(/.test(text) ? text.replace(' (', ' (' + tx('prefix なし。')) : text + tx('（prefix なし）');
    var own = { pfx: o.pfx, keys: [o.label], text: text };
    // What the move works inside (a prompt, a list) stays on it.
    ['prompt', 'picker', 'type'].forEach(function (f) { if (m[f] != null) own[f] = m[f]; });
    return own;
  }

  // The move the 手順 shows now, in the player's keys.
  function guideMove(b) {
    var m = b.q.next();
    // In the player's keys first: a move with no key of its own goes
    // through the : prompt, which openFirst must then leave open.
    if (m && S.conf) {
      var out = ownMove(m);
      if (m.alt) {
        out = { pfx: out.pfx, keys: out.keys, text: out.text };
        out.alt = m.alt.map(ownMove).filter(function (a) { return a.keys.length && a.keys[0] !== ':' && a.keys[0] !== out.keys[0]; });
      }
      m = out;
    }
    m = openFirst(b, m) || m;
    // A y/n question this order does not want: say no first.
    if (S.confirm && (!m || (m.keys[0] !== 'y' && m.keys[0] !== 'n'))) m = mv(['n'], 'n で取り消す', true);
    return m;
  }

  // Something left open by a slip comes first: tmux detached, a list, a prompt
  // this question does not ask for.
  // `m` is the question's own move: one marked `prompt` works inside the
  // open prompt (a name, a window number) and is kept.
  function openFirst(b, m) {
    // Outside tmux the move typed there stands (tmux attach); one typed into a pane waits.
    if (S.detached) return m && m.type && !m.shell ? m : attachMove();
    // A move marked `picker` works inside the open session list.
    if (S.picker && !(m && m.picker && !S.picker.kind)) return mv(['Esc'], 'Esc で一覧を閉じる', true);
    if (S.prompt && !(m && m.prompt)) return mv(['Esc'], 'Esc で入力欄を閉じる', true);
    // list-keys, show-messages: the list over the pane goes first.
    var vp = T.activePane(T.activeWindow(S.session));
    if (vp && vp.mode === 'view') return mv(['q'], 'q で一覧を閉じる', true);
    return null;
  }

  function attachMove() {
    var m = mv(['Enter'], 'tmux attach と打って Enter（tmux に戻る）', true);
    m.type = 'tmux attach';
    return m;
  }

  // Outside, to one session by name (tmux attach would take the last one used).
  function attachTo(sess) {
    var m = mv(['Enter'], tx('tmux attach -t {0} と打って Enter（{0} に入る）', sess.name), true);
    m.type = 'tmux attach -t ' + sess.name;
    return m;
  }

  // To session `target`: inside the open list with ↑ ↓ and Enter; else by
  // ( or ) when it is next door in the name order (L when it is the one you
  // left), or s for the list. `viaList` puts s first: the list is the lesson.
  function sessionMove(target, viaList) {
    if (!target || target === S.session) return null;
    var ti = S.sessions.indexOf(target), at = S.sessions.indexOf(S.session), n = S.sessions.length;
    if (ti < 0) return null;
    if (S.picker && !S.picker.kind) {
      var m, rows = pickerRows();
      // The session's own row in the tree (not one of its windows).
      n = rows.length;
      for (var ri = 0; ri < n; ri++) if (rows[ri].sess === target && !rows[ri].win) ti = ri;
      if (S.picker.idx === ti) m = mv(['Enter'], tx('Enter を押す（{0} に移る）', target.name), true);
      else {
        var down = (ti - S.picker.idx + n) % n, up = (S.picker.idx - ti + n) % n;
        m = down <= up ? mv(['↓'], tx('↓ を押す（{0} の行まで）', target.name), true) : mv(['↑'], tx('↑ を押す（{0} の行まで）', target.name), true);
      }
      m.picker = true;
      return m;
    }
    var ways = [];
    if ((at - 1 + n) % n === ti) ways.push(mv(['('], tx('( を押す（前のセッション {0} へ）', target.name)));
    else if ((at + 1) % n === ti) ways.push(mv([')'], tx(') を押す（次のセッション {0} へ）', target.name)));
    if (S.lastSession === target) ways.push(mv(['L'], tx('L を押す（直前のセッション {0} に戻る）', target.name)));
    var list = mv(['s'], 's を押す（セッションの一覧が出る）');
    if (viaList) ways.unshift(list); else ways.push(list);
    var out = ways.shift();
    out.alt = ways;
    return out;
  }

  // What a question is about may be gone (a slip closed it), or a shape may
  // have gone wrong (trident): ask again from where you stand.
  function lostTarget(b) {
    var t = b.type;
    if (t === 'resize') return !paneExists(S.q0.id);
    if (t === 'trident') return tridentState() === 'other';
    // z does nothing on a window of one pane: the question needs a second.
    if (t === 'zoom') return T.panesOf(T.activeWindow(S.session)).length < 2;
    if (t === 'find_zoom' || t === 'swap_zoom') { var fz = T.findPane(S.session, S.target); return !fz || T.panesOf(fz.win).length < 2; }
    if (t === 'select_window') return !T.windowById(S.session, S.q0);
    if (t === 'new_and_home') return !T.windowById(S.session, S.q0.home);
    if (t === 'rename') return !T.windowById(S.session, S.q0.win);
    // (A session renamed under the order keeps it: the order follows the new name.)
    if (t === 'session_switch' || t === 'session_attach') return S.sessions.indexOf(S.q0.target) < 0;
    // In another session its pane is not found: the session it left is what counts.
    if (t === 'detach_attach') return false;
    if (t === 'join_pane' || t === 'join_pane_h') return !paneExists(S.q0.src) || !paneExists(S.q0.dst);
    // A wrong window took one of the two numbers: asked again from here.
    if (t === 'swap_window') {
      var sa = T.windowById(S.session, S.q0.win), so = T.windowById(S.session, S.q0.other);
      return !sa || !so || [S.q0.from, S.q0.to].indexOf(sa.index) < 0 || [S.q0.from, S.q0.to].indexOf(so.index) < 0;
    }
    if (t === 'move_window') { var mw = T.windowById(S.session, S.q0.win), mt = T.windowByIndex(S.session, S.q0.to); return !mw || (!!mt && mt !== mw); }
    if (t === 'layout' || t === 'layout_cycle') { var lw = T.windowById(S.session, S.q0.win); return !lw || T.panesOf(lw).length < 2; }
    if (t === 'sync_panes') {
      var sw = T.windowById(S.session, S.q0.win);
      return !sw || S.q0.panes.filter(function (id) { var h = T.findPane(S.session, id); return h && h.win === sw; }).length < 2;
    }
    // Panes turned some other way than round (a swap, a split): from here.
    if (t === 'rotate') return !paneExists(S.q0.target) || !sameCycle();
    return !!S.target && !paneExists(S.target);
  }

  function askAgain(b) {
    b.redo = (b.redo || 0) + 1;
    S.qText = null; S.qGoal = null; S.target = null;
    b.q.setup(rng(b.seed + ':' + b.i + ':' + b.redo));
    note(b.type === 'trident' ? '形が変わったので、このペインからやり直す' : 'ねらいがなくなったので、選び直した');
  }

  function closeMove(id) {
    if (S.confirm) return S.confirm.pane === id ? mv(['y'], 'y を押す（閉じる）', true) : mv(['n'], 'n で取り消す（閉じるペインが違う）', true);
    return moveTo(id) || mv(['x'], 'x を押す（確認が出る）');
  }

  // To window `id`: by its number, as the status bar shows it. From 10 on
  // there is no key for it: prefix ' asks for the number.
  function windowMove(id, verb) {
    var w = T.windowById(S.session, id);
    if (!w) return null;
    if (w.index < 10) return mv([String(w.index)], tx(verb ? '{0} を押す（{1} に戻る）' : '{0} を押す（{1} へ）', w.index, winLabel(w)));
    if (S.prompt && S.prompt.label === INDEX_PROMPT) {
      var m = mv([], tx(S.prompt.value ? 'Ctrl+u で消して {0} と打って Enter' : '{0} と打って Enter（{1} へ）', w.index, winLabel(w)), true);
      m.prompt = true;
      m.type = String(w.index);
      return onTrack(m);
    }
    return mv(["'"], tx("' を押す（番号の入力欄が出る）。{0} と打って Enter で {1} へ", w.index, winLabel(w)));
  }

  // The resize key that can move something: sideways if the pane has a
  // left-right split above it, else up or down.
  // Tried on a copy of the window first, so the 手順 never points a way
  // that is already as far as it goes (a narrow pane in a crowded window).
  function resizeMove() {
    var win = T.activeWindow(S.session);
    var r = T.rectOf(win, win.active, S.cols, S.rows);
    var order = hasAxis(win, win.active, 'lr') ? (r && r.x === 0 ? [1, 0, 3, 2] : [0, 1, 3, 2]) : (r && r.y === 0 ? [3, 2, 1, 0] : [2, 3, 1, 0]);
    var DIRS = ['L', 'R', 'U', 'D'];
    var pick = order[0];
    for (var k = 0; k < order.length; k++) {
      var i = order[k], label = LV.KEYS.resize[i], d = DIRS[i];
      var step = /^Option/.test(label) ? 5 : 1;
      var copy = JSON.parse(JSON.stringify(win));
      var axis = d === 'L' || d === 'R' ? 'lr' : 'tb';
      for (var n = 0; n < 6; n++) T.resizePane(copy, win.active, axis, d === 'L' || d === 'U' ? -step : step, S.cols, S.rows);
      var cr = T.rectOf(copy, win.active, S.cols, S.rows), r0 = baseRect();
      if (cr && r0 && (Math.abs(cr.w - r0.w) >= 5 || Math.abs(cr.h - r0.h) >= 3)) { pick = i; break; }
    }
    var lb = LV.KEYS.resize[pick];
    return mv([lb], tx(/^Option/.test(lb) ? '{0} を押す（1 回で 5 マス）' : '{0} を押す（1 回 1 マス。続けて 5 回）', lb));
  }

  // How far the pane has moved since the question began, on the axis nearer
  // its goal (5 cells across, 3 rows down, as Q.resize.check): {axis, n}, or null.
  function resizedBy() {
    var w = T.activeWindow(S.session);
    var rr = S.q0 && T.rectOf(w, S.q0.id, S.cols, S.rows);
    var r0 = baseRect();
    if (!rr || !r0) return null;
    var dw = Math.abs(rr.w - r0.w), dh = Math.abs(rr.h - r0.h);
    if (!dw && !dh) return null;
    return dw / 5 >= dh / 3 ? { axis: 'lr', n: dw } : { axis: 'tb', n: dh };
  }

  // The shape of the window as a question began, kept as a tree so that a
  // browser resized mid-question gives the same baseline in the new cells.
  function cloneTree(node) {
    if (node.type === 'pane') return { type: 'pane', pane: node.pane };
    var c = { type: 'split', dir: node.dir, ratio: node.ratio, a: cloneTree(node.a), b: cloneTree(node.b) };
    ['even', 'tile', 'main', 'mirror'].forEach(function (k) { if (node[k] != null) c[k] = node[k]; });
    return c;
  }

  function baseRect() {
    if (!S.q0 || !S.q0.root) return null;
    return T.rectOf({ root: S.q0.root, zoomed: false }, S.q0.id, S.cols, S.rows);
  }

  function swapMove() {
    return moveTo(S.target) || mv(['{'], '{ を押す（前のペインと入れ替わる。左上に着くまで）');
  }

  // The pane a swap question moves to the top left: the one you are in if
  // it is near enough, else one at most two places down the layout order,
  // so the question takes two swaps at most (plus the walk to it).
  var SWAP_REACH = 2;
  function swapTarget(r) {
    var win = T.activeWindow(S.session);
    var panes = T.panesOf(win);
    var at = panes.map(function (p) { return p.id; }).indexOf(win.active);
    if (at > 0 && at <= SWAP_REACH) return panes[at];
    return pick(r, panes.slice(1, SWAP_REACH + 1));
  }

  // Every question: steps (how many moves it takes, for its 目安: see
  // LV.limitFor; left out, it counts as two), text (the generic order, for
  // lists; setup may write a specific one into S.qText), the tmux command it teaches, the actions it
  // may use (others are misses), the key actions to show, setup(r): what it
  // needs of the live house and what it targets, check(), next(): the move
  // the guide shows from the current state, and goal(): what to change,
  // marked in the house itself (完成図) — {pane, mark, tag} on a room or
  // {tab, tag} on a window in the status bar ('+' for a new one).
  function activeId() { return T.activeWindow(S.session).active; }

  // The 目安 of a question type, in seconds.
  function qLimit(type) { return LV.limitFor(Q[type] && Q[type].steps); }

  var Q = {
    split_lr: {
      steps: 1, text: '左右に分割する（split）', cmd: 'split-window -h', allow: ['split_lr'], show: ['split_lr'],
      goal: function () { return [{ pane: activeId(), mark: 'split-v', tag: 'ここを左右に' }]; },
      setup: function () { needUnzoom(); S.q0 = splitCount(T.activeWindow(S.session), 'lr'); },
      check: function () { return splitCount(T.activeWindow(S.session), 'lr') > S.q0; },
      next: function () { return mv(['%'], '% を押す（Shift+5）。右に新しいペインが開く'); }
    },
    split_tb: {
      steps: 1, text: '上下に分割する（split）', cmd: 'split-window -v', allow: ['split_tb'], show: ['split_tb'],
      goal: function () { return [{ pane: activeId(), mark: 'split-h', tag: 'ここを上下に' }]; },
      setup: function () { needUnzoom(); S.q0 = splitCount(T.activeWindow(S.session), 'tb'); },
      check: function () { return splitCount(T.activeWindow(S.session), 'tb') > S.q0; },
      next: function () { return mv(['"'], '" を押す（ダブルクォート）。下に新しいペインが開く'); }
    },
    focus: {
      steps: 2, text: '隣のペインへ移動する', cmd: 'select-pane -L/-R/-U/-D', allow: [], show: ['focus'],
      goal: function () { return [{ pane: S.target, mark: 'go', tag: 'ここへ' }]; },
      setup: function (r) {
        needUnzoom(); needPanes(2);
        var p = pick(r, otherPanes()), lb = askedLabel(p);
        S.target = p.id;
        S.qText = function () { return tx('{0} へ移動する', lb()); };
      },
      check: function () { return activeId() === S.target; },
      next: function () { return moveTo(S.target); }
    },
    zoom: {
      steps: 1, text: 'このペインを全画面にする（zoom）', cmd: 'resize-pane -Z', allow: ['zoom'], show: ['zoom'],
      goal: function () { return [{ pane: activeId(), mark: 'zoom', tag: 'ここを全画面に' }]; },
      setup: function () { needUnzoom(); needPanes(2); },
      check: function () { return T.activeWindow(S.session).zoomed; },
      next: function () { return mv(['z'], 'z を押す（zoom）。このペインだけが画面いっぱいになる'); }
    },
    unzoom: {
      steps: 1, text: '全画面をやめて元の分割に戻す', cmd: 'resize-pane -Z', allow: ['zoom'], show: ['zoom'],
      goal: function () { return [{ pane: activeId(), mark: 'unzoom', tag: '元の分割に戻す' }]; },
      setup: function () { needZoom(); },
      check: function () { return !T.activeWindow(S.session).zoomed; },
      next: function () { return mv(['z'], 'もう一度 z を押す。元の分割に戻る'); }
    },
    close: {
      steps: 4, text: 'ペインを閉じる（kill-pane）', cmd: 'kill-pane', allow: ['close'], show: ['focus', 'close'],
      goal: function () { return [{ pane: S.target, mark: 'close', tag: '閉じる' }]; },
      setup: function (r) {
        needUnzoom(); needPanes(2);
        var p = pick(r, otherPanes()), lb = askedLabel(p);
        S.target = p.id;
        S.qText = function () { return tx('{0} を閉じる', lb()); };
      },
      check: function () { return !paneExists(S.target); },
      next: function () { return closeMove(S.target); }
    },
    new_window: {
      steps: 1, text: '新しいウィンドウを作る', cmd: 'new-window', allow: ['new_window'], show: ['new_window'],
      goal: function () { return [{ tab: '+', tag: '新しいウィンドウ' }]; },
      setup: function () { S.q0 = S.session.windows.length; },
      check: function () { return S.session.windows.length > S.q0; },
      next: function () { return mv(['c'], 'c を押す（create）。新しいウィンドウが開く'); }
    },
    select_window: {
      steps: 1, text: 'ほかのウィンドウへ移動する', cmd: 'select-window -t 番号', allow: ['select_window'], show: ['select_window'],
      goal: function () { return [{ tab: S.q0, tag: 'ここへ' }]; },
      setup: function (r) {
        needWindows(2);
        var w = pick(r, otherWindows());
        S.q0 = w.id;
        S.qGoal = { index: w.index, name: w.name };
        S.qText = tx('ウィンドウ {0} へ移動する', winLabel(w));
      },
      check: function () { return S.session.active === S.q0; },
      next: function () { return windowMove(S.q0); }
    },
    resize: {
      steps: 1, text: 'このペインの大きさを変える（resize）', cmd: 'resize-pane -L/-R/-U/-D', allow: ['resize'], show: ['resize'],
      goal: function () {
        var d = resizedBy();
        var tag = !d ? '境目を横に 5 マス（縦なら 3 行）動かす'
          : d.axis === 'lr' ? tx('いま横に {0} マス動いた（5 マスで成功）', d.n) : tx('いま縦に {0} 行動いた（3 行で成功）', d.n);
        return [{ pane: S.q0.id, mark: 'resize', tag: tag }];
      },
      setup: function () {
        needUnzoom(); needPanes(2);
        var win = T.activeWindow(S.session);
        S.q0 = { id: win.active, root: cloneTree(win.root) };
      },
      // Only a resize counts: moving to a pane of another size is not one.
      check: function () {
        var w = T.activeWindow(S.session);
        var rr = T.rectOf(w, S.q0.id, S.cols, S.rows), r0 = baseRect();
        return S.lastAction === 'resize' && !!rr && !!r0 && !w.zoomed && (Math.abs(rr.w - r0.w) >= 5 || Math.abs(rr.h - r0.h) >= 3);
      },
      // Back to the pane the question is about first (another pane, another window).
      next: function () { return moveTo(S.q0.id) || resizeMove(); }
    },
    swap: {
      steps: 3, text: 'ペインを左上まで入れ替えて動かす（swap）', cmd: 'swap-pane -U', allow: ['swap'], show: ['swap'],
      goal: function () { return [{ pane: S.target, mark: 'to-left', tag: '左上へ' }]; },
      setup: function (r) {
        needUnzoom(); needPanes(2);
        var p = swapTarget(r), lb = askedLabel(p);
        S.target = p.id;
        S.qText = function () { return tx('{0} を左上まで動かす（swap）', lb()); };
      },
      check: function () { return isFirst(S.target); },
      next: swapMove
    },
    rename: {
      steps: 4, text: 'ウィンドウの名前を変える（rename）', cmd: 'rename-window', allow: ['rename'], show: ['rename'],
      goal: function () { return [{ tab: S.q0.win, tag: tx('{0} に', S.q0.name) }]; },
      setup: function (r) {
        var win = T.activeWindow(S.session);
        var name = pick(r, ['dev', 'log', 'ssh', 'edit', 'build'].filter(function (n) { return n !== win.name; }));
        S.q0 = { win: win.id, name: name, from: win.name };
        S.qGoal = name;
        S.qText = tx('ウィンドウの名前を「{0}」にする（rename）', name);
      },
      check: function () { var w = T.windowById(S.session, S.q0.win); return !!w && w.name === S.q0.name; },
      next: function () {
        // Taken to another window (n, p, a number): , would rename that one.
        var away = S.session.active !== S.q0.win;
        if (S.prompt && S.prompt.label === '(rename-window)' && !away) {
          var pm = mv([], tx('Ctrl+u（か Backspace）で今の名前「{0}」を消し、{1} と打って Enter', S.prompt.value, S.q0.name), true);
          pm.prompt = true;
          return pm;
        }
        var w = T.windowById(S.session, S.q0.win);
        if (w && away) return windowMove(w.id);
        if (w && w.name !== S.q0.from && w.name !== S.q0.name) return mv([','], tx('名前が「{0}」になった。もう一度 , を押して、{1} に直す', w.name, S.q0.name));
        return mv([','], ', を押す（カンマ）。名前の入力欄が出る');
      }
    },
    kill_window: {
      steps: 3, text: 'ウィンドウを閉じる（kill-window）', cmd: 'kill-window', allow: ['kill_window', 'select_window'], show: ['select_window', 'kill_window'],
      goal: function () { return [{ tab: S.q0, mark: 'close', tag: '閉じる' }]; },
      setup: function (r) {
        needWindows(2);
        var w = pick(r, otherWindows());
        S.q0 = w.id;
        S.qGoal = { index: w.index, name: w.name };
        S.qText = tx('ウィンドウ {0} を閉じる', winLabel(w));
      },
      check: function () { return !T.windowById(S.session, S.q0); },
      next: function () {
        if (S.confirm) return S.confirm.win === S.q0 ? mv(['y'], 'y を押す（閉じる）', true) : mv(['n'], 'n で取り消す（閉じるウィンドウが違う）', true);
        if (S.session.active !== S.q0) return windowMove(S.q0);
        return mv(['&'], '& を押す（確認が出る）');
      }
    },
    copy_top: {
      // Leaving copy mode is part of it: in a real tmux a beginner who has
      // scrolled up is stuck until they know q.
      steps: 3, text: 'スクロールして一番上まで戻り、q で抜ける（copy mode）', cmd: 'copy-mode → history-top → cancel', allow: ['copy'], show: ['copy'],
      goal: function () { return S.q1 ? [{ pane: S.target, mark: 'go', tag: 'q で抜ける' }] : [{ pane: S.target, mark: 'top', tag: '一番上まで' }]; },
      setup: function () {
        var pane = T.activePane(T.activeWindow(S.session));
        pane.mode = null;
        pane.lines.push({ html: '<span class="sh-prompt">' + esc(promptText(pane)) + '</span>cat makimono.txt' });
        printScroll(pane);
        S.target = pane.id;
        S.q1 = false;
      },
      // The top, once reached, is remembered (S.q1); solved on leaving copy mode after it.
      check: function () {
        var h = T.findPane(S.session, S.target);
        if (!h) return false;
        if (h.pane.mode !== 'copy') return S.q1;
        var info = scrollInfo(h.pane);
        if (info && info.history > 30 && info.pos >= info.history - 2) S.q1 = true;
        return false;
      },
      step: function () {
        var h = T.findPane(S.session, S.target);
        if (!h) return null;
        return S.q1 ? [3, 3, 'q でコピーモードを抜ける'] : h.pane.mode === 'copy' ? [2, 3, '一番上へ'] : [1, 3, 'コピーモードに入る'];
      },
      next: function () {
        var back = moveTo(S.target);
        if (back) return back;
        var p = T.activePane(T.activeWindow(S.session));
        if (p.mode !== 'copy') return mv(['['], '[ を押す（コピーモードに入る）');
        if (S.q1) return copyMove('cancel', 'コピーモードを抜ける。シェルに戻る');
        return copyMove('top', '一番上へ', 'emacs 式は Alt+<');
      }
    },
    copy_page: {
      // The mark is put three pages up, measured on this pane as it stands;
      // solved while it is in view (PageDown brings it back after an overshoot).
      steps: 3, text: 'ページ送りで印の行まで戻る（copy mode）', cmd: 'copy-mode → page-up', allow: ['copy'], show: ['page'],
      goal: function () { return [{ pane: S.target, mark: 'top', tag: '印の行が見えるまで上へ' }]; },
      setup: function () {
        var pane = T.activePane(T.activeWindow(S.session));
        pane.mode = null;
        var el = paneBodyEl(pane.id);
        var rows = el ? Math.max(4, Math.round(el.clientHeight / S.cellH)) : 20;
        // Lines from the mark to the end of the scroll (the blank line and
        // the prompt included): just past three page moves of rows - 1 lines.
        var from = 4 * (rows - 1) - 2;
        pane.lines.push({ html: '<span class="sh-prompt">' + esc(promptText(pane)) + '</span>cat server.log' });
        printLog(pane, Math.max(120, from + 40), [{ from: from - 2, text: tx('★ ここまで戻る'), cls: 'sh-gold' }]);
        S.target = pane.id;
        S.q0 = { id: pane.id, ln: pane.lines.length - from };
      },
      check: function () {
        var h = T.findPane(S.session, S.q0.id);
        return !!h && h.pane.mode === 'copy' && lineWhere(h.pane, S.q0.ln) === 'visible';
      },
      step: function () {
        var h = T.findPane(S.session, S.q0.id);
        if (!h) return null;
        return h.pane.mode === 'copy' ? [2, 2, '印の行が見えるまで上へ'] : [1, 2, 'コピーモードに入る'];
      },
      next: function () {
        var back = moveTo(S.target);
        if (back) return back;
        var p = T.activePane(T.activeWindow(S.session));
        if (p.mode !== 'copy') return mv(['['], '[ を押す（コピーモードに入る）');
        if (lineWhere(p, S.q0.ln) === 'below') {
          // Many pages below (a pane of one row pages a line at a time):
          // leaving and coming back is quicker than paging down.
          if (linePages(p, S.q0.ln) > 6) return mv(['q'], tx('q で抜ける（{0} で入り直すと、一番下に戻る）', ownKey('[').label || '['), true);
          return mv(['PageDown'], 'PageDown を押す（行き過ぎた。1 ページ下へ）', true);
        }
        return mv(['PageUp'], 'PageUp を押す（1 ページ上へ。印の行が見えるまで）', true);
      }
    },
    copy_search: {
      // vi keys: ? searches up (the history is above), n finds the next.
      steps: 3, text: 'ログの中の言葉を検索で探す（copy mode）', cmd: 'copy-mode → search-backward', allow: ['copy'], show: ['search'],
      goal: function () { return [{ pane: S.target, mark: 'top', tag: tx('{0} の行を探す', S.q0.word) }]; },
      setup: function (r) {
        var pane = T.activePane(T.activeWindow(S.session));
        pane.mode = null;
        pane.search = null;
        var word = pick(r, ['ERROR', 'WARN', 'FATAL', 'panic']);
        pane.lines.push({ html: '<span class="sh-prompt">' + esc(promptText(pane)) + '</span>cat server.log' });
        printLog(pane, 140, [{ from: 40 + pickInt(r, 60), text: word + tx('  接続が切れた'), cls: 'sh-err' }]);
        S.target = pane.id;
        S.q0 = { id: pane.id, word: word };
        S.qGoal = word;
        S.qText = tx('ログの中の {0} の行を探す（検索）', word);
      },
      check: function () {
        var h = T.findPane(S.session, S.q0.id);
        return !!h && h.pane.mode === 'copy' && lineAt(h.pane, h.pane.cy).indexOf(S.q0.word) >= 0;
      },
      step: function () {
        var h = T.findPane(S.session, S.q0.id);
        if (!h) return null;
        return h.pane.mode !== 'copy' ? [1, 3, 'コピーモードに入る'] : S.prompt ? [3, 3, tx('{0} と打って Enter', S.q0.word)] : [2, 3, '? で上向きに検索'];
      },
      next: function () {
        var back = moveTo(S.target);
        if (back) return back;
        var p = T.activePane(T.activeWindow(S.session));
        if (p.mode !== 'copy') return mv(['['], '[ を押す（コピーモードに入る）');
        if (S.prompt && /search/.test(S.prompt.label)) {
          var pm = mv([], tx(S.prompt.value ? 'Ctrl+u で消して {0} と打って Enter' : '{0} と打って Enter（見つかった行へ飛ぶ）', S.q0.word), true);
          pm.prompt = true;
          pm.type = S.q0.word;
          return onTrack(pm);
        }
        return copyMove('searchUp', '上向きに検索', 'emacs 式は Ctrl+r');
      }
    },
    last_window: {
      steps: 1, text: '直前のウィンドウに戻る（last-window）', cmd: 'last-window', allow: ['select_window'], show: ['last_window'],
      goal: function () { return [{ tab: S.q0, tag: 'ここへ戻る' }]; },
      setup: function (r) {
        needWindows(2);
        // The window you were in last; the status bar marks it with -.
        var last = T.windowById(S.session, S.session.last);
        if (!last || last.id === S.session.active) { last = pick(r, otherWindows()); S.session.last = last.id; }
        S.q0 = last.id;
        S.qGoal = { index: last.index, name: last.name };
        S.qText = tx('直前のウィンドウ {0} に戻る', winLabel(last));
      },
      check: function () { return S.session.active === S.q0; },
      next: function () {
        var w = T.windowById(S.session, S.q0);
        if (!w) return null;
        // A slip to another window made that one the last: the number then.
        if (S.session.last === S.q0) return mv(['l'], tx('l を押す（直前のウィンドウ {0} に戻る）', winLabel(w)));
        return windowMove(S.q0, true);
      }
    },
    break_pane: {
      steps: 1, text: 'このペインを別のウィンドウにする（break-pane）', cmd: 'break-pane', allow: ['break_pane'], show: ['break_pane'],
      goal: function () { return [{ pane: S.target, mark: 'go', tag: 'このペインを' }, { tab: '+', tag: '別のウィンドウに' }]; },
      setup: function () {
        needUnzoom(); needPanes(2);
        var win = T.activeWindow(S.session);
        S.target = win.active;
        S.q0 = { win: win.id };
      },
      check: function () {
        var h = T.findPane(S.session, S.target);
        return !!h && h.win.id !== S.q0.win && T.panesOf(h.win).length === 1;
      },
      next: function () { return moveTo(S.target) || mv(['!'], '! を押す（Shift+1）。このペインが新しいウィンドウになる'); }
    },
    find_zoom: {
      steps: 3, text: 'ペインへ移動して全画面にする', cmd: 'select-pane → resize-pane -Z', allow: ['zoom'], show: ['focus', 'zoom'],
      goal: function () { return [{ pane: S.target, mark: 'zoom', tag: 'ここを全画面に' }]; },
      setup: function (r) {
        needUnzoom(); needPanes(2);
        var p = pick(r, otherPanes()), lb = askedLabel(p);
        S.target = p.id;
        S.q0 = { label: lb };
        S.qText = function () { return tx('{0} へ移動して全画面にする', lb()); };
      },
      check: function () { var w = T.activeWindow(S.session); return w.active === S.target && w.zoomed; },
      step: function () {
        var p = T.findPane(S.session, S.target);
        if (!p) return null;
        return activeId() !== S.target ? [1, 2, tx('{0} へ移動する', S.q0.label())] : [2, 2, '全画面にする'];
      },
      next: function () { return moveTo(S.target) || mv(['z'], 'z を押す（全画面に）'); }
    },
    trident: {
      steps: 2, text: '左右に分割し、右側をさらに上下に分割する', cmd: 'split-window -h → -v', allow: ['split_lr', 'split_tb'], show: ['split_lr', 'split_tb'],
      // The shape is read around the pane the question started in: a new
      // left-right split with it on the left and a top-bottom pair on the right.
      goal: function () {
        var s = tridentState();
        if (s === 'start') return [{ pane: S.q0.pane, mark: 'split-v', tag: 'まず左右に' }];
        if (s === 'right') return [{ pane: S.q0.right, mark: 'split-h', tag: '右側を上下に' }];
        return [{ pane: activeId(), mark: 'close', tag: '閉じてやり直す' }];
      },
      setup: function () {
        needUnzoom();
        var win = T.activeWindow(S.session);
        S.q0 = { pane: win.active, parent: T.parentOf(win.root, win.active).parent };
      },
      check: function () { return tridentState() === 'done'; },
      step: function () {
        var s = tridentState();
        if (s === 'start') return [1, 2, '左右に分割する'];
        if (s === 'right') return [2, 2, '右側を上下に分割する'];
        return [0, 2, '形が違う。このペインを閉じてやり直す'];
      },
      next: function () {
        var s = tridentState();
        // % splits the pane you are in: back to the order's pane first.
        if (s === 'start') return moveTo(S.q0.pane) || mv(['%'], '% を押す（まず左右に）');
        if (s === 'right') return moveTo(S.q0.right) || mv(['"'], '" を押す（右側を上下に）');
        return mv(['x'], '形が違う。x → y でペインを閉じて、% → " の順にやり直す');
      }
    },
    two_akima: {
      steps: 8, text: 'ペインを二つ閉じる', cmd: 'kill-pane ×2', allow: ['close'], show: ['focus', 'close'],
      goal: function () { return S.q0.filter(paneExists).map(function (id) { return { pane: id, mark: 'close', tag: '閉じる' }; }); },
      setup: function (r) {
        needUnzoom(); needPanes(3);
        var a = pick(r, otherPanes());
        var b = pick(r, otherPanes().filter(function (p) { return p !== a; }));
        S.q0 = [a.id, b.id];
        // Named as asked: one closed, the other keeps its name (its number now beside it).
        var la = askedLabel(a), lb = askedLabel(b);
        S.q1 = {};
        S.q1[a.id] = la; S.q1[b.id] = lb;
        S.qText = function () {
          var ea = paneExists(a.id), eb = paneExists(b.id);
          if (ea !== eb) return tx('{0} も閉じる（1 つは閉じた）', (ea ? la : lb)());
          return tx('{0} と {1} を閉じる', la(), lb());
        };
      },
      check: function () { return !paneExists(S.q0[0]) && !paneExists(S.q0[1]); },
      step: function () {
        var left = S.q0.filter(paneExists);
        return left.length ? [3 - left.length, 2, tx('{0} を閉じる', S.q1[left[0]]())] : null;
      },
      next: function () {
        var left = S.q0.filter(paneExists);
        return left.length ? closeMove(left[0]) : null;
      }
    },
    new_and_home: {
      steps: 2, text: '新しいウィンドウを作って、元のウィンドウに戻る', cmd: 'new-window → select-window', allow: ['new_window', 'select_window'], show: ['new_window', 'select_window'],
      goal: function () { return S.q1 ? [{ tab: S.q0.home, tag: 'ここへ戻る' }] : [{ tab: '+', tag: '新しいウィンドウ' }]; },
      setup: function () {
        var win = T.activeWindow(S.session);
        S.q0 = { n: S.session.windows.length, home: win.id };
        S.q1 = false;
        S.qGoal = { index: win.index, name: win.name };
        S.qText = tx('新しいウィンドウを作って、{0} に戻る', winLabel(win));
      },
      check: function () {
        if (S.session.windows.length > S.q0.n) S.q1 = true;
        return S.q1 && S.session.active === S.q0.home;
      },
      step: function () { var w = T.windowById(S.session, S.q0.home); if (!w) return null; return S.q1 ? [2, 2, tx('{0} に戻る', winLabel(w))] : [1, 2, '新しいウィンドウを作る']; },
      next: function () { return S.q1 ? windowMove(S.q0.home, true) : mv(['c'], 'c を押す（新しいウィンドウ）'); }
    },
    swap_zoom: {
      steps: 4, text: 'ペインを左上まで動かして全画面にする', cmd: 'swap-pane → resize-pane -Z', allow: ['swap', 'zoom'], show: ['swap', 'zoom'],
      goal: function () { return isFirst(S.target) ? [{ pane: S.target, mark: 'zoom', tag: 'ここを全画面に' }] : [{ pane: S.target, mark: 'to-left', tag: '左上へ' }]; },
      setup: function (r) {
        needUnzoom(); needPanes(2);
        var p = swapTarget(r), lb = askedLabel(p);
        S.target = p.id;
        S.q0 = { label: lb };
        S.qText = function () { return tx('{0} を左上まで動かして全画面にする', lb()); };
      },
      check: function () {
        var h = T.findPane(S.session, S.target);
        return !!h && h.win.zoomed && h.win.active === S.target && isFirst(S.target);
      },
      step: function () {
        var p = T.findPane(S.session, S.target);
        if (!p) return null;
        return isFirst(S.target) ? [2, 2, '全画面にする'] : [1, 2, tx('{0} を左上まで動かす', S.q0.label())];
      },
      next: function () { return isFirst(S.target) ? (moveTo(S.target) || mv(['z'], 'z を押す（全画面に）')) : swapMove(); }
    },
    detach_attach: {
      text: 'デタッチして、tmux attach で戻る', cmd: 'detach-client → tmux attach', allow: ['detach'], show: ['detach'], steps: 2,
      goal: function () { return [{ pane: activeId(), mark: 'go', tag: 'デタッチして戻る' }]; },
      setup: function () {
        // Already outside (a slip): the first half is done.
        S.q1 = S.detached;
        S.q0 = { home: S.session };
        S.target = activeId();
      },
      // Back in the session it left: a new one made outside (tmux new) is not "back".
      check: function () {
        if (S.detached) S.q1 = true;
        return S.q1 && !S.detached && (S.session === S.q0.home || S.sessions.indexOf(S.q0.home) < 0);
      },
      step: function () { return S.detached || S.q1 ? [2, 2, 'tmux attach で戻る'] : [1, 2, 'デタッチする']; },
      next: function () {
        if (S.detached) return S.session === S.q0.home ? attachMove() : attachTo(S.q0.home);
        if (S.q1) return sessionMove(S.q0.home);
        return mv(['d'], 'd を押す（デタッチ）。tmux の外のシェルに戻る');
      }
    },
    yank_paste: {
      // As in tmux: the copy cursor starts on the prompt, so the line above
      // is reached with ↑, selected from its head (Home) to its end (End).
      text: 'cat が出した行をコピーして、貼り付ける', cmd: 'copy-mode → paste-buffer', allow: ['copy', 'yank_start', 'yank', 'paste'], show: ['copy', 'yank', 'paste'], steps: 7,
      goal: function () { return [{ pane: S.q0.id, mark: 'go', tag: S.clipboard === S.q0.text ? 'ここに貼り付ける' : 'この行をコピーする' }]; },
      setup: function () {
        var pane = T.activePane(T.activeWindow(S.session));
        pane.mode = null;
        pane.pasted = false;
        pane.lines.push({ html: '<span class="sh-prompt">' + esc(promptText(pane)) + '</span>cat kakejiku.txt' });
        var gold = tx('「デタッチしても、セッションはそのまま。」');
        pane.lines.push({ html: '<span class="sh-gold">' + esc(gold) + '</span>', text: gold, cls: 'sh-gold' });
        S.q0 = { id: pane.id, ln: pane.lines.length - 1, text: gold };
        S.target = pane.id;
      },
      // Pasted, and the line itself: a copy of some other text is not it.
      check: function () { return !!T.findPane(S.session, S.q0.id) && S.pasted === S.q0.text; },
      step: function () { return S.clipboard === S.q0.text ? [2, 2, 'ここに貼り付ける'] : [1, 2, 'この行をコピーする']; },
      next: function () {
        var h = T.findPane(S.session, S.q0.id);
        if (!h) return null;
        var p = h.pane;
        // Back to the pane the line is in first.
        var back = moveTo(S.q0.id);
        if (back) return back;
        if (p.mode === 'copy') {
          var ln = S.q0.ln;
          // Copied with a key that stays in copy mode (copy-pipe): out first.
          if (S.clipboard === S.q0.text) return copyMove('cancel', 'コピーモードを抜ける');
          // A selection begun somewhere else: let go of it first.
          if (p.sel != null && (p.sel !== ln || p.selx !== 0)) return mv(['Esc'], 'Esc を押す（選び直す）', true);
          if (p.cy > ln) return mv(['↑'], '↑ を押す（コピーする行まで上がる）', true);
          // Far above the line (g, PageUp): leaving and coming back is quicker than ↓ a hundred times.
          if (ln - p.cy > 5) return mv(['q'], tx('q で抜ける（{0} で入り直すと、一番下に戻る）', ownKey('[').label || '['), true);
          if (p.cy < ln) return mv(['↓'], '↓ を押す（コピーする行まで下がる）', true);
          if (p.sel == null) return lineMove(p.cx > 0 ? copyMove('home', '行の頭へ', 'vi 式は 0、emacs 式は Ctrl+a') : copyMove('begin', 'ここから選び始める'));
          if (p.cx < endCol(lineAt(p, ln))) return copyMove('end', '行の終わりまで選ぶ', 'vi 式は $、emacs 式は Ctrl+e');
          return copyMove('copy', copyKeyStays('copy') ? '選んだところをコピーする。コピーモードには残る' : '選んだところをコピーする');
        }
        if (S.clipboard === S.q0.text) return mv([']'], '] を押す（貼り付ける）');
        return mv(['['], '[ を押す（コピーモードに入る）');
      }
    },
    // The session questions name the session on the status bar ([name]).
    // A session made with new -s is switched to, as in tmux, so the second
    // step is the way back.
    session_new: {
      steps: 4, text: '新しいセッションを作って、元のセッションに戻る', cmd: 'new-session -s 名前 → switch-client', allow: ['new_session', 'choose', 'detach'], show: ['new_session', 'choose'],
      goal: function () { return S.q1 ? [{ sess: S.q0.home, tag: tx('{0} に戻る', S.q0.home.name) }] : [{ sess: '+', tag: tx('「{0}」を作る', S.q0.name) }]; },
      setup: function (r) {
        var home = S.session;
        var name = pick(r, SESSION_NAMES.filter(function (nm) { return !sessionByName(nm); })) || freshName();
        S.q0 = { name: name, home: home, had: S.sessions.slice() };
        S.q1 = false;
        S.qGoal = { name: name, home: home.name };
        S.qText = function () { return tx('セッション「{0}」を作って、{1} に戻る', name, home.name); };
      },
      check: function () {
        if (sessionByName(S.q0.name)) S.q1 = true;
        return S.q1 && S.session === S.q0.home;
      },
      step: function () { return S.q1 ? [2, 2, tx('{0} に戻る', S.q0.home.name)] : [1, 2, tx('セッション「{0}」を作る', S.q0.name)]; },
      next: function () {
        if (S.q1) return sessionMove(S.q0.home);
        if (S.prompt && S.prompt.label === ':') {
          var pm = mv([], tx(S.prompt.value ? 'Ctrl+u で消して new -s {0} と打って Enter' : 'new -s {0} と打って Enter（セッションができて、そこに移る）', S.q0.name), true);
          pm.prompt = true;
          pm.type = 'new -s ' + S.q0.name;
          return onTrack(pm);
        }
        // A session of another name came out: said; the order stands.
        var extra = S.sessions.filter(function (s) { return S.q0.had.indexOf(s) < 0; })[0];
        if (extra) return mv([':'], tx('セッション「{0}」ができた。もう一度 : を押して new -s {1}', extra.name, S.q0.name));
        return mv([':'], ': を押す（コマンドの入力欄が出る）');
      }
    },
    session_switch: {
      steps: 3, text: 'ほかのセッションへ移る', cmd: 'choose-tree → switch-client', allow: ['choose'], show: ['choose'],
      goal: function () { return [{ sess: S.q0.target, tag: tx('{0} へ', S.q0.target.name) }]; },
      setup: function (r) {
        needSessions(3);
        var t = pick(r, otherSessions());
        S.q0 = { target: t };
        S.qGoal = { name: t.name };
        S.qText = function () { return tx('セッション {0} へ移る', t.name); };
      },
      check: function () { return S.session === S.q0.target; },
      next: function () { return sessionMove(S.q0.target, true); }
    },
    session_attach: {
      // tmux ls is shown on the way (it is how you learn the name outside)
      // but not required: attach -t straight away passes too.
      steps: 4, text: 'デタッチして、tmux attach -t 名前 でほかのセッションに入る', cmd: 'detach-client → tmux attach -t 名前', allow: ['detach'], show: ['detach'],
      goal: function () { return [{ sess: S.q0.target, tag: tx('外から {0} に入る', S.q0.target.name) }]; },
      setup: function (r) {
        needSessions(2);
        var t = pick(r, otherSessions());
        S.q0 = { target: t };
        // Already outside (a slip): the first step is done.
        S.q1 = S.detached;
        S.qGoal = { name: t.name };
        S.qText = function () { return tx('デタッチして、tmux attach -t {0} で {0} に入る', t.name); };
      },
      check: function () {
        if (S.detached) S.q1 = true;
        return S.q1 && !S.detached && S.session === S.q0.target;
      },
      step: function () {
        if (!S.detached && !S.q1) return [1, 3, 'デタッチする'];
        if (S.detached && !S.outer.ls) return [2, 3, 'tmux ls で一覧を見る'];
        return [3, 3, tx('tmux attach -t {0} で入る', S.q0.target.name)];
      },
      next: function () {
        var name = S.q0.target.name;
        // Back inside but not there (tmux attach without -t): out again.
        if (!S.detached) return mv(['d'], S.q1 ? tx('d を押す（もう一度デタッチして、-t {0} で入り直す）', name) : 'd を押す（デタッチ）。tmux の外のシェルに戻る');
        var m = S.outer.ls ? mv(['Enter'], tx('tmux attach -t {0} と打って Enter（{0} に入る）', name), true) : mv(['Enter'], 'tmux ls と打って Enter（セッションの一覧が出る）', true);
        m.type = S.outer.ls ? 'tmux attach -t ' + name : 'tmux ls';
        return m;
      }
    },
    // ---- 達人 ----
    join_pane: joinQ(false),
    join_pane_h: joinQ(true),
    swap_window: {
      steps: 3, text: 'ウィンドウの番号を入れ替える（swap-window）', cmd: 'swap-window -t 番号', allow: ['swap_window', 'select_window'], show: ['swap_window'],
      goal: function () { return [{ tab: S.q0.win, tag: tx('{0} 番へ', S.q0.to) }, { tab: S.q0.other, tag: tx('{0} 番へ', S.q0.from) }]; },
      setup: function (r) {
        needWindows(3);
        var win = T.activeWindow(S.session), o = pick(r, otherWindows());
        S.q0 = { win: win.id, other: o.id, from: win.index, to: o.index };
        S.qGoal = { index: o.index };
        S.qText = tx('このウィンドウ {0} を {1} と入れ替える（{2} 番へ）', winLabel(win), winLabel(o), o.index);
      },
      check: function () {
        var a = T.windowById(S.session, S.q0.win), o = T.windowById(S.session, S.q0.other);
        return !!a && !!o && a.index === S.q0.to && o.index === S.q0.from;
      },
      next: function () {
        if (S.session.active !== S.q0.win) return windowMove(S.q0.win);
        var o = T.windowById(S.session, S.q0.other);
        return cmdMove('swap-window -t ' + o.index, tx('{0} と入れ替わる', winLabel(o)));
      }
    },
    move_window: {
      steps: 3, text: 'ウィンドウを空いている番号へ動かす（move-window）', cmd: 'move-window -t 番号', allow: ['move_window', 'select_window'], show: ['move_window'],
      goal: function () { return [{ tab: S.q0.win, tag: tx('{0} 番へ', S.q0.to) }]; },
      setup: function (r) {
        var win = T.activeWindow(S.session), b = S.session.baseIndex;
        var free = [b + 4, b + 5, b + 6, b + 7, b + 8].filter(function (i) { return !T.windowByIndex(S.session, i); });
        var to = pick(r, free);
        S.q0 = { win: win.id, to: to };
        S.qGoal = { index: to };
        S.qText = tx('このウィンドウ {0} を {1} 番へ動かす（move-window）', winLabel(win), to);
      },
      check: function () { var w = T.windowById(S.session, S.q0.win); return !!w && w.index === S.q0.to; },
      next: function () {
        if (S.session.active !== S.q0.win) return windowMove(S.q0.win);
        return cmdMove('move-window -t ' + S.q0.to, tx('{0} 番へ動く', S.q0.to), ownPrompt(MOVE_PROMPT), String(S.q0.to));
      }
    },
    layout: layoutQ(false),
    layout_cycle: layoutQ(true),
    sync_panes: {
      steps: 7, text: '全部のペインに同じコマンドを一度に打つ（synchronize-panes）', cmd: 'setw synchronize-panes on → off', allow: ['sync', 'zoom'], show: ['sync'],
      goal: function () { return [{ pane: activeId(), mark: 'go', tag: syncDone() ? '同期をオフに戻す' : syncOn(T.activeWindow(S.session), null) ? 'ここで打つと全部のペインに入る' : '同期をオンにする' }]; },
      setup: function (r) {
        needUnzoom(); needPanes(3);
        var win = T.activeWindow(S.session);
        var cmd = pick(r, ['date', 'uptime', 'hostname']);
        var had = {};
        T.panesOf(win).forEach(function (p) { had[p.id] = p.lines.length; p.mode = null; });
        S.q0 = { win: win.id, cmd: cmd, panes: Object.keys(had), had: had };
        S.qGoal = { cmd: cmd };
        S.qText = tx('全部のペインで {0} を一度に打つ（同期をオン → {0} → オフ）', cmd);
      },
      check: function () { return syncDone() && !syncLeft(); },
      step: function () { return syncDone() ? [3, 3, '同期をオフに戻す'] : syncLeft() ? [2, 3, tx('{0} と打って Enter（全部のペインに入る）', S.q0.cmd)] : [1, 3, '同期をオンにする']; },
      next: function () {
        var w = T.windowById(S.session, S.q0.win);
        if (!w) return null;
        if (S.session.active !== w.id) return windowMove(w.id);
        if (syncDone()) return syncMove(false);
        if (!syncOn(w, T.activePane(w))) return syncMove(true);
        if (w.zoomed) return mv(['z'], 'z を押す（全画面を戻す。隠れたペインには入らない）');
        if (T.activePane(w).mode === 'copy') return copyMove('cancel', 'コピーモードを抜ける');
        // What the synced panes hold already: the start of the command goes on.
        var cmd = S.q0.cmd, ins = T.panesOf(w).filter(function (p) { return syncOn(w, p); }).map(function (p) { return p.input || ''; });
        var typed = ins[0] || '', same = ins.every(function (x) { return x === typed; });
        var dirty = ins.some(function (x) { return x; }) && !(same && cmd.indexOf(typed) === 0);
        var rest = dirty ? cmd : cmd.slice(typed.length);
        var m = mv([], dirty ? tx('Ctrl+u で消して {0} と打って Enter（全部のペインに入る）', cmd) : typed ? (rest ? tx('続けて {0} と打って Enter（全部のペインに入る）', rest) : tx('Enter を押す（全部のペインに入る）')) : tx('{0} と打って Enter（全部のペインに入る）', cmd), true);
        m.type = rest; m.clear = dirty; m.shell = true;
        return m;
      }
    },
    pane_jump: {
      steps: 2, text: 'ペインに番号を出して、番号で飛ぶ（display-panes）', cmd: 'display-panes', allow: [], show: ['display_panes'],
      goal: function () { return [{ pane: S.target, mark: 'go', tag: 'ここへ（q と番号で）' }]; },
      setup: function (r) {
        needUnzoom(); needPanes(4);
        var win = T.activeWindow(S.session);
        var near = ['L', 'R', 'U', 'D'].map(function (d) { var nb = T.neighbour(win, S.cols, S.rows, d, true); return nb && nb.id; });
        var far = otherPanes().filter(function (p) { return near.indexOf(p.id) < 0; });
        var p = pick(r, far.length ? far : otherPanes()), lb = askedLabel(p);
        S.target = p.id;
        S.qText = function () { return tx('{0} へ、q で番号を出して飛ぶ', lb()); };
      },
      check: function () { return activeId() === S.target; },
      next: function () {
        var h = T.findPane(S.session, S.target);
        if (!h) return null;
        var win = T.activeWindow(S.session);
        if (h.win !== win) return windowMove(h.win.id);
        var qi = T.paneIndex(S.session, win, h.pane);
        // The numbers are up (for display-panes-time, 1 s): the number now.
        if (S.panesShown && Date.now() < S.panesShown) return mv([String(qi)], tx('{0} を押す（その番号のペインへ飛ぶ）', qi), true);
        var dms = optMs('display-panes-time', 1000);
        var m = dms === 1000 ? mv(['q'], 'q を押す（ペインに番号が出る。1 秒のうちに番号を押す）') : mv(['q'], tx('q を押す（ペインに番号が出る。{0} 秒のうちに番号を押す）', dms / 1000));
        var a = moveTo(S.target);
        if (a) m.alt = [{ pfx: a.pfx, keys: a.keys, text: a.text }];
        return m;
      }
    },
    search_yank: {
      steps: 6, text: 'ログを検索して、見つけた行をまるごとコピーする（copy mode）', cmd: 'search-backward → begin-selection → copy-selection', allow: ['copy', 'yank_start', 'yank', 'search'], show: ['search', 'yank'],
      goal: function () { return [{ pane: S.q0.id, mark: 'top', tag: tx('{0} の行をコピーする', S.q0.word) }]; },
      setup: function (r) {
        var pane = T.activePane(T.activeWindow(S.session));
        pane.mode = null;
        pane.search = null;
        var word = pick(r, ['ERROR', 'WARN', 'FATAL', 'panic']), from = 30 + pickInt(r, 60), total = 140;
        pane.lines.push({ html: '<span class="sh-prompt">' + esc(promptText(pane)) + '</span>cat server.log' });
        var base = pane.lines.length;
        printLog(pane, total, [{ from: from, text: word + tx('  ディスクがいっぱい'), cls: 'sh-err' }]);
        var ln = base + total - 1 - from;
        S.target = pane.id;
        S.q0 = { id: pane.id, word: word, ln: ln, text: lineText(pane.lines[ln]).trim() };
        S.qGoal = word;
        S.qText = tx('ログの {0} の行を検索で探して、その行をまるごとコピーする', word);
      },
      check: function () { return !!T.findPane(S.session, S.q0.id) && S.clipboard.trim() === S.q0.text; },
      step: function () {
        var h = T.findPane(S.session, S.q0.id);
        if (!h) return null;
        return h.pane.mode !== 'copy' ? [1, 3, 'コピーモードに入る'] : h.pane.cy !== S.q0.ln ? [2, 3, tx('{0} を検索する', S.q0.word)] : [3, 3, 'その行をまるごとコピーする'];
      },
      next: function () {
        var back = moveTo(S.q0.id);
        if (back) return back;
        var p = T.activePane(T.activeWindow(S.session)), ln = S.q0.ln;
        if (p.mode !== 'copy') return mv(['['], '[ を押す（コピーモードに入る）');
        if (S.prompt && /search/.test(S.prompt.label)) {
          var pm = mv([], tx(S.prompt.value ? 'Ctrl+u で消して {0} と打って Enter' : '{0} と打って Enter（見つかった行へ飛ぶ）', S.q0.word), true);
          pm.prompt = true;
          pm.type = S.q0.word;
          return onTrack(pm);
        }
        // A selection begun somewhere else: let go of it first.
        if (p.sel != null && (p.sel !== ln || p.selx !== 0)) return mv(['Esc'], 'Esc を押す（選び直す）', true);
        if (p.cy !== ln) return copyMove('searchUp', '上向きに検索', 'emacs 式は Ctrl+r');
        if (p.sel == null) return lineMove(p.cx > 0 ? copyMove('home', '行の頭へ', 'vi 式は 0、emacs 式は Ctrl+a') : copyMove('begin', 'ここから選び始める'));
        if (p.cx < endCol(lineAt(p, ln))) return copyMove('end', '行の終わりまで選ぶ', 'vi 式は $、emacs 式は Ctrl+e');
        return copyMove('copy', copyKeyStays('copy') ? '選んだところをコピーする。コピーモードには残る' : '選んだところをコピーする');
      }
    },
    rotate: {
      steps: 2, text: 'ペインを回して、印のペインを左上へ（rotate-window）', cmd: 'rotate-window', allow: ['swap'], show: ['rotate'],
      goal: function () { return [{ pane: S.q0.target, mark: 'to-left', tag: '回して左上へ' }]; },
      setup: function (r) {
        needUnzoom(); needPanes(3);
        var win = T.activeWindow(S.session), ps = T.panesOf(win);
        var p = pick(r, ps.slice(1));
        var label = paneLabel(p);
        S.target = p.id;
        S.q0 = { win: win.id, order: ps.map(function (x) { return x.id; }), target: p.id };
        S.qText = tx('ペインを回して、いまの {0} を左上へ（rotate-window）', label);
      },
      check: function () { return isFirst(S.q0.target) && sameCycle(); },
      next: function () {
        var h = T.findPane(S.session, S.q0.target);
        if (!h) return null;
        if (h.win !== T.activeWindow(S.session)) return windowMove(h.win.id);
        var ps = T.panesOf(h.win), k = ps.indexOf(h.pane), n = ps.length;
        var back = MAC ? 'Option+o' : 'Alt+o';
        var up = mv(['Ctrl+o'], 'Ctrl+o を押す（全部のペインが 1 つずつ前へ回る）'), down = mv([back], tx('{0} を押す（全部のペインが 1 つずつ後ろへ回る）', back));
        var first = k <= n - k ? up : down;
        first.alt = [k <= n - k ? down : up];
        return first;
      }
    },
    new_window_named: {
      steps: 3, text: '名前を付けて新しいウィンドウを作る（new-window -n）', cmd: 'new-window -n 名前', allow: ['new_window', 'rename', 'select_window'], show: ['command'],
      goal: function () { return [{ tab: '+', tag: tx('「{0}」を作る', S.q0.name) }]; },
      setup: function (r) {
        var used = {};
        S.session.windows.forEach(function (w) { used[w.name] = 1; });
        var name = pick(r, ['tail', 'repl', 'top', 'vim', 'deploy'].filter(function (n) { return !used[n]; })) || 'tail';
        S.q0 = { name: name, had: S.session.windows.map(function (w) { return w.id; }) };
        S.qGoal = name;
        S.qText = tx('「{0}」という名前の新しいウィンドウを作る（new-window -n）', name);
      },
      check: function () { return S.session.windows.some(function (w) { return w.name === S.q0.name && S.q0.had.indexOf(w.id) < 0; }); },
      next: function () {
        // Made with c, without the name: the name is given there (rename-window).
        var fresh = S.session.windows.filter(function (w) { return S.q0.had.indexOf(w.id) < 0; })[0];
        if (fresh && S.session.active === fresh.id && !(S.prompt && S.prompt.label === ':')) {
          if (S.prompt && S.prompt.label === '(rename-window)') {
            var pm = mv([], tx('Ctrl+u（か Backspace）で今の名前「{0}」を消し、{1} と打って Enter', S.prompt.value, S.q0.name), true);
            pm.prompt = true;
            pm.type = S.q0.name;
            return pm;
          }
          return mv([','], tx(', を押す（このウィンドウに名前「{0}」を付ける）', S.q0.name));
        }
        return cmdMove('new-window -n ' + S.q0.name, tx('「{0}」ができる', S.q0.name));
      }
    },
    kill_session: {
      steps: 3, text: 'ほかのセッションを閉じる（kill-session）', cmd: 'kill-session -t 名前', allow: ['kill_session'], show: ['command'],
      goal: function () { return [{ pane: activeId(), mark: 'go', tag: tx('セッション {0} を閉じる', S.q0.target.name) }]; },
      setup: function (r) {
        needSessions(2);
        var t = pick(r, otherSessions());
        S.q0 = { target: t };
        S.qGoal = { name: t.name };
        S.qText = function () { return tx('セッション {0} を閉じる（kill-session -t {0}）', t.name); };
      },
      check: function () { return S.sessions.indexOf(S.q0.target) < 0; },
      next: function () { return cmdMove('kill-session -t ' + S.q0.target.name, tx('{0} が閉じる', S.q0.target.name)); }
    }
  };

  // Where the trident question stands: 'start' (nothing new around the
  // pane), 'right' (split left-right, the right pane still whole; S.q0.right
  // names it), 'done', or 'other' (some other shape).
  function tridentState() {
    var win = T.activeWindow(S.session);
    var hit = T.parentOf(win.root, S.q0.pane);
    if (!hit) return 'other';
    var p = hit.parent;
    if (p === S.q0.parent) return 'start';
    if (!p || p.dir !== 'lr' || p.a !== hit.node) return 'other';
    if (p.b.type === 'pane') { S.q0.right = p.b.pane.id; return 'right'; }
    return p.b.dir === 'tb' && p.b.a.type === 'pane' && p.b.b.type === 'pane' ? 'done' : 'other';
  }

  // ---- the 達人 questions' helpers ------------------------------------------

  // A command typed at the : prompt: first :, then the command (over what
  // was typed) and Enter. `own`: the player's key that asks for its
  // argument instead (bind J command-prompt "join-pane -s '%%'"), and
  // `arg` what to answer there.
  function cmdMove(cmd, what, own, arg) {
    if (own && S.prompt && S.prompt.label === own.act.label) {
      var op = mv([], tx(S.prompt.value ? 'Ctrl+u で消して {0} と打って Enter' : '{0} と打って Enter（{1}）', arg, tx(what)), true);
      op.prompt = true;
      op.type = arg;
      return onTrack(op);
    }
    if (own && !(S.prompt && S.prompt.label === ':')) {
      var om = mv([own.key.label], tx('{0} を押す（「{1}」と聞かれる）', own.key.label, own.act.label), own.table === 'root');
      om.own = true;
      return om;
    }
    if (S.prompt && S.prompt.label === ':') {
      var pm = mv([], tx(S.prompt.value ? 'Ctrl+u で消して {0} と打って Enter' : '{0} と打って Enter（{1}）', cmd, tx(what)), true);
      pm.prompt = true;
      pm.type = cmd;
      return onTrack(pm);
    }
    return mv([':'], ': を押す（コマンドの入力欄が出る）');
  }

  // The player's key that asks for a command's argument (command-prompt
  // with a template the test `re` matches), or null.
  var JOIN_PROMPT = /^(join-pane|joinp|move-pane|movep)\s+-s\s+['"]?%%/;
  var MOVE_PROMPT = /^(move-window|movew)\s+-t\s+['"]?%%/;
  function ownPrompt(re) {
    if (!S.conf) return null;
    var found = null;
    S.conf.binds.forEach(function (b) { if (b.act.run === 'prompt' && (b.table === 'prefix' || b.table === 'root') && re.test(b.act.tpl)) found = b; });
    return found;
  }

  // join-pane, below (`h`: to the right of) the pane the question began in.
  function joinQ(h) {
    return {
      steps: 3, text: h ? 'ほかのウィンドウのペインを、このペインの右に連れてくる（join-pane -h）' : 'ほかのウィンドウのペインを、このペインの下に連れてくる（join-pane）',
      cmd: h ? 'join-pane -h -s 番号' : 'join-pane -s 番号', allow: ['join', 'break_pane'], show: ['join'],
      goal: function () {
        var src = T.findPane(S.session, S.q0.src);
        var out = [{ pane: S.q0.dst, mark: h ? 'split-v' : 'split-h', tag: h ? 'この右へ' : 'この下へ' }];
        if (src && src.win.id !== S.q0.win) out.push({ tab: src.win.id, tag: 'ここのペインを' });
        return out;
      },
      setup: function (r) {
        needUnzoom(); needWindows(2);
        var win = T.activeWindow(S.session), w = pick(r, otherWindows());
        var label = winLabel(w);
        S.target = T.activePane(w).id;
        S.q0 = { src: S.target, dst: win.active, win: win.id };
        S.qGoal = { index: w.index };
        S.qText = tx(h ? 'ウィンドウ {0} のペインを、このペインの右に連れてくる（join-pane -h）' : 'ウィンドウ {0} のペインを、このペインの下に連れてくる（join-pane）', label);
      },
      check: function () {
        var hs = T.findPane(S.session, S.q0.src);
        if (!hs || hs.win.id !== S.q0.win) return false;
        var hit = T.parentOf(hs.win.root, S.q0.src), p = hit.parent;
        return !!p && p.dir === (h ? 'lr' : 'tb') && p.b === hit.node && p.a.type === 'pane' && p.a.pane.id === S.q0.dst;
      },
      next: function () {
        var hs = T.findPane(S.session, S.q0.src);
        if (!hs) return null;
        // Here in another shape: back to a window of its own first (break-pane).
        if (hs.win.id === S.q0.win) return moveTo(S.q0.src) || mv(['!'], '! を押す（形が違う。いったん別のウィンドウに戻して、やり直す）');
        var back = moveTo(S.q0.dst);
        if (back) return back;
        // The window's own pane is -s :N (a bare N is a pane here first); another of its panes is :N.P.
        var t = ':' + hs.win.index + (hs.win.active === hs.pane.id ? '' : '.' + T.paneIndex(S.session, hs.win, hs.pane));
        return cmdMove((h ? 'join-pane -h -s ' : 'join-pane -s ') + t, h ? '右に来る' : '下に来る', h ? null : ownPrompt(JOIN_PROMPT), t);
      }
    };
  }

  // The layouts in words: their tmux names and what they look like.
  var LAYOUT_WORDS = {
    'even-horizontal': '横に均等', 'even-vertical': '縦に均等', 'main-horizontal': '上に大きく', 'main-horizontal-mirrored': '下に大きく',
    'main-vertical': '左に大きく', 'main-vertical-mirrored': '右に大きく', tiled: '田の字'
  };
  function layoutLabel(name) { return tx('{0}（{1}）', name, tx(LAYOUT_WORDS[name])); }

  // The rooms of the window as `name` would lay them out, on a copy.
  function layoutRects(win, name) {
    var copy = { root: cloneTree(win.root), zoomed: false, active: win.active, lastLayout: win.lastLayout };
    T.applyLayout(copy, name);
    return T.layout(copy, S.cols, S.rows).panes;
  }
  function sameShape(win, name) {
    var key = function (list) { return list.map(function (r) { return r.pane.id + ':' + r.x + ',' + r.y + ',' + r.w + ',' + r.h; }).join(' '); };
    var z = win.zoomed;
    win.zoomed = false;
    var now = key(T.layout(win, S.cols, S.rows).panes);
    win.zoomed = z;
    return now === key(layoutRects(win, name));
  }

  // The 完成図 of a layout question: the window as it will be, small, with
  // the pane numbers and the one you are in.
  function layoutFigure(name) {
    var win = T.windowById(S.session, S.q0.win);
    if (!win) return null;
    return { rects: layoutRects(win, name).map(function (r) { return { x: r.x / S.cols, y: r.y / S.rows, w: r.w / S.cols, h: r.h / S.rows, n: T.paneIndex(S.session, win, r.pane), me: r.pane.id === win.active }; }), ratio: (S.cols * S.cellW) / (S.rows * S.cellH) };
  }

  // select-layout by its key (prefix M-1 …), or `cycle`: next-layout (Space)
  // to the next one in its order.
  function layoutQ(cycle) {
    return {
      steps: 1, text: cycle ? '並べ方を順に変える（next-layout）' : '並べ方を選んで変える（select-layout）', cmd: cycle ? 'next-layout' : 'select-layout', allow: ['layout'], show: [cycle ? 'layout' : 'layout_pick'],
      goal: function () { return [{ pane: activeId(), mark: 'go', tag: tx('{0}に', layoutLabel(S.q0.name)) }]; },
      figure: function () { return layoutFigure(S.q0.name); },
      setup: function (r) {
        needUnzoom(); needPanes(3);
        var win = T.activeWindow(S.session), name;
        if (cycle) {
          // The next one in the order that changes something.
          for (var i = 1; i <= T.LAYOUTS.length && !name; i++) {
            var n = T.LAYOUTS[(win.lastLayout + i) % T.LAYOUTS.length];
            if (!sameShape(win, n)) name = n;
          }
        } else {
          name = pick(r, T.LAYOUT_KEYS.slice(0, 5).filter(function (n) { return n !== win.layoutName && !sameShape(win, n); }));
        }
        S.q0 = { win: win.id, name: name || 'tiled' };
        S.qGoal = { layout: S.q0.name };
        S.qText = tx(cycle ? 'Space で並べ方を順に変えて、{0}にする' : '並べ方を {0}にする', layoutLabel(S.q0.name));
      },
      check: function () { var w = T.activeWindow(S.session); return w.id === S.q0.win && w.layoutName === S.q0.name && !w.zoomed; },
      next: function () {
        var w = T.windowById(S.session, S.q0.win);
        if (!w) return null;
        if (S.session.active !== w.id) return windowMove(w.id);
        var lb = (MAC ? 'Option+' : 'Alt+') + (T.LAYOUT_KEYS.indexOf(S.q0.name) + 1);
        var pick1 = mv([lb], tx('{0} を押す（{1}になる）', lb, layoutLabel(S.q0.name)));
        var space = mv(['Space'], tx(cycle ? 'Space を押す（次の並べ方へ。{0}まで）' : 'Space を押す（次の並べ方 {0}へ）', layoutLabel(cycle ? S.q0.name : T.LAYOUTS[(w.lastLayout + 1) % T.LAYOUTS.length])));
        var nextIs = T.LAYOUTS[(w.lastLayout + 1) % T.LAYOUTS.length] === S.q0.name;
        if (cycle) { space.alt = [pick1]; return space; }
        if (nextIs) pick1.alt = [space];
        return pick1;
      }
    };
  }

  // synchronize-panes: whether every pane the question began with has run
  // the command since, and whether any pane of the window still takes the
  // keys of the others.
  function syncDone() {
    var w = T.windowById(S.session, S.q0.win);
    if (!w) return false;
    var want = promptText() + S.q0.cmd;
    return S.q0.panes.every(function (id) {
      var h = T.findPane(S.session, id);
      if (!h || h.win !== w) return true;
      for (var i = S.q0.had[id]; i < h.pane.lines.length; i++) if (lineText(h.pane.lines[i]) === want) return true;
      return false;
    });
  }
  function syncLeft() {
    var w = T.windowById(S.session, S.q0.win);
    return !!w && T.panesOf(w).some(function (p) { return syncOn(w, p); });
  }

  // Turning it on or off: the player's own key for it (bind S setw
  // synchronize-panes), else the command.
  function syncMove(on) {
    var own = null;
    if (S.conf) S.conf.binds.forEach(function (b) {
      var a = b.act.argv;
      if (b.act.run !== 'cmd' || !a || !/^(set|set-option|setw|set-window-option)$/.test(a[0]) || (b.table !== 'prefix' && b.table !== 'root')) return;
      var f = CF.flags(a);
      if (f.rest[0] !== 'synchronize-panes' || f.f.g || f.f.p || f.f.u) return;
      if (f.rest[1] == null || /^(on|yes|1)$/i.test(f.rest[1]) === on) own = b;
    });
    if (own && !(S.prompt && S.prompt.label === ':')) {
      var m = mv([own.key.label], tx(on ? '{0} を押す（同期をオンにする）' : '{0} を押す（同期をオフに戻す）', own.key.label), own.table === 'root');
      m.own = true;
      return m;
    }
    return cmdMove('setw synchronize-panes ' + (on ? 'on' : 'off'), on ? '同期がオンになる' : '同期がオフに戻る');
  }

  // rotate-window keeps the panes' round order: the order now is the one
  // the question began with, turned.
  function sameCycle() {
    var w = T.windowById(S.session, S.q0.win);
    if (!w) return false;
    var now = T.panesOf(w).map(function (p) { return p.id; }), was = S.q0.order;
    if (now.length !== was.length) return false;
    var at = now.indexOf(was[0]);
    return at >= 0 && was.every(function (id, i) { return now[(at + i) % now.length] === id; });
  }

  // Short names of the question types, for lists.
  var TYPE_NAMES = {
    split_lr: '左右に分割', split_tb: '上下に分割', focus: 'ペイン移動', zoom: '全画面', unzoom: '全画面を戻す',
    close: 'ペインを閉じる', new_window: 'ウィンドウ作成', select_window: 'ウィンドウ移動', resize: '大きさ変更', swap: '入れ替え',
    rename: '名前を変える', kill_window: 'ウィンドウを閉じる', copy_top: 'スクロール', find_zoom: '移動して全画面', trident: '三分割',
    two_akima: '二つ閉じる', new_and_home: '作って戻る', swap_zoom: '入れ替えて全画面', detach_attach: 'デタッチして戻る', yank_paste: 'コピーと貼り付け',
    session_new: 'セッション作成', session_switch: 'セッション移動', session_attach: 'attach -t で入る',
    copy_page: 'ページ送り', copy_search: '履歴の検索', last_window: '直前のウィンドウ', break_pane: 'ペインを別ウィンドウに',
    join_pane: 'ペインを連れてくる', join_pane_h: 'ペインを右に連れてくる', swap_window: 'ウィンドウの入れ替え', move_window: 'ウィンドウの番号を変える',
    layout: '並べ方を選ぶ', layout_cycle: '並べ方を順に変える', sync_panes: '全部のペインに打つ', pane_jump: '番号で飛ぶ',
    search_yank: '検索してコピー', rotate: 'ペインを回す', new_window_named: '名前付きのウィンドウ', kill_session: 'セッションを閉じる'
  };
  function typeName(t) { return TYPE_NAMES[t] ? tx(TYPE_NAMES[t]) : t; }

  // What a key does, for the miss chip (actions that are never a miss are left out).
  var ACTION_NAMES = {
    split_lr: '左右に分割', split_tb: '上下に分割', zoom: '全画面の切り替え', close: 'ペインを閉じる', new_window: '新しいウィンドウ',
    resize: '大きさを変える', swap: 'ペインの入れ替え', rename: 'ウィンドウの名前', kill_window: 'ウィンドウを閉じる', copy: 'コピーモード',
    detach: 'デタッチ', layout: '並べ方を変える', paste: '貼り付け', yank: 'コピー', yank_start: '選び始め', search: '検索',
    rename_session: 'セッションの名前', new_session: '新しいセッション', rename_pane: 'ペインの名前', choose: 'セッション一覧',
    break_pane: 'ペインを別ウィンドウに', join: 'ペインを連れてくる', swap_window: 'ウィンドウの入れ替え', move_window: 'ウィンドウを動かす',
    sync: '同期入力', kill_session: 'セッションを閉じる'
  };

  // The tips of a question type: those of the action it is really about
  // (the last one it shows) first, then of the rest.
  function tipsOf(type) {
    var q = Q[type];
    if (!q) return [];
    var pool = [];
    q.show.slice().reverse().forEach(function (a) { pool = pool.concat(LV.tipsFor(a)); });
    return pool;
  }

  // A new order, avoiding the same question twice in a row where it can.
  // `rand` makes it repeatable (today's order); Math.random otherwise.
  function shuffle(a, rand) {
    rand = rand || Math.random;
    for (var tries = 0; tries < 50; tries++) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      // Nor 全画面 right after a new window: the fresh window has one pane,
      // so the zoom question would have to add one first.
      if (a.every(function (x, n) { return n === 0 || (a[n - 1] !== x && !(a[n - 1] === 'new_window' && x === 'zoom')); })) break;
    }
    return a;
  }

  // The ghost (影) to race, as picked on the course select (S.ghostPick):
  // today's fastest player, the next one up from your best, or your own
  // best. Your own is there at once; the board's arrives if it can, with its
  // keys when it logged them. A shuffled run races only its own.
  function pickGhost(b) {
    if (b.course.practice || b.course.daily || b.first) { b.ghost = null; return; }
    var own = REC.ghostOf(b.course.id);
    b.ghost = own;
    var mode = S.ghostPick;
    // Reading a ghost sends nothing of the player's; from a file:// page
    // only a local test server is asked, as with the boards.
    if (mode === 'own' || !NET || b.shuffled || !(NET.state().key || /^https?:$/.test(location.protocol) || /^http:\/\/(localhost|127\.0\.0\.1)|-staging\./.test(NET.API))) return;
    NET.ghost(b.course.id, 'today', mode === 'next' && own ? { above: own.time } : null).then(function (g) {
      if (!g || S.run !== b || (g.splits || []).length !== b.qs.length) return;
      var me = NET.state().name;
      if (me && g.name === me) return;
      b.ghost = { name: g.name, time: g.time, splits: g.splits, keys: g.keys || null, today: true, kind: mode === 'next' && own ? 'next' : 'top' };
      prepGhost(b);
      $('#playbar').dataset.key = '';
      if (S.screen === 'game') renderPlaybar();
    }).catch(function () { /* offline: your own ghost */ });
  }

  var GHOST_PICKS = [['top', '今日の 1 位'], ['next', '1 つ上の人'], ['own', '自己ベスト']];
  function ghostPickHTML() {
    return '<div class="ghost-pick"><span class="gp-l">' + tx('影（いっしょに走る相手）') + '</span><div class="seg" role="group" aria-label="' + tx('影') + '">' +
      GHOST_PICKS.map(function (x) { return '<button type="button" data-ghost="' + x[0] + '" aria-pressed="' + (x[0] === S.ghostPick ? 'true' : 'false') + '">' + tx(x[1]) + '</button>'; }).join('') + '</div></div>';
  }

  function prepGhost(b) {
    if (!b.ghost) return;
    var t = 0;
    b.ghost.cum = b.ghost.splits.map(function (s) { t += s; return t; });
  }

  // The questions of a run. A house asks the same questions every time, in
  // today's order: the same for everyone on the same day (Japan time), so
  // the ランキング compares like with like. The 稽古 picks one question at a
  // time (drillNext). 順番を変えて (`shuffled`) asks in a fresh order instead,
  // so a replay is not from memory; such a run is kept but never sent to
  // the ranking.
  function questionsFor(course, day, shuffled) {
    if (course.drill) return [drillNext(null)];
    if (course.daily) return [LV.dailyPick(day)];
    if (shuffled) return pairZoom(shuffle(course.qs.slice()));
    return pairZoom(shuffle(course.qs.slice(), rng(day + ':' + course.id)));
  }

  // 稽古: every type the courses ask, weighed by how often its keys are
  // needed and how it has gone (records.js drillPick, counting this run's
  // questions too); never the same type twice in a row.
  // Until 入門 has been played through, only its types: nothing is drilled
  // that was never shown with its 手順. The 達人 house's types join once
  // that house (or 今日の達人) has been played.
  function drillTypes() {
    var out = [], all = REC.load();
    var pro = REC.runsOf('pro', all).length || REC.runsOf('daily', all).length;
    var easy = REC.runsOf('easy', all).length;
    LV.COURSES.forEach(function (c) {
      if ((c.expert && !pro) || (c.id !== 'easy' && !easy)) return;
      c.qs.forEach(function (t) { if (Q[t] && out.indexOf(t) < 0) out.push(t); });
    });
    return out;
  }

  function drillNext(b) {
    var done = b ? b.qlog.filter(function (q) { return q && q.s != null; }) : [];
    var last = b && b.qs.length ? b.qs[b.qs.length - 1] : null;
    return REC.drillPick(drillTypes(), REC.drillRecent(done), last);
  }

  // 'unzoom' goes right after a 'zoom' wherever it can, so z is pressed
  // twice in a row on the live house: in, then out. An unzoom with no zoom
  // left to follow stays where the shuffle put it (the house zooms for it).
  function pairZoom(list) {
    var outs = list.filter(function (t) { return t === 'unzoom'; }).length;
    if (!outs) return list;
    var zooms = list.filter(function (t) { return t === 'zoom'; }).length;
    var spare = Math.max(0, outs - zooms), out = [];
    list.forEach(function (t) {
      if (t === 'unzoom') { if (spare) { spare--; out.push(t); } return; }
      out.push(t);
      if (t === 'zoom' && outs > spare) { outs--; out.push('unzoom'); }
    });
    return out;
  }

  function prepareRun(courseId, opts) {
    var course = REC.courseOf(courseId) || REC.courseOf('easy');
    var day = LV.dayKey();
    var shuffled = !!(opts && opts.shuffle) && !course.practice;
    var played = course.practice || course.daily ? 0 : REC.runsOf(course.id).length;
    // はじめての回: the house's own first order (levels.js firstQs), off the ranking.
    var first = !!course.firstQs && !shuffled && !played;
    var qs = first ? course.firstQs.slice() : questionsFor(course, day, shuffled);
    S.run = {
      course: course,
      day: day,
      qs: qs,
      shuffled: shuffled,
      first: first,
      // 上級 and 達人 from their second run on: the 手順 start hidden.
      blind: !!course.blind || !!(course.blindLater && played),
      // The 稽古 goes on until the player stops, or for the count they chose.
      target: course.drill && opts && opts.n > 0 ? opts.n : 0,
      // Question types learnt before this run: their 手順 stays folded.
      learnt: REC.learnt(),
      // The 目安 of the question being asked (loadQuestion sets each).
      limit: qLimit(qs[0]),
      i: 0,
      phase: 'ready',
      penalty: 0, misses: 0, overs: 0, guides: 0, keys: 0,
      // Tab switches: how many, and the seconds the clock stood still.
      pauses: 0, paused: 0,
      start: 0, qStart: 0, end: 0,
      stage: 0,
      ghostDiff: null,
      // Today's rooms are the same for everyone too.
      seed: course.practice || shuffled ? course.id + ':' + Math.random() : day + ':' + course.id,
      // What was pressed when (logKey): the ghost's hands and the replay.
      klog: course.drill ? null : { keys: [], q: [], v: SIM_V }
    };
    pickGhost(S.run);
    prepGhost(S.run);
  }

  function beginRun() {
    var b = S.run;
    b.phase = 'count';
    b.i = 0;
    b.penalty = 0; b.misses = 0; b.overs = 0; b.guides = 0; b.keys = 0;
    b.pauses = 0; b.paused = 0;
    b.streak = 0;
    b.qlog = [];
    if (b.klog) b.klog = { keys: [], q: [], v: SIM_V };
    $('#sashizu').dataset.key = '';
    seal(false);
    var n = 3;
    var NUM = { 3: kanji(3), 2: kanji(2), 1: kanji(1) };
    banner(NUM[n], 'count');
    AU.se('tick');
    var step = function () {
      if (S.run !== b) return;
      n -= 1;
      if (n > 0) { banner(NUM[n], 'count'); AU.se('tick'); b.timer = setTimeout(step, reduceMotion ? 250 : 650); return; }
      banner('始め', 'go');
      AU.se('go');
      b.phase = 'play';
      b.start = performance.now();
      loadQuestion();
      render();
      startClock();
      // The tab was left during the countdown: the clock must not run.
      if (document.hidden || !document.hasFocus()) pauseRun();
    };
    b.timer = setTimeout(step, reduceMotion ? 250 : 650);
    render();
  }

  // Leaving the tab or the window stops the clock; the question is hidden
  // until the player is back and presses a key or clicks.
  function pauseRun() {
    var b = S.run;
    if (S.replay || !b || b.phase !== 'play' || S.screen !== 'game') return;
    b.phase = 'pause';
    b.pausedAt = performance.now();
    b.pauses += 1;
    clearInterval(S.clock);
    S.armed = false;
    AU.stop();
    $('#pause').hidden = false;
    render();
  }

  function resumeRun() {
    var b = S.run;
    if (!b || b.phase !== 'pause') return;
    var d = performance.now() - b.pausedAt;
    b.start += d;
    b.qStart += d;
    b.paused += d / 1000;
    b.phase = 'play';
    $('#pause').hidden = true;
    $('#sashizu').dataset.key = '';
    AU.se('go');
    music();
    startClock();
    render();
    focusSink();
  }

  function loadQuestion() {
    var b = S.run;
    if (nowMs() < S.repeatUntil) S.graceUntil = nowMs() + 500;
    S.repeatUntil = 0;
    // A message from the last question would hide this one's wings.
    S.message = null;
    clearTimeout(S.messageTimer);
    // Its miss chip would read as a miss on this question (a streak chip stays).
    $$('#chips .chip.miss').forEach(function (c) { c.parentNode.removeChild(c); });
    var type = b.qs[b.i];
    var q = Q[type];
    // The house stays as it is; only a half-typed prompt or confirm is dropped.
    S.armed = false;
    S.confirm = null;
    S.prompt = null;
    S.picker = null;
    hidePaneNumbers();
    S.qText = null;
    S.qGoal = null;
    S.qNote = [];
    S.target = null;
    // Copy mode belongs to the question that asked for it.
    S.session.windows.forEach(function (w) { T.panesOf(w).forEach(function (p) { if (p.mode) p.mode = null; }); });
    q.setup(rng(b.seed + ':' + b.i));
    b.q = q;
    b.type = type;
    b.stage = 0;
    b.peek = false;
    b.limit = qLimit(type);
    S.clipboard = '';
    S.pasted = '';
    // `l` is this question's 目安: the records measure it against that; `p`
    // the fewest keys it takes on these bindings.
    var guidePar = parKeys(b), fewest = guidePar == null ? null : parKeys(b, true);
    b.qlog[b.i] = { t: type, s: null, m: 0, l: b.limit, p: fewest ? Math.min(fewest.n, guidePar) : guidePar };
    // The guide's own count (標準), and the fewest way, for the word after a long way round.
    if (guidePar != null) b.qlog[b.i].sd = guidePar;
    b.route = fewest ? fewest.route : null;
    b.qStart = performance.now();
    if (b.klog) b.klog.q[b.i] = Math.max(0, Math.round(b.qStart - b.start));
  }

  // ---- the fewest keys (標準, par) ------------------------------------------------
  // How many keys the question takes when the 手順 is followed to the letter
  // on the player's own bindings: a -r key repeats without the prefix, a -n
  // key needs none, a prompt takes its text and Enter. Tried on the house
  // itself, then every object is put back as it was (snapshot), so nothing
  // that points into the house goes stale. Null when the guide did not get
  // there, and then nothing is claimed.
  // The guide's own way, and (`wide`) the other ways it shows beside each
  // step (o, ;, q and the number, ( ) L…) and a command typed by its
  // shortest name: the fewest of them all. {n, route: [labels], last}.
  function parKeys(b, wide) {
    if (!b.q || b.q.check()) return wide ? { n: 0, route: [] } : 0;
    var snap = snapshot(), best = null, budget = 80;
    S.sim = true;
    S.graceUntil = 0;
    var go = function (n, route, depth) {
      if (b.q.check()) { if (!best || n < best.n) best = { n: n, route: route.slice() }; return; }
      if (depth > 60 || (best && n >= best.n) || budget-- <= 0) return;
      var m = guideMove(b);
      if (!m) return;
      var ways = [m];
      if (wide && !S.legacy) {
        (m.alt || []).forEach(function (a) { if (a && a.keys && a.keys.length) ways.push(a); });
        var sh = m.type && shortTyped(m.type);
        if (sh) ways.push({ pfx: false, keys: [], type: sh, prompt: true, cont: false, clear: m.clear });
      }
      for (var i = 0; i < ways.length; i++) {
        var keep = ways.length > 1 ? snapshot() : null;
        var k = simMove(ways[i]);
        if (k) go(n + k, route.concat([ways[i].type != null ? ways[i].type + ' Enter' : moveLabel(ways[i])]), depth + 1);
        if (keep) restore(keep);
        if (!k && i === 0 && ways.length === 1) return;
      }
    };
    try { go(0, [], 0); } catch (e) { best = null; }
    S.sim = false;
    restore(snap);
    if (!wide) return best ? best.n : null;
    return best;
  }

  // A typed command with its name as short as tmux takes it (killp, kill-ses);
  // null when it is already that short.
  function shortTyped(text) {
    var w = String(text).split(' '), r = CF.resolve(w[0]);
    if (!r.name) return null;
    w[0] = CF.shortest(r.name);
    // A session by the shortest start of its name (-t wo for work).
    var ti = w.indexOf('-t');
    if (ti > 0 && /^(kill-session|switch-client|attach-session)$/.test(r.name) && sessionByName(w[ti + 1] || '')) {
      for (var n = 1; n < w[ti + 1].length; n++) if (sessionTarget(w[ti + 1].slice(0, n)) === sessionByName(w[ti + 1])) { w[ti + 1] = w[ti + 1].slice(0, n); break; }
    }
    var out = w.join(' ');
    return out.length < String(text).length ? out : null;
  }

  function simKey(ev) {
    if (!ev) return 0;
    S.lastAction = null;
    handleGameKey({ key: ev.key, code: ev.code, ctrl: !!ev.ctrl, alt: !!ev.alt, shift: !!ev.shift, meta: false });
    return 1;
  }

  function simType(text) {
    var n = 0;
    String(text).split('').forEach(function (ch) { n += simKey({ key: ch }); });
    return n + simKey({ key: 'Enter' });
  }

  // One guide move as keys; returns how many were pressed (0: no way).
  function simMove(m) {
    var n = 0;
    if (m.type) {
      if ((S.prompt && S.prompt.value && !m.cont) || m.clear) n += simKey({ key: 'u', ctrl: true });
      return n + simType(m.type);
    }
    if (!m.keys.length) {
      // The rename prompt: the name the order asks for, over the old one.
      if (!S.prompt || typeof S.qGoal !== 'string') return 0;
      if (S.prompt.value) n += simKey({ key: 'u', ctrl: true });
      return n + simType(S.qGoal);
    }
    var ev = keyFromLabel(m.keys[0]);
    if (!ev) return 0;
    // Inside the repeat window a -r key goes without the prefix (続けて押す).
    if (m.pfx && !S.armed && !(nowMs() < S.repeatUntil && repeatBinding(ev))) n += simKey(prefixEvent());
    m.keys.forEach(function (l) { n += simKey(keyFromLabel(l)); });
    return n;
  }

  // Every object reachable from S with its own fields, so the house can be
  // tried on and put back in place (restore). DOM nodes and functions are
  // left alone.
  function snapshot() {
    var seen = typeof Map === 'function' ? new Map() : null;
    var list = [];
    var walk = function (o) {
      if (!o || typeof o !== 'object' || (seen ? seen.has(o) : list.some(function (e) { return e.o === o; }))) return;
      if (typeof Node !== 'undefined' && o instanceof Node) return;
      if (seen) seen.set(o, 1);
      var copy = Array.isArray(o) ? o.slice() : {};
      if (!Array.isArray(o)) for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) copy[k] = o[k];
      list.push({ o: o, c: copy });
      if (Array.isArray(o)) o.forEach(walk);
      else for (var j in copy) walk(copy[j]);
    };
    walk(S);
    return list;
  }

  function restore(list) {
    list.forEach(function (e) {
      var o = e.o, c = e.c;
      if (Array.isArray(o)) { o.length = 0; for (var i = 0; i < c.length; i++) o.push(c[i]); return; }
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k) && !Object.prototype.hasOwnProperty.call(c, k)) delete o[k];
      for (var j in c) o[j] = c[j];
    });
  }

  function qText(b) { var t = S.qText; return typeof t === 'function' ? t() : t || tx(b.q.text); }

  // After every key: a miss, or the question solved.
  function runTick() {
    var b = S.run;
    if (!b || b.phase !== 'play') return;
    // Moving about (panes, windows) is never a miss: the guide may lead back.
    var free = ['brief', 'focus', 'select_window', 'yank_start', 'search', 'cmd'];
    if (S.lastAction && free.indexOf(S.lastAction) < 0 &&
        (S.lastAction === 'unbound' || b.q.allow.indexOf(S.lastAction) < 0)) {
      miss();
    }
    var q1 = S.q1;
    if (!b.q.check() && lostTarget(b)) askAgain(b);
    // A check that moved the question on (S.q1: the top reached, a window
    // made) comes after the draw, so the card is drawn again.
    if (S.q1 !== q1 && !b.q.check()) render();
    if (b.q.check()) {
      shorterWay(b);
      b.streak = (b.streak || 0) + 1;
      AU.se('hit', b.streak);
      termFlash('hit');
      var used = (performance.now() - b.qStart) / 1000;
      b.qlog[b.i].s = +used.toFixed(2);
      // Against the ghost: where you are now versus where it was here.
      if (b.ghost && b.ghost.cum) b.ghostDiff = (performance.now() - b.start) / 1000 + b.penalty - b.ghost.cum[b.i];
      if (b.streak % 5 === 0) chip('good', tx('{0} 問連続 ・ ミスなし', b.streak));
      // Hold the solved rooms on screen while they finish moving, under a
      // 成 seal. The clock stops for it; any key goes on at once.
      b.phase = 'clear';
      b.clearAt = performance.now();
      clearInterval(S.clock);
      seal(true);
      render();
      b.timer = setTimeout(function () { if (S.run === b) afterClear(); }, reduceMotion ? 250 : CLEAR_HOLD);
    }
  }

  // Solved the long way round: the shorter way, said once a run for each
  // type, briefly, and never a miss. last-window by its number: l needs no number.
  function shorterWay(b) {
    var q = b.qlog[b.i];
    if (!q || S.replay || (b.said && b.said[b.type])) return;
    var say = null, lk = S.lastKey;
    if (b.type === 'last_window' && lk && !lk.ctrl && !lk.alt) {
      var own = ownKey('l');
      if (!own.none && lk.key !== own.label && lk.key !== 'l') say = tx('{0} なら番号を見なくても 1 キーで戻れる', own.label);
    }
    // Another way than the fewest (its last key differs; not a slip on the same way).
    if (!say && b.route && b.route.length && typeof q.p === 'number' && q.k > q.p && lk) {
      var end = b.route[b.route.length - 1].split(' ').pop();
      var mine = ARROWS[{ ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D' }[lk.key]] || (lk.key === ' ' ? 'Space' : lk.key);
      if (end !== mine && end !== CF.keyLabel({ key: lk.key, ctrl: !!lk.ctrl, alt: !!lk.alt, shift: !!lk.shift })) say = tx('{0} キーの道もある（{1}）', q.p, b.route.join(' → '));
    }
    if (!say) return;
    b.said = b.said || {};
    b.said[b.type] = 1;
    // The chip stays into the next question: it names the one it is about.
    chip('', tx('{0}: {1}', typeName(b.type), say));
  }

  var CLEAR_HOLD = 650;

  function seal(on) {
    var el = $('#seal');
    if (!el) return;
    el.classList.remove('show');
    if (on) { void el.offsetWidth; el.classList.add('show'); }
  }

  function afterClear() {
    var b = S.run;
    if (!b || b.phase !== 'clear') return;
    clearTimeout(b.timer);
    var d = performance.now() - b.clearAt;
    b.start += d;
    b.phase = 'play';
    seal(false);
    b.i += 1;
    if (b.i === 1) count('q1');
    if (b.course.drill && b.i >= b.qs.length && !(b.target && b.i >= b.target)) b.qs.push(drillNext(b));
    if (b.i >= b.qs.length) { finishRun(); return; }
    loadQuestion();
    render();
    startClock();
    // The tab was left during the hold: the clock must not run.
    if (document.hidden || !document.hasFocus()) pauseRun();
  }

  function miss() {
    var b = S.run;
    b.misses += 1;
    b.streak = 0;
    b.penalty += LV.MISS_PENALTY;
    if (b.qlog[b.i]) b.qlog[b.i].m += 1;
    AU.se('miss');
    // A wrong key on a folded 手順 brings it out at once (and counts as shown).
    if (folded(b)) { peek(b); renderSashizu(); renderTerm(); renderTabArrow(); renderKeybar(); }
    // A wrong key teaches its own job: " は上下に分割.
    var what = ACTION_NAMES[S.lastAction], k = S.lastKey;
    var label = k && k.key !== 'Enter' ? CF.keyLabel({ key: k.key, ctrl: !!k.ctrl, alt: !!k.alt, shift: !!k.shift }) : '';
    chip('miss', !what ? tx('ミス +{0} 秒', LV.MISS_PENALTY)
      : label ? tx('ミス +{0} 秒 ・ {1} は「{2}」', LV.MISS_PENALTY, label, tx(what))
      : tx('ミス +{0} 秒 ・ {1}', LV.MISS_PENALTY, tx(what)));
    termFlash('miss');
    shake();
  }

  // The 行灯: past the 目安 the panel says so, once, and stays still. The
  // question is never skipped; the 手順 is on screen from the start.
  function startClock() {
    clearInterval(S.clock);
    S.clock = setInterval(function () {
      var b = S.run;
      if (!b || b.phase !== 'play' || S.screen !== 'game') { clearInterval(S.clock); return; }
      var used = (performance.now() - b.qStart) / 1000;
      var stage = used > b.limit ? 1 : 0;
      // A learnt question: try from memory first, the steps come after a few seconds.
      if (!b.peek && used > LV.PEEK_AFTER && folded(b)) { peek(b); renderSashizu(); renderTerm(); renderTabArrow(); renderKeybar(); }
      if (stage > b.stage) {
        var log = b.qlog[b.i];
        if (b.stage < 1) { b.overs += 1; log.o = 1; b.streak = 0; }
        b.stage = stage;
        AU.se('andon');
        syncBody();
        renderSashizu();
        // A folded 手順 opens in the order at the top of the room.
        renderTerm();
        renderTabArrow();
      }
      renderClock();
      renderGhostbar();
    }, 100);
  }

  // The folded 手順 comes out: the solve no longer counts as from memory
  // (`g`, records.js).
  function peek(b) {
    b.peek = true;
    b.qlog[b.i].g = 1;
    b.guides += 1;
  }

  // The 稽古 ends when the player stops (やめる, Esc twice): what was solved
  // is its result. Nothing solved yet: a plain quit (false).
  function endDrill() {
    var b = S.run;
    if (!b || !b.course.drill || b.phase === 'done' || b.phase === 'count') return false;
    if (!b.qlog.some(function (q) { return q && q.s != null; })) return false;
    finishRun();
    return true;
  }

  function finishRun() {
    var b = S.run;
    dropBinds();
    clearInterval(S.clock);
    clearTimeout(b.timer);
    b.end = performance.now();
    // Stopped mid-hold or paused: the clock had stopped there.
    if (b.phase === 'pause') { var dp = b.end - b.pausedAt; b.start += dp; b.qStart += dp; $('#pause').hidden = true; }
    if (b.phase === 'clear') b.start += b.end - b.clearAt;
    b.phase = 'done';
    count('finish');
    var drill = !!b.course.drill;
    // A 稽古 stopped on a question: that one is not part of the result.
    var qlog = b.qlog.filter(function (q) { return q && q.s != null; });
    var open = b.qlog.length > qlog.length ? b.qlog[b.qlog.length - 1] : null;
    var raw = (b.end - b.start) / 1000 - (open ? (b.end - b.qStart) / 1000 : 0);
    var misses = b.misses - (open ? open.m : 0);
    var time = raw + misses * LV.MISS_PENALTY;
    var paused = +b.paused.toFixed(1);
    var n = qlog.length;
    var result = {
      course: b.course.id, time: time, raw: raw, misses: misses, overs: b.overs, guides: b.guides,
      keys: b.keys, n: n, avg: time / n, qlog: qlog,
      pauses: b.pauses, paused: paused, shuffled: b.shuffled, drill: drill, daily: !!b.course.daily, day: b.day,
      first: b.first, blind: b.blind && !b.course.daily
    };
    if (drill) { result.bestStreak = REC.drillStreak(qlog); result.bestBefore = REC.drillBest(); }
    var sum = REC.add({
      course: b.course.id, prefix: S.conf ? S.conf.prefix.label : 'C-b', conf: S.conf ? 1 : undefined,
      time: +time.toFixed(2), raw: +raw.toFixed(2), misses: misses, overs: b.overs, guides: b.guides,
      keys: b.keys, n: n, qs: qlog, drill: drill || undefined,
      pauses: b.pauses || undefined, paused: paused || undefined, shuffled: b.shuffled || undefined,
      first: b.first ? 1 : undefined, blind: b.blind && !drill && !b.course.daily ? 1 : undefined,
      // The day's order and the keys: what a replay needs.
      day: drill ? undefined : b.day, klog: !drill && b.klog ? b.klog : undefined
    });
    for (var k in sum) result[k] = sum[k];
    // The question that ran longest past its 目安, to practise next.
    var slow = null;
    qlog.forEach(function (q) { if (q.o && (!slow || q.s > slow.s)) slow = q; });
    result.slow = slow ? slow.t : null;
    // The tip is about the question that needs it: the one past its 目安,
    // else the one that took longest.
    var longest = null;
    qlog.forEach(function (q) { if (q.s != null && (!longest || q.s > longest.s)) longest = q; });
    result.tipFor = slow ? slow.t : longest ? longest.t : null;
    var pool = tipsOf(result.tipFor);
    if (!pool.length) { result.tipFor = null; b.qs.forEach(function (t) { pool = pool.concat(tipsOf(t)); }); }
    result.tip = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    result.at = new Date();
    if (b.ghost) {
      result.ghost = { name: b.ghost.name, time: b.ghost.time, diff: +(time - b.ghost.time).toFixed(2), kind: b.ghost.kind };
    }
    result.conf = S.conf ? 1 : 0;
    S.result = result;
    S.navAfter = performance.now() + 700;
    shareRun(sum.runId);
    S.run = null;
    showScreen('result');
    // A best time past the first run gets the long fanfare, a new rank the
    // climbing one; the screen's own tune follows either.
    AU.play(result.record && result.count > 1 ? 'record' : result.rankUp ? 'rankup' : 'clear', 'title');
  }

  // ---- replay (この回を見る) ----------------------------------------------
  // A run with a key log is played again on the house: the same day's
  // questions in the same order, the same keys at the same moments, so what
  // happens on screen is what happened. The house is read-only; Space
  // pauses, ×2 hurries, ← → jump between questions, Esc closes. It needs
  // the bindings the run was played on: the defaults, or the player's own
  // file (this device's, or one published on the board). A run the house
  // cannot follow (the keys stop matching) says so and stops.

  // A run that can be played again here: { conf } is the file to play it on
  // (null: the defaults), or null when the keys are unknown.
  function replayable(run, confText) {
    if (!run || !run.klog || !Array.isArray(run.klog.keys) || !Array.isArray(run.klog.q) || !run.day || run.shuffled || run.drill) return null;
    var c = REC.courseOf(run.course);
    if (!c || c.practice || !run.qs || run.qs.length !== (c.daily ? 1 : c.qs.length)) return null;
    if (!run.conf) return { conf: null };
    if (typeof confText === 'string') return { conf: confText };
    // This device's own run on its own file, still the same prefix.
    if (run.mine && S.conf && S.confText && run.prefix === S.conf.prefix.label) return { conf: S.confText };
    return null;
  }

  function startReplay(run, who, confText, from) {
    var can = replayable(run, confText);
    if (!can) return false;
    leaveRun();
    S.replayFrom = from || S.screen;
    S.replay = {
      run: run, who: who || tx('自分'), keys: run.klog.keys, q: run.klog.q,
      i: 0, t: 0, now: null, speed: 1, playing: true, lost: false, done: false,
      wall: performance.now(),
      keep: { text: S.confText, conf: S.conf, screenConf: S.conf }
    };
    // A log from before SIM_V: the house plays by the rules of then.
    S.legacy = (run.klog.v || 1) < SIM_V;
    // The bindings of the run, for its length only.
    if (can.conf != null) { var c = CF.parse(can.conf, { legacy: S.legacy }); S.conf = c.custom ? c : null; S.confText = can.conf; }
    else { S.conf = null; S.confText = ''; }
    replayHouse(0);
    showScreen('game');
    S.replay.timer = setInterval(replayTick, 50);
    return true;
  }

  // The house at the start of question `j`: built fresh, then every key up
  // to that question fed at once.
  function replayHouse(j) {
    var R = S.replay, run = R.run, course = REC.courseOf(run.course);
    buildHouse();
    var qs = run.qs.map(function (q) { return q.t; });
    S.run = {
      course: course, day: run.day, qs: qs, shuffled: false, target: 0, learnt: {}, limit: qLimit(qs[0]),
      i: 0, phase: 'play', penalty: 0, misses: 0, overs: 0, guides: 0, keys: 0, pauses: 0, paused: 0,
      start: performance.now(), qStart: performance.now(), end: 0, stage: 0, ghostDiff: null, streak: 0,
      seed: run.day + ':' + course.id, qlog: [], klog: null, replay: true
    };
    R.i = 0; R.lost = false; R.done = false;
    $('#chips').innerHTML = '';
    $('#playbar').dataset.key = '';
    $('#sashizu').dataset.key = '';
    loadQuestion();
    while (S.run.i < j && R.i < R.keys.length && !R.lost) replayPress(R.keys[R.i++]);
    R.t = R.i < R.keys.length ? Math.max(R.q[S.run.i] || 0, R.keys[R.i][0] - 400) : R.keys.length ? R.keys[R.keys.length - 1][0] : 0;
    R.wall = performance.now();
    render();
  }

  // One logged key on the house, at its own moment on the clock.
  function replayPress(e) {
    var R = S.replay, b = S.run;
    var ev = keyFromLabel(e[1]) || { key: e[1] };
    R.now = e[0];
    S.lastAction = null;
    S.lastKey = ev;
    handleGameKey({ key: ev.key, code: ev.code, ctrl: !!ev.ctrl, alt: !!ev.alt, shift: !!ev.shift, meta: false });
    b.keys += 1;
    if (b.qlog[b.i]) b.qlog[b.i].k = (b.qlog[b.i].k || 0) + 1;
    var free = ['brief', 'focus', 'select_window', 'yank_start', 'search', 'cmd'];
    if (S.lastAction && free.indexOf(S.lastAction) < 0 && (S.lastAction === 'unbound' || b.q.allow.indexOf(S.lastAction) < 0)) {
      b.misses += 1; b.penalty += LV.MISS_PENALTY; b.streak = 0;
      if (b.qlog[b.i]) b.qlog[b.i].m += 1;
      if (!R.jumping) chip('miss', tx('ミス +{0} 秒', LV.MISS_PENALTY));
    }
    if (!b.q.check() && lostTarget(b)) askAgain(b);
    if (b.q.check()) {
      b.streak = (b.streak || 0) + 1;
      b.qlog[b.i].s = +(((R.q[b.i + 1] != null ? R.q[b.i + 1] : e[0]) - R.q[b.i]) / 1000).toFixed(2);
      b.i += 1;
      if (b.i >= b.qs.length) { b.phase = 'done'; R.done = true; }
      else loadQuestion();
    }
    R.now = null;
  }

  function replayTick() {
    var R = S.replay, b = S.run;
    if (!R || !b || S.screen !== 'game') { if (R) clearInterval(R.timer); return; }
    var now = performance.now();
    if (R.playing && !R.done && !R.lost) {
      R.t += (now - R.wall) * R.speed;
      while (R.i < R.keys.length && R.keys[R.i][0] <= R.t && b.phase === 'play') {
        var e = R.keys[R.i];
        // A key from a later question than the house is on: the house went
        // another way than the run did (the keys of another setting, say).
        var qi = 0;
        while (qi + 1 < R.q.length && R.q[qi + 1] <= e[0]) qi++;
        if (qi > b.i) { R.lost = true; break; }
        R.i += 1;
        replayPress(e);
        render();
      }
      if (R.i >= R.keys.length && !R.done) R.done = true;
    }
    R.wall = now;
    // The bar's clock reads the replay's time.
    b.start = now - R.t;
    b.qStart = b.start + (R.q[Math.min(b.i, R.q.length - 1)] || 0);
    renderClock();
    renderGhostbar();
  }

  function replayJump(d) {
    var R = S.replay, b = S.run;
    var j = Math.max(0, Math.min(b.qs.length - 1, (R.done ? b.qs.length - 1 : b.i) + d));
    R.jumping = true;
    replayHouse(j);
    R.jumping = false;
  }

  // The keys of the watcher: Space pauses, ← → jump, Esc closes; the house
  // takes nothing else.
  function replayKey(k) {
    if (isModifierOnly(k.key)) return false;
    if (k.key === 'Escape') { endReplay(); showScreen(S.replayFrom === 'records' ? 'records' : S.result ? 'result' : 'title'); return true; }
    if (k.key === ' ' || k.key === 'Enter') { replayControl('toggle'); return true; }
    if (k.key === 'ArrowLeft') { replayControl('prev'); return true; }
    if (k.key === 'ArrowRight') { replayControl('next'); return true; }
    return true;
  }

  function replayControl(what) {
    var R = S.replay;
    if (!R) return;
    if (what === 'toggle') { if (R.done) { replayHouse(0); R.playing = true; } else { R.playing = !R.playing; R.wall = performance.now(); } }
    if (what === 'speed') R.speed = R.speed === 2 ? 1 : 2;
    if (what === 'prev') replayJump(-1);
    if (what === 'next') replayJump(1);
    if (what === 'close') { endReplay(); showScreen(S.replayFrom === 'records' ? 'records' : S.result ? 'result' : 'title'); return; }
    $('#ghostbar').dataset.key = '';
    renderGhostbar();
    focusSink();
  }

  function endReplay() {
    var R = S.replay;
    if (!R) return;
    clearInterval(R.timer);
    S.extraConf = [];
    S.conf = R.keep.conf;
    S.confText = R.keep.text;
    S.replay = null;
    S.legacy = false;
    S.run = null;
    seal(false);
    syncBody();
  }

  // ---- rendering ----------------------------------------------------------

  function render() {
    syncBody();
    if (S.screen === 'title') renderTitle();
    if (S.screen === 'game') { renderSashizu(); renderPlaybar(); renderGhostbar(); renderTerm(); renderStatus(); renderTabArrow(); renderKeybar(); renderCheat(); }
    if (S.screen === 'result') renderResult();
    if (S.screen === 'records') renderRecords();
  }

  function keycaps(list, lit) {
    return list.map(function (k) { return '<kbd' + (lit && lit.indexOf(k) >= 0 ? ' class="next"' : '') + '>' + esc(k) + '</kbd>'; }).join('');
  }

  var KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  function kanji(n) {
    if (EN) return String(n);
    if (n < 10) return KANJI[n];
    if (n < 20) return '十' + (n % 10 ? KANJI[n % 10] : '');
    return KANJI[Math.floor(n / 10)] + '十' + (n % 10 ? KANJI[n % 10] : '');
  }

  function fmt(t) { return t == null ? '—' : tx('{0}秒', t.toFixed(1)); }

  // A course's floor plan as a small grid: more rooms, a bigger house.
  function planHTML(c) {
    var p = c.plan, cells = '';
    for (var i = 0; i < p.cells; i++) cells += '<i' + (i === p.lit ? ' class="lit"' : '') + '></i>';
    return '<span class="mini" style="grid-template-columns:repeat(' + p.cols + ',1fr);grid-template-rows:repeat(' + p.rows + ',1fr)" aria-hidden="true">' + cells + '</span>';
  }

  function ao5(runs) {
    if (runs.length < 5) return null;
    return runs.slice(0, 5).reduce(function (s, r) { return s + r.time; }, 0) / 5;
  }

  // The shortest and longest 目安 among a course's questions.
  function limitRange(c) {
    var ls = c.qs.map(qLimit);
    return [Math.min.apply(null, ls), Math.max.apply(null, ls)];
  }

  function lastCourse(all) {
    var runs = (all.runs || []).filter(function (r) { var c = REC.courseOf(r.course); return c && !c.practice && !c.daily; });
    var last = runs.slice(-1)[0];
    return last ? last.course : 'easy';
  }

  // 今日の問題: every course asks in today's order, the same for everyone
  // (Japan time), so today's times compare. The day, your streak, and per
  // course today's top time on the boards.
  // 10月23日; in English "Oct 23", since 10/23 reads two ways.
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayLabel(day) { var p = day.split('-'); return EN ? MONTHS[+p[1] - 1] + ' ' + +p[2] : tx('{0}月{1}日', +p[1], +p[2]); }

  function renderToday(all) {
    var el = $('#today');
    if (!el) return;
    var sk = REC.streak(all);
    // One day is no streak yet; yesterday alone is the reason to play today.
    var line = sk.days >= 2 ? (sk.today ? tx('{0} 日連続', sk.days) : tx('{0} 日連続（今日まだ）', sk.days)) : '';
    var again = sk.days === 1 && !sk.today ? tx('昨日も解いた。今日も解くと 2 日連続') : '';
    el.innerHTML = '<b>' + esc(tx('今日の問題')) + '</b> <span class="today-day">' + esc(dayLabel(LV.dayKey())) + '</span>' +
      (line ? '<span class="today-streak">' + esc(line) + '</span>' : '') +
      (again ? '<span class="today-again">' + esc(again) + '</span>' : '') +
      '<small>' + esc(tx('今日はみんな同じ順番で出る。日本時間の 0 時に変わる。')) + '</small>' + dailyLineHTML(all);
    var gp = $('#ghost-pick');
    if (gp) gp.innerHTML = ghostPickHTML();
  }

  // 今日の達人 in one line: the day's question, its fewest keys, and the way in.
  function dailyLineHTML(all) {
    var t = LV.dailyPick(LV.dayKey()), par = dailyPar(), best = REC.todayBest('daily', all);
    return '<p class="today-daily"><span class="td-text"><b>' + esc(tx('今日の達人')) + '</b>: ' + esc(typeName(t)) +
      (par != null ? esc(tx(' ・ 標準 {0} キー', par)) : '') + (best != null ? esc(tx(' ・ 今日 {0}秒', best.toFixed(1))) : '') + '</span>' +
      '<button type="button" class="btn td-go" data-daily="1">' + esc(tx(best != null ? 'もう一度' : '挑む')) + '<kbd class="hk">D</kbd></button></p>';
  }

  function topHTML(id) {
    var t = S.tops && S.tops[id];
    if (!t) return '';
    return esc(tx('最速 {0}', tx('{0}秒', t.time.toFixed(1))));
  }

  // Reading the boards sends nothing of the player's; only from the site.
  function loadTops() {
    if (!NET || !/^https?:$/.test(location.protocol) || S.topsAt && Date.now() - S.topsAt < 60000) return;
    S.topsAt = Date.now();
    S.tops = S.tops || {};
    LV.COURSES.forEach(function (c) {
      NET.board(c.id, BOARD_SPAN).then(function (rows) {
        if (!rows.length) return;
        S.tops[c.id] = rows[0];
        var el = $('#course-list [data-top="' + c.id + '"]');
        if (el) el.innerHTML = topHTML(c.id);
      }).catch(function () { /* offline: nothing to show */ });
    });
  }

  // The belt of a title as a small still mark: its colour and, past 黒帯,
  // the gold stripes. The name is always written beside it.
  function beltHTML(title) {
    var r = LV.rankInfo(title);
    return r ? '<i class="belt b-' + r.belt + (r.stripes ? ' s' + r.stripes : '') + '" aria-hidden="true"></i>' : '';
  }

  // A title with its belt: 黒帯, or Kuro-obi · Black Belt in English.
  function rankHTML(title) {
    return '<span class="rank">' + beltHTML(title) + esc(tx(title)) + '</span>';
  }

  // The title in a line that has no room for the meaning: 黒帯, or Kuro-obi.
  function rankShort(title) {
    var r = LV.rankInfo(title);
    return EN && r ? r.romaji : title;
  }

  // The 免状's day: 2026年10月23日, or Oct 23, 2026.
  function menjoDate(day) {
    var p = day.split('-');
    return EN ? MONTHS[+p[1] - 1] + ' ' + +p[2] + ', ' + p[0] : tx('{0}年{1}月{2}日', p[0], +p[1], +p[2]);
  }

  // 腕前: the level from the latest five runs on a house, いまの調子 (the
  // title is what you reached; the Lv is how it goes now), and how much
  // faster per question the next level is. A still bar, no motion. On the
  // title it is the house that stands highest (records.js skill).
  function skillHTML(sk, from) {
    if (!sk) return '<div class="sk-none">' + esc(tx('腕前 ―　一度はじめると、ここに Lv が出る')) + '</div>';
    var cur = LV.paceFor(sk.lv), nxt = sk.next;
    var frac = nxt != null ? Math.max(0, Math.min(1, (cur - sk.pace) / (cur - nxt))) : 1;
    var up = from && from.lv < sk.lv;
    return '<div class="sk-row"><span class="sk-lab">' + tx('腕前') + '</span><span class="sk-lv' + (up ? ' up' : '') + '">' +
      '<span class="sk-form">' + tx('いまの調子') + '</span> ' + (up ? '<small>Lv.' + from.lv + ' → </small>' : '') + 'Lv.' + sk.lv + '</span></div>' +
      '<div class="sk-bar" aria-hidden="true"><i style="width:' + Math.round(frac * 100) + '%"></i></div>' +
      '<div class="sk-note">' + (nxt != null ? tx('次の Lv.{0} まで、1 問あたり {1} 秒速く', sk.lv + 1, sk.toNext.toFixed(2)) : tx('最高の Lv。')) +
      tx('（{0}の直近 {1} 回の平均 {2} 秒／問）', esc(REC.courseOf(sk.course).title), sk.runs, sk.pace.toFixed(2)) + '</div>';
  }

  // The top bar: the 腕前, always in view.
  function renderMeta(all) {
    var sk = REC.skill(all);
    $('#title-meta').textContent = sk ? tx('いまの調子 Lv.{0}', sk.lv) : 'prefix ' + prefixLabel();
  }

  function renderTitle() {
    var all = REC.load();
    $('#skill').innerHTML = skillHTML(REC.skill(all));
    var dbest = REC.drillBest(all);
    // Before the first drill, the weak spots are the reason to start one.
    var weak = dbest ? [] : REC.weakTypes(1).map(typeName);
    $('#keiko-sub').textContent = dbest ? tx('手順なしで思い出す ・ 最長 {0} 問連続', dbest) : weak.length ? tx('苦手: {0}', weak[0]) : tx('手順なしで思い出す');
    var pick = lastCourse(all);
    var html = '';
    LV.COURSES.forEach(function (c, i) {
      var runs = REC.runsOf(c.id, all);
      var best = REC.best(c.id, all);
      var a5 = ao5(runs);
      // The title reached on this house (the name tag), what the best time
      // holds and the next one; on a house not yet entered, whether the one
      // before has reached 黒帯: the step up.
      var held = REC.bestTitle(c.id, all);
      var nr = best ? LV.nextRank(c, best.time, null, held) : null;
      var prevTitle = !runs.length && i > 0 ? REC.bestTitle(LV.COURSES[i - 1].id, all) : null;
      var stepUp = prevTitle && LV.rankIndex(prevTitle) <= LV.rankIndex(LV.STEP_UP_RANK);
      html += '<li><button type="button" class="wing' + (c.id === pick ? ' hot' : '') + '" data-course="' + c.id + '">' +
        planHTML(c) +
        '<span class="wing-main"><span class="wing-name">' + esc(c.title) +
        '<span class="wing-n">' + nQ(c.qs.length) + '</span>' +
        '<span class="wing-mode' + (c.recommended ? ' rec' : '') + '">' + esc(c.mode) + '</span>' +
        (held ? '<span class="wing-title">' + rankHTML(held) + '</span>' : '') +
        // The key that starts this course (navKey): someone who knows tmux goes straight to 上級 with 3.
        '<kbd class="hk">' + (i + 1) + '</kbd></span>' +
        '<span class="wing-desc">' + tx('目安は 1 問 {0}〜{1} 秒。', limitRange(c)[0], limitRange(c)[1]) + esc(c.desc) + '</span>' +
        (c.blindLater ? '<span class="wing-blind">' + esc(runs.length ? tx('手順なし（{0} 秒で出る）', LV.PEEK_AFTER) : tx('2 回目からは手順なし（{0} 秒で出る）', LV.PEEK_AFTER)) + '</span>' : '') + '</span>' +
        '<span class="wing-best"><small>' + tx('自己ベスト') + '</small><b>' + (best ? fmt(best.time) : '—') + '</b>' +
        '<small>' + (runs.length ? (a5 != null ? tx('五回平均 {0} ・ ', a5.toFixed(1)) : '') + tx('{0} 回', runs.length) : tx('お手本 {0} 秒', LV.par(c))) + '</small>' +
        (nr ? '<small class="wing-rank">' + esc(nr.next ? tx('{0}まで あと {1} 秒', rankShort(nr.next), nr.gap.toFixed(1)) : tx('最高の称号 {0}', rankShort(nr.rank))) + '</small>' : '') +
        (stepUp ? '<small class="wing-next">' + esc(tx('次はここ（{0}で {1}）', LV.COURSES[i - 1].title, rankShort(prevTitle))) + '</small>' : '') +
        '<small class="wing-top" data-top="' + c.id + '">' + topHTML(c.id) + '</small></span>' +
        '</button></li>';
    });
    $('#course-list').innerHTML = html;
    renderToday(all);
    loadTops();
    $('#enter-sub').textContent = tx('{0} から', REC.courseOf(pick).title);
    $('#btn-enter').dataset.course = pick;
    var n = (all.runs || []).length;
    $('#records-sub').textContent = n ? tx('通算 {0} 回', n) : tx('上達を見る');
    // The first-time line has done its job once a run is in.
    $('#fine-first').hidden = n > 0;
    renderMeta(all);
    renderVersion();
  }

  // v1.0.0 · デプロイ 30 · 4c08daf (2026-10-23); the commit links to GitHub.
  function renderVersion() {
    var V = ADV.VERSION || {}, el = $('#ver');
    if (!el || !V.v) return;
    var html = 'v' + esc(V.v) + ' · ' + (V.deploy ? esc(tx('デプロイ {0}', V.deploy)) : 'dev');
    if (/^[0-9a-f]{7,40}$/.test(V.commit || '')) html += ' · <a href="https://github.com/t29mato/tmux-dojo/commit/' + V.commit + '" target="_blank" rel="noopener">' + V.commit.slice(0, 7) + '</a>';
    if (V.at) html += ' (' + esc(V.at) + ')';
    el.innerHTML = html;
  }

  // Whether this question's 手順 is folded: its type is learnt (覚えた), or
  // this is the 稽古, and the 目安 has not passed yet.
  function folded(b) {
    var e = b.learnt && b.learnt[b.qs[b.i]];
    return (!!b.course.drill || !!b.blind || !!(e && e.learnt)) && b.stage === 0 && !b.peek;
  }

  // 問題 3 / 15. The 稽古 counts up (3 / 10 when a count was chosen).
  function qCount(b, sep) {
    var i = Math.min(b.i + 1, b.qs.length);
    var n = b.target || (b.course.drill ? 0 : b.qs.length);
    return n ? i + sep + n : String(i);
  }

  // The 指示, twice: in the house (the order bar under the panes, where the
  // eyes are) and in the side panel (the detail, hidden unless asked for).
  // Each holds the question and the 手順, the answer step by step, shown
  // from the start unless the question type is learnt. Rebuilt only when
  // the question, the stage or the key state changes; the clock ticks update
  // the gauge in place.
  function renderSashizu() {
    var el = $('#sashizu');
    var b = S.run;
    if (el && S.free) {
      if (el.dataset.key === 'free') return;
      el.dataset.key = 'free';
      el.innerHTML = '<div class="sz-lab"><span>' + tx('練習') + '</span></div><div class="sz-q">' + tx('問題も時計もない。自由に触ってみよう') + '</div>' +
        '<p class="sz-free">' + tx('{0} のあとのキーも、{0} → : で打つコマンドも、全部ここで試せる。記録には残らない。', esc(prefixLabel())) + '</p>' +
        '<p class="sz-free">' + tx('やめるときは Esc を 2 回か「やめる」') + '</p>';
      return;
    }
    if (!el || !b) return;
    var playing = b.phase === 'play' && b.q;
    var fold = playing && folded(b);
    var move = playing && !fold ? guideMove(b) : null;
    var key = [b.i, b.phase, b.stage, fold ? 1 : 0, S.armed ? 1 : 0, S.confirm ? 1 : 0, S.prompt ? 1 : 0, move ? move.text : ''].join('|');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    var html = '<div class="sz-lab"><span>' + tx('問題') + '</span><b>' + qCount(b, ' / ') + '</b></div>';
    if (!playing) {
      html += '<div class="sz-q">' + tx(b.phase === 'count' ? 'はじめる……' : b.phase === 'pause' ? '一時停止中' : b.phase === 'clear' ? '成った' : '') + '</div>';
      el.innerHTML = html;
      return;
    }
    html += '<div class="sz-q">' + esc(qText(b)) + '</div>';
    var keys = [], rootKeys = [];
    b.q.show.forEach(function (a) {
      showKeys(a).forEach(function (o) {
        var list = o.pfx ? keys : rootKeys;
        if (list.indexOf(o.label) < 0) list.push(o.label);
      });
    });
    var lit = move ? move.keys : [];
    var pfxCls = 'pfx' + (move && move.pfx ? (S.armed ? ' done' : ' next') : '');
    if (S.qNote.length) html += '<div class="sz-note">' + esc(S.qNote.join(tx('。'))) + '</div>';
    html += '<div class="sz-keys"><kbd class="' + pfxCls + '">' + esc(prefixLabel()) + '</kbd><span class="arr">→</span>' + keycaps(keys, lit) + '</div>';
    if (rootKeys.length) html += '<div class="sz-keys"><span class="arr">' + tx('prefix なし') + '</span>' + keycaps(rootKeys, lit) + '</div>';
    // The command behind the keys, for the curious (the detail panel only).
    html += '<div class="sz-cmd">' + tx('中で動く tmux のコマンド') + ': <code>' + esc(tx(b.q.cmd).replace('-L/-R/-U/-D', tx('-L（左）-R（右）-U（上）-D（下）'))) + '</code></div>';
    if (move) {
      html += '<div class="shinan"><div class="shinan-t">' + tx('手順') + '</div><ol>' +
        steps(move).map(function (s, i, all) {
          var now = all.findIndex(function (x) { return !x.done; });
          return '<li class="' + (s.done ? 'done' : i === now ? 'now' : '') + '"><span class="no">' + (i + 1) + '</span>' + esc(s.text) + tick(s.done) + '</li>';
        }).join('') + '</ol></div>';
      if (move.alt && move.alt.length) html += '<span class="sz-alt">' + tx('別解: ') + move.alt.map(function (a) { return altHTML(a) + ' ' + esc(a.text); }).join(tx('、')) + '</span>';
    } else if (fold) {
      html += '<p class="learnt-note">' + tx(b.course.drill || b.blind ? '思い出して押す。手順は {0} 秒後か、ミスのあとに出る。' : '覚えた問題。{0} 秒で手順が出る。', LV.PEEK_AFTER) + '</p>';
    }
    html += '<div class="andon' + (b.stage ? ' lit' : '') + '"><div class="andon-l"><span>' + tx('目安 {0} 秒', b.limit) + '</span><b class="andon-over"></b></div>' +
      '<div class="gauge"><i class="left"></i><i class="over"></i></div>';
    html += '</div>';
    el.innerHTML = html;
    renderClock();
  }

  // The key labels of a show list (LV.KEYS) in the player's own keys: the
  // prefix keys through ownKey, the copy-mode keys ([ and PageUp aside)
  // through copyOwn.
  var COPY_SHOWS = { copy: 1, page: 1, search: 1, yank: 1 };
  function showKeys(a) {
    var out = [];
    (LV.KEYS[a] || []).forEach(function (k) {
      if (COPY_SHOWS[a] && k !== '[') { out.push({ label: copyOwn(k), pfx: true }); return; }
      var o = ownKey(k);
      if (!o.none) out.push(o);
    });
    return out;
  }

  function steps(move) {
    var list = [];
    if (move.pfx) list.push({ text: tx('{0} を押して離す（prefix）', prefixLabel()), key: prefixLabel(), done: S.armed });
    list.push({ text: move.text, keys: move.keys, done: false });
    return list;
  }

  // The tick of a done step. It takes its space whether shown or not, so
  // nothing in the order shifts when a step is ticked off.
  function tick(done) { return '<i class="tick' + (done ? ' on' : '') + '" aria-hidden="true">✓</i>'; }

  function altHTML(a) {
    return (a.pfx ? '<kbd>' + esc(prefixLabel()) + '</kbd>→' : '') + a.keys.map(function (k) { return '<kbd>' + esc(k) + '</kbd>'; }).join('');
  }

  // The order, written at the top of the room you stand in, like the
  // message a server prints when you log in: the question, then the keys of
  // the next step and what they do. It moves with you; nothing in it moves.
  function motdHTML(b, move, fold) {
    // Printed as shell comments just above the prompt, where the eyes are:
    //   # 3/15  ペイン 2 を閉じる   tmux: kill-pane
    //   # ▶ Ctrl+b → →   → を押す（右へ）
    var c = '';
    // A question in two steps shows one step at a time; the whole order
    // stays above it, small.
    var st = b.q.step && b.q.step();
    var html = st ? '<div class="ob-whole">' + c + esc(qText(b)) + '</div>' : '';
    html += '<div class="motd-h">' + c + '<span class="ob-n">' + qCount(b, '/') + '</span> ' +
      // Past the 目安: said once on the card, still (the gauge is in the hidden panel).
      (b.stage >= 1 ? '<span class="ob-over">' + tx('目安超え') + '</span> ' : '') +
      (st ? '<span class="ob-step">' + (st[0] ? tx('手順 {0}/{1}', st[0], st[1]) : tx('やり直し')) + '</span> ' : '') +
      '<b class="ob-q">' + esc(st ? tx(st[2]) : qText(b)) + '</b></div>';
    if (S.qNote.length) html += '<div class="ob-note">' + c + esc(S.qNote.join(tx('。'))) + '</div>';
    // はじめての回, question 1: the two words everything after leans on.
    if (b.first && b.i === 0) html += '<div class="ob-note ob-words">' + c + esc(tx('ペイン = 画面の区画、ウィンドウ = タブ')) + '</div>';
    if (move) {
      var keys = '';
      steps(move).forEach(function (s, i) {
        if (i) keys += '<span class="arr">→</span>';
        if (s.key) keys += '<kbd class="pfx' + (s.done ? ' done' : ' next') + '">' + esc(s.key) + tick(s.done) + '</kbd>';
        else keys += s.keys.length ? keycaps(s.keys, S.armed || !move.pfx ? s.keys : []) : '<kbd>…</kbd>';
      });
      // A step that is words rather than a key (a name to type, tmux attach,
      // Esc to close something) keeps its text on a phone too.
      var prompt = !move.keys.length || move.type || move.keys[0] === 'Esc';
      html += '<div class="ob-guide' + (prompt ? ' ob-prompt' : '') + '">' + c + '<span class="motd-go" aria-hidden="true">▶</span><span class="ob-keys">' + keys + '</span><span class="ob-txt">' + esc(move.text) + '</span></div>';
      if (move.alt && move.alt.length && !S.armed) html += '<div class="ob-alt">' + c + tx('別解') + ' ' + move.alt.map(altHTML).join(' ／ ') + '</div>';
    } else if (fold) {
      // The words are the whole guide here: kept on a phone too (ob-prompt).
      html += '<div class="ob-guide learnt ob-prompt">' + c + tx(b.course.drill ? '稽古' : b.blind ? '手順なし' : '覚えた ✓') + '<span class="ob-txt">' + tx('思い出して押す。{0} 秒で手順が出る', LV.PEEK_AFTER) + '</span></div>';
    }
    // A layout question: the window as it will be, small.
    if (b.q.figure) html += figureHTML(b.q.figure());
    return html;
  }

  // The 完成図 of a layout: the panes as they will stand, with their numbers.
  function figureHTML(f) {
    if (!f) return '';
    return '<div class="ob-fig" aria-hidden="true" style="aspect-ratio:' + f.ratio.toFixed(3) + '">' + f.rects.map(function (r) {
      return '<i' + (r.me ? ' class="me"' : '') + ' style="left:' + (r.x * 100).toFixed(2) + '%;top:' + (r.y * 100).toFixed(2) + '%;width:' + (r.w * 100).toFixed(2) + '%;height:' + (r.h * 100).toFixed(2) + '%"><b>' + r.n + '</b></i>';
    }).join('') + '</div>';
  }

  // The ghost in the bar: who it is, and after each question how far ahead
  // or behind you are. It changes only when a question is solved.
  function ghostWho(g) {
    return !g.today ? tx('自分のベスト') : g.kind === 'next' ? tx('1 つ上 {0}', g.name) : tx('今日の一番 {0}', g.name);
  }

  function ghostHTML(b) {
    if (!b.ghost || S.replay) return '';
    var who = ghostWho(b.ghost);
    var d = b.ghostDiff;
    var txt = d == null ? tx('{0}秒', b.ghost.time.toFixed(1)) : tx('{0}秒', (d <= 0 ? '−' : '+') + Math.abs(d).toFixed(1));
    return '<span class="pb-ghost' + (d == null ? '' : d <= 0 ? ' ahead' : ' behind') + '" title="' + esc(tx('影: {0}', who)) + '">' + tx('影') + ' <small>' + esc(who) + '</small> <b>' + txt + '</b></span>';
  }

  function renderPlaybar() {
    var b = S.run;
    var el = $('#playbar');
    if (el && S.free) {
      var fk = 'free|' + (S.conf ? prefixLabel() : '');
      if (el.dataset.key === fk) return;
      el.dataset.key = fk;
      el.innerHTML = '<span class="pb-course">' + tx('練習') + tx(' ・ 問題なし') + '</span>' + (S.conf ? '<span class="pb-conf">' + tx('自分のキー設定（prefix {0}）', prefixLabel()) + '</span>' : '') + '<span class="pb-sp"></span>' +
        '<span class="pb-free">' + tx('やめるときは Esc を 2 回か「やめる」') + '</span>';
      return;
    }
    if (!b || !el) return;
    var key = [b.i, b.phase, b.misses, b.streak >= 3 ? b.streak : 0, b.ghost ? b.ghost.name : '', b.ghostDiff, S.replay ? 'r' : ''].join('|');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.innerHTML = '<span class="pb-course">' + (S.replay ? '<span class="pb-replay">' + tx('再生') + '</span> <span class="pb-who">' + esc(S.replay.who) + ' ・ </span>' : '') + esc(b.course.title) + tx(' ・ 問題 ') + '<b>' + qCount(b, ' / ') + '</b></span>' +
      (b.first && !S.replay ? '<span class="pb-note">' + tx('はじめての回（ランキングには載らない）') + '</span>' : '') +
      (b.blind && !b.course.daily && !S.replay ? '<span class="pb-note">' + tx('手順なし（{0} 秒で出る）', LV.PEEK_AFTER) + '</span>' : '') +
      (b.streak >= 3 ? '<span class="pb-streak">' + tx('{0} 連', b.streak) + '</span>' : '') +
      (S.conf ? '<span class="pb-conf">' + tx('自分のキー設定（prefix {0}）', prefixLabel()) + '</span>' : '') +
      '<span class="pb-sp"></span>' +
      (b.misses ? '<span class="pb-pen">' + tx('ミス {0}（+{1}秒）', b.misses, b.penalty) + '</span>' : '') +
      ghostHTML(b) +
      '<span class="pb-time"><span>0.0</span><small>' + tx('秒') + '</small></span>';
    renderClock();
  }

  // The strip under the bar: where the ghost is now (its question) and the
  // keys it is pressing, from its key log at this many seconds into the run
  // (the clock without penalties, as the log counts). Words only, changed
  // in place when they change; a ghost without a log shows its question
  // from the splits. In a replay, the controls and the keys being fed.
  function renderGhostbar() {
    var el = $('#ghostbar'), b = S.run;
    if (!el) return;
    if (!b || (!b.ghost && !S.replay) || b.phase === 'count') { if (!el.hidden) { el.hidden = true; el.innerHTML = ''; el.dataset.key = ''; } return; }
    var html, key;
    if (S.replay) {
      var R = S.replay;
      var last = R.keys.slice(Math.max(0, R.i - 5), R.i).map(function (e) { return '<kbd>' + esc(e[1]) + '</kbd>'; }).join('');
      var state = R.lost ? tx('再現がずれた（問題 {0}）', b.i + 1) : R.done ? tx('再生おわり') : R.playing ? '' : tx('一時停止');
      key = [R.i, R.playing, R.speed, R.lost, R.done, b.i].join('|');
      html = '<span class="gb-ctl">' +
        '<button type="button" class="btn" data-rp="toggle" aria-label="' + tx(R.playing ? '一時停止' : '再生') + '">' + (R.playing ? '❚❚' : '▶') + '<kbd class="hk">Space</kbd></button>' +
        '<button type="button" class="btn" data-rp="speed" aria-pressed="' + (R.speed === 2 ? 'true' : 'false') + '">×2</button>' +
        '<button type="button" class="btn" data-rp="prev" aria-label="' + tx('前の問題') + '">◀<kbd class="hk">←</kbd></button>' +
        '<button type="button" class="btn" data-rp="next" aria-label="' + tx('次の問題') + '">▶<kbd class="hk">→</kbd></button>' +
        '<button type="button" class="btn ghost" data-rp="close">' + tx('閉じる') + '<kbd class="hk">Esc</kbd></button></span>' +
        '<span class="gb-keys">' + (last || '<small>' + tx('まだキーなし') + '</small>') + '</span>' +
        (state ? '<span class="gb-state">' + state + '</span>' : '');
    } else {
      var g = b.ghost;
      var live = b.phase === 'play' || b.phase === 'pause' || b.phase === 'clear';
      var now = b.phase === 'pause' ? b.pausedAt : b.phase === 'clear' ? b.clearAt : performance.now();
      var t = live ? now - b.start : 0;
      var gi, keys = '';
      if (g.keys && g.keys.q && g.keys.q.length) {
        var q = g.keys.q, ks = g.keys.keys;
        gi = 0;
        while (gi + 1 < q.length && q[gi + 1] <= t) gi++;
        var upto = 0;
        while (upto < ks.length && ks[upto][0] <= t) upto++;
        keys = ks.slice(Math.max(0, upto - 4), upto).map(function (e) { return '<kbd>' + esc(e[1]) + '</kbd>'; }).join('');
      } else {
        var tp = t / 1000 + b.penalty, cum = g.cum || [];
        gi = 0;
        while (gi + 1 < cum.length && cum[gi] <= tp) gi++;
        keys = '<small>' + tx('キーの記録なし') + '</small>';
      }
      var finished = t / 1000 + b.penalty >= g.time;
      key = [gi, finished, keys].join('|');
      html = '<span class="gb-who">' + tx('影') + ' <b>' + esc(g.today ? g.name : tx('自分のベスト')) + '</b></span>' +
        '<span class="gb-q">' + (finished ? tx('ゴール {0}秒', g.time.toFixed(1)) : tx('問題 {0}', (gi + 1) + ' / ' + b.qs.length)) + '</span>' +
        '<span class="gb-keys">' + (finished ? '' : keys) + '</span>';
    }
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.innerHTML = html;
    el.hidden = false;
  }

  // The running clock and the 目安 gauge: green while there is time left,
  // then a red bar that grows with the overrun.
  function renderClock() {
    var b = S.run;
    if (!b) return;
    var live = b.phase === 'play' || b.phase === 'pause' || b.phase === 'clear';
    var now = b.phase === 'pause' ? b.pausedAt : b.phase === 'clear' ? b.clearAt : performance.now();
    var t = $('#playbar .pb-time span');
    if (t) t.textContent = (live ? (now - b.start) / 1000 + b.penalty : 0).toFixed(1);
    var used = live ? (now - b.qStart) / 1000 : 0;
    var left = $('#sashizu .gauge .left'), over = $('#sashizu .gauge .over'), o = $('#sashizu .andon-over');
    if (left) left.style.width = Math.max(0, (b.limit - used) / b.limit * 100) + '%';
    if (over) over.style.width = Math.min(100, Math.max(0, (used - b.limit) / (b.limit * (LV.GUIDE_AT - 1)) * 100)) + '%';
    // Past the 目安 the panel goes still: no counting seconds to distract.
    if (o) o.textContent = used > b.limit ? tx('目安超え') : '';
  }

  // Short notes under the order: a streak, a wrong key.
  function chip(kind, text) {
    var box = $('#chips');
    if (!box) return;
    var c = document.createElement('span');
    c.className = 'chip ' + kind;
    c.textContent = tx(text);
    box.insertBefore(c, box.firstChild);
    while (box.children.length > 2) box.removeChild(box.lastChild);
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 2200);
  }

  function measureCells() {
    var probe = $('#probe');
    var r = probe.getBoundingClientRect();
    S.cellW = r.width / 20;
    S.cellH = r.height;
    var term = $('#term');
    var box = term.getBoundingClientRect();
    S.cols = Math.max(20, Math.floor(box.width / S.cellW));
    S.rows = Math.max(8, Math.floor(box.height / S.cellH));
  }

  // The panes are kept as elements between renders, so a split, a close, a
  // resize or a zoom can move them (this house is livelier than tmux: real
  // panes jump, these slide like fusuma). A new window slides the whole view.
  var view = { session: null, win: null, zoomed: false, borders: '' };

  // A fusuma panel laid over a room: it slides away when the room opens and
  // slides shut when the room is closed. Removed with its animation.
  function fusuma(el, cls) {
    var door = document.createElement('div');
    door.className = 'fusuma ' + cls;
    door.innerHTML = '<i></i>';
    el.appendChild(door);
    door.addEventListener('animationend', function () { door.remove(); });
  }

  // Switching wings: a big fusuma sweeps off the whole house.
  function wipe(term, dir) {
    if (reduceMotion) return;
    var door = document.createElement('div');
    door.className = 'wipe ' + dir;
    door.innerHTML = '<i></i>';
    term.appendChild(door);
    door.addEventListener('animationend', function () { door.remove(); });
  }

  function animateOnce(el, cls) {
    if (reduceMotion) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', function done(e) {
      if (e.target !== el) return;
      el.classList.remove(cls);
      el.removeEventListener('animationend', done);
    });
  }

  function renderTerm() {
    var term = $('#term');
    measureCells();
    if (S.detached) {
      view.session = view.win = null;
      term.innerHTML = '<div class="outer-shell"><div class="pane-body outer-body">' + linesHTML(S.outer.lines) +
        '<div class="sh-line"><span class="sh-prompt">$ </span>' + withCursor(S.outer.input, S.outer.cur, true) + '</div></div></div>';
      var ob = $('.outer-body', term);
      ob.scrollTop = ob.scrollHeight;
      // The order follows you outside: the card sits in the lower half.
      var orun = S.run;
      if (orun && orun.phase === 'play' && orun.q) {
        var ofold = folded(orun);
        placeCard(term, term.clientWidth / 2, term.clientHeight * 0.66, motdHTML(orun, ofold ? null : guideMove(orun), ofold), '', '');
      }
      return;
    }
    var win = T.activeWindow(S.session);
    var lay = T.layout(win, S.cols, S.rows);
    var cw = S.cellW, ch = S.cellH;
    var run = S.run;
    var playing = !!(run && run.phase === 'play' && run.q);
    var fold = playing && folded(run);
    var move = playing && !fold ? guideMove(run) : null;
    var motdH = 0;
    var marks = goalMarks();
    var wanted = {};
    marks.forEach(function (g) { if (g.pane) wanted[g.pane] = g.mark || 'go'; });
    var active = null;
    lay.panes.forEach(function (r) { if (r.pane.id === win.active) active = r; });
    var fresh = view.session !== S.session || view.win !== win;
    if (fresh) {
      var moved = view.session === S.session && view.win;
      var next = moved && (win.index > view.win.index || S.session.windows.indexOf(view.win) < 0);
      if (moved) animateOnce(term, next ? 'slide-next' : 'slide-prev');
      term.innerHTML = '<div class="glow"></div>';
      if (moved) wipe(term, next ? 'next' : 'prev');
      view.borders = '';
    }
    // Zooming lifts the other walls away; unzooming drops them back.
    var zoomIn = !fresh && win.zoomed && !view.zoomed;
    var zoomOut = !fresh && !win.zoomed && view.zoomed;
    view.session = S.session;
    view.win = win;
    view.zoomed = win.zoomed;
    var old = {};
    $$(':scope > .pane[data-pane-id]', term).forEach(function (el) { old[el.dataset.paneId] = el; });
    lay.panes.forEach(function (r) {
      var p = r.pane;
      var isActive = p.id === win.active;
      var idx = T.paneIndex(S.session, win, p);
      var el = old[p.id];
      var born = !el;
      delete old[p.id];
      if (born) {
        el = document.createElement('div');
        el.dataset.paneId = p.id;
        el.innerHTML = '<div class="decor"></div><div class="pane-title"></div><div class="pane-body"></div>';
        term.appendChild(el);
      }
      var wpx = r.w * cw, hpx = r.h * ch;
      var room = p.name || '';
      var size = hpx < 110 || wpx < 150 ? 'cramped' : '';
      // Every key draws every pane; what has not changed is left alone, so
      // the browser lays out only the rooms that moved (input latency).
      var cls = 'pane' + (isActive ? ' active' : '') + (wanted[p.id] ? ' wanted' + (wanted[p.id] === 'close' ? ' wanted-close' : '') : '') + (size ? ' ' + size : '') + (el.dataset.anim ? ' ' + el.dataset.anim : '');
      if (el.className !== cls) el.className = cls;
      // --numw: the room the number (and the Z flag) takes at the top right.
      var css = 'left:' + (r.x * cw) + 'px;top:' + (r.y * ch) + 'px;width:' + wpx + 'px;height:' + hpx + 'px;--numw:' + numWidth(wpx, win.zoomed) + 'px';
      if (el._css !== css) { el._css = css; el.style.cssText = css; }
      var decorKey = room + '|' + size;
      if (el.dataset.decor !== decorKey) {
        el.dataset.decor = decorKey;
        el.firstChild.innerHTML = '';
      }
      // The pane's number, always on and dim, as prefix q shows it.
      var title = '<span class="pnum">' + idx + '</span>' + (p.name ? '<span class="pt-name">' + esc(p.name) + '</span>' : '') + (win.zoomed ? '<span class="zoom-flag">Z</span>' : '');
      if (el.children[1]._html !== title) { el.children[1]._html = title; el.children[1].innerHTML = title; }
      var body = el.children[2];
      body.className = 'pane-body' + (p.mode ? ' copy' : '');
      body.dataset.paneBody = p.id;
      var bodyHTML = paneBodyHTML(p, isActive);
      if (body._html !== bodyHTML) { body._html = bodyHTML; body.innerHTML = bodyHTML; }
      // A room that appears in a window already on screen slides open from
      // the side it was split off.
      if (born && !fresh && !reduceMotion) {
        var anim = zoomOut ? 'enter-drop' : 'enter-fade';
        if (!zoomOut) lay.panes.forEach(function (o) {
          if (o.x === r.x && o.w === r.w && o.y + o.h + 1 === r.y) anim = 'enter-y';
          else if (o.y === r.y && o.h === r.h && o.x + o.w + 1 === r.x) anim = 'enter-x';
        });
        if (anim === 'enter-x' || anim === 'enter-y') fusuma(el, 'open-' + anim.slice(-1));
        el.dataset.anim = anim;
        el.classList.add(anim);
        el.addEventListener('animationend', function done(e) {
          if (e.target !== el) return;
          el.classList.remove(el.dataset.anim);
          delete el.dataset.anim;
          el.removeEventListener('animationend', done);
        });
      }
    });
    // Rooms that are gone fold away (and stop counting as rooms at once).
    Object.keys(old).forEach(function (id) {
      var el = old[id];
      el.removeAttribute('data-pane-id');
      $$('[data-pane-body],[data-copy-ind]', el).forEach(function (x) { x.removeAttribute('data-pane-body'); x.removeAttribute('data-copy-ind'); });
      el.className = 'pane leaving' + (zoomIn ? ' lift' : '');
      if (reduceMotion) { el.remove(); return; }
      // A closed room gets its fusuma shut; a room zoomed away lifts off.
      if (!zoomIn) fusuma(el, el.offsetWidth >= el.offsetHeight ? 'shut-x' : 'shut-y');
      setTimeout(function () { el.remove(); }, 360);
    });
    // The lantern light follows the room you stand in.
    var glow = $(':scope > .glow', term);
    if (glow && active) glow.style.cssText = 'left:' + (active.x * cw) + 'px;top:' + (active.y * ch) + 'px;width:' + (active.w * cw) + 'px;height:' + (active.h * ch) + 'px';
    var bhtml = '';
    lay.borders.forEach(function (b) {
      var near = false;
      if (active) {
        if (b.dir === 'v') near = (active.x + active.w === b.x || active.x === b.x + 1) && active.y < b.y + b.len && b.y < active.y + active.h;
        else near = (active.y + active.h === b.y || active.y === b.y + 1) && active.x < b.x + b.len && b.x < active.x + active.w;
      }
      bhtml += '<div class="border ' + b.dir + (near ? ' near' : '') + '" style="left:' + (b.x * cw) + 'px;top:' + (b.y * ch) + 'px;width:' + ((b.dir === 'v' ? 1 : b.len) * cw) + 'px;height:' + ((b.dir === 'v' ? b.len : 1) * ch) + 'px"></div>';
    });
    if (bhtml !== view.borders) {
      // Borders move with the rooms; a changed set fades in once they land.
      var shape = function (h) { return h.replace(/ near/g, ''); };
      var reshaped = shape(bhtml) !== shape(view.borders);
      $$(':scope > .border', term).forEach(function (x) { x.remove(); });
      var tmp = document.createElement('div');
      tmp.innerHTML = bhtml;
      while (tmp.firstChild) {
        if (reshaped && !fresh && !reduceMotion) tmp.firstChild.classList.add('settle');
        term.appendChild(tmp.firstChild);
      }
      view.borders = bhtml;
    }
    // 完成図: what this question wants changed, marked on the rooms.
    $$(':scope > .goal, :scope > .goal-arrow, :scope > .goal-key, :scope > .guide-card, :scope > .here-tag, :scope > .dp-num', term).forEach(function (x) { x.remove(); });
    // display-panes: the numbers, big, on every pane.
    if (S.panesShown && Date.now() < S.panesShown) {
      lay.panes.forEach(function (r) {
        term.insertAdjacentHTML('beforeend', '<div class="dp-num' + (r.pane.id === win.active ? ' active' : '') + '" style="left:' + (r.x * cw) + 'px;top:' + (r.y * ch) + 'px;width:' + (r.w * cw) + 'px;height:' + (r.h * ch) + 'px">' + T.paneIndex(S.session, win, r.pane) + '</div>');
      });
    }
    var labelled = false, anchor = null;
    marks.forEach(function (g) {
      if (!g.pane) return;
      var r = null;
      lay.panes.forEach(function (x) { if (x.pane.id === g.pane) r = x; });
      if (!r) return;
      var full = g.mark === 'unzoom';
      var box = full ? { x: 0, y: 0, w: S.cols, h: S.rows } : r;
      var d = document.createElement('div');
      d.className = 'goal ' + (g.mark || 'go');
      d.style.cssText = 'left:' + (box.x * cw) + 'px;top:' + (box.y * ch) + 'px;width:' + (box.w * cw) + 'px;height:' + (box.h * ch) + 'px';
      // On the room you stand in, the tag goes under the order.
      // The pane you stand in: the guide card sits on it and carries the tag.
      var here = r === active || full;
      d.innerHTML = here && !anchor ? '' : '<span class="goal-tag">' + esc(g.tag) + '</span>';
      term.appendChild(d);
      if (here && !anchor) anchor = { x: (box.x + box.w / 2) * cw, y: (box.y + box.h / 2) * ch, tag: g.tag };
      // Another pane: an arrow from where you stand to it; the guide card
      // sits on the first arrow, where the eyes go.
      if (active && r !== active && !win.zoomed) {
        term.insertAdjacentHTML('beforeend', arrowHTML(active, r, cw, ch, 0, ''));
        if (!labelled) anchor = { x: arrowMid.x, y: arrowMid.y };
        labelled = true;
      }
    });
    // Nothing marked on a pane (a window question): the card goes on the
    // arrow to the tab (renderTabArrow). Otherwise in the middle of your pane.
    if (playing && !anchor && active && !marks.some(function (g) { return g.tab || g.sess; })) anchor = { x: (active.x + active.w / 2) * cw, y: (active.y + active.h / 2) * ch };
    // Where you stand, said in words on the pane itself: the card never covers it.
    if (playing && active) placeHereTag(term, active, cw, ch, win.zoomed, T.activePane(win).mode === 'copy');
    // A step chip already says what to do here; the tag would repeat it.
    if (playing && anchor) placeCard(term, anchor.x, anchor.y, motdHTML(run, move, fold), run.q.step && run.q.step() ? '' : anchor.tag, '');
    var pk = $(':scope > .picker', term);
    if (pk) pk.remove();
    if (S.picker) term.insertAdjacentHTML('beforeend', pickerHTML());
    // Scroll positions, the copy cursor and the indicator need the DOM.
    lay.panes.forEach(function (r) {
      var p = r.pane;
      var el = $('[data-pane-body="' + p.id + '"]', term);
      if (!el) return;
      if (p.mode === 'copy') {
        var max = el.scrollHeight - el.clientHeight;
        if (p.scrollTop > max) p.scrollTop = max;
        el.scrollTop = p.scrollTop;
        if (p.syncCursor) {
          // After a page move the cursor lands on the top visible line (on
          // its own row since SIM_V; H M L: the top, middle, bottom one): the
          // text is drawn again with the cursor cell there (the scroll stays).
          var lines = $$('[data-ln]', el), sc = p.syncCursor;
          var y = sc === 'mid' ? el.scrollTop + el.clientHeight / 2 : sc === 'bottom' ? el.scrollTop + el.clientHeight - 1 : el.scrollTop + (sc.row || 0);
          var hit = null;
          for (var i = 0; i < lines.length; i++) {
            if (sc === 'bottom' || sc === 'mid') { if (lines[i].offsetTop <= y) hit = lines[i]; else break; }
            else if (lines[i].offsetTop >= y - 1) { hit = lines[i]; break; }
          }
          if (!hit && lines.length) hit = lines[lines.length - 1];
          if (hit) goLine(p, Number(hit.dataset.ln));
          if (typeof sc === 'string') p.cx = 0;
          p.syncCursor = false;
          var keep = el.scrollTop;
          el._html = paneBodyHTML(p, true);
          el.innerHTML = el._html;
          el.scrollTop = keep;
        }
        if (p.reveal) {
          var line = $('[data-ln="' + p.cy + '"]', el);
          if (line) {
            var top = line.offsetTop, h = line.offsetHeight;
            if (p.reveal === 'center') el.scrollTop = top - el.clientHeight / 2;
            else if (top < el.scrollTop) el.scrollTop = top;
            else if (top + h > el.scrollTop + el.clientHeight) el.scrollTop = top + h - el.clientHeight;
            p.scrollTop = el.scrollTop;
          }
          p.reveal = null;
        }
        var info = scrollInfo(p);
        var ind = $('[data-copy-ind="' + p.id + '"]', term);
        if (ind && info) ind.textContent = '[' + info.pos + '/' + info.history + ']';
      } else if (p.mode === 'view') {
        el.scrollTop = 0;
      } else {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  // The keys of a move, short: "Ctrl+b → →".
  function moveLabel(m) {
    if (!m || !m.keys.length) return '';
    return (m.pfx ? prefixLabel() + ' → ' : '') + m.keys.join(' ');
  }

  // Where an arrow starts: the middle of the room you stand in, below the order.
  function arrowFrom(a, cw, ch, motdH) {
    var top = a.y * ch + 20 + motdH, bottom = (a.y + a.h) * ch;
    return { x: (a.x + a.w / 2) * cw, y: Math.min(bottom - 10, (top + bottom) / 2) };
  }

  function arrowHTML(a, t, cw, ch, motdH, label) {
    var f = arrowFrom(a, cw, ch, motdH);
    return arrowSVG(f.x, f.y, (t.x + t.w / 2) * cw, (t.y + t.h / 2) * ch, 34, label, '');
  }

  var arrowMid = { x: 0, y: 0 };

  function numWidth(wpx, zoomed) { return (wpx < 150 ? 30 : 46) + (zoomed ? 22 : 0); }

  // いまここ, left of the pane number, off the first line of text. A narrow
  // pane gets a shorter word under the number; a sliver gets a dot. In copy
  // mode it steps down a line, off the [pos/history] indicator.
  function placeHereTag(term, a, cw, ch, zoomed, copy) {
    var el = document.createElement('span');
    el.className = 'here-tag';
    el.textContent = tx('いまここ');
    term.appendChild(el);
    var left = a.x * cw, w = a.w * cw;
    var num = numWidth(w, zoomed);
    var top = a.y * ch + 6 + (copy ? ch : 0);
    var tw = el.offsetWidth;
    if (tw + num + 4 > w) {
      // Under the number instead; a shorter word, or a dot, when even that is too wide.
      top += a.w * cw < 150 ? 20 : 30;
      if (tw + 4 > w) { el.textContent = tx('ここ'); tw = el.offsetWidth; }
      if (tw + 4 > w) { el.textContent = '●'; el.className += ' dot'; tw = el.offsetWidth; }
      el.style.left = Math.max(left + 2, left + w - tw - 2) + 'px';
    } else el.style.left = (left + w - num - tw) + 'px';
    el.style.top = top + 'px';
  }

  // The guide card: the order and the keys, in the one place the eyes go
  // (on the arrow, or on the pane to change). Kept inside the terminal.
  function placeCard(term, x, y, inner, tag, cls) {
    var el = document.createElement('div');
    el.className = 'guide-card motd' + (cls ? ' ' + cls : '');
    el.innerHTML = (tag ? '<div class="gc-tag">' + esc(tag) + '</div>' : '') + inner;
    term.appendChild(el);
    var w = el.offsetWidth, h = el.offsetHeight, W = term.clientWidth, H = term.clientHeight;
    // Never on top of "いまここ", "ここへ", a pane number or the copy-mode
    // indicator: slide up or down off them, whichever stays closest to the arrow.
    var tr = term.getBoundingClientRect();
    var keep = $$(':scope > .here-tag, :scope > .goal .goal-tag, :scope > .pane .pnum, :scope > .pane [data-copy-ind]', term).map(function (k) {
      var r = k.getBoundingClientRect();
      return { l: r.left - tr.left - 4, t: r.top - tr.top - 4, r: r.right - tr.left + 4, b: r.bottom - tr.top + 4 };
    });
    // Nor under 始め while it shows: on a phone it sits where the card goes.
    var bn = $('#banner');
    if (bn && bn.classList.contains('show')) {
      var br = bn.getBoundingClientRect();
      keep.push({ l: br.left - tr.left - 12, t: br.top - tr.top - 12, r: br.right - tr.left + 12, b: br.bottom - tr.top + 12 });
    }
    var left = Math.max(6, Math.min(W - w - 6, x - w / 2));
    var clampY = function (t) { return Math.max(6, Math.min(H - h - 6, t)); };
    var cover = function (t) {
      return keep.reduce(function (a, k) {
        var ox = Math.min(left + w, k.r) - Math.max(left, k.l), oy = Math.min(t + h, k.b) - Math.max(t, k.t);
        return a + (ox > 0 && oy > 0 ? ox * oy : 0);
      }, 0);
    };
    var tries = [clampY(y - h / 2)];
    keep.forEach(function (k) { tries.push(clampY(k.t - h), clampY(k.b)); });
    tries.push(6, clampY(H - h - 6));
    var best = tries[0];
    tries.forEach(function (t) {
      var c = cover(t), cb = cover(best);
      if (c < cb || (c === cb && Math.abs(t - (y - h / 2)) < Math.abs(best - (y - h / 2)))) best = t;
    });
    el.style.left = left + 'px';
    el.style.top = best + 'px';
    // The chips (a streak, a miss) sit right under the card, where the eyes
    // are; above it when that is off the foot or on a tag.
    var chips = $('#chips');
    if (chips) {
      // Two chips at most, about 70px; one chip under the card takes 44px.
      var below = best + h + 6;
      var hit = function (t, b) { return keep.reduce(function (a, k) { return a + (Math.min(left + 200, k.r) > Math.max(left, k.l) && Math.min(b, k.b) > Math.max(t, k.t) ? 1 : 0); }, 0); };
      // A card on the tab arrow: the arrow leaves from its foot, so the chips go above.
      var up = below + 44 > H || hit(below, below + 44) > hit(best - 76, best - 6) || (cls === 'tab' && best - 76 >= 0);
      chips.style.cssText = 'left:' + left + 'px;right:auto;' + (up ? 'top:auto;bottom:' + (H - best + 6) + 'px' : 'bottom:auto;top:' + below + 'px');
    }
    return el;
  }

  function arrowSVG(x1, y1, x2, y2, stop, label, cls) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var s0 = Math.min(16, len * 0.1), s1 = Math.min(stop, len * 0.2);
    var ax = x1 + dx / len * s0, ay = y1 + dy / len * s0, bx = x2 - dx / len * s1, by = y2 - dy / len * s1;
    arrowMid = { x: (ax + bx) / 2, y: (ay + by) / 2 };
    var W = S.cols * S.cellW, H = S.rows * S.cellH;
    return '<svg class="goal-arrow' + (cls ? ' ' + cls : '') + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      '<defs><marker id="ga-head' + cls + '" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>' +
      '<line x1="' + ax.toFixed(1) + '" y1="' + ay.toFixed(1) + '" x2="' + bx.toFixed(1) + '" y2="' + by.toFixed(1) + '" marker-end="url(#ga-head' + cls + ')"/></svg>' +
      (label ? '<span class="goal-key' + (cls ? ' ' + cls : '') + '" style="left:' + ((ax + bx) / 2).toFixed(0) + 'px;top:' + ((ay + by) / 2).toFixed(0) + 'px">' + esc(label) + '</span>' : '');
  }

  // A wing (window) the question wants: an arrow from the room you stand in
  // down to its tab in the status bar.
  function renderTabArrow() {
    var term = $('#term');
    if (!term) return;
    $$(':scope > .goal-arrow.tab, :scope > .goal-key.tab, :scope > .guide-card.tab', term).forEach(function (x) { x.remove(); });
    var tab = $('#status .goal-tab');
    var act = $(':scope > .pane.active', term);
    if (!act || S.detached) return;
    var b = S.run, fold = !!(b && folded(b));
    // The status bar shows a prompt, a y/n or a message instead of the
    // tabs: the card stays, on your pane.
    if (!tab) {
      if (b && b.phase === 'play' && b.q && !$(':scope > .guide-card', term)) {
        var tr0 = term.getBoundingClientRect(), ar0 = act.getBoundingClientRect();
        placeCard(term, ar0.left - tr0.left + ar0.width / 2, ar0.top - tr0.top + ar0.height / 2, motdHTML(b, fold ? null : guideMove(b), fold), '', 'tab');
      }
      return;
    }
    var tr = term.getBoundingClientRect(), r = tab.getBoundingClientRect(), ar = act.getBoundingClientRect();
    var motd = $(':scope > .motd', act);
    var top = ar.top - tr.top + 20 + (motd ? motd.offsetHeight : 0), bottom = ar.bottom - tr.top;
    // The bar above the panes (status-position top): the arrow goes up.
    var above = !!(S.conf && S.conf.statusTop);
    var x1 = ar.left - tr.left + ar.width / 2, y1 = above ? Math.max(top + 10, (top + bottom) / 2) : Math.min(bottom - 10, (top + bottom) / 2);
    var x2 = Math.max(12, Math.min(tr.width - 12, r.left - tr.left + Math.min(r.width / 2, 40))), y2 = above ? 4 : tr.height - 4;
    // A window question: the guide card sits where the arrow's middle would
    // be, and the arrow then leaves from the card's foot (its head when the
    // bar is above), never behind it.
    if (b && b.phase === 'play' && b.q && !$(':scope > .guide-card:not(.tab)', term)) {
      var card = placeCard(term, (x1 + x2) / 2, (y1 + y2) / 2, motdHTML(b, fold ? null : guideMove(b), fold), '', 'tab');
      x1 = card.offsetLeft + card.offsetWidth / 2;
      y1 = above ? card.offsetTop - 2 : card.offsetTop + card.offsetHeight + 2;
    }
    term.insertAdjacentHTML('beforeend', arrowSVG(x1, y1, x2, y2, 4, '', 'tab'));
  }

  function tabGoal(name) {
    var found = null;
    goalMarks().forEach(function (g) { if (g.tab === name) found = g; });
    return found;
  }

  function goalMarks() {
    var b = S.run;
    if (!b || b.phase !== 'play' || !b.q || !b.q.goal || S.detached) return [];
    var win = T.activeWindow(S.session);
    try {
      return (b.q.goal() || []).map(function (g) {
        var o = {}; for (var k in g) o[k] = g[k];
        if (o.tag) o.tag = tx(o.tag);
        // A pane in another window: mark that window's tab instead.
        var h = o.pane && T.findPane(S.session, o.pane);
        if (h && h.win !== win) return { tab: h.win.id, tag: tx('このウィンドウへ') };
        return o;
      });
    } catch (e) { return []; }
  }

  // The text of a pane: its lines and the prompt, or in copy mode the
  // scrollback with the cursor cell and the selection.
  function paneBodyHTML(p, isActive) {
    if (p.mode === 'view') {
      var v = p.view;
      return '<div class="copy-ind">[' + v.top + '/' + v.lines.length + ']</div>' +
        (v.hint ? '<div class="view-hint">' + esc(tx(v.hint)) + '</div>' : '') +
        v.lines.slice(v.top).map(function (l) { return '<div class="sh-line">' + (l ? esc(l) : '&nbsp;') + '</div>'; }).join('');
    }
    return (p.mode === 'copy' ? '<div class="copy-ind" data-copy-ind="' + p.id + '">[0/0]</div>' : '') +
      linesHTML(p.lines, p.mode === 'copy' ? p : null) +
      (p.mode === 'copy' ? copyLineHTML(p, p.lines.length, lineAt(p, p.lines.length), '', null)
        : '<div class="sh-line"><span class="sh-prompt">' + esc(promptText(p)) + '</span>' + withCursor(p.input, p.cur, isActive) + '</div>');
  }

  function pickerHTML() {
    if (S.picker.kind === 'buffer') {
      return '<div class="picker" role="listbox" aria-label="' + tx('バッファ') + '"><div class="picker-head">' + tx('(choose-buffer)  Enter で貼る') + '</div>' +
        '<div class="picker-row on">(0) buffer0: ' + hhmm(S.clipAt || new Date()) + ': ' + esc(S.clipboard.split('\n')[0].slice(0, 40)) + '</div></div>';
    }
    var html = '<div class="picker" role="listbox" aria-label="' + tx('セッション') + '">';
    html += '<div class="picker-head">' + tx('(choose-tree)  ↑↓ で選んで Enter') + '</div>';
    var sg = sessGoal();
    // As tmux draws the tree: + a folded session, - an opened one with its
    // windows (├─→ … └─→) and their status flags under it.
    pickerRows().forEach(function (r, i) {
      var g = !r.win && sg && sg.sess === r.sess, s = r.sess, w = r.win, text;
      if (w) {
        var flag = w.id === s.active ? '*' : (w.id === s.last ? '-' : '');
        if (w.zoomed) flag += 'Z';
        text = (r.tail ? '└─→' : '├─→') + ' + ' + w.index + ': ' + esc(w.name) + flag + ': "dojo"';
      } else text = (S.picker.wins ? '- ' : '+ ') + esc(s.name) + ': ' + s.windows.length + ' windows' + (s === S.session ? ' (attached)' : '');
      html += '<div class="picker-row' + (i === S.picker.idx ? ' on' : '') + (g ? ' goal-row' : '') + '">(' + i + ') ' + text +
        (g ? '<span class="goal-tag">' + esc(sg.tag) + '</span>' : '') + '</div>';
    });
    return html + '</div>';
  }

  // The session mark of the question ({sess, tag}), shown on the status
  // bar's [name] and on the session's row in the list.
  function sessGoal() {
    var found = null;
    goalMarks().forEach(function (g) { if (g.sess) found = g; });
    return found;
  }

  // Each room is furnished: tatami underfoot, a 鴨居 and a 柱 for the walls,
  // furniture on the floor and sometimes something on the wall or hanging
  // from the ceiling. Drawn faint, behind the shell text. The floor pieces
  // share one 200x90 viewBox so they sit on the tatami at the same scale.
  var svg = function (vb, body, cls) { return '<svg class="' + cls + '" viewBox="' + vb + '" aria-hidden="true">' + body + '</svg>'; };
  var zabuton = function (x, y, c) { return '<path d="M' + x + ' ' + y + 'q25-5 50 0l3 10q-28 5-56 0z" fill="' + c + '"/><circle cx="' + (x + 25) + '" cy="' + (y + 5) + '" r="1.5" fill="#f3eadb" opacity=".8"/>'; };
  var yunomi = function (x, y) { return '<path d="M' + x + ' ' + y + 'h7l-1 9h-5z" fill="#efe6d2" stroke="#9a8f7c" stroke-width=".8"/><path class="steam" d="M' + (x + 3.5) + ' ' + (y - 1) + 'c-3-4 3-6 0-10" fill="none" stroke="#b9ab8e" stroke-width="1.6" stroke-linecap="round"/>'; };
  var steam = function (x, y) { return '<path class="steam" d="M' + x + ' ' + y + 'c-3-4 3-6 0-10" fill="none" stroke="#b9ab8e" stroke-width="1.6" stroke-linecap="round"/>'; };
  var andon = function (x) { return '<rect x="' + x + '" y="30" width="26" height="54" fill="#fbf6ea" stroke="#5a3a1a" stroke-width="1.5"/><path d="M' + x + ' 48h26M' + x + ' 66h26M' + (x + 13) + ' 30v54" stroke="#5a3a1a" stroke-width="1"/><ellipse cx="' + (x + 13) + '" cy="58" rx="8" ry="12" fill="#ffd27a" opacity=".55"/><path class="flame" d="M' + (x + 13) + ' 50c-2.5 3-2.5 6 0 8 2.5-2 2.5-5 0-8z" fill="#f0a33a"/><rect x="' + (x - 4) + '" y="84" width="34" height="2" fill="#5a3a1a"/>'; };
  var FURNISH = {
    // A Showa 茶の間: 茶箪笥, ちゃぶ台 with 急須, 湯呑 and みかん, 座布団 on
    // three sides, a pull-cord lamp overhead and the 柱時計 ticking.
    '茶の間': {
      furn: svg('0 0 200 90',
        '<rect x="156" y="6" width="42" height="78" rx="1.5" fill="#7a5a32"/><rect x="159" y="9" width="36" height="30" fill="#e9e2d0"/>' +
        '<path d="M177 9v30M159 24h36" stroke="#7a5a32" stroke-width="1.5"/><path d="M163 15h10M181 15h10M163 31h10M181 31h10" stroke="#9a8f7c" stroke-width="1.2" opacity=".6"/>' +
        '<rect x="159" y="43" width="36" height="12" fill="#6b4a26"/><rect x="159" y="58" width="36" height="12" fill="#6b4a26"/><rect x="159" y="73" width="36" height="8" fill="#6b4a26"/>' +
        '<circle cx="177" cy="49" r="1.6" fill="#d9b25a"/><circle cx="177" cy="64" r="1.6" fill="#d9b25a"/><rect x="161" y="1" width="10" height="5" rx="1" fill="#4f6440"/>' +
        '<rect x="66" y="60" width="5" height="24" fill="#5a3a1a"/><rect x="128" y="60" width="5" height="24" fill="#5a3a1a"/>' +
        '<path d="M52 56h96v5c0 3-22 6-48 6s-48-3-48-6z" fill="#6e4520"/><ellipse cx="100" cy="56" rx="48" ry="9" fill="#9a6532"/>' +
        '<ellipse cx="100" cy="55" rx="42" ry="6.5" fill="none" stroke="#b07a45" stroke-width=".8"/>' +
        '<ellipse cx="82" cy="49" rx="9" ry="7" fill="#4f6440"/><path d="M73 47l-7-4" stroke="#4f6440" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M90 45l9-6" stroke="#5a3a1a" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="82" cy="42.5" rx="4" ry="1.6" fill="#3d4f31"/>' +
        yunomi(102, 43) + yunomi(113, 44) +
        '<ellipse cx="134" cy="52" rx="10" ry="3" fill="#efe6d2" stroke="#9a8f7c" stroke-width=".6"/><circle cx="130" cy="48" r="4" fill="#e98a2a"/><circle cx="137" cy="48.5" r="3.6" fill="#f09a35"/><path d="M130 44.5l1-2" stroke="#4f6440" stroke-width="1.2"/>' +
        zabuton(4, 72, '#8a3b3b') + zabuton(92, 76, '#8a3b3b'), 'furn'),
      lamp: svg('0 0 70 90',
        '<path d="M35 0v34" stroke="#3a2a14" stroke-width="1.6"/>' +
        '<path d="M35 34c-12 0-22 10-24 22h48c-2-12-12-22-24-22z" fill="#5f7d57"/><path d="M11 56h48" stroke="#3a2a14" stroke-width="1.2"/>' +
        '<path d="M14 57q21 5 42 0z" fill="#fff8e8"/><circle cx="35" cy="60" r="5" fill="#ffd27a"/>' +
        '<ellipse class="lamp-glow" cx="35" cy="68" rx="30" ry="16" fill="#ffd27a" opacity=".22"/>' +
        '<path d="M42 57v20" stroke="#9a8f7c" stroke-width="1"/><circle cx="42" cy="78" r="1.8" fill="#b9322a"/>', 'lamp'),
      wall: svg('0 0 40 86',
        '<rect x="5" y="2" width="30" height="80" rx="3" fill="#6e4520"/><path d="M5 2h30" stroke="#4a3016" stroke-width="3"/><circle cx="20" cy="20" r="11" fill="#f6efdd" stroke="#3a2a14" stroke-width="1.2"/>' +
        '<path d="M20 11v2M29 20h-2M20 29v-2M11 20h2" stroke="#6f6558" stroke-width="1"/><path d="M20 20V12M20 20l5 3" stroke="#2b2622" stroke-width="1.4" stroke-linecap="round"/>' +
        '<rect x="10" y="36" width="20" height="40" fill="#3a2a14"/><rect x="12" y="38" width="16" height="36" fill="#f6efdd" opacity=".12"/>' +
        '<g class="pendulum"><path d="M20 36v28" stroke="#c9a24a" stroke-width="1.2"/><circle cx="20" cy="66" r="4.5" fill="#d9b25a"/></g>', 'wall')
    },
    // 座敷: a 床の間 with a scroll and 生け花, cushions laid out for guests.
    '座敷': {
      furn: svg('0 0 200 90',
        '<rect x="116" y="62" width="84" height="22" fill="#5a3a1a"/><rect x="116" y="60" width="84" height="3" fill="#8a5a2b"/>' +
        '<rect x="160" y="2" width="20" height="52" fill="#fbf6ea" stroke="#cdbf9f" stroke-width=".6"/><rect x="158" y="1" width="24" height="3" fill="#5a3a1a"/><rect x="158" y="52" width="24" height="3" fill="#5a3a1a"/>' +
        '<path d="M170 12c-2 8 3 14 0 26" fill="none" stroke="#2b2622" stroke-width="2" opacity=".6"/><rect x="172" y="44" width="4" height="4" fill="#b9322a"/>' +
        '<path d="M130 60c-6-2-7-12-2-16h12c5 4 4 14-2 16z" fill="#3b4a5c"/>' +
        '<path d="M134 44c-2-10-8-16-16-22M134 44c3-8 10-12 18-14M134 44c0-8 2-16 0-24" fill="none" stroke="#4a3a24" stroke-width="1.4" stroke-linecap="round"/>' +
        '<circle cx="118" cy="22" r="3.4" fill="#b9322a"/><circle cx="152" cy="30" r="3" fill="#b9322a"/><circle cx="134" cy="20" r="2.6" fill="#c84b3c"/>' +
        '<path d="M124 27l4-1M142 33l4 1M131 32l3 2" stroke="#5d7a4a" stroke-width="2.4" stroke-linecap="round"/>' +
        zabuton(6, 72, '#3b4a5c') + zabuton(60, 72, '#3b4a5c'), 'furn')
    },
    // 納戸: a 長持, stacked 葛籠, a 行李 with the futon rolled on it, a broom.
    '納戸': {
      furn: svg('0 0 200 90',
        '<rect x="104" y="50" width="88" height="34" rx="2" fill="#3a2a14"/><path d="M104 57h88" stroke="#5a4322" stroke-width="2"/><path d="M148 50v34" stroke="#b9322a" stroke-width="2.5"/><rect x="124" y="61" width="8" height="6" fill="#8a6a3a"/>' +
        '<rect x="118" y="24" width="56" height="26" rx="2" fill="#a07c48"/><path d="M118 31h56" stroke="#5a4322" stroke-width="1.5"/><path d="M126 31v19M138 31v19M150 31v19M162 31v19" stroke="#6e5530" stroke-width="1"/><path d="M146 24v26" stroke="#b9322a" stroke-width="2"/>' +
        '<rect x="30" y="58" width="56" height="26" rx="2" fill="#c8a862"/><path d="M30 64h56M58 58v26" stroke="#8a6a3a" stroke-width="1.2"/><path d="M34 70h48M34 76h48" stroke="#8a6a3a" stroke-width=".6" opacity=".6"/>' +
        '<ellipse cx="58" cy="50" rx="26" ry="8" fill="#8a3b3b"/><ellipse cx="34" cy="50" rx="4" ry="8" fill="#b35050"/>' +
        '<path d="M16 20l-4 64" stroke="#8a6a3a" stroke-width="2" stroke-linecap="round"/><path d="M12 68l-8 16M12 68l-2 18M12 68l4 17M12 68l8 15" stroke="#c8a862" stroke-width="2" stroke-linecap="round"/>', 'furn')
    },
    // 書院: a 文机 with 硯, brush and bound books, an 行灯, the round window.
    '書院': {
      furn: svg('0 0 200 90',
        '<rect x="50" y="52" width="100" height="6" fill="#7a4a22"/><rect x="56" y="58" width="6" height="26" fill="#5a3a1a"/><rect x="138" y="58" width="6" height="26" fill="#5a3a1a"/>' +
        '<rect x="62" y="44" width="22" height="8" rx="1.5" fill="#2b2622"/><rect x="66" y="40" width="6" height="4" fill="#1a1612"/>' +
        '<rect x="88" y="47" width="26" height="5" fill="#fbf6ea" stroke="#cdbf9f" stroke-width=".6"/><path d="M90 50l26-8" stroke="#3a2a14" stroke-width="2" stroke-linecap="round"/><path d="M113 43l5-1.5" stroke="#efe6d2" stroke-width="2.4" stroke-linecap="round"/>' +
        '<rect x="118" y="36" width="28" height="5" fill="#fbf6ea" stroke="#9a8f7c" stroke-width=".6"/><rect x="118" y="41" width="28" height="5" fill="#fbf6ea" stroke="#9a8f7c" stroke-width=".6"/><rect x="118" y="46" width="28" height="6" fill="#fbf6ea" stroke="#9a8f7c" stroke-width=".6"/><path d="M118 36v16" stroke="#2b4a7a" stroke-width="2.5"/>' +
        andon(166) + zabuton(74, 74, '#3b4a5c'), 'furn'),
      wall: svg('0 0 70 70',
        '<circle cx="35" cy="35" r="31" fill="#fbf6ea" stroke="#6e4520" stroke-width="4"/>' +
        '<path d="M35 4v62M4 35h62M19 6v58M51 6v58M6 19h58M6 51h58" stroke="#8a6a3a" stroke-width="1"/>' +
        '<path d="M12 50c10-8 20-6 26-16" fill="none" stroke="#5d7a4a" stroke-width="2" opacity="0.5"/>', 'wall')
    },
    // 次の間: a gold 屏風 with pines, a 火鉢 warming the floor.
    '次の間': {
      furn: svg('0 0 200 90',
        '<path d="M56 10l36 6v48l-36-6z" fill="#d8b25a"/><path d="M92 16l36-6v48l-36 6z" fill="#e6c46a"/><path d="M128 10l36 6v48l-36-6z" fill="#d8b25a"/><path d="M164 16l36-6v48l-36 6z" fill="#e6c46a"/>' +
        '<path d="M56 10l36 6 36-6 36 6 36-6M56 58l36 6 36-6 36 6 36-6" fill="none" stroke="#2b2622" stroke-width="1.6"/>' +
        '<circle cx="178" cy="26" r="6" fill="#b9322a" opacity=".8"/>' +
        '<path d="M74 46c16-6 28-18 56-16s36 12 58 6" fill="none" stroke="#4a5d3a" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M104 28c5-5 13-5 18 0M140 34c5-5 13-5 18 0M80 36c4-4 10-4 14 0" fill="none" stroke="#3d4f31" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M12 62h44l-4 22H16z" fill="#4a4540"/><ellipse cx="34" cy="62" rx="22" ry="5" fill="#6f6558"/><ellipse cx="34" cy="62" rx="15" ry="3" fill="#9a8f7c"/>' +
        '<path class="flame" d="M34 54c-3 3-3 6 0 8 3-2 3-5 0-8z" fill="#f0a33a"/>' + steam(30, 54) +
        zabuton(66, 74, '#3b4a5c'), 'furn')
    },
    // 仏間: the 仏壇 open, a candle, incense, the 鈴 on its cushion.
    '仏間': {
      furn: svg('0 0 200 90',
        '<rect x="110" y="6" width="8" height="78" fill="#2b2420"/><rect x="196" y="6" width="4" height="78" fill="#2b2420"/>' +
        '<rect x="118" y="2" width="78" height="82" fill="#1f1a16"/><rect x="124" y="8" width="66" height="54" fill="#5a3a1a"/><rect x="130" y="12" width="54" height="44" fill="#7a5a20"/>' +
        '<path d="M130 12l27-8 27 8" fill="none" stroke="#d9b25a" stroke-width="1.5"/><rect x="154" y="28" width="6" height="18" fill="#d9b25a"/><circle cx="157" cy="23" r="4" fill="#d9b25a"/>' +
        '<rect x="122" y="62" width="70" height="4" fill="#d9b25a"/><rect x="122" y="68" width="70" height="14" fill="#2b2420"/><path d="M157 68v14" stroke="#d9b25a" stroke-width=".8"/>' +
        '<rect x="98" y="52" width="4" height="22" fill="#f6efdd"/><rect x="94" y="74" width="12" height="4" fill="#8a6a3a"/><path class="flame" d="M100 44c-3 3-3 6 0 8 3-2 3-5 0-8z" fill="#f0a33a"/>' +
        '<path d="M72 68h16l-2 8H74z" fill="#8a6a3a"/><ellipse cx="80" cy="68" rx="8" ry="2" fill="#9a8f7c"/>' + steam(80, 66) +
        '<path d="M38 76q12-4 24 0l1 6q-13 4-26 0z" fill="#8a3b3b"/><path d="M42 66h16a8 8 0 0 1-16 0z" fill="#c9a24a"/><path d="M60 62l8-6" stroke="#5a3a1a" stroke-width="2" stroke-linecap="round"/>' +
        zabuton(2, 74, '#4a3f5c'), 'furn')
    },
    // The rooms a player opens with a split.
    '客間': {
      furn: svg('0 0 200 90',
        zabuton(10, 72, '#4f6440') + zabuton(146, 72, '#4f6440') +
        '<rect x="60" y="58" width="6" height="26" fill="#5a3a1a"/><rect x="134" y="58" width="6" height="26" fill="#5a3a1a"/><rect x="54" y="52" width="92" height="7" rx="1" fill="#8a5a2b"/>' +
        '<rect x="78" y="46" width="44" height="6" rx="1" fill="#3a2a14"/>' + yunomi(84, 37) + yunomi(110, 37) +
        '<rect x="96" y="40" width="9" height="6" fill="#efe6d2" stroke="#9a8f7c" stroke-width=".6"/><circle cx="100" cy="41" r="2" fill="#b9322a"/>', 'furn')
    },
    '控えの間': {
      furn: svg('0 0 200 90',
        '<rect x="124" y="20" width="68" height="56" fill="#fbf6ea" stroke="#5a3a1a" stroke-width="2"/><rect x="118" y="76" width="80" height="4" fill="#5a3a1a"/><rect x="120" y="80" width="8" height="4" fill="#5a3a1a"/><rect x="188" y="80" width="8" height="4" fill="#5a3a1a"/>' +
        '<path d="M136 60c14-10 30-10 44 0" fill="none" stroke="#4a5d3a" stroke-width="2.4"/><circle cx="170" cy="36" r="6" fill="#b9322a" opacity=".7"/>' +
        andon(40) + zabuton(70, 72, '#3b4a5c'), 'furn')
    },
    '台所': {
      furn: svg('0 0 200 90',
        '<path d="M92 84V50q0-10 10-10h88q10 0 10 10v34z" fill="#8c7b66"/><path d="M92 84h108" stroke="#5a4a3a" stroke-width="2"/>' +
        '<path d="M104 84v-12q0-5 5-5h12q5 0 5 5v12z" fill="#2b2622"/><path d="M160 84v-12q0-5 5-5h12q5 0 5 5v12z" fill="#2b2622"/><path class="flame" d="M115 72c-3 3-3 6 0 8 3-2 3-5 0-8z" fill="#f0a33a"/>' +
        '<ellipse cx="118" cy="40" rx="16" ry="4" fill="#4a4540"/><path d="M104 40q14-14 28 0z" fill="#3a3530"/><rect x="108" y="24" width="20" height="4" rx="2" fill="#8a6a3a"/>' +
        '<ellipse cx="176" cy="40" rx="14" ry="4" fill="#4a4540"/><path d="M164 40q12-12 24 0z" fill="#3a3530"/><rect x="170" y="26" width="12" height="3" rx="1.5" fill="#8a6a3a"/>' + steam(118, 22) + steam(176, 24) +
        '<path d="M28 60h30l-3 24H31z" fill="#a07c48"/><path d="M28 64h30" stroke="#5a4322" stroke-width="1.5"/><path d="M34 62l-2-10M52 62l2-10" stroke="#8a6a3a" stroke-width="2"/><path d="M30 52h26" stroke="#8a6a3a" stroke-width="2"/>' +
        '<path d="M44 44l14-20" stroke="#8a6a3a" stroke-width="2"/><ellipse cx="43" cy="46" rx="5" ry="3" fill="#8a6a3a"/>', 'furn')
    },
    '縁側': {
      furn: svg('0 0 200 90',
        '<rect x="140" y="64" width="40" height="4" fill="#5a3a1a"/><rect x="144" y="68" width="4" height="16" fill="#5a3a1a"/><rect x="172" y="68" width="4" height="16" fill="#5a3a1a"/><path d="M148 64v-8h24v8z" fill="#3b4a5c"/>' +
        '<path d="M160 56c-2-10 4-14 0-22M160 44l-8-4M160 50l8-6" fill="none" stroke="#4a3a24" stroke-width="2.4" stroke-linecap="round"/>' +
        '<circle cx="150" cy="38" r="7" fill="#4a5d3a"/><circle cx="170" cy="42" r="8" fill="#5d7a4a"/><circle cx="160" cy="32" r="7" fill="#4a5d3a"/>' +
        '<rect x="96" y="76" width="30" height="5" rx="1" fill="#3a2a14"/>' + yunomi(106, 66) +
        zabuton(20, 72, '#8a3b3b'), 'furn')
    }
  };

  function decorHTML(room, size) {
    var html = '<div class="kamoi"></div><div class="hashira"></div><div class="tatami"></div>';
    var f = FURNISH[room];
    if (f && !size) html += f.furn + (f.lamp || '') + (f.wall || '');
    return html;
  }

  function linesHTML(lines, copyPane) {
    var out = '';
    var lastClear = -1;
    for (var i = 0; i < lines.length; i++) if (lines[i] && lines[i].clear) lastClear = i;
    for (var j = 0; j < lines.length; j++) {
      var l = lines[j];
      if (l && l.clear) {
        if (j === lastClear) out += '<div class="sh-clear"></div>';
        continue;
      }
      var body = typeof l === 'string' ? (l === '' ? '&nbsp;' : esc(l)) : l.html;
      out += copyPane ? copyLineHTML(copyPane, j, lineText(l), body, l && l.cls) : '<div class="sh-line" data-ln="' + j + '">' + body + '</div>';
    }
    return out;
  }

  // A line in copy mode: the cursor cell and the selected characters, as
  // tmux shows them. A line wholly in or out of the selection keeps its
  // colours; one the cursor or an end of the selection is on is drawn from
  // its text, under `cls` if it has one.
  function copyLineHTML(p, j, text, html, cls) {
    var r = selRange(p), from = -1, to = -1;
    if (r && j >= r.a[0] && j <= r.b[0]) { from = j === r.a[0] ? r.a[1] : 0; to = j === r.b[0] ? r.b[1] : text.length; }
    var cur = j === p.cy;
    var line = 'sh-line' + (cur ? ' cl' : '');
    if (!cur && from < 0) return '<div class="' + line + '" data-ln="' + j + '">' + html + '</div>';
    if (!cur && from === 0 && to >= text.length) return '<div class="' + line + ' sel" data-ln="' + j + '">' + html + '</div>';
    var cx = Math.min(p.cx || 0, text.length), out = '';
    for (var i = 0; i <= text.length; i++) {
      var ch = text[i] || '', here = cur && i === cx;
      if (!ch && !here) break;
      var c = (i >= from && i <= to ? 'sel ' : '') + (here ? (ch ? 'cursor on-char' : 'cursor') : '');
      out += c ? '<span class="' + c.trim() + '">' + esc(ch) + '</span>' : esc(ch);
    }
    if (cls) out = '<span class="' + cls + '">' + out + '</span>';
    return '<div class="' + line + '" data-ln="' + j + '">' + (out || '&nbsp;') + '</div>';
  }

  function renderStatus() {
    var bar = $('#status');
    if (S.screen !== 'game') return;
    bar._html = null;
    if (S.detached) { bar.innerHTML = ''; bar.classList.add('gone'); return; }
    bar.classList.remove('gone');
    if (S.confirm) { bar.innerHTML = '<div class="st-prompt">' + esc(S.confirm.text) + '</div>'; return; }
    if (S.prompt) { bar.innerHTML = '<div class="st-prompt">' + esc(S.prompt.label) + ' ' + withCursor(S.prompt.value, S.prompt.cur, true) + '</div>'; return; }
    if (S.message) { bar.innerHTML = '<div class="st-msg">' + esc(S.message) + '</div>'; return; }
    var win = T.activeWindow(S.session);
    var sg = sessGoal();
    var html = '<span class="st-session' + (sg ? ' goal-tab' : '') + '">[' + esc(S.session.name) + ']' + (sg ? '<span class="goal-tag">' + esc(sg.tag) + '</span>' : '') + '</span><span class="st-wins">';
    S.session.windows.forEach(function (w) {
      var flag = w.id === S.session.active ? '*' : (w.id === S.session.last ? '-' : '');
      if (w.zoomed) flag += 'Z';
      // #{?window_flags,#{window_flags}, }: no flag is still one cell.
      if (!flag) flag = '\u00a0';
      var g = tabGoal(w.id);
      html += '<span class="st-win' + (w.id === S.session.active ? ' cur' : '') + (g ? ' goal-tab' + (g.mark === 'close' ? ' close' : '') : '') + '">' + w.index + ':' + esc(w.name) + flag + (g ? '<span class="goal-tag">' + esc(g.tag) + '</span>' : '') + '</span>';
    });
    var gn = tabGoal('+');
    if (gn) html += '<span class="st-win goal-tab new">' + nextWindowIndex() + ':＋<span class="goal-tag">' + esc(gn.tag) + '</span></span>';
    html += '</span><span class="st-right">';
    if (S.armed) html += '<span class="st-prefix">PREFIX</span>';
    else if (Date.now() < S.repeatUntil) html += '<span class="st-prefix repeat">REPEAT</span>';
    var ap = T.activePane(win);
    if (ap.mode === 'copy') html += '<span class="st-mode">COPY' + (ap.sel != null ? ' SEL' : '') + '</span>';
    if (S.clipboard) html += '<span class="st-clip" title="' + tx('コピーした内容') + '">📋</span>';
    html += '<span class="st-host">"dojo"</span><span class="st-clock">' + clock() + '</span></span>';
    // The bar changes only with the windows, the flags or the clock.
    if (bar._html === html) return;
    bar._html = html;
    bar.innerHTML = html;
    // A narrow bar: the tab the question wants is scrolled into view.
    var wins = $('.st-wins', bar), tab = $('.goal-tab', bar);
    if (wins && tab) {
      var over = tab.getBoundingClientRect().right - wins.getBoundingClientRect().right;
      if (over > 0) wins.scrollLeft = over + 4;
    }
  }

  // The number new-window would give.
  function nextWindowIndex() { return T.freeIndex(S.session); }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function hhmm(d) {
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  // As the default status-right: %H:%M %d-%b-%y.
  function clock() {
    var d = new Date();
    return hhmm(d) + ' ' + (d.getDate() < 10 ? '0' : '') + d.getDate() + '-' + MONTHS[d.getMonth()] + '-' + String(d.getFullYear()).slice(2);
  }

  // Turn a key label from levels.js into a key object for the phone key bar.
  function keyFromLabel(label) {
    var own = /^(Ctrl\+)?((?:Alt|Option)\+)?(Shift\+)?(.+)$/.exec(label);
    if (own && (own[1] || own[2] || own[3]) && label.length > 2) {
      var ak = own[4], AK = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown', Space: ' ', Esc: 'Escape', BSpace: 'Backspace' };
      ak = AK[ak] || ak;
      return { key: ak, ctrl: !!own[1], alt: !!own[2], shift: !!own[3], code: /^[a-z]$/i.test(ak) ? 'Key' + ak.toUpperCase() : /^[0-9]$/.test(ak) ? 'Digit' + ak : ak === '\\' ? 'Backslash' : undefined };
    }
    var m = /^([CM])-(.+)$/.exec(label);
    var arrows = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' };
    if (m) {
      var code = /^[0-9]$/.test(m[2]) ? 'Digit' + m[2] : undefined;
      return m[1] === 'C' ? { key: arrows[m[2]] || m[2], ctrl: true } : { key: arrows[m[2]] || m[2], alt: true, code: code };
    }
    if (label === 'PgUp' || label === 'PageUp') return { key: 'PageUp' };
    if (label === 'PageDown') return { key: 'PageDown' };
    if (label === 'Home' || label === 'End') return { key: label };
    if (label === 'Enter') return { key: 'Enter' };
    if (label === 'Esc') return { key: 'Escape' };
    if (label === 'Space') return { key: ' ' };
    if (label === '⌘V') return { key: 'v', meta: true };
    if (arrows[label]) return { key: arrows[label] };
    if (label.length === 1) return { key: label };
    return null;
  }

  // The on-screen keys for phones.
  function renderKeybar() {
    var bar = $('#keybar');
    var keys = [];
    var seen = {};
    function add(label, k, cls) {
      if (!k || seen[label]) return;
      seen[label] = true;
      keys.push({ label: label, k: k, cls: cls || '' });
    }
    add(prefixLabel(), prefixEvent(), 'k-prefix');
    add('Esc', { key: 'Escape' });
    add('←', { key: 'ArrowLeft' }); add('↑', { key: 'ArrowUp' }); add('↓', { key: 'ArrowDown' }); add('→', { key: 'ArrowRight' });
    var labels = [];
    var gm = S.run && S.run.phase === 'play' && S.run.q && !folded(S.run) ? guideMove(S.run) : null;
    if (gm) {
      gm.keys.forEach(function (l) { labels.push(l); });
      (gm.alt || []).forEach(function (a) { a.keys.forEach(function (l) { labels.push(l); }); });
    } else if (S.run && S.run.q) S.run.q.show.forEach(function (a) { showKeys(a).forEach(function (o) { labels.push(o.label); }); });
    // 練習: the common keys, with the prefix as the player has it.
    if (S.free) ['%', '"', 'z', 'x', 'c', 'n', 'o', '[', ':'].forEach(function (l) { var o = ownKey(l); if (!o.none) labels.push(o.label); });
    labels.forEach(function (label) { add(label, keyFromLabel(label), 'k-level'); });
    if (S.confirm) add('y', { key: 'y' });
    if (S.detached || S.prompt) add('Enter', { key: 'Enter' });
    // Only the key the guide asks for next stands out.
    var nx = S.run && S.run.phase === 'play' && S.run.q && !folded(S.run) ? guideMove(S.run) : null;
    var want = nx ? (nx.pfx && !S.armed ? [prefixLabel()] : nx.keys) : [];
    var html = '';
    keys.forEach(function (x) {
      if (want.indexOf(x.label) >= 0) x.cls += ' k-next';
      html += '<button type="button" class="key ' + x.cls + '" data-k="' + esc(JSON.stringify(x.k)) + '"' + (x.cls === 'k-prefix' && S.armed ? ' aria-pressed="true"' : '') + '>' + esc(x.label) + '</button>';
    });
    html += '<button type="button" class="key k-type" data-type="1">' + tx('文字を打つ') + '</button>';
    // The buttons under the house are hidden on a phone: やめる lives here.
    html += '<button type="button" class="key k-quit" data-quit="1">' + tx('やめる') + '</button>';
    // Drawn on every key; the same keys are left as they are.
    if (bar._html !== html) { bar._html = html; bar.innerHTML = html; }
  }

  // ---- effects -------------------------------------------------------------

  function banner(text, kind) {
    var el = $('#banner');
    if (!el) return;
    el.textContent = tx(text);
    el.className = 'banner ' + (kind || '');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(S.bannerTimer);
    S.bannerTimer = setTimeout(function () { el.classList.remove('show'); }, 700);
  }

  function shake() {
    if (reduceMotion) return;
    var t = $('.term-wrap');
    t.classList.remove('shake');
    void t.offsetWidth;
    t.classList.add('shake');
  }

  // A glow around the house: lamplight for a hit, vermilion for a miss.
  function termFlash(kind) {
    if (reduceMotion) return;
    var t = $('.term-wrap');
    if (!t) return;
    t.classList.remove('flash-hit', 'flash-miss');
    void t.offsetWidth;
    t.classList.add('flash-' + kind);
    // The lantern flares with a hit.
    var glow = $('#term > .glow');
    if (glow && kind === 'hit') animateOnce(glow, 'flare');
  }

  function celebrate() {
    if (reduceMotion) return;
    var fx = $('#fx');
    var colors = ['c1', 'c2', 'c3', 'c4'];
    for (var i = 0; i < 36; i++) {
      var s = document.createElement('span');
      var ang = Math.random() * Math.PI * 2;
      var dist = 120 + Math.random() * 260;
      s.className = 'p ' + colors[i % 4];
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(ang) * dist - 80 + 'px');
      s.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      s.style.animationDelay = (Math.random() * 120) + 'ms';
      fx.appendChild(s);
    }
    setTimeout(function () { fx.innerHTML = ''; }, 1400);
  }

  // ---- screens -----------------------------------------------------------

  function showScreen(name) {
    S.screen = name;
    // A button that was just clicked would otherwise keep the focus and
    // swallow Enter/Space as a click.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    $$('.screen').forEach(function (el) { el.hidden = el.id !== name + '-screen'; });
    // A screen keeps its scroll while hidden; a result must start at the top.
    var shown = $('#' + name + '-screen');
    if (shown) shown.scrollTop = 0;
    window.scrollTo(0, 0);
    if (name !== 'game') clearInterval(S.clock);
    syncBody();
    render();
    // A sheet (the result, the records) hands the focus to its title: a
    // screen reader says where the player is, and Tab goes on into the sheet.
    var h = $('#' + name + '-screen .em-title');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    if (name !== 'result') music();
  }

  function startRun(courseId, opts) {
    store.save({ prefix: S.prefix });
    S.result = null;
    buildHouse();
    prepareRun(courseId, opts);
    $('#chips').innerHTML = '';
    $('#playbar').dataset.key = '';
    showScreen('game');
    count('start');
    render();
    beginRun();
    focusSink();
  }

  // 練習's cheat sheet: the keys of every house played so far (入門 always),
  // in plain words, each one as the player's own file has it. Folds away;
  // the choice is kept.
  var CHEAT = {
    easy: [[['%'], '左右に分割'], [['"'], '上下に分割'], [['←', '→', '↑', '↓'], 'となりのペインへ'], [['o'], '次のペインへ順に'], [['z'], '全画面にする／戻す'],
      [['x', 'y'], 'ペインを閉じる（y で確認）'], [['c'], 'ウィンドウを作る'], [['n', 'p'], '次・前のウィンドウへ'], [['0-9'], 'その番号のウィンドウへ']],
    normal: [[[MAC ? 'Option+←' : 'Ctrl+←', '…'], 'ペインの大きさを変える'], [['{', '}'], 'ペインを入れ替える'], [[','], 'ウィンドウに名前を付ける'], [['&', 'y'], 'ウィンドウを閉じる'],
      [['l'], '直前のウィンドウへ'], [['!'], 'ペインを別のウィンドウにする'], [['['], 'コピーモード（q で抜ける）'], [['PageUp'], 'コピーモードで 1 ページ上へ'], [['d'], 'デタッチ（tmux a で戻る）']],
    hard: [[['$'], 'セッションに名前を付ける'], [['s'], 'セッションの一覧'], [['(', ')'], '前・次のセッションへ'], [[':', 'new -s'], 'セッションを作る'],
      [['[', '?'], '上向きに検索'], [[']'], 'コピーしたものを貼る']],
    pro: [[['Space'], '並べ方を順に変える'], [[MAC ? 'Option+1' : 'Alt+1', '…'], '並べ方を選ぶ（5 は田の字）'], [['q'], 'ペインの番号を出して飛ぶ'], [['Ctrl+o'], 'ペインを回す'],
      [[':', 'join-pane -s'], 'ペインを連れてくる'], [[':', 'swap-window -t'], 'ウィンドウを入れ替える'], [[':', 'setw synchronize-panes'], '全部のペインに同時に打つ']]
  };

  function cheatHTML() {
    var all = REC.load();
    var houses = LV.COURSES.filter(function (c) { return c.id === 'easy' || REC.runsOf(c.id, all).length; });
    var rows = '';
    houses.forEach(function (c) {
      rows += '<li class="ch-house">' + esc(c.title) + '</li>';
      CHEAT[c.id].forEach(function (e) {
        // The first key is the one after the prefix: the player's own if moved.
        var o = LABEL_SIG[e[0][0]] ? ownKey(e[0][0]) : { label: e[0][0] };
        var keys = o.none ? (o.cmd ? '<kbd>:</kbd> <code>' + esc(o.cmd) + '</code>' : '—')
          : '<kbd>' + esc(o.label) + '</kbd>' + e[0].slice(1).map(function (k) { return k === '…' ? '…' : / /.test(k) ? ' <code>' + esc(k) + '</code>' : ' <kbd>' + esc(k) + '</kbd>'; }).join('');
        rows += '<li><span class="ch-keys">' + keys + (o.root ? ' <small>' + tx('prefix なし') + '</small>' : '') + '</span><span class="ch-what">' + esc(tx(e[1]).replace(/^[a-z]/, function (c) { return c.toUpperCase(); })) + '</span></li>';
      });
    });
    return '<summary>' + esc(tx('覚えたキー（{0}）', houses.map(function (c) { return c.title; }).join(tx('・')))) + '</summary>' +
      '<p class="ch-how">' + tx('どれも {0} を押して離してから。', '<kbd>' + esc(prefixLabel()) + '</kbd>') + '</p><ul class="ch-list">' + rows + '</ul>';
  }

  function renderCheat() {
    var el = $('#cheat');
    if (!el) return;
    el.hidden = !S.free;
    if (!S.free) return;
    var key = prefixLabel() + '|' + S.confText + '|' + (REC.load().runs || []).length;
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.innerHTML = cheatHTML();
    // Open unless folded before; on a phone folded at first, the house needs the room.
    var pref = store.load().cheat;
    el.open = pref != null ? !!pref : !window.matchMedia('(max-width: 760px)').matches;
  }

  // 練習: the house with no question, no clock and no record. Every key and
  // : command works as in a run; Esc twice or やめる leaves.
  function startFree() {
    store.save({ prefix: S.prefix });
    leaveRun();
    S.result = null;
    buildHouse();
    S.free = true;
    $('#chips').innerHTML = '';
    $('#playbar').dataset.key = '';
    $('#sashizu').dataset.key = '';
    showScreen('game');
    render();
    focusSink();
  }

  // The counts (net.js): nothing but the step, the course and the question.
  function count(e, n) { if (NET && NET.ev) NET.ev(e, S.run ? S.run.course.id : '', n); }

  function leaveRun() {
    S.free = false;
    if (S.replay) { endReplay(); return; }
    dropBinds();
    if (S.run && S.run.phase !== 'done') count('quit', S.run.i);
    if (S.run) { clearTimeout(S.run.timer); clearInterval(S.clock); }
    S.run = null;
    seal(false);
  }

  function sec(t) { return tx('{0} 秒', t.toFixed(1)); }

  // The last few runs as bars, oldest first; the shape matters, not the numbers.
  function spark(list) {
    if (!list || list.length < 2) return '';
    var max = Math.max.apply(null, list.map(function (r) { return r.time; }));
    return '<div class="spark" aria-label="' + tx('直近 {0} 回のタイム', list.length) + '">' + list.map(function (r, i) {
      return '<i class="' + (r.rec ? 'rec' : '') + (i === list.length - 1 ? ' now' : '') + '" style="height:' + Math.max(8, Math.round(r.time / max * 100)) + '%"><b>' + r.time.toFixed(1) + '</b></i>';
    }).join('') + '</div>';
  }

  function wareki(d) {
    if (EN) return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  // Under the result's title (which already names the course and the
  // count): the day, and the key config when the run was on the player's own.
  function resultSub(r) {
    var day = wareki(r.at);
    return S.conf ? tx('{0} ・ {1}', day, tx('自分のキー設定（prefix {0}）', prefixLabel())) : day;
  }

  // 15 問 / 1 問: the counter of questions (English needs the singular).
  function nQ(n) { return n === 1 ? tx('1 問') : tx('{0} 問', n); }

  // The result as a hand scroll (記録): the time, against お手本, the rank
  // as a seal, the details and the last ten runs.
  function renderResult() {
    var r = S.result;
    var el = $('#result-body');
    if (!r || !el) return;
    if (r.drill) { renderDrillResult(r, el); return; }
    if (r.daily) { renderDailyResult(r, el); return; }
    var c = REC.courseOf(r.course);
    var diff = r.time - r.par;
    var verdict = diff <= 0
      ? tx('お手本 {0} 秒より <b>{1} 秒</b> 速い', r.par, Math.abs(diff).toFixed(1))
      : tx('お手本 {0} 秒まで あと <b>{1} 秒</b>', r.par, diff.toFixed(1));
    var sub = '';
    // The first run of a house says three things only: the belt, the time
    // (the best so far) and the next belt. The rest comes from the second.
    var first = r.count === 1;
    if (first) sub = tx('はじめての挑戦。これが自己ベスト。');
    else if (r.record) sub = tx('★ 自己ベスト更新（{0} → {1}）', r.best.toFixed(1), r.time.toFixed(1));
    else if (r.delta < 0) sub = tx('前回より {0} 秒 速い。自己ベストまで あと {1} 秒', Math.abs(r.delta).toFixed(1), r.bestDelta.toFixed(1));
    else sub = tx('前回より {0} 秒 遅い。自己ベストまで あと {1} 秒', r.delta.toFixed(1), r.bestDelta.toFixed(1));
    if (r.ao5 != null) sub += tx(' ・ 五回平均 {0}', (r.ao5Prev != null ? r.ao5Prev.toFixed(1) + ' → ' : '') + r.ao5.toFixed(1));
    // 昇格 only when this run raised the house's highest title; otherwise
    // this run's title, and the one reached when it is higher.
    var held = REC.bestTitle(r.course);
    var rankLine = r.rankUp
      ? '<b class="em-promo">' + tx('{0} に昇格', rankHTML(r.rank)) + '</b>'
      : tx('今回の称号 <b>{0}</b>', rankHTML(r.rank)) +
        (held && LV.rankIndex(held) < LV.rankIndex(r.rank) ? '<span class="em-held">' + tx('（{0}の最高は {1}）', esc(c.title), rankHTML(held)) + '</span>' : '');
    // What the next title needs on this course, in all and per question:
    // the number to beat next time.
    var nr = LV.nextRank(c, r.time, r.n);
    if (first) verdict = nr.next ? tx('{0}まで あと <b>{1} 秒</b>', esc(tx(nr.next)), nr.gap.toFixed(1)) : esc(tx('最高の称号。'));
    else rankLine += '<small>' + esc(nr.next ? tx('{0}まで あと {1} 秒（1 問 {2} 秒）', tx(nr.next), nr.gap.toFixed(1), nr.gapQ.toFixed(2)) : tx('最高の称号。')) + '</small>';
    var slow = r.slow ? Q[r.slow] : null;
    var slowKeys = [];
    if (slow) slow.show.forEach(function (a) { (LV.KEYS[a] || []).forEach(function (k) { if (slowKeys.indexOf(k) < 0) slowKeys.push(k); }); });
    var isRec = !!(r.record && r.count > 1);
    var up = nextCourse(r);
    el.classList.toggle('is-rec', isRec);
    el.innerHTML =
      '<div class="em-hd">' + tx('{0} 回目', r.count) + '</div>' +
      '<h2 class="em-title">' + esc(tx('{0} {1} 問、解き終わった', c.title, r.n)) + '</h2>' +
      '<div class="em-sub">' + esc(resultSub(r)) + '</div>' +
      '<div class="em-row"><div class="em-time">' + r.time.toFixed(1) + '<small>' + tx('秒') + '</small></div>' +
      '<div class="em-verdict' + (first ? ' em-goal' : '') + '">' + verdict + '<span class="em-tip">' + esc(sub) + '</span></div></div>' +
      // The seal keeps the kanji in English too; the words beside it translate.
      '<div class="em-rank' + (r.rankUp ? ' up' : '') + '"><span class="hanko" lang="ja" aria-hidden="true">' + esc(r.rank).replace(/^(.{3})(.+)$/, '$1<br>$2') + '</span><span>' + rankLine + '</span></div>' +
      (first ? resultNetHTML(r) : resultMoreHTML(r, slow, slowKeys)) +
      '<div class="cta"><button type="button" class="btn primary" data-course="' + r.course + '">' + (c.practice ? tx('もう一度 稽古') : tx('もう一度')) + '<kbd class="hk">Enter</kbd></button>' +
      (up ? '<button type="button" class="btn primary" data-course="' + up.id + '">' + esc(tx('{0}へ進む', up.title)) + '<kbd class="hk">N</kbd></button>' : '') +
      (!c.practice ? '<button type="button" class="btn" data-course="' + r.course + '" data-shuffle="1">' + tx('順番を変えて') + '</button>' : '') +
      (!c.practice ? '<button type="button" class="btn" data-course="keiko">' + tx('稽古（手順なし）') + '<kbd class="hk">K</kbd></button>' : '') +
      '<button type="button" class="btn" data-records="' + (c.practice ? lastCourse(REC.load()) : r.course) + '">' + tx('記録を見る') + '<kbd class="hk">R</kbd></button>' +
      '<button type="button" class="btn ghost" data-title="1">' + tx('コース選択へ') + '<kbd class="hk">Esc</kbd></button></div>';
    renderMeta();
    if ((isRec || r.rankUp) && S.celebrated !== r.runId) { S.celebrated = r.runId; celebrate(); }
  }

  // Past the first run: the Lv, the facts, the keys against 標準, the
  // slowest, the share text, the last runs and a tip.
  function resultMoreHTML(r, slow, slowKeys) {
    return (
      '<div class="skill em-skill">' + skillHTML(r.skill, r.skillFrom) + '</div>' +
      learntHTML(r) +
      '<dl class="em-facts">' +
      '<div><dt>' + tx('1 問あたり') + '</dt><dd>' + tx('{0}秒', r.avg.toFixed(2)) + '</dd></div>' +
      '<div><dt>' + tx('実時間') + '</dt><dd>' + tx('{0}秒', r.raw.toFixed(1)) + '</dd></div>' +
      '<div><dt>' + tx('ミス') + '</dt><dd>' + tx('{0}（+{1}秒）', r.misses, r.misses * LV.MISS_PENALTY) + '</dd></div>' +
      '<div><dt>' + tx('目安超え') + '</dt><dd>' + nQ(r.overs) + '</dd></div>' +
      '<div><dt>' + tx('自己ベスト') + '</dt><dd>' + fmt(r.record ? r.time : r.best) + '</dd></div>' +
      '<div><dt>' + tx('押したキー') + '</dt><dd>' + keysHTML(r) + '</dd></div>' +
      (r.blind ? '<div><dt>' + tx('手順を見た') + '</dt><dd>' + nQ(r.guides) + '</dd></div>' : '') +
      '</dl>' +
      parBeatHTML(r.keys, parOf(r.qlog || [])) +
      overKeysHTML(r) +
      resultNetHTML(r) +
      watchHTML(r) +
      confShareHTML(r) +
      slowestHTML(r) +
      shareHTML(r) +
      spark(r.spark) +
      '<div class="spark-l"><span>' + (slow ? esc(tx('いちばん時間がかかった問題: {0}（{1} → {2}）', tx(slow.text), prefixLabel(), slowKeys.join(' '))) : r.overs ? '' : tx('目安超えなし。どの問題も目安のうちに解いた')) + '</span>' +
      (r.spark && r.spark.length > 1 ? '<span class="spark-key"><i class="rec"></i>' + tx('自己ベスト') + ' <i class="now"></i>' + tx('今回') + '</span>' : '') + '</div>' +
      (r.tip ? '<div class="tips"><div class="tips-head">' + tx('豆知識') + (r.tipFor ? tx(' ・ {0}', esc(typeName(r.tipFor))) : '') + '</div><p>' + esc(r.tip) + '</p></div>' : ''));
  }

  // 押したキー 113 / 標準 84: the keys against the fewest the 手順 takes on
  // these bindings (parKeys), when every question had its count.
  function parOf(qs) {
    var p = 0;
    for (var i = 0; i < qs.length; i++) { if (typeof qs[i].p !== 'number') return null; p += qs[i].p; }
    return p;
  }

  function keysHTML(r) {
    var par = parOf(r.qlog || []);
    return par == null ? String(r.keys) : tx('{0} / 標準 {1}', r.keys, par);
  }

  // Fewer keys than 標準 (the 手順's count): key golf, said out loud.
  function parBeat(keys, par) {
    var d = typeof keys === 'number' && typeof par === 'number' ? par - keys : 0;
    return d > 0 ? tx('標準より {0} キー少ない', d) : '';
  }
  function parBeatHTML(keys, par) {
    var t = parBeat(keys, par);
    return t ? '<p class="em-parbeat">' + esc(t) + '</p>' : '';
  }

  // The questions that took more keys than the fewest, most extra first;
  // one row a type (a course asks some twice: their keys add up, ×2 said).
  function overKeys(qlog) {
    var by = {}, out = [];
    (qlog || []).forEach(function (q) {
      if (typeof q.p !== 'number' || typeof q.k !== 'number' || q.k <= q.p) return;
      if (!by[q.t]) { by[q.t] = { t: q.t, k: 0, p: 0, n: 0 }; out.push(by[q.t]); }
      by[q.t].k += q.k; by[q.t].p += q.p; by[q.t].n += 1;
    });
    return out;
  }

  function overKeysHTML(r) {
    var over = overKeys(r.qlog);
    if (!over.length) return '';
    over.sort(function (a, b) { return (b.k - b.p) - (a.k - a.p); });
    return '<div class="em-overkeys"><div class="ok-head">' + tx('標準より多く押した問題') + '</div><ul>' +
      over.slice(0, 5).map(function (q) { return '<li>' + esc(typeName(q.t) + (q.n > 1 ? ' ×' + q.n : '')) + ' <span>' + tx('押した {0} / 標準 {1}', q.k, q.p) + '</span></li>'; }).join('') + '</ul></div>';
  }

  // この回を見る: the run played again (startReplay), or its keys listed.
  function watchHTML(r) {
    var run = r.runId ? REC.runById(r.runId) : null;
    if (!run || !run.klog) return '';
    return '<p class="em-watch"><button type="button" class="btn" data-replay="' + esc(run.id) + '">' + tx('この回を見る') + '</button></p>' +
      (watchable(r) ? '<p class="em-board dim">' + tx('この回は誰でも見られる（ランキングに載った回）:') + '</p>' + watchLinkHTML(run.id) : '');
  }

  // A run on the player's own file, with a name: offer to publish the file
  // (the result is where the run just was).
  function confShareHTML(r) {
    if (!r.conf || !S.confText || !NET || !NET.state().name || REC.courseOf(r.course).practice) return '';
    if (NET.state().confShared) return '<p class="em-board dim">' + tx('この .tmux.conf は公開中（ランキングの「自分の設定」から見られる）。') + '</p>';
    return '<p class="em-board"><a href="#" data-conf-share="1">' + tx('この回の .tmux.conf を公開する') + '</a> <small>' + tx('ランキングの「自分の設定」から読めるようになる') + '</small></p>';
  }

  // 今日の達人's result: the time, the keys against the fewest, whether the
  // 手順 came out, the days in a row, and the day's board.
  function renderDailyResult(r, el) {
    var q = r.qlog[0] || {};
    var par = typeof q.p === 'number' ? q.p : null;
    var sk = REC.streak(null, null, 'daily');
    var tb = REC.todayBest('daily');
    el.classList.toggle('is-rec', false);
    el.innerHTML =
      '<div class="em-hd">' + esc(tx('今日の達人 ・ {0}', dayLabel(r.day || LV.dayKey()))) + '</div>' +
      '<h2 class="em-title">' + esc(typeName(q.t)) + '</h2>' +
      '<div class="em-sub">' + esc(resultSub(r)) + '</div>' +
      '<div class="em-row"><div class="em-time">' + r.time.toFixed(1) + '<small>' + tx('秒') + '</small></div>' +
      '<div class="em-verdict">' + (par != null ? tx('押したキー <b>{0}</b> ／ 標準 {1}', r.keys, par) : tx('押したキー <b>{0}</b>', r.keys)) +
      '<span class="em-tip">' + esc(q.g ? tx('手順を見た（{0} 秒で出た）', LV.PEEK_AFTER) : tx('手順を見ずに解いた')) + (r.misses ? esc(tx(' ・ ミス {0}（+{1}秒）', r.misses, r.misses * LV.MISS_PENALTY)) : '') + '</span></div></div>' +
      parBeatHTML(r.keys, par) +
      (sk.days >= 2 ? '<p class="em-learnt">' + esc(tx('今日の達人 {0} 日連続', sk.days)) + '</p>' : '') +
      '<dl class="em-facts">' +
      '<div><dt>' + tx('実時間') + '</dt><dd>' + tx('{0}秒', r.raw.toFixed(1)) + '</dd></div>' +
      '<div><dt>' + tx('今日の自己ベスト') + '</dt><dd>' + fmt(tb) + '</dd></div>' +
      '<div><dt>' + tx('連続') + '</dt><dd>' + tx('{0} 日', sk.days) + '</dd></div>' +
      '</dl>' +
      resultNetHTML(r) +
      dailyBoardHTML() +
      watchHTML(r) +
      shareHTML(r) +
      (r.tip ? '<div class="tips"><div class="tips-head">' + tx('豆知識') + (r.tipFor ? tx(' ・ {0}', esc(typeName(r.tipFor))) : '') + '</div><p>' + esc(r.tip) + '</p></div>' : '') +
      '<div class="cta"><button type="button" class="btn primary" data-course="daily">' + tx('もう一度') + '<kbd class="hk">Enter</kbd></button>' +
      '<button type="button" class="btn" data-course="pro">' + esc(tx('{0}をはじめる', REC.courseOf('pro').title)) + '</button>' +
      '<button type="button" class="btn ghost" data-title="1">' + tx('コース選択へ') + '<kbd class="hk">Esc</kbd></button></div>';
    renderMeta();
    loadDailyBoard();
  }

  // Today's board of 今日の達人, under its result: the first ten, with the
  // keys each pressed and whether the 手順 came out.
  function dailyBoardHTML() {
    var d = S.dailyBoard;
    if (!d || d.day !== LV.dayKey()) return '';
    var me = NET ? NET.state().name : null;
    var q0 = S.result && S.result.daily && S.result.qlog[0];
    var par = q0 && typeof q0.p === 'number' ? q0.p : dailyPar();
    if (!d.rows.length) return '<div class="rec-panel daily-board"><div class="rec-head">' + tx('今日の達人のランキング') + '</div><p class="rec-empty">' + tx('まだ今日の記録はない。一番乗りの好機。') + '</p></div>';
    return '<div class="rec-panel daily-board"><div class="rec-head">' + tx('今日の達人のランキング') + '</div><table class="rec-table board"><thead><tr><th>' + tx('位') + '</th><th>' + tx('名前') + '</th><th>' + tx('タイム') + '</th><th>' + tx('キー') + '</th></tr></thead><tbody>' +
      d.rows.slice(0, 10).map(function (r) {
        var keys = typeof r.keys === 'number' ? (par != null ? tx('{0} / 標準 {1}', r.keys, par) : String(r.keys)) : '—';
        return '<tr class="' + (me && r.name === me ? 'is-me' : '') + '"><td class="c-n">' + r.rank + '</td><td>' + esc(r.name) + (r.peek ? ' <small class="r-own">' + tx('手順を見た') + '</small>' : '') +
          (r.log ? ' <a href="#" class="r-watch" data-watch-run="' + esc(r.id || '') + '">' + tx('見る') + '</a>' : '') + '</td><td class="r-time">' + tx('{0}秒', r.time.toFixed(1)) + '</td><td class="c-n">' + esc(keys) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // Read once the run is on the board (or right away when it cannot be).
  function loadDailyBoard() {
    var r = S.result;
    if (!NET || !r || !r.daily || (!/^https?:$/.test(location.protocol) && !/^http:\/\/(localhost|127\.0\.0\.1)|-staging\./.test(NET.API))) return;
    if (r.board && r.board.state === 'sending') return;
    var day = LV.dayKey(), key = (r.board ? r.board.state : '') + '|' + r.runId;
    if (S.dailyBoard && S.dailyBoard.key === key) return;
    S.dailyBoard = { day: day, key: key, rows: (S.dailyBoard && S.dailyBoard.day === day ? S.dailyBoard.rows : []) };
    NET.board('daily', 'today').then(function (rows) {
      S.dailyBoard = { day: day, key: key, rows: rows };
      if (S.screen === 'result' && S.result === r) renderResult();
    }).catch(function () { /* offline: no board */ });
  }

  // The fewest keys 今日の達人 takes on the player's bindings, tried on a
  // house of its own (the one the question will be asked on), then put back.
  function dailyPar() {
    var day = LV.dayKey(), key = day + '|' + (S.conf ? S.confText : '') + '|' + S.cols + 'x' + S.rows;
    if (S.dailyParAt && S.dailyParAt.key === key) return S.dailyParAt.n;
    var n = null;
    if (!S.run && !S.replay) {
      var snap = snapshot();
      try {
        S.sim = true;
        buildHouse();
        var type = LV.dailyPick(day);
        S.run = { course: LV.DAILY, day: day, qs: [type], learnt: {}, i: 0, phase: 'play', qlog: [], keys: 0, misses: 0, penalty: 0, stage: 0, seed: day + ':' + LV.DAILY.id, klog: null };
        loadQuestion();
        n = S.run.qlog[0].p;
      } catch (e) { n = null; }
      restore(snap);
      S.sim = false;
    }
    S.dailyParAt = { key: key, n: n };
    return n;
  }

  // The 稽古's result: the longest run from memory, how each type went, and
  // what to drill next. No お手本, no rank, no ranking: it is practice.
  function renderDrillResult(r, el) {
    var c = REC.courseOf(r.course);
    var by = {};
    r.qlog.forEach(function (q) {
      var e = by[q.t] || (by[q.t] = { t: q.t, n: 0, clean: 0, sum: 0 });
      e.n += 1; e.sum += q.s;
      if (!q.g && !q.m && !q.o) e.clean += 1;
    });
    var list = Object.keys(by).map(function (k) { return by[k]; });
    list.sort(function (a, b) { return (a.clean / a.n) - (b.clean / b.n) || b.n - a.n; });
    var weak = list.filter(function (e) { return e.clean < e.n; }).slice(0, 3);
    var best = Math.max(r.bestStreak, r.bestBefore || 0);
    var isBest = r.bestStreak > 0 && r.bestStreak > (r.bestBefore || 0);
    var sub = isBest ? (r.bestBefore ? tx('★ 最長記録（{0} → {1}）', r.bestBefore, r.bestStreak) : tx('これが出発点。'))
      : tx('これまでの最長 {0} 問', best);
    var rows = list.map(function (e) {
      return '<tr><td>' + esc(typeName(e.t)) + '</td><td class="c-n">' + e.n + '</td><td class="c-n">' + e.clean + '</td><td class="r-time">' + tx('{0}秒', (e.sum / e.n).toFixed(1)) + '</td></tr>';
    }).join('');
    el.classList.toggle('is-rec', isBest && !!r.bestBefore);
    el.innerHTML =
      '<div class="em-hd">' + tx('稽古 {0} 回目', r.count) + '</div>' +
      '<h2 class="em-title">' + esc(tx('稽古 {0} 問', r.n)) + '</h2>' +
      '<div class="em-sub">' + esc(resultSub(r)) + '</div>' +
      '<div class="em-row"><div class="em-time">' + r.bestStreak + '<small>' + tx('問連続') + '</small></div>' +
      '<div class="em-verdict">' + esc(tx('手順を見ずに、ミスなく続けて解けた数')) + '<span class="em-tip">' + esc(sub) + '</span></div></div>' +
      learntHTML(r) +
      '<dl class="em-facts">' +
      '<div><dt>' + tx('解いた問題') + '</dt><dd>' + r.n + '</dd></div>' +
      '<div><dt>' + tx('手順を見た') + '</dt><dd>' + nQ(r.guides) + '</dd></div>' +
      '<div><dt>' + tx('ミス') + '</dt><dd>' + r.misses + '</dd></div>' +
      '<div><dt>' + tx('1 問あたり') + '</dt><dd>' + tx('{0}秒', r.avg.toFixed(2)) + '</dd></div>' +
      '</dl>' +
      '<div class="rec-panel em-types"><div class="rec-head">' + tx('問題ごと') + '</div><table class="rec-table"><thead><tr><th>' + tx('問題') + '</th><th>' + tx('回数') + '</th><th>' + tx('手順なしで') + '</th><th>' + tx('平均') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="em-next">' + (weak.length ? tx('次に鍛える: ') + '<b>' + weak.map(function (e) { return esc(typeName(e.t)); }).join(tx('・')) + '</b>' : esc(tx('どれも手順なしで解けた。'))) + '</p>' +
      (r.tip ? '<div class="tips"><div class="tips-head">' + tx('豆知識') + (r.tipFor ? tx(' ・ {0}', esc(typeName(r.tipFor))) : '') + '</div><p>' + esc(r.tip) + '</p></div>' : '') +
      '<div class="cta"><button type="button" class="btn primary" data-course="keiko">' + tx('もう一度（やめるまで）') + '<kbd class="hk">Enter</kbd></button>' +
      '<button type="button" class="btn" data-course="keiko" data-n="10">' + tx('10 問だけ') + '</button>' +
      '<button type="button" class="btn" data-course="keiko" data-n="20">' + tx('20 問だけ') + '</button>' +
      '<button type="button" class="btn" data-free="1">' + tx('練習（問題なしで自由に）') + '<kbd class="hk">P</kbd></button>' +
      '<button type="button" class="btn" data-records="' + lastCourse(REC.load()) + '">' + tx('記録を見る') + '<kbd class="hk">R</kbd></button>' +
      '<button type="button" class="btn ghost" data-title="1">' + tx('コース選択へ') + '<kbd class="hk">Esc</kbd></button></div>';
    renderMeta();
    if (isBest && r.bestBefore && S.celebrated !== r.runId) { S.celebrated = r.runId; celebrate(); }
  }

  // The next house up (入門 → 中級 → 上級) after a run of 黒帯 or better, while
  // that house has never been entered: the moment to step up.
  function nextCourse(r) {
    var i = LV.COURSES.map(function (c) { return c.id; }).indexOf(r.course);
    var up = i >= 0 ? LV.COURSES[i + 1] : null;
    if (!up || REC.runsOf(up.id, REC.load()).length) return null;
    return LV.rankIndex(r.rank) <= LV.rankIndex(LV.STEP_UP_RANK) ? up : null;
  }

  // The three questions that took longest, with their seconds: what to practise.
  function slowestHTML(r) {
    var qs = (r.qlog || []).filter(function (q) { return q && q.s != null; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 3);
    if (qs.length < 2) return '';
    return '<div class="em-slow"><div class="rec-head">' + tx('時間がかかった問題') + '</div><ol>' +
      qs.map(function (q) { return '<li><span>' + esc(typeName(q.t)) + '</span><b>' + tx('{0} 秒', q.s.toFixed(1)) + (q.m ? '<small>' + tx('ミス {0}', q.m) + '</small>' : '') + '</b></li>'; }).join('') +
      '</ol></div>';
  }

  // ---- ランキング and 合言葉 ---------------------------------------------------------
  // All optional: with no network the game is exactly as before.

  // After a run: bring the history in line with the other devices, then
  // enter the run on the boards when the player has a name.
  function shareRun(runId) {
    var r = S.result;
    if (!NET || !r) return;
    // 稽古 is kept in step between devices but never goes on the boards;
    // nor does a run in a changed order, or one paused for long.
    var why = REC.courseOf(r.course).practice ? 'practice' : r.first ? 'first' : r.shuffled ? 'shuffled' : r.paused > LV.PAUSE_MAX ? 'paused' : null;
    if (why) { if (why !== 'practice') r.board = { state: why }; if (NET.state().key) NET.sync().catch(function () {}); return; }
    // Nothing leaves the browser until the player gives a name or a 合言葉.
    if (!NET.state().key) { r.board = { state: 'noname' }; return; }
    var run = (REC.load().runs || []).filter(function (x) { return x.id === runId; })[0];
    r.board = { state: NET.state().name ? 'sending' : 'noname' };
    NET.sync().then(function () {
      if (!NET.state().name) { r.board = { state: 'noname' }; return null; }
      return NET.submit(run).then(function (res) {
        r.board = res ? { state: 'ok', rank: res.rank, total: res.total } : { state: 'off' };
      });
    }).catch(function (e) {
      // The server's reason (key log: …) is kept for the tests and the console.
      r.board = { state: e && e.status === 400 && NET.state().name ? 'refused' : 'offline', why: e && e.message };
    }).then(function () { if (S.screen === 'result' && S.result === r) renderResult(); });
  }

  // The run as a few lines to paste anywhere, Wordle style: one square a
  // question (green: under half the 目安, yellow: within it, red: over it or
  // a wrong key), the time against お手本, the rank and the link.
  var SITE = 'https://t29mato.github.io/games/tmux-dojo/';
  function shareText(r) {
    var c = REC.courseOf(r.course);
    if (r.daily) {
      var dq = r.qlog[0] || {}, dd = LV.dayKey(r.at).split('-');
      var db = parBeat(r.keys, dq.p);
      return tx('tmux 道場 今日の達人 {0} {1} {2}秒 ・ 押したキー {3} / 標準 {4}{5}', EN ? dayLabel(LV.dayKey(r.at)) : +dd[1] + '/' + +dd[2], typeName(dq.t), r.time.toFixed(1), r.keys, typeof dq.p === 'number' ? dq.p : '—', dq.g ? tx('（手順を見た）') : tx('（手順なし）')) + (db ? tx(' ・ {0}', db) : '') + '\n' +
        (watchable(r) ? watchURL(r.runId) : SITE + (EN ? '?lang=en' : ''));
    }
    var sq = (r.qlog || []).map(function (q) {
      return q.m || q.o ? '🟥' : q.s != null && q.s <= REC.limitOf(q, c) / 2 ? '🟩' : '🟨';
    });
    var rows = [];
    for (var i = 0; i < sq.length; i += 10) rows.push(sq.slice(i, i + 10).join(''));
    var day = LV.dayKey(r.at), d = day.split('-');
    // The title in English carries its kanji: Kuro-obi 黒帯.
    var title = EN && LV.rankInfo(r.rank) ? LV.rankInfo(r.rank).romaji + ' ' + r.rank : r.rank;
    var beat = parBeat(r.keys, parOf(r.qlog || []));
    return tx('tmux 道場 {0} {1} {2}秒（お手本 {3}秒）{4}', EN ? dayLabel(day) : +d[1] + '/' + +d[2], c.title, r.time.toFixed(1), r.par, title) + (beat ? tx(' ・ {0}', beat) : '') + '\n' +
      rows.join('\n') + '\n' + (watchable(r) ? watchURL(r.runId) : SITE + (EN ? '?lang=en' : ''));
  }

  // A run on the boards with its keys can be watched by anyone from a link.
  function watchable(r) {
    if (!r || !r.board || r.board.state !== 'ok' || !r.runId) return false;
    var run = REC.runById(r.runId);
    return !!(run && run.klog);
  }

  function watchURL(id) { return SITE + '?watch=' + encodeURIComponent(id) + (EN ? '&lang=en' : ''); }

  // The link under a watchable run, with a button that copies it.
  function watchLinkHTML(id) {
    var url = watchURL(id);
    return '<p class="watch-link"><a href="' + esc(url) + '" target="_blank" rel="noopener" data-watch-url>' + esc(url) + '</a>' +
      '<button type="button" class="btn ghost" data-copy-watch="' + esc(url) + '">' + tx('リンクを写す') + '</button><small class="watch-msg" aria-live="polite"></small></p>';
  }

  function shareHTML(r) {
    if (REC.courseOf(r.course).practice) return '';
    var text = shareText(r);
    // On screen the kanji of the title is marked as Japanese.
    var shown = esc(text).replace(esc(r.rank), '<span lang="ja">' + esc(r.rank) + '</span>');
    return '<div class="share"><pre class="share-text">' + shown + '</pre>' +
      '<div class="share-btns"><button type="button" class="btn" data-share>' + tx('結果をコピー') + '</button>' +
      '<a class="btn ghost" target="_blank" rel="noopener" href="https://x.com/intent/post?text=' + encodeURIComponent(text) + '">' + tx('X に投稿') + '</a>' +
      '<small class="share-msg" aria-live="polite"></small></div></div>';
  }

  function copyShare() {
    var r = S.result, m = $('#result-body .share-msg');
    if (!r) return;
    var text = shareText(r);
    var said = function (t) { if (m) m.textContent = tx(t); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { said('コピーした。好きな所に貼れる。'); }, function () { selectShare(); said('選んだ。コピーして貼れる。'); });
    } else { selectShare(); said('選んだ。コピーして貼れる。'); }
  }

  function selectShare() {
    var pre = $('#result-body .share-text');
    if (!pre || !window.getSelection) return;
    var range = document.createRange();
    range.selectNodeContents(pre);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // What this run taught: types newly learnt (their 手順 folds from now on)
  // and types that slipped (their 手順 is back).
  function learntHTML(r) {
    var html = '';
    if (r.learntNew && r.learntNew.length) html += '<p class="em-learnt">' + tx('覚えた: ') + '<b>' + r.learntNew.map(typeName).map(esc).join(tx('・')) + '</b>' + tx('（次からは手順を隠す。{0} 秒後に出る）', LV.PEEK_AFTER) + '</p>';
    if (r.learntLost && r.learntLost.length) html += '<p class="em-learnt lost">' + tx('もう一度: {0}（手順を出す）', r.learntLost.map(typeName).map(esc).join(tx('・'))) + '</p>';
    return html;
  }

  function resultNetHTML(r) {
    var html = '';
    if (r.ghost) {
      var d = r.ghost.diff;
      html += '<p class="em-ghost' + (d <= 0 ? ' win' : '') + '">' + tx(d <= 0 ? '影（{0} {1}秒）に <b>{2} 秒差で勝った</b>' : '影（{0} {1}秒）に {2} 秒差で負けた',
        esc(r.ghost.name === '自分' ? tx('自分のベスト') : (r.ghost.kind === 'next' ? tx('1 つ上 ') : '') + r.ghost.name), r.ghost.time.toFixed(1), Math.abs(d).toFixed(1)) + '</p>';
    }
    var b = r.board;
    if (!b) return html;
    if (b.state === 'sending') html += '<p class="em-board">' + tx('今日のランキングに載せている……') + '</p>';
    if (b.state === 'ok') html += '<p class="em-board">' + tx('今日のランキング <b>{0} 位</b> ／ {1} 人', b.rank, b.total) + ' ' + tx('・') + ' <a href="#" data-board="' + r.course + '">' + tx('ランキングを見る') + '</a></p>';
    if (b.state === 'refused') html += '<p class="em-board dim">' + tx('この記録はランキングに載せられなかった（手で解いた記録だけが載る）。') + '</p>';
    if (b.state === 'offline') html += '<p class="em-board dim">' + tx('ランキングにつながらなかった（記録には残る）。') + '</p>';
    if (b.state === 'paused') html += '<p class="em-board dim">' + tx('途中で {0} 秒 止まっていたので、今日のランキングには載せない（記録には残る）。', r.paused.toFixed(1)) + '</p>';
    if (b.state === 'shuffled') html += '<p class="em-board dim">' + tx('順番を変えた回は、今日のランキングには載せない（記録には残る）。') + '</p>';
    if (b.state === 'first') html += '<p class="em-board dim">' + tx('はじめての回は、やさしい順番なのでランキングには載らない（記録には残る）。次の回から今日の順番で載る。') + '</p>';
    if (b.state === 'noname') {
      html += '<form class="em-board name-form" data-name-form="result"><label>' + tx('名前を付けると、今日のランキングに載る') + '</label>' +
        '<span class="nf-row"><input name="name" maxlength="12" autocomplete="nickname" aria-label="' + tx('ランキングの名前') + '" placeholder="' + tx('名前（12 文字まで）') + '"><button type="submit" class="btn">' + tx('ランキングに載せる') + '</button></span>' +
        '<small class="nf-msg"></small></form>';
    }
    return html;
  }

  // The name form: on the result it also enters the run just made.
  function submitName(form) {
    var input = form.querySelector('input'), msg = form.querySelector('.nf-msg');
    var name = input.value.trim();
    if (!name) { input.focus(); return; }
    msg.textContent = tx('送っている……');
    NET.setName(name).then(function () { return NET.sync(); }).then(function () {
      AU.se('hit', 1);
      if (form.dataset.nameForm === 'result' && S.result) {
        var r = S.result;
        var run = (REC.load().runs || []).filter(function (x) { return x.id === r.runId; })[0];
        r.board = { state: 'sending' };
        renderResult();
        return NET.submit(run).then(function (res) {
          r.board = res ? { state: 'ok', rank: res.rank, total: res.total } : { state: 'off' };
          renderResult();
        });
      }
      renderRecords();
    }).catch(function (e) {
      // The run itself failed to go up: the result was redrawn without this
      // form, so say it there, not in a form that is gone.
      var r = S.result;
      if (r && r.board && r.board.state === 'sending') {
        r.board = { state: e && e.status === 400 ? 'refused' : 'offline' };
        if (S.screen === 'result') renderResult();
        return;
      }
      msg.textContent = tx(e && e.status === 409 ? 'その名前は他の人が使っている。別の名前で。' :
        e && e.status === 400 ? '使えない名前。12 文字まで。' : 'つながらなかった。あとでもう一度。');
    });
  }

  // ランキング: each player's best for the course, today / this week / ever.
  function renderBoard(body, id) {
    // 今日の達人 asks another question every day: only today's board compares.
    var daily = !!REC.courseOf(id).daily;
    var span = daily ? 'today' : S.boardSpan || BOARD_SPAN;
    var seg = daily ? '' : '<div class="seg rec-span" role="group" aria-label="' + tx('期間') + '">' +
      [['today', '今日'], ['week', '今週'], ['all', '全期間']].map(function (x) {
        return '<button type="button" data-span="' + x[0] + '" aria-pressed="' + (x[0] === span ? 'true' : 'false') + '">' + tx(x[1]) + '</button>';
      }).join('') + '</div>';
    var me = NET ? NET.state().name : null;
    var key = id + '|' + span;
    var cached = S.boardCache && S.boardCache[key];
    // From a file:// page nothing is fetched: say so instead of loading forever.
    // A local test server (?api=http://localhost…) counts as online from a file:// page.
    var offline = !NET || (!/^https?:$/.test(location.protocol) && !/^http:\/\/(localhost|127\.0\.0\.1)|-staging\./.test(NET.API));
    var table = function (rows) {
      if (!rows.length) return '<p class="rec-empty">' + tx(span === 'today' ? 'まだ今日の記録はない。一番乗りの好機。' : 'まだ記録がない。') + '</p>';
      return '<table class="rec-table board"><thead><tr><th>' + tx('位') + '</th><th>' + tx('名前') + '</th><th>' + tx('タイム') + '</th><th class="r-note">' + tx('日付') + '</th></tr></thead><tbody>' +
        rows.map(function (r) {
          // A run on the player's own .tmux.conf (bind -n moves take one key)
          // is said so; a published file is a link to it.
          var own = r.own ? ' <small class="r-own">' + (r.conf ? '<a href="#" data-conf-of="' + esc(r.name) + '">' + tx('自分の設定') + '</a>' : tx('自分の設定')) + '</small>' : '';
          var watch = r.log ? ' <a href="#" class="r-watch" data-watch="' + esc(r.name) + '" data-watch-id="' + esc(r.id || '') + '">' + tx('見る') + '</a>' : '';
          // A run where the 手順 came out still ranks, marked: how many questions.
          var peek = r.peek ? ' <small class="r-own">' + tx('手順を見た {0} 問', r.peek) + '</small>' : '';
          return '<tr class="' + (me && r.name === me ? 'is-me' : '') + '"><td class="c-n">' + r.rank + '</td><td>' + esc(r.name) + own + peek + watch + '</td><td class="r-time">' + tx('{0}秒', r.time.toFixed(1)) + '</td><td class="r-note c-n">' + esc(r.day.slice(5).replace('-', '/')) + '</td></tr>';
        }).join('') + '</tbody></table>';
    };
    var note = me ? '<p class="rec-empty">' + tx('「{0}」として載る。名前は「引き継ぎ」で変えられる。', esc(me)) + '</p>'
      : '<p class="rec-empty">' + tx('名前を付けると、遊ぶたびに自分の一番が載る。名前は「引き継ぎ」で付けられる。') + '</p>';
    body.innerHTML = '<div class="rec-panel"><div class="rec-head">' + tx('ランキング ・ {0}', esc(REC.courseOf(id).title)) + '</div>' + seg +
      '<div class="board-body">' + (cached ? table(cached.rows) : '<p class="rec-empty">' + tx(offline ? 'オフラインなのでランキングは見られない' : '読み込み中……') + '</p>') + '</div>' + note + ghostPickHTML() + '</div>';
    if (cached && Date.now() - cached.at < 15000) return;
    if (offline) return;
    // Looking at the boards is the player's choice; reading sends nothing of theirs.
    NET.board(id, span).then(function (rows) {
      S.boardCache = S.boardCache || {};
      S.boardCache[key] = { rows: rows, at: Date.now() };
      if (S.screen === 'records' && S.recTab === 'board' && S.recCourse === id && (daily || (S.boardSpan || BOARD_SPAN) === span)) renderRecords();
    }).catch(function () {
      var bb = $('#records-body .board-body');
      if (bb && !cached) bb.innerHTML = '<p class="rec-empty">' + tx('ランキングにつながらなかった。通信できるときにもう一度。') + '</p>';
    });
  }

  // 引き継ぎ: the 合言葉 and the name.
  function renderSync(body) {
    var st = NET ? NET.state() : {};
    var keyHTML = st.key
      ? '<div class="sync-key"><code>' + esc(st.key) + '</code><button type="button" class="btn" data-copy-key>' + tx('写す') + '</button></div>' +
        '<p class="rec-empty">' + tx('別の端末でこの合言葉を入れると、同じ記録が見られる。他の人には教えない。') + (st.syncedAt ? tx('最後に合わせた: {0}（UTC）', esc(recDate(st.syncedAt)) + ' ' + esc(st.syncedAt.slice(11, 16))) : '') + '</p>'
      : '<p class="rec-empty">' + tx('まだ合言葉がない。一度遊ぶか、下の「今すぐ合わせる」で作られる。') + '</p>';
    body.innerHTML =
      '<div class="rec-panel"><div class="rec-head">' + tx('この端末の合言葉') + '</div>' + keyHTML +
      '<div class="cta"><button type="button" class="btn" data-sync-now>' + tx('今すぐ合わせる') + '</button></div><p class="sync-msg rec-empty" data-sync-msg></p></div>' +
      '<div class="rec-panel"><div class="rec-head">' + tx('別の端末の合言葉を入れる') + '</div>' +
      '<form class="name-form" data-key-form><span class="nf-row"><input name="key" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="' + tx('別の端末の合言葉') + '" placeholder="' + tx('例: matsu-kaze-tsuru-482') + '"><button type="submit" class="btn">' + tx('この合言葉にする') + '</button></span>' +
      '<small class="nf-msg">' + tx('この端末の記録も、その合言葉の記録に合わさる。') + '</small></form></div>' +
      '<div class="rec-panel"><div class="rec-head">' + tx('ランキングの名前') + '</div>' +
      '<form class="name-form" data-name-form="records"><span class="nf-row"><input name="name" maxlength="12" autocomplete="nickname" aria-label="' + tx('ランキングの名前') + '" value="' + esc(st.name || '') + '" placeholder="' + tx('名前（12 文字まで）') + '"><button type="submit" class="btn">' + tx(st.name ? '変える' : '付ける') + '</button></span>' +
      '<small class="nf-msg">' + tx(st.name ? '遊ぶたびに、その回の記録がランキングに載る。' : '名前を付けると、遊ぶたびにランキングに載る。') + '</small></form></div>' +
      confSharePanel(st);
  }

  // 公開した .tmux.conf: whether the file is up, and the way to take it down.
  function confSharePanel(st) {
    if (!st.name) return '';
    return '<div class="rec-panel" data-conf-panel><div class="rec-head">' + tx('公開した .tmux.conf') + '</div>' +
      (st.confShared
        ? '<p class="rec-empty">' + tx('公開中。ランキングの「自分の設定」から誰でも読める。') + '</p><div class="cta"><button type="button" class="btn" data-conf-unshare>' + tx('公開をやめる') + '</button></div>'
        : '<p class="rec-empty">' + (S.confText ? tx('いまのキー設定を公開すると、ランキングの「自分の設定」から読めるようになる。') : tx('まだ公開していない。キー設定を貼って遊ぶと公開できる。')) + '</p>' +
          (S.confText ? '<div class="cta"><button type="button" class="btn" data-conf-share="1">' + tx('いまの設定を公開する') + '</button></div>' : '')) +
      '<p class="sync-msg rec-empty" data-conf-msg></p></div>';
  }

  // The published-file sheet: the exact text and the warning, before anything leaves.
  function openConfDialog() {
    var d = $('#conf-dialog');
    if (!d || !S.confText) return;
    $('#conf-preview').textContent = S.confText;
    $('#conf-size').textContent = tx('{0} 行 ・ {1} バイト（8 KB まで）', S.confText.split('\n').length, utf8Len(S.confText));
    $('#conf-dialog-msg').textContent = '';
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }

  function utf8Len(t) {
    return typeof TextEncoder === 'function' ? new TextEncoder().encode(t).length : unescape(encodeURIComponent(t)).length;
  }

  function closeConfDialog() {
    var d = $('#conf-dialog');
    if (!d) return;
    if (typeof d.close === 'function' && d.open) d.close(); else d.removeAttribute('open');
  }

  function publishConf() {
    var msg = $('#conf-dialog-msg');
    if (utf8Len(S.confText) > 8 * 1024) { msg.textContent = tx('8 KB を超えている。短くしてから。'); return; }
    msg.textContent = tx('送っている……');
    NET.setConf(S.confText).then(function () {
      closeConfDialog();
      if (S.screen === 'result') renderResult();
      if (S.screen === 'records') renderRecords();
    }).catch(function (e) {
      msg.textContent = tx(e && e.status === 413 ? '8 KB を超えている。短くしてから。' : e && e.status === 400 ? '先にランキングの名前を付ける。' : 'つながらなかった。あとでもう一度。');
    });
  }

  // Another player's published file, read-only, with the way to play on it.
  function renderConfView(body) {
    var v = S.confView;
    if (!v) { S.recTab = 'board'; renderRecords(); return; }
    body.innerHTML = '<div class="rec-panel"><div class="rec-head">' + tx('{0} の .tmux.conf', esc(v.name)) + '</div>' +
      (v.text == null ? '<p class="rec-empty">' + tx(v.error || '読み込み中……') + '</p>'
        : '<pre class="conf-view">' + esc(v.text) + '</pre>' +
          '<div class="cta"><button type="button" class="btn primary" data-conf-use="1">' + tx('この設定で遊ぶ') + '</button>' +
          '<button type="button" class="btn ghost" data-rec-tab="board">' + tx('ランキングへ戻る') + '</button></div>') + '</div>';
  }

  function openConfOf(name) {
    S.confView = { name: name, text: null };
    S.recTab = 'conf';
    renderRecords();
    NET.conf(name).then(function (j) {
      if (!S.confView || S.confView.name !== name) return;
      S.confView.text = String(j.text || '');
      if (S.screen === 'records' && S.recTab === 'conf') renderRecords();
    }).catch(function (e) {
      if (!S.confView || S.confView.name !== name) return;
      S.confView.error = e && e.status === 404 ? tx('この設定はもう公開されていない。') : tx('つながらなかった。通信できるときにもう一度。');
      if (S.screen === 'records' && S.recTab === 'conf') renderRecords();
    });
  }

  // ---- この回を見る from the board ----------------------------------------
  // The player's best of the span with its keys: listed per question, and
  // played again when its bindings are known (the defaults, or a published
  // file).
  function openWatch(name, course, span, id) {
    S.watch = { name: name, course: course, run: null, id: id || null };
    S.recTab = 'watch';
    renderRecords();
    NET.ghost(course, span, { name: name }).then(function (g) {
      if (!S.watch || S.watch.name !== name) return;
      takeWatch(g, name, course);
    }).catch(function () {
      if (!S.watch || S.watch.name !== name) return;
      S.watch.error = tx('つながらなかった。通信できるときにもう一度。');
      if (S.screen === 'records' && S.recTab === 'watch') renderRecords();
    });
  }

  // The server's run (a ghost or a replay by id) as the watch view and the
  // replay take it; the published file comes after, when there is one.
  function takeWatch(g, name, course) {
    var redraw = function () { if (S.screen === 'records' && S.recTab === 'watch') renderRecords(); };
    if (!g || !g.keys) { S.watch.error = tx('この回のキーの記録はない。'); redraw(); return null; }
    var c = REC.courseOf(course);
    var types = questionsFor(c, g.day, false);
    var run = {
      course: course, day: g.day, time: g.time, conf: g.conf || g.own ? 1 : 0, prefix: null, keys: g.keys.keys.length, n: types.length,
      qs: types.map(function (t, i) { return { t: t, s: +((g.splits[i] || 0)).toFixed(2), k: g.keys.keys.filter(function (e) { return inQuestion(g.keys.q, e[0]) === i; }).length }; }),
      klog: g.keys, shared: !!g.conf
    };
    S.watch.run = run;
    redraw();
    if (g.conf) NET.conf(name).then(function (j) {
      if (!S.watch || S.watch.name !== name) return;
      S.watch.confText = String(j.text || '');
      // From a link: the replay starts as soon as the file is here.
      if (S.watch.link && !S.replay && S.screen !== 'game' && replayable(run, S.watch.confText)) { startReplay(run, name, S.watch.confText, 'title'); return; }
      redraw();
    }).catch(function () {});
    return run;
  }

  // ?watch=<run id>: someone's link to a ranked run. Fetched, then played
  // on the house at once when its keys are known, else listed. Only from the
  // site or a local test server, as the boards are.
  function openWatchLink(id) {
    if (!NET || !/^https?:$/.test(location.protocol) && !/^http:\/\/(localhost|127\.0\.0\.1)|-staging\./.test(NET.API)) return;
    S.watch = { name: '', course: null, run: null, id: id, link: true };
    NET.replay(id).then(function (g) {
      if (!S.watch || S.watch.id !== id || !REC.courseOf(g.course)) return;
      S.watch.name = g.name; S.watch.course = g.course;
      var run = takeWatch(g, g.name, g.course);
      if (!run) { S.recTab = 'watch'; openRecords(g.course, 'title'); return; }
      if (replayable(run, null) && startReplay(run, g.name, undefined, 'title')) return;
      // The file is needed first (an own-config run): the list, with 再生する once it is here.
      S.recTab = 'watch';
      openRecords(g.course, 'title');
    }).catch(function (e) {
      S.watch = null;
      if (S.screen === 'title') banner(e && e.status === 404 ? 'その回は見つからない' : 'つながらなかった', 'go');
    });
  }

  function inQuestion(q, ms) {
    var i = 0;
    while (i + 1 < q.length && q[i + 1] <= ms) i++;
    return i;
  }

  // The keys of a run per question, with when each came (seconds into the
  // question), against the fewest when known.
  function keyListHTML(run) {
    var q = run.klog.q, ks = run.klog.keys;
    return '<table class="rec-table keylist"><thead><tr><th>#</th><th>' + tx('問題') + '</th><th>' + tx('秒') + '</th><th>' + tx('キー') + '</th></tr></thead><tbody>' +
      run.qs.map(function (x, i) {
        var mine = ks.filter(function (e) { return inQuestion(q, e[0]) === i; });
        var keys = mine.map(function (e) { return '<kbd title="' + ((e[0] - q[i]) / 1000).toFixed(2) + 's">' + esc(e[1]) + '</kbd>'; }).join('');
        var n = typeof x.p === 'number' ? tx('{0} / 標準 {1}', mine.length, x.p) : String(mine.length);
        return '<tr' + (typeof x.p === 'number' && mine.length > x.p ? ' class="over"' : '') + '><td class="c-n">' + (i + 1) + '</td><td>' + esc(typeName(x.t)) + '</td><td class="r-time">' + (typeof x.s === 'number' ? x.s.toFixed(1) : '—') + '</td><td class="k-keys">' + keys + ' <small>' + n + '</small></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderWatch(body) {
    var w = S.watch;
    if (!w) { S.recTab = 'board'; renderRecords(); return; }
    var run = w.run;
    var can = run ? replayable(run, w.confText) : null;
    var html = '<div class="rec-panel"><div class="rec-head">' + tx('{0} の回 ・ {1}', esc(w.name), esc(REC.courseOf(w.course).title)) + '</div>';
    if (!run) html += '<p class="rec-empty">' + esc(w.error || tx('読み込み中……')) + '</p>';
    else {
      html += '<p class="rec-empty">' + tx('{0}秒 ・ 押したキー {1}', run.time.toFixed(1), run.keys) + (run.conf ? tx(' ・ 自分の設定') : '') + '</p>' +
        (w.id ? watchLinkHTML(w.id) : '') +
        '<div class="cta">' + (can ? '<button type="button" class="btn primary" data-replay-watch="1">' + tx('再生する') + '</button>'
          : '<span class="rec-empty">' + tx(run.mine ? 'この回のキー設定と今の設定が違うので、再生はできない（キーの一覧だけ）。' : run.conf && !run.shared ? 'この人の設定は公開されていないので、再生はできない（キーの一覧だけ）。' : '再生はできない（キーの一覧だけ）。') + '</span>') +
        '<button type="button" class="btn ghost" data-rec-tab="board">' + tx('ランキングへ戻る') + '</button></div>' +
        keyListHTML(run);
    }
    body.innerHTML = html + '</div>';
  }

  function syncNow(msgEl) {
    if (!NET) return;
    if (msgEl) msgEl.textContent = tx('合わせている……');
    NET.sync().then(function (res) {
      renderRecords();
      var m = $('[data-sync-msg]');
      if (m) m.textContent = res.added ? tx('{0} 回分の記録が加わった。', res.added) : tx('合わせた。この端末の記録はそろっている。');
    }).catch(function () {
      var m = $('[data-sync-msg]');
      if (m) m.textContent = tx('つながらなかった。通信できるときにもう一度。');
    });
  }

  // ---- 記録: the run history ------------------------------------------------

  function openRecords(course, from) {
    S.recordsFrom = from || S.screen;
    S.recCourse = course || S.recCourse || lastCourse(REC.load());
    showScreen('records');
  }

  // Straight to the rankings, from the title: today's board of the course
  // you played last (入門 for a first visit).
  // While few people play, the all-time board is the one with names on it.
  var BOARD_SPAN = 'all';

  function openBoard() {
    S.recTab = 'board'; S.boardSpan = BOARD_SPAN;
    openRecords(null, 'title');
  }

  function recDate(at) {
    var d = new Date(at);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // Up to 20 latest runs as bars: vermilion for a record, a dotted line at
  // the best and a faint one at お手本. The SVG stretches to the box; the
  // labels are HTML on top so their text keeps its size.
  function recChart(runs, c, best) {
    var list = runs.slice(0, 20).reverse();
    var W = 200, H = 100;
    var par = LV.par(c);
    var max = Math.max(par, Math.max.apply(null, list.map(function (r) { return r.time; }))) * 1.12;
    var y = function (t) { return +(H - t / max * H).toFixed(2); };
    var svg = '<svg class="rec-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true">';
    list.forEach(function (r, i) {
      svg += '<rect class="bar' + (r.rec ? ' rec' : '') + (i === list.length - 1 ? ' now' : '') + '" x="' + (i * 10 + 1.5) + '" y="' + y(r.time) + '" width="7" height="' + (H - y(r.time)) + '"><title>' +
        esc(tx('{0} {1}秒 ミス {2}', recDate(r.at), r.time.toFixed(1), r.misses)) + '</title></rect>';
    });
    svg += '<line class="par" x1="0" x2="' + W + '" y1="' + y(par) + '" y2="' + y(par) + '" vector-effect="non-scaling-stroke"/>';
    if (best != null) svg += '<line class="best" x1="0" x2="' + W + '" y1="' + y(best) + '" y2="' + y(best) + '" vector-effect="non-scaling-stroke"/>';
    svg += '</svg>';
    var lbl = '<span class="lbl par-l" style="top:' + y(par) + '%">' + tx('お手本 {0}秒', par) + '</span>';
    if (best != null) lbl += '<span class="lbl best-l" style="top:' + y(best) + '%">' + tx('自己ベスト {0}秒', best.toFixed(1)) + '</span>';
    return '<div id="rec-chart" class="rec-chart" role="img" aria-label="' + tx('タイムの移り変わり') + '">' + svg + lbl + '</div>';
  }

  // Every day's best since the first run: the long view of getting faster.
  // A line on a fixed grid; the first and the latest day are labelled.
  function dailyChart(days, c) {
    if (days.length < 2) return '';
    var W = 300, H = 100, par = LV.par(c);
    var max = Math.max(par, Math.max.apply(null, days.map(function (d) { return d.time; }))) * 1.1;
    var min = Math.min(par, Math.min.apply(null, days.map(function (d) { return d.time; }))) * 0.85;
    var x = function (i) { return +(days.length === 1 ? W / 2 : i / (days.length - 1) * W).toFixed(2); };
    var y = function (t) { return +(H - (t - min) / (max - min) * H).toFixed(2); };
    var pts = days.map(function (d, i) { return x(i) + ',' + y(d.time); }).join(' ');
    var first = days[0], last = days[days.length - 1];
    var gain = first.time - last.time;
    var svg = '<svg class="rec-svg daily" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<line class="par" x1="0" x2="' + W + '" y1="' + y(par) + '" y2="' + y(par) + '" vector-effect="non-scaling-stroke"/>' +
      '<polyline class="line" points="' + pts + '" vector-effect="non-scaling-stroke"/>' +
      '</svg>' +
      // Dots as HTML so the stretched SVG does not squash them.
      days.map(function (d, i) { return '<i class="dot" style="left:' + (x(i) / W * 100) + '%;top:' + y(d.time) + '%" title="' + esc(d.day + ' ' + tx('{0}秒', d.time.toFixed(1))) + '"></i>'; }).join('');
    return '<div class="rec-panel"><div class="rec-head">' + tx('日ごとのベスト（全期間 {0} 日）', days.length) + '</div>' +
      '<div class="rec-chart daily-chart">' + svg + '<span class="lbl par-l" style="top:' + y(par) + '%">' + tx('お手本 {0}秒', par) + '</span></div>' +
      '<div class="daily-l"><span>' + esc(first.day.slice(5).replace('-', '/')) + ' ' + tx('{0}秒', first.time.toFixed(1)) + '</span>' +
      '<span>' + (gain > 0 ? '<b>' + tx('−{0} 秒', gain.toFixed(1)) + '</b>' : '') + '</span>' +
      '<span>' + esc(last.day.slice(5).replace('-', '/')) + ' ' + tx('{0}秒', last.time.toFixed(1)) + '</span></div></div>';
  }

  function renderRecords() {
    var id = S.recCourse;
    var c = REC.courseOf(id);
    $$('#records-screen [data-rec-course]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.recCourse === id ? 'true' : 'false'); });
    var tab = S.recTab || 'growth';
    // 今日の達人 has a board and nothing else.
    if (c.daily && tab === 'growth') tab = S.recTab = 'board';
    $$('#records-screen .rec-tab [data-rec-tab]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.recTab === tab || (tab === 'conf' || tab === 'watch') && b.dataset.recTab === 'board' ? 'true' : 'false'); });
    // The course row keeps its space on the 引き継ぎ tab: nothing below jumps.
    $('#records-screen .rec-seg').classList.toggle('off', tab === 'sync');
    var body = $('#records-body');
    if (tab === 'board') { renderBoard(body, id); return; }
    if (tab === 'sync') { renderSync(body); return; }
    if (tab === 'conf') { renderConfView(body); return; }
    if (tab === 'watch') { renderWatch(body); return; }
    var st = REC.stats(id);
    if (!st) {
      body.innerHTML = '<div class="rec-log"><p>' + tx('{0}（{1}）の記録は、まだ白紙。', esc(c.title), esc(c.mode)) + '</p><p>' + tx('一度はじめると、ここに上達が描かれていく。') + '</p></div>' +
        '<div class="cta"><button type="button" class="btn primary" data-course="' + id + '">' + tx('{0}をはじめる', esc(c.title)) + '</button></div>' + rankPanel(c, '', null) + menjoPanel() + drillPanel();
      return;
    }
    var gain = st.first.time - st.best;
    var head = st.count === 1
      ? '<p>' + tx('まだ 1 回。もう一度遊ぶと、ここに上達が出る。') + '</p>'
      : '<p>' + tx('はじめて {0} → 自己ベスト {1}', sec(st.first.time), sec(st.best)) + (gain > 0 ? '（<b>' + tx('−{0} 秒', gain.toFixed(1)) + '</b>）' : '') + '</p>';
    var a5 = ao5(st.runs);
    var tiles =
      '<div class="rec-tiles">' +
      '<div class="rec-tile"><small>' + tx('自己ベスト') + '</small><b>' + fmt(st.best) + '</b></div>' +
      '<div class="rec-tile"><small>' + tx('最高の称号') + '</small><b>' + (st.bestRank ? rankHTML(st.bestRank) : '—') + '</b></div>' +
      '<div class="rec-tile"><small>' + tx('挑戦回数') + '</small><b>' + tx('{0} 回', st.count) + '</b></div>' +
      '<div class="rec-tile"><small>' + tx('五回平均') + '</small><b>' + fmt(a5) + '</b></div>' +
      '</div>';
    var chart = '<div class="rec-panel"><div class="rec-head">' + tx('タイムの移り変わり（直近 {0} 回）', Math.min(20, st.count)) + '</div>' + recChart(st.runs, c, st.best) + '</div>' +
      dailyChart(REC.dailyBest(id), c);
    var rows = st.runs.slice(0, 20).map(function (r) {
      var note = r.legacy ? tx('旧記録') : tx('ミス {0}', r.misses) + (r.overs ? tx(' ・ 目安超え {0}', r.overs) : '') + (r.timeouts ? tx(' ・ 時間切れ {0}', r.timeouts) : '');
      var watch = r.klog ? ' <a href="#" class="r-watch" data-replay="' + esc(r.id) + '">' + tx('見る') + '</a>' : '';
      return '<tr class="' + (r.rec ? 'is-rec' : '') + '"><td class="c-n">' + recDate(r.at) + '</td><td class="r-time">' + tx('{0}秒', r.time.toFixed(1)) + watch + '</td><td class="r-note">' + note + '</td><td class="r-rank">' + rankHTML(r.rank) + '</td><td class="r-star">' + (r.rec ? '★' : '') + '</td></tr>';
    }).join('');
    var table = '<div class="rec-panel"><div class="rec-head">' + tx('直近の記録') + '</div><table class="rec-table"><thead><tr><th>' + tx('日付') + '</th><th>' + tx('タイム') + '</th><th class="r-note">' + tx('内訳') + '</th><th>' + tx('称号') + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    body.innerHTML = '<div class="rec-log">' + head + '</div>' + tiles + rankPanel(c, st.bestRank, st.best) + menjoPanel() + chart + weakPanel(id) + drillPanel() + learntPanel() + table;
  }

  // The whole ladder, top to bottom: every title and the time it needs on
  // this course (misses included), the one reached marked, and what the
  // best time still needs for the next.
  function rankPanel(c, mine, best) {
    var n = c.qs.length, mul = c.rankMul || 1;
    var rows = LV.RANKS.map(function (r, i) {
      var t = isFinite(r.max) ? tx('{0} 秒以内', Math.round(r.max * mul * n)) : tx('{0} 秒より遅い', Math.round(LV.RANKS[i - 1].max * mul * n));
      var per = isFinite(r.max) ? tx('{0} 秒', (r.max * mul).toFixed(1)) : '';
      return '<tr class="' + (r.title === mine ? 'is-rec' : '') + '"><td class="r-rank">' + rankHTML(r.title) + '</td><td class="r-time">' + t + '</td><td class="r-note">' + per + '</td><td class="r-star">' + (r.title === mine ? tx('いまここ') : '') + '</td></tr>';
    }).join('');
    var nr = best != null ? LV.nextRank(c, best, null, mine) : null;
    var next = nr ? '<p class="rec-next">' + esc(nr.next ? tx('{0}まで あと {1} 秒（1 問 {2} 秒）', tx(nr.next), nr.gap.toFixed(1), nr.gapQ.toFixed(2)) : tx('最高の称号。')) + '</p>' : '';
    // Not "目安": that word is the per-question time limit elsewhere.
    return '<div class="rec-panel rec-ranks"><div class="rec-head">' + tx('称号の一覧（{0}・{1} 問）', esc(c.title), n) + '</div><table class="rec-table"><thead><tr><th>' + tx('称号') + '</th><th>' + tx('タイム') + '</th><th class="r-note">' + tx('1 問あたり') + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' + next +
      '<p class="rec-empty">' + esc(tx('称号は帯の色: 白帯 → 緑帯 → 茶帯 → 黒帯 → 師範代 → 師範 → 達人 → 名人。一度届いた称号は下がらない。お手本は師範代のタイム。')) + '</p></div>';
  }

  // 免状: every title reached, on which house and from which day.
  function menjoPanel() {
    var list = REC.menjo();
    var rows = list.map(function (m) {
      return '<tr><td class="r-rank">' + rankHTML(m.title) + '</td><td>' + esc(REC.courseOf(m.course).title) + '</td><td class="c-n">' + esc(menjoDate(m.day)) + '</td></tr>';
    }).join('');
    return '<div class="rec-panel rec-menjo"><div class="rec-head">' + tx('免状') + '</div>' +
      (rows ? '<table class="rec-table"><thead><tr><th>' + tx('称号') + '</th><th>' + tx('コース') + '</th><th>' + tx('届いた日') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="rec-empty">' + tx('まだ免状はない。一度解き終わると、届いた称号の免状がここに並ぶ。') + '</p>') + '</div>';
  }

  function weakPanel(id) {
    var w = REC.weakness(id, 10);
    if (!w) return '<div class="rec-panel rec-weak"><div class="rec-head">' + tx('目安を超えがちな問題') + '</div><p class="rec-empty">' + tx('2 回遊ぶと、苦手な問題が見えてくる。') + '</p></div>';
    var row = function (e) {
      var q = Q[e.type];
      var keys = [];
      q.show.forEach(function (a) { (LV.KEYS[a] || []).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
      return '<li><span class="w-text">' + esc(tx(q.text)) + '</span>' +
        '<span class="w-num">' + tx('平均 {0}秒 ・ ミス {1}%', e.avg.toFixed(1), Math.round(e.missRate * 100)) + (e.overs ? tx(' ・ 目安超え {0}', e.overs) : '') + '</span>' +
        '<span class="w-keys"><kbd class="pfx">' + esc(prefixLabel()) + '</kbd><span class="arr">→</span>' + keycaps(keys) + '</span>' +
        // The tip where it is wanted: on the question that keeps running over.
        (tipsOf(e.type).length ? '<span class="w-tip">' + esc(tipsOf(e.type)[0]) + '</span>' : '') + '</li>';
    };
    return '<div class="rec-panel rec-weak"><div class="rec-head">' + tx('目安を超えがちな問題（直近 {0} 回）', w.runs) + '</div>' +
      (w.weak.length ? '<ol class="weak-list">' + w.weak.map(row).join('') + '</ol>' : '<p class="rec-empty">' + tx('目安を超えがちな問題はない。') + '</p>') +
      (w.strong ? '<p class="w-strong">' + tx('得意: ') + '<b>' + esc(tx(Q[w.strong.type].text)) + '</b> ' + tx('平均 {0}秒', w.strong.avg.toFixed(1)) + '</p>' : '') +
      '</div>';
  }

  // 稽古: the longest run from memory so far, and the way in.
  function drillPanel() {
    var runs = REC.runsOf('keiko').filter(function (r) { return r.drill; });
    var best = REC.drillBest();
    return '<div class="rec-panel rec-drill"><div class="rec-head">' + tx('稽古（手順なしで思い出す）') + '</div>' +
      '<p class="rec-empty">' + esc(runs.length ? tx('手順なし・ミスなしで続けて解けた最長 {0} 問 ・ {1} 回', best, runs.length) : tx('まだ稽古していない。苦手な問題が多めに出る。')) + '</p>' +
      '<div class="cta"><button type="button" class="btn" data-course="keiko">' + tx('稽古する') + '</button></div></div>';
  }

  // Which question types are learnt (手順 folded) and how close the rest are.
  function learntPanel() {
    var l = REC.learnt();
    var types = Object.keys(TYPE_NAMES).filter(function (t) { return l[t]; });
    if (!types.length) return '';
    var done = types.filter(function (t) { return l[t].learnt; });
    return '<div class="rec-panel learnt-list"><div class="rec-head">' + tx('覚えた問題 {0} ／ {1}', done.length, types.length) + '</div>' +
      '<p class="rec-empty">' + esc(tx('{0} 回続けて速く解けた問題は「覚えた」になり、手順が隠れる。', LV.LEARNT_AFTER)) + '</p><ul>' +
      types.map(function (t) {
        var e = l[t];
        return '<li class="' + (e.learnt ? 'ok' : '') + '">' + esc(typeName(t)) + '<small>' + (e.learnt ? tx('覚えた') : tx('あと {0}', LV.LEARNT_AFTER - e.streak)) + '</small></li>';
      }).join('') + '</ul></div>';
  }

  // The sink keeps the focus during play: on phones it raises the soft
  // keyboard, and on desktops a focused text field makes key-grabbing
  // extensions (Vimium and the like) step aside and pass every key through.
  function focusSink() {
    var sink = $('#sink');
    if (sink && S.screen === 'game' && document.activeElement !== sink) sink.focus({ preventScroll: true });
  }

  // ---- the player's .tmux.conf ---------------------------------------------

  function applyConf(text, save) {
    var c = CF.parse(text);
    S.confText = text;
    S.conf = c.custom ? c : null;
    if (save) store.save({ conf: text, nav: null });
    renderConfReport(c, text);
    syncBody();
    if (S.screen === 'title') renderTitle();
  }

  function renderConfReport(c, text) {
    var el = $('#conf-report');
    if (!el) return;
    if (!String(text || '').trim()) { el.innerHTML = ''; return; }
    var row = function (x, note) { return '<li><code><i class="no">' + x.no + '</i>' + esc(x.line) + '</code><span' + (note === x.why ? ' class="err"' : '') + '>' + esc(note) + '</span></li>'; };
    var html = '';
    html += '<h4>' + tx('使う {0} 行', c.used.length) + (c.custom ? tx('（prefix {0}）', esc(c.prefix.label)) : '') + '</h4>';
    html += c.used.length ? '<ul>' + c.used.map(function (x) { return row(x, x.say); }).join('') + '</ul>' : '<p>' + tx('ゲームで使える行がなかった。既定のキーで遊ぶ。') + '</p>';
    // 未対応: what tmux does and the game cannot (its keys do nothing here);
    // apart from the settings the game has no use for.
    if (c.unsupported.length) {
      html += '<details open><summary class="err">' + tx('未対応 {0} 行（そのキーはゲームでは何も起きない）', c.unsupported.length) + '</summary><ul>' + c.unsupported.map(function (x) { return row(x, x.why); }).join('') + '</ul></details>';
    }
    if (c.skipped.length) {
      html += '<details><summary>' + tx('関係ない {0} 行（見た目などの設定）', c.skipped.length) + '</summary><ul>' + c.skipped.map(function (x) { return row(x, x.why); }).join('') + '</ul></details>';
    }
    el.innerHTML = html;
  }

  // ---- wiring ------------------------------------------------------------

  function init() {
    I18N.apply();
    $$('.lang-toggle').forEach(function (b) {
      b.textContent = EN ? '日本語' : 'EN';
      b.setAttribute('lang', EN ? 'ja' : 'en');
      b.setAttribute('aria-label', EN ? '日本語にする' : 'Switch to English');
      b.addEventListener('click', function () { I18N.set(EN ? 'ja' : 'en'); });
    });
    // A course's name from levels.js (達人 has its own English name).
    $$('[data-course-title]').forEach(function (el) { el.textContent = REC.courseOf(el.dataset.courseTitle).title; });
    var saved = store.load();
    applyTheme(saved.theme === 'dark' || saved.theme === 'light' ? saved.theme : null);
    applySound(saved.sound !== false);
    // The side panel is the detail; the order is in the house.
    S.detail = saved.detail === true;
    if (GHOST_PICKS.some(function (x) { return x[0] === saved.ghost; })) S.ghostPick = saved.ghost;
    // The player's .tmux.conf (the vim-tmux-navigator switch of before
    // becomes the plugin line).
    var ct = typeof saved.conf === 'string' ? saved.conf : saved.nav === 'vim' ? CF.SAMPLE_NAVIGATOR : '';
    $('#conf-text').value = ct;
    applyConf(ct, false);
    $('#conf-apply').addEventListener('click', function () { applyConf($('#conf-text').value, true); });
    $('#conf-sample').addEventListener('click', function () {
      var t = $('#conf-text');
      if (!/vim-tmux-navigator/.test(t.value)) t.value = (t.value && !/\n$/.test(t.value) ? t.value + '\n' : t.value) + CF.SAMPLE_NAVIGATOR;
      applyConf(t.value, true);
    });
    $('#conf-noconfirm').addEventListener('click', function () {
      var t = $('#conf-text');
      if (!/kill-pane\s*$/m.test(t.value)) t.value = (t.value && !/\n$/.test(t.value) ? t.value + '\n' : t.value) + CF.SAMPLE_NOCONFIRM;
      applyConf(t.value, true);
    });
    $('#conf-resize').addEventListener('click', function () {
      var t = $('#conf-text');
      if (!/resize-pane -L 5\s*$/m.test(t.value)) t.value = (t.value && !/\n$/.test(t.value) ? t.value + '\n' : t.value) + CF.SAMPLE_RESIZE;
      applyConf(t.value, true);
    });
    $('#conf-reset').addEventListener('click', function () { $('#conf-text').value = ''; applyConf('', true); });
    $('#cheat').addEventListener('toggle', function () { if (S.free) { store.save({ cheat: $('#cheat').open }); focusSink(); } });
    $('.detail-toggle').addEventListener('click', function () { S.detail = !S.detail; store.save({ detail: S.detail }); syncBody(); if (S.screen === 'game') render(); focusSink(); });

    $$('.theme-toggle').forEach(function (b) { b.addEventListener('click', toggleTheme); });
    $$('.sound-toggle').forEach(function (b) {
      b.addEventListener('click', function () { applySound(!S.sound); store.save({ sound: S.sound }); if (S.sound) music(); });
    });
    document.addEventListener('pointerdown', function () { AU.unlock(); }, true);
    $('#btn-enter').addEventListener('click', function () { startRun($('#btn-enter').dataset.course || 'easy'); });
    $('#btn-records').addEventListener('click', function () { S.recTab = 'growth'; openRecords(null, 'title'); });
    $('#btn-board').addEventListener('click', openBoard);
    $('#btn-keiko').addEventListener('click', function () { startRun('keiko'); });
    $('#btn-free').addEventListener('click', startFree);
    $('#today').addEventListener('click', function (e) { if (e.target.closest('[data-daily]')) startRun('daily'); });
    $('#course-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-course]');
      if (b) startRun(b.dataset.course);
    });
    // The ladder, from the course select: the records of the course picked, at its title list.
    $('#btn-ladder').addEventListener('click', function () {
      S.recTab = 'growth';
      openRecords($('#btn-enter').dataset.course || null, 'title');
      var el = $('#records-body .rec-ranks');
      if (el) el.scrollIntoView();
    });
    $$('.to-title').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (endDrill()) return;
        leaveRun();
        showScreen('title');
      });
    });
    // The 影 to race, picked on the course select or under the board.
    document.addEventListener('click', function (e) {
      var g = e.target.closest('[data-ghost]');
      if (!g) return;
      S.ghostPick = g.dataset.ghost;
      store.save({ ghost: S.ghostPick });
      AU.se('cursor');
      $$('[data-ghost]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.ghost === S.ghostPick ? 'true' : 'false'); });
    });
    // この回を見る: a run of this device played again.
    document.addEventListener('click', function (e) {
      var w = e.target.closest('[data-replay]');
      if (!w) return;
      e.preventDefault();
      var run = REC.runById(w.dataset.replay);
      if (!run) return;
      run.mine = true;
      if (!startReplay(run, tx('自分'), undefined, S.screen)) {
        // Its keys cannot be played here (another file than today's): listed instead.
        S.watch = { name: tx('自分'), course: run.course, run: run, confText: null };
        S.recTab = 'watch';
        if (S.screen !== 'records') openRecords(run.course, S.screen); else renderRecords();
      }
    });
    $('#ghostbar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rp]');
      if (b) { e.preventDefault(); replayControl(b.dataset.rp); }
    });
    $('#ghostbar').addEventListener('pointerdown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
    // The published .tmux.conf: the sheet, then the send.
    document.addEventListener('click', function (e) {
      var cw = e.target.closest('[data-copy-watch]');
      if (cw) {
        var wm = cw.parentNode.querySelector('.watch-msg');
        var saidW = function (t) { if (wm) wm.textContent = tx(t); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cw.dataset.copyWatch).then(function () { saidW('リンクを写した。'); }, function () { saidW('写せなかった。リンクを選んでコピーして。'); });
        else saidW('写せなかった。リンクを選んでコピーして。');
        return;
      }
      if (e.target.closest('[data-conf-share]')) { e.preventDefault(); openConfDialog(); return; }
      if (e.target.closest('#conf-publish')) { publishConf(); return; }
      if (e.target.closest('#conf-cancel')) { closeConfDialog(); return; }
      if (e.target.closest('[data-conf-unshare]')) {
        var m = $('[data-conf-msg]');
        if (m) m.textContent = tx('送っている……');
        NET.setConf('').then(function () { renderRecords(); }).catch(function () { if (m) m.textContent = tx('つながらなかった。あとでもう一度。'); });
      }
    });
    $('#result-screen').addEventListener('click', function (e) {
      if (e.target.closest('[data-share]')) { copyShare(); return; }
      var wr = e.target.closest('[data-watch-run]');
      if (wr) { e.preventDefault(); if (wr.dataset.watchRun) openWatchLink(wr.dataset.watchRun); return; }
      var r = e.target.closest('[data-records]');
      if (r) { S.recTab = 'growth'; openRecords(r.dataset.records || null, 'result'); return; }
      var bd = e.target.closest('[data-board]');
      if (bd) { e.preventDefault(); S.recTab = 'board'; S.boardSpan = BOARD_SPAN; openRecords(bd.dataset.board, 'result'); return; }
      if (e.target.closest('[data-free]')) { startFree(); return; }
      var b = e.target.closest('[data-course]');
      if (b) { startRun(b.dataset.course, { shuffle: !!b.dataset.shuffle, n: Number(b.dataset.n) || 0 }); return; }
      if (e.target.closest('[data-title]')) showScreen('title');
    });
    $('#records-screen').addEventListener('click', function (e) {
      var t = e.target.closest('[data-rec-course]');
      if (t) { S.recCourse = t.dataset.recCourse; AU.se('cursor'); renderRecords(); return; }
      var tb = e.target.closest('[data-rec-tab]');
      if (tb) { S.recTab = tb.dataset.recTab; AU.se('cursor'); renderRecords(); if (S.recTab === 'sync' && NET && NET.state().key) syncNow(); return; }
      var sp = e.target.closest('[data-span]');
      if (sp) { S.boardSpan = sp.dataset.span; AU.se('cursor'); renderRecords(); return; }
      var co = e.target.closest('[data-conf-of]');
      if (co) { e.preventDefault(); openConfOf(co.dataset.confOf); return; }
      var wt = e.target.closest('[data-watch]');
      if (wt) { e.preventDefault(); openWatch(wt.dataset.watch, S.recCourse, S.boardSpan || BOARD_SPAN, wt.dataset.watchId); return; }
      if (e.target.closest('[data-replay-watch]')) {
        var w = S.watch;
        if (w && w.run) startReplay(w.run, w.name, w.confText, 'records');
        return;
      }
      if (e.target.closest('[data-conf-use]')) {
        var v = S.confView;
        if (!v || v.text == null) return;
        if (!window.confirm(tx('いまのキー設定を {0} の設定に置き換える？（キー設定の欄で戻せる）', v.name))) return;
        $('#conf-text').value = v.text;
        applyConf(v.text, true);
        showScreen('title');
        var box = $('#conf-box');
        if (box) box.open = true;
        return;
      }
      if (e.target.closest('[data-sync-now]')) { syncNow($('[data-sync-msg]')); return; }
      if (e.target.closest('[data-copy-key]')) {
        var k = NET && NET.state().key;
        var done = function () { var m = $('[data-sync-msg]'); if (m) m.textContent = tx('合言葉を写した。'); };
        if (k && navigator.clipboard) navigator.clipboard.writeText(k).then(done, function () {});
        return;
      }
      var b = e.target.closest('[data-course]');
      if (b) { startRun(b.dataset.course); return; }
      if (e.target.closest('#btn-records-back')) { showScreen(S.recordsFrom === 'result' && S.result ? 'result' : 'title'); return; }
      if (e.target.closest('#btn-records-clear')) {
        var linked = NET && NET.state().key;
        if (!window.confirm(tx(linked ? 'この端末の記録をすべて消して、合言葉も外す？（合言葉の側の記録は残る）' : '記録の記録をすべて消す？'))) return;
        REC.clearArena();
        if (linked) NET.forget();
        renderRecords();
      }
    });

    // The name and 合言葉 forms on the result and 記録 screens.
    document.addEventListener('submit', function (e) {
      var f = e.target;
      if (f.matches('[data-name-form]')) { e.preventDefault(); submitName(f); }
      if (f.matches('[data-key-form]')) {
        e.preventDefault();
        var msg = f.querySelector('.nf-msg');
        msg.textContent = tx('合わせている……');
        NET.useKey(f.querySelector('input').value).then(function (res) {
          renderRecords();
          var m = $('[data-sync-msg]');
          if (m) m.textContent = tx('合言葉を切り替えた。') + (res.added ? tx('{0} 回分の記録が加わった。', res.added) : '');
        }).catch(function (err) {
          msg.textContent = tx(err && err.status === 404 ? 'その合言葉は見つからない。綴りを確かめて。' :
            err && err.message === 'bad key' ? '合言葉の形が違う（例: matsu-kaze-tsuru-482）。' : 'つながらなかった。あとでもう一度。');
        });
      }
    });
    document.addEventListener('keydown', onKeyDown);
    var sink = $('#sink');
    sink.addEventListener('input', onSinkInput);
    sink.addEventListener('compositionstart', function () { S.composing = true; imeNote(); });
    sink.addEventListener('compositionend', function () { S.composing = false; sink.value = ''; });
    $('#term').addEventListener('pointerdown', function () { focusSink(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) pauseRun(); });
    window.addEventListener('pagehide', function () { if (S.run && S.run.phase !== 'done') count('quit', S.run.i); });
    count('visit');
    window.addEventListener('blur', pauseRun);
    $('#pause').addEventListener('pointerdown', function (e) { e.preventDefault(); resumeRun(); });
    // Vimium's Esc, a click on a key button: take the focus straight back.
    // Not from the buttons round the house (やめる, the top bar): a keyboard
    // user who got there must be able to press them.
    $('#sink').addEventListener('blur', function () {
      setTimeout(function () {
        var a = document.activeElement;
        if (a && a.closest && a.closest('.game-foot, .topbar')) return;
        focusSink();
      }, 0);
    });
    $('#keybar').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.type) { $('#sink').focus(); return; }
      if (b.dataset.quit) { if (!endDrill()) { leaveRun(); showScreen('title'); } return; }
      // A key the game did not take changed nothing; a taken one drew already.
      if (!handleKey(JSON.parse(b.dataset.k))) render();
    });
    $('#keybar').addEventListener('pointerdown', function (e) {
      // Buttons must not take focus away from the sink on phones.
      if (e.target.closest('button') && !e.target.closest('button').dataset.type) e.preventDefault();
    });

    window.addEventListener('resize', function () { if (S.screen === 'game') render(); });
    setInterval(function () { if (S.screen === 'game' && !S.confirm && !S.prompt && !S.message) renderStatus(); }, 30000);

    showScreen('title');
    // Someone's link to a run: straight to the replay.
    try {
      var watchId = new URLSearchParams(window.location.search).get('watch');
      if (watchId && /^[\w-]{1,40}$/.test(watchId)) openWatchLink(watchId);
    } catch (e) { /* no URLSearchParams: no link */ }

    // A read-only view for the tests. Playing still goes through the keyboard.
    window.tmuxDa = {
      records: function () { return JSON.parse(JSON.stringify(REC.load())); },
      drillTypes: function () { return drillTypes(); },
      state: function () {
        var win = S.session ? T.activeWindow(S.session) : null;
        var ap = win ? T.activePane(win) : null;
        var b = S.run;
        return {
          screen: S.screen, prefix: S.prefix,
          armed: S.armed, detached: S.detached,
          session: S.session ? S.session.name : null,
          sessions: S.sessions.map(function (s) { return s.name; }),
          picker: S.picker && !S.picker.kind ? S.picker.idx : null,
          house: S.houseAt || null,
          windows: S.session ? S.session.windows.map(function (w) { return { index: w.index, name: w.name, active: w.id === S.session.active, panes: T.panesOf(w).length, zoomed: w.zoomed }; }) : [],
          activeWindow: win ? win.name : null,
          activeIndex: win ? win.index : null,
          layout: win ? win.layoutName : null,
          activePane: ap ? ap.id : null,
          panes: win ? T.panesOf(win).map(function (p) { return p.id; }) : [],
          copyMode: ap ? ap.mode === 'copy' : false,
          view: ap && ap.mode === 'view' ? { top: ap.view.top, lines: ap.view.lines.slice() } : null,
          free: S.free, confirm: S.confirm ? S.confirm.text : null, message: S.message,
          copyAt: ap && ap.mode === 'copy' ? { ln: ap.cy, col: ap.cx, sel: ap.sel == null ? null : [ap.sel, ap.selx], lines: ap.lines.length } : null,
          input: ap ? ap.input : null,
          cursor: ap ? (ap.cur == null ? ap.input.length : ap.cur) : null,
          promptValue: S.prompt ? S.prompt.value : null,
          clipboard: S.clipboard,
          run: b ? {
            course: b.course.id, phase: b.phase, i: b.i, n: b.qs.length, type: b.type, misses: b.misses,
            stage: b.stage, overs: b.overs, guides: b.guides, limit: b.limit,
            shuffled: b.shuffled, pauses: b.pauses, paused: b.paused, first: !!b.first, blind: !!b.blind,
            drill: !!b.course.drill, target: b.target, peek: !!b.peek, streak: b.streak || 0,
            order: b.q ? qText(b) : null,
            qs: b.qs.slice(), day: b.day,
            folded: b.q && b.phase === 'play' ? folded(b) : false,
            goals: b.q && b.phase === 'play' ? goalMarks().length : 0,
            goal: S.qGoal,
            note: (S.qNote || []).slice(),
            next: b.q && b.phase === 'play' ? guideMove(b) : null,
            par: b.qlog && b.qlog[b.i] ? b.qlog[b.i].p : null,
            route: b.route ? b.route.slice() : null
          } : null,
          result: S.result,
          recCourse: S.screen === 'records' ? S.recCourse : null,
          recTab: S.screen === 'records' ? S.recTab : null,
          ghostPick: S.ghostPick,
          ghost: b && b.ghost ? { name: b.ghost.name, time: b.ghost.time, today: !!b.ghost.today, kind: b.ghost.kind || null, keys: b.ghost.keys ? b.ghost.keys.keys.length : 0 } : null,
          klog: b && b.klog ? { keys: b.klog.keys.length, q: b.klog.q.slice() } : null,
          replay: S.replay ? { legacy: S.legacy, who: S.replay.who, i: S.replay.i, n: S.replay.keys.length, t: Math.round(S.replay.t), speed: S.replay.speed, playing: S.replay.playing, lost: S.replay.lost, done: S.replay.done } : null,
          watch: S.watch ? { name: S.watch.name, id: S.watch.id || null, run: !!S.watch.run, error: S.watch.error || null } : null,
          detail: S.detail, conf: S.conf ? { prefix: S.conf.prefix.label, binds: S.conf.binds.length, navigator: S.conf.navigator, modeKeys: S.conf.modeKeys, statusTop: S.conf.statusTop } : null,
          cols: S.cols, rows: S.rows
        };
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
