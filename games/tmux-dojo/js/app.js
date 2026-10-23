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
    conf: null             // what of it the game uses (conf.js); null: the defaults
  };

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var CF = ADV.conf;
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
        pane.lines.push(tx('使えるコマンド: ls  echo  cat  pwd  clear  exit  tmux  help'));
        pane.lines.push(tx('tmux の操作は {0} を押して離してからキーを押す。押すキーは画面の手順に出ている', prefixLabel()));
        break;
      case 'ls':
        pane.lines.push('kakejiku.txt  makimono.txt  tokonoma/');
        break;
      case 'pwd':
        pane.lines.push('/home/dojo/' + (pane.name || 'ma'));
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
        else if (!argv[1] || /^(a|attach|attach-session|new|new-session)$/.test(argv[1])) {
          pane.lines.push('sessions should be nested with care, unset $TMUX to force');
          pane.lines.push({ html: '<span class="sh-dim">' + esc(tx('（もう tmux の中にいる。デタッチは {0} → {1}）', prefixLabel(), LV.HINTS.detach)) + '</span>' });
        } else pane.lines.push('usage: tmux [attach|ls]');
        break;
      default:
        pane.lines.push('zsh: command not found: ' + cmd);
    }
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
    $('#term').classList.add('powering-up');
    setTimeout(function () { $('#term').classList.remove('powering-up'); }, reduceMotion ? 0 : 900);
  }

  // ---- sessions ------------------------------------------------------------

  function makeSession(name) {
    var s = T.createSession({ name: name, baseIndex: S.conf ? S.conf.baseIndex : 0, paneBaseIndex: S.conf ? S.conf.paneBaseIndex : 0 });
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

  function switchSession(s) {
    if (!s || s === S.session) return false;
    S.session.attached = false;
    S.lastSession = S.session;
    S.session = s;
    s.attached = true;
    return true;
  }

  function freshName() {
    var n = S.sessions.length;
    while (sessionByName(String(n))) n++;
    return String(n);
  }

  function newSession() {
    S.sessions = [];
    S.lastSession = null;
    S.session = makeSession('dojo');
    S.session.attached = true;
    S.detached = false;
    S.armed = false;
    S.confirm = null;
    S.prompt = null;
    S.picker = null;
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
    if (S.run && S.run.phase === 'clear' && !isModifierOnly(k.key)) afterClear();
    if (S.run && S.run.phase !== 'play') return !isModifierOnly(k.key);
    if (isModifierOnly(k.key)) return false;
    S.lastAction = null;
    S.lastKey = k;
    var consumed = handleGameKey(k);
    if (consumed) {
      if (S.run) S.run.keys += 1;
      if (S.lastAction && S.lastAction !== 'unbound' && S.lastAction !== 'brief') AU.se('cmd');
      render();
      runTick();
    }
    return consumed;
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
      message(tx('tmux のコピーは tmux の中にある。{0} → ] で貼る', prefixLabel()));
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
        // Prefix twice: send-prefix. The shell gets the key itself, so C-b
        // (or C-a) still moves the cursor, as in a real tmux.
        S.armed = false;
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
    if (Date.now() < S.graceUntil && repeatBinding(k)) {
      S.graceUntil = Date.now() + 500;
      return true;
    }
    S.graceUntil = 0;

    if (Date.now() < S.repeatUntil) {
      var rp = repeatBinding(k);
      if (rp && rp.bind) return runBinding(rp.bind, win, pane);
      if (rp) { resize(win, pane, rp); armRepeat(); S.lastAction = 'resize'; return true; }
      S.repeatUntil = 0;
    }

    if (pane.mode === 'copy') return copyModeKey(k, pane);

    // Esc twice in a row with nothing open: back to the title (the mouse-free
    // way to やめる).
    if (k.key === 'Escape') {
      var now = Date.now();
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
    return editLine(pane, k, function (line) { runPaneCommand(pane, line); });
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
    if (a.run === 'send-prefix') { if (pane.mode !== 'copy') lineEdit(pane, 'input', prefixEvent()); S.lastAction = 'brief'; return true; }
    if (a.run === 'clear') { if (pane.mode !== 'copy') pane.lines.push({ clear: true }); S.lastAction = 'brief'; return true; }
    if (a.run === 'noop') { message('source-file: ゲームでは何も起きない'); S.lastAction = 'brief'; return true; }
    if (a.resize) {
      resize(win, pane, { dir: a.resize, n: a.n });
      S.lastAction = 'resize';
    } else {
      prefixedKey({ key: a.key, code: /^[0-9]$/.test(a.key) ? 'Digit' + a.key : undefined, ctrl: !!a.ctrl, alt: false, shift: false, meta: false }, win, pane);
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
    // Ctrl still held from the prefix on an arrow the guide wants plain:
    // not a 1-cell resize, and not a miss. Said instead.
    if (rz && k.ctrl && !k.alt && guideWants(ARROWS[rz.dir])) {
      message(tx('Ctrl を離してから {0} を押す（Ctrl+矢印は大きさを変える）', ARROWS[rz.dir]));
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

    // Alt+1..5: select-layout (tmux). e.code survives Option's character remap on a Mac.
    if (k.alt && !k.ctrl && /^Digit[1-5]$/.test(k.code || '')) {
      T.applyLayout(win, T.LAYOUTS[Number(k.code.slice(5)) - 1]);
      S.lastAction = 'layout';
      return true;
    }
    if (k.ctrl && !k.alt && key.toLowerCase() === 'o') { T.rotateWindow(win); S.lastAction = 'swap'; return true; }
    // Ctrl still held from the prefix: Ctrl+z is not z. Said, not counted.
    if (k.ctrl && !k.alt && DEFAULT_KEYS.indexOf(key.length === 1 ? key.toLowerCase() : key) >= 0) {
      message(tx('Ctrl を離してから {0} を押す', key.length === 1 ? key.toLowerCase() : key));
      S.lastAction = 'brief';
      return true;
    }
    if (k.ctrl || k.alt) { unbound(k); return true; }

    var moves = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D' };
    if (moves[key]) {
      // As select-pane does: the neighbour is found on the unzoomed layout,
      // and moving there unzooms.
      var z = win.zoomed;
      win.zoomed = false;
      var nb = T.neighbour(win, S.cols, S.rows, moves[key]);
      win.zoomed = z;
      if (nb) T.selectPane(win, nb.id);
      else message(tx('そちらにペインはない（{0} → % か " で分割）', prefixLabel()));
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
    if (key === 's' || key === 'w') { openPicker(key === 'w'); S.lastAction = 'choose'; return true; }
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
    if (key === ' ') { T.nextLayout(win); S.lastAction = 'layout'; return true; }
    if (key === ']') { paste(pane); return true; }
    if (key === ':') { S.lastAction = 'cmd'; S.prompt = { label: ':', value: '', done: runTmuxCommand }; return true; }
    if (key === 'l') {
      // vim hands reach for l to go right: say where it went (not when the
      // 手順 asked for l).
      var wantL = guideWants('l') || !!(S.run && S.run.phase === 'play' && S.run.type === 'last_window');
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
  function breakPane(win, pane) {
    if (T.breakPane(S.session, win, pane.id) === win) message(tx('ペインが 1 つだけなので、ウィンドウの番号が {0} に変わっただけ', win.index));
  }

  // The default prefix keys the game has: a Ctrl+key of one of them is a
  // slip of the finger, not a miss.
  var DEFAULT_KEYS = '%"zxc&np,[]d$sw(){} :l;oi?q\'=#!0123456789'.split('').concat(['PageUp']);

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

  // display-panes: the numbers show for display-panes-time (1 s).
  function showPaneNumbers() {
    S.panesShown = Date.now() + 1000;
    clearTimeout(S.dpTimer);
    S.dpTimer = setTimeout(function () { if (S.panesShown) { S.panesShown = null; if (S.screen === 'game') renderTerm(); } }, 1000);
  }

  function hidePaneNumbers() {
    S.panesShown = null;
    clearTimeout(S.dpTimer);
  }

  function withUnzoom(win) {
    if (win.zoomed) win.zoomed = false;
    return win;
  }

  // The tmux command prompt (prefix → :). Only the commands the game teaches.
  function runTmuxCommand(line) {
    var argv = line.trim().split(/\s+/);
    var cmd = argv[0] || '';
    var win = T.activeWindow(S.session);
    var pane = T.activePane(win);
    function flag(f) { var i = argv.indexOf(f); return i > 0 ? (argv[i + 1] || '') : null; }
    if (!cmd) return;
    if (/^(new|new-session|news)$/.test(cmd)) {
      var name = flag('-s') || freshName();
      if (sessionByName(name)) { message('duplicate session: ' + name); return; }
      var s = makeSession(name);
      if (argv.indexOf('-d') < 0) switchSession(s);
      S.lastAction = 'new_session';
    } else if (/^(rename-session|rename)$/.test(cmd)) {
      renameSession(S.session, argv.slice(1).join(' ').trim());
      S.lastAction = 'rename_session';
    } else if (/^(switch-client|switchc)$/.test(cmd)) {
      var sw = flag('-t') !== null ? sessionByName(flag('-t'))
        : argv.indexOf('-l') > 0 ? S.lastSession
        : S.sessions[((S.sessions.indexOf(S.session) + (argv.indexOf('-p') > 0 ? -1 : 1)) % S.sessions.length + S.sessions.length) % S.sessions.length];
      if (sw && S.sessions.indexOf(sw) >= 0) switchSession(sw);
      else message(flag('-t') !== null ? 'can\'t find session: ' + flag('-t') : 'no last session');
      S.lastAction = 'choose';
    } else if (/^(new-window|neww)$/.test(cmd)) {
      var w = T.createWindow(S.session, flag('-n') || 'zsh');
      T.selectWindow(S.session, w.id);
      nameRoom(T.activePane(w));
      S.lastAction = 'new_window';
    } else if (/^(rename-window|renamew)$/.test(cmd)) {
      if (argv[1]) win.name = argv.slice(1).join(' ');
      S.lastAction = 'rename';
    } else if (/^(split-window|splitw)$/.test(cmd)) {
      var lr = argv.indexOf('-h') > 0;
      nameRoom(T.splitPane(win, pane.id, lr ? 'lr' : 'tb', null, false));
      S.lastAction = lr ? 'split_lr' : 'split_tb';
    } else if (/^(kill-pane|killp)$/.test(cmd)) {
      if (!T.killPane(win, pane.id)) message('最後のペインは閉じられない');
      S.lastAction = 'close';
    } else if (/^(kill-window|killw)$/.test(cmd)) {
      if (!T.killWindow(S.session, win.id)) message('最後のウィンドウは閉じられない');
      S.lastAction = 'kill_window';
    } else if (/^(break-pane|breakp)$/.test(cmd)) {
      breakPane(win, pane);
      S.lastAction = 'break_pane';
    } else if (/^(last-window|last)$/.test(cmd)) {
      if (S.session.last && T.windowById(S.session, S.session.last)) T.selectWindow(S.session, S.session.last);
      else message('no last window');
      S.lastAction = 'select_window';
    } else if (/^(select-layout|selectl)$/.test(cmd)) {
      var lay = argv[1] || '';
      if (T.LAYOUTS.indexOf(lay) >= 0) T.applyLayout(win, lay);
      else message('unknown layout: ' + lay);
      S.lastAction = 'layout';
    } else if (/^(next-layout|nextl)$/.test(cmd)) {
      T.nextLayout(win);
      S.lastAction = 'layout';
    } else if (/^(swap-pane|swapp)$/.test(cmd)) {
      T.swapStep(win, argv.indexOf('-U') > 0 ? -1 : 1);
      S.lastAction = 'swap';
    } else if (/^(select-pane|selectp)$/.test(cmd) && flag('-T') !== null) {
      pane.name = argv.slice(argv.indexOf('-T') + 1).join(' ');
      S.lastAction = 'rename_pane';
    } else if (/^(detach|detach-client)$/.test(cmd)) {
      detach();
      S.lastAction = 'detach';
    } else if (/^(choose-tree|choose-session)$/.test(cmd)) {
      openPicker(argv.indexOf('-w') > 0);
      S.lastAction = 'choose';
    } else if (/^(list-sessions|ls)$/.test(cmd)) {
      message(sessionLines().join(' / '));
    } else {
      message('unknown command: ' + cmd);
      S.lastAction = 'unbound';
    }
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

  function copyModeKey(k, pane) {
    var el = paneBodyEl(pane.id);
    if (!el) { pane.mode = null; return true; }
    var max = el.scrollHeight - el.clientHeight;
    var page = Math.max(S.cellH, el.clientHeight - S.cellH);
    var key = k.key;
    var mk = metaKey(k);
    // Copy keys: Space/Enter (vi) or C-Space/M-w (emacs).
    var begins = key === ' ' || (k.ctrl && key === ' ') || key === 'V';
    var copies = (key === 'Enter' && !k.ctrl) || mk === 'w' || (k.ctrl && key === 'w');
    if ((key === 'Escape' || (k.ctrl && key === 'g')) && pane.sel != null) { pane.sel = null; return true; }
    if (copies && pane.sel != null) { yank(pane, key !== 'Enter'); return true; }
    if (key === 'v' || key === 'y') { message(key === 'v' ? 'tmux の v は矩形選択（四角く選ぶ）の切り替え。選び始めは Space（emacs 式は C-Space）' : 'tmux の y には割り当てがない。コピーは Enter（emacs 式は M-w）'); return true; }
    if (key === 'q' || key === 'Escape' || key === 'Enter' || (k.ctrl && (key === 'c' || key === 'g'))) { pane.mode = null; return true; }
    if (begins) { pane.sel = pane.cy; pane.selx = Math.min(pane.cx || 0, lineAt(pane, pane.cy).length); S.lastAction = 'yank_start'; return true; }
    if (k.ctrl && key === 'p') { goLine(pane, stepLine(pane, pane.cy, -1)); pane.reveal = 'edge'; return true; }
    if (k.ctrl && key === 'n') { goLine(pane, stepLine(pane, pane.cy, 1)); pane.reveal = 'edge'; return true; }
    // Along the line: ←/→ (h/l), the head (Home, 0, C-a) and the end (End, $, C-e).
    var len = lineAt(pane, pane.cy).length;
    if (key === 'ArrowLeft' || key === 'h') { pane.cx = Math.max(0, Math.min(pane.cx || 0, len) - 1); return true; }
    if (key === 'ArrowRight' || key === 'l') { pane.cx = Math.min(len, (pane.cx || 0) + 1); return true; }
    if (key === 'Home' || key === '0' || (k.ctrl && key === 'a')) { pane.cx = 0; return true; }
    if (key === 'End' || key === '$' || (k.ctrl && key === 'e')) { pane.cx = len; return true; }
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
    if (key === 'PageUp' || (k.alt && key === 'v') || (k.ctrl && key === 'b')) pane.scrollTop -= page;
    else if (key === 'PageDown' || (k.ctrl && key === 'v') || (k.ctrl && key === 'f')) pane.scrollTop += page;
    else if (k.ctrl && key === 'u') pane.scrollTop -= page / 2;
    else if (k.ctrl && key === 'd') pane.scrollTop += page / 2;
    else if (key === 'g') pane.scrollTop = 0;
    else if (key === 'G') pane.scrollTop = max;
    else return true;
    if (pane.scrollTop < 0) pane.scrollTop = 0;
    if (pane.scrollTop > max) pane.scrollTop = max;
    pane.syncCursor = true;
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
        if (pane.sel == null) pane.reveal = 'center';
        else pane.reveal = 'edge';
        return;
      }
    }
    message(tx('見つからない: {0}', pane.search.term));
  }

  // From where Space was pressed to the cursor, the character under it
  // included, as tmux's vi keys copy; the emacs keys (`excl`) stop before
  // the end, as a real M-w does.
  function yank(pane, excl) {
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
    pane.mode = null;
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
    else if (/^[0-9]$/.test(key) && Number(key) < n) pickRow(rows[Number(key)]);
    else if (key === 'Escape' || key === 'q' || (k.ctrl && key === 'c')) S.picker = null;
    return true;
  }

  // The repeat window ends on its own; the badge and the glow must follow.
  function armRepeat() {
    S.repeatUntil = Date.now() + 500;
    clearTimeout(S.repeatTimer);
    S.repeatTimer = setTimeout(function () { if (S.screen === 'game') render(); }, 520);
  }

  // message, note, chip and banner take Japanese and show it in the page's language.
  function message(text) {
    S.message = tx(text);
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
      var i = '123'.indexOf(k);
      if (i >= 0 && LV.COURSES[i]) return go(function () { startRun(LV.COURSES[i].id); });
      if (k === 'k' || k === 'K') return go(function () { startRun('keiko'); });
      if (k === 'r' || k === 'R') return go(function () { S.recTab = 'growth'; openRecords(null, 'title'); });
      if (k === 'b' || k === 'B') return go(openBoard);
    } else if (S.screen === 'result' && S.result) {
      if (k === 'Enter' || k === ' ') return go(function () { startRun(S.result.course); });
      if (k === 'k' || k === 'K') return go(function () { startRun('keiko'); });
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
  var ARROW_KEY = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' };
  // What to type at : when the player's file leaves an action with no key.
  var CMD_FOR = { 'k:%': 'split-window -h', 'k:"': 'split-window', 'k:x': 'kill-pane', 'k:&': 'kill-window', 'k:c': 'new-window', 'k:,': tx('rename-window 名前'), 'k:{': 'swap-pane -U', 'k:}': 'swap-pane -D', 'k: ': 'next-layout', 'k:d': 'detach', 'k:!': 'break-pane', 'k:l': 'last-window' };

  function sigOf(act) { return act.key != null ? 'k:' + act.key : act.resize ? 'r:' + act.resize : null; }

  // The default key event behind a label, to see whether the file took it away.
  function labelEvent(label) {
    var r = /^(Ctrl|Option)\+(.)$/.exec(label);
    if (r) return { key: ARROW_KEY[r[2]], ctrl: r[1] === 'Ctrl', alt: r[1] === 'Option', shift: false };
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

  function ownMove(m) {
    if (!m || !m.pfx || m.keys.length !== 1) return m;
    var o = ownKey(m.keys[0]);
    if (o.same) return m;
    if (o.none) {
      if (!o.cmd) return mv([], 'この設定ではこの操作のキーがない', true);
      // The command prompt is open: the command itself is the step.
      if (S.prompt && S.prompt.label === ':') {
        var pm = mv([], tx(S.prompt.value ? 'Ctrl+u で消して {0} と打って Enter' : '{0} と打って Enter', o.cmd), true);
        pm.prompt = true;
        pm.type = o.cmd;
        return pm;
      }
      return mv([':'], tx('この設定ではキーがない。: を押して {0} と打ち Enter', o.cmd));
    }
    var text = m.text.replace(m.keys[0], o.label).replace(/（Shift\+\d）|（ダブルクォート）| \(Shift\+\d\)| \(double quote\)/g, '');
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
    if (S.detached) return m && m.type ? m : attachMove();
    // A move marked `picker` works inside the open session list.
    if (S.picker && !(m && m.picker && !S.picker.kind)) return mv(['Esc'], 'Esc で一覧を閉じる', true);
    if (S.prompt && !(m && m.prompt)) return mv(['Esc'], 'Esc で入力欄を閉じる', true);
    return null;
  }

  function attachMove() {
    var m = mv(['Enter'], 'tmux attach と打って Enter（tmux に戻る）', true);
    m.type = 'tmux attach';
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
      return m;
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
    return { type: 'split', dir: node.dir, ratio: node.ratio, a: cloneTree(node.a), b: cloneTree(node.b) };
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
        var p = pick(r, otherPanes());
        S.target = p.id;
        S.qText = function () { return tx('{0} へ移動する', paneLabel(p)); };
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
        var p = pick(r, otherPanes());
        S.target = p.id;
        S.qText = function () { return tx('{0} を閉じる', paneLabel(p)); };
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
        var p = swapTarget(r);
        S.target = p.id;
        S.qText = function () { return tx('{0} を左上まで動かす（swap）', paneLabel(p)); };
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
        if (S.q1) return mv(['q'], 'q を押す（コピーモードを抜ける。シェルに戻る）', true);
        return mv(['g'], 'g を押す（一番上へ。emacs 式は Alt+<）', true);
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
          if (linePages(p, S.q0.ln) > 6) return mv(['q'], 'q で抜ける（[ で入り直すと、一番下に戻る）', true);
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
          return pm;
        }
        return mv(['?'], '? を押す（上向きに検索。emacs 式は Ctrl+r）', true);
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
        var p = pick(r, otherPanes());
        S.target = p.id;
        S.qText = function () { return tx('{0} へ移動して全画面にする', paneLabel(p)); };
      },
      check: function () { var w = T.activeWindow(S.session); return w.active === S.target && w.zoomed; },
      step: function () {
        var p = T.findPane(S.session, S.target);
        if (!p) return null;
        return activeId() !== S.target ? [1, 2, tx('{0} へ移動する', paneLabel(p.pane))] : [2, 2, '全画面にする'];
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
        // Said once: a closed pane has no number any more.
        var la = paneLabel(a), lb = paneLabel(b);
        S.qText = function () { return tx('{0} と {1} を閉じる', paneExists(a.id) ? paneLabel(a) : la, paneExists(b.id) ? paneLabel(b) : lb); };
      },
      check: function () { return !paneExists(S.q0[0]) && !paneExists(S.q0[1]); },
      step: function () {
        var left = S.q0.filter(paneExists), h = left.length && T.findPane(S.session, left[0]);
        return h ? [3 - left.length, 2, tx('{0} を閉じる', paneLabel(h.pane))] : null;
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
        var p = swapTarget(r);
        S.target = p.id;
        S.qText = function () { return tx('{0} を左上まで動かして全画面にする', paneLabel(p)); };
      },
      check: function () {
        var h = T.findPane(S.session, S.target);
        return !!h && h.win.zoomed && h.win.active === S.target && isFirst(S.target);
      },
      step: function () {
        var p = T.findPane(S.session, S.target);
        if (!p) return null;
        return isFirst(S.target) ? [2, 2, '全画面にする'] : [1, 2, tx('{0} を左上まで動かす', paneLabel(p.pane))];
      },
      next: function () { return isFirst(S.target) ? (moveTo(S.target) || mv(['z'], 'z を押す（全画面に）')) : swapMove(); }
    },
    detach_attach: {
      text: 'デタッチして、tmux attach で戻る', cmd: 'detach-client → tmux attach', allow: ['detach'], show: ['detach'], steps: 2,
      goal: function () { return [{ pane: activeId(), mark: 'go', tag: 'デタッチして戻る' }]; },
      setup: function () {
        // Already outside (a slip): the first half is done.
        S.q1 = S.detached;
        S.target = activeId();
      },
      check: function () {
        if (S.detached) S.q1 = true;
        return S.q1 && !S.detached;
      },
      step: function () { return S.detached || S.q1 ? [2, 2, 'tmux attach で戻る'] : [1, 2, 'デタッチする']; },
      next: function () { return S.detached ? attachMove() : mv(['d'], 'd を押す（デタッチ）。tmux の外のシェルに戻る'); }
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
          // A selection begun somewhere else: let go of it first.
          if (p.sel != null && (p.sel !== ln || p.selx !== 0)) return mv(['Esc'], 'Esc を押す（選び直す）', true);
          if (p.cy > ln) return mv(['↑'], '↑ を押す（コピーする行まで上がる）', true);
          // Far above the line (g, PageUp): leaving and coming back is quicker than ↓ a hundred times.
          if (ln - p.cy > 5) return mv(['q'], 'q で抜ける（[ で入り直すと、一番下に戻る）', true);
          if (p.cy < ln) return mv(['↓'], '↓ を押す（コピーする行まで下がる）', true);
          if (p.sel == null) {
            if (p.cx > 0) return mv(['Home'], 'Home を押す（行の頭へ。vi 式は 0、emacs 式は Ctrl+a）', true);
            return mv(['Space'], 'Space を押す（ここから選び始める）', true);
          }
          if (p.cx < S.q0.text.length) return mv(['End'], 'End を押す（行の終わりまで選ぶ。vi 式は $、emacs 式は Ctrl+e）', true);
          return mv(['Enter'], 'Enter を押す（選んだところをコピーする）', true);
        }
        if (S.clipboard === S.q0.text) return mv([']'], '] を押す（貼り付ける）');
        return mv(['['], '[ を押す（コピーモードに入る）');
      }
    },
    // The session questions name the session on the status bar ([name]).
    // A session made with new -s is switched to, as in tmux, so the second
    // step is the way back.
    session_new: {
      steps: 4, text: '新しいセッションを作って、元のセッションに戻る', cmd: 'new-session -s 名前 → switch-client', allow: ['new_session', 'choose'], show: ['new_session', 'choose'],
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
          return pm;
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

  // Short names of the question types, for lists.
  var TYPE_NAMES = {
    split_lr: '左右に分割', split_tb: '上下に分割', focus: 'ペイン移動', zoom: '全画面', unzoom: '全画面を戻す',
    close: 'ペインを閉じる', new_window: 'ウィンドウ作成', select_window: 'ウィンドウ移動', resize: '大きさ変更', swap: '入れ替え',
    rename: '名前を変える', kill_window: 'ウィンドウを閉じる', copy_top: 'スクロール', find_zoom: '移動して全画面', trident: '三分割',
    two_akima: '二つ閉じる', new_and_home: '作って戻る', swap_zoom: '入れ替えて全画面', detach_attach: 'デタッチして戻る', yank_paste: 'コピーと貼り付け',
    session_new: 'セッション作成', session_switch: 'セッション移動', session_attach: 'attach -t で入る',
    copy_page: 'ページ送り', copy_search: '履歴の検索', last_window: '直前のウィンドウ', break_pane: 'ペインを別ウィンドウに'
  };
  function typeName(t) { return TYPE_NAMES[t] ? tx(TYPE_NAMES[t]) : t; }

  // What a key does, for the miss chip (actions that are never a miss are left out).
  var ACTION_NAMES = {
    split_lr: '左右に分割', split_tb: '上下に分割', zoom: '全画面の切り替え', close: 'ペインを閉じる', new_window: '新しいウィンドウ',
    resize: '大きさを変える', swap: 'ペインの入れ替え', rename: 'ウィンドウの名前', kill_window: 'ウィンドウを閉じる', copy: 'コピーモード',
    detach: 'デタッチ', layout: '並べ方を変える', paste: '貼り付け', yank: 'コピー', yank_start: '選び始め', search: '検索',
    rename_session: 'セッションの名前', new_session: '新しいセッション', rename_pane: 'ペインの名前', choose: 'セッション一覧',
    break_pane: 'ペインを別ウィンドウに'
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

  // The ghost (影) to race: today's fastest player if faster than you, else
  // your own best. Your own is there at once; today's arrives if it can.
  function pickGhost(b) {
    if (b.course.practice) { b.ghost = null; return; }
    var own = REC.ghostOf(b.course.id);
    b.ghost = own;
    // Today's fastest ran today's order; a shuffled run races only its own.
    if (!NET || !NET.state().key || b.shuffled) return;
    NET.ghost(b.course.id, 'today').then(function (g) {
      if (!g || S.run !== b || (own && own.time <= g.time) || (g.splits || []).length !== b.qs.length) return;
      var me = NET.state().name;
      if (me && g.name === me && own) return;
      b.ghost = { name: g.name, time: g.time, splits: g.splits, today: true };
      prepGhost(b);
      $('#playbar').dataset.key = '';
      if (S.screen === 'game') renderPlaybar();
    }).catch(function () { /* offline: your own ghost */ });
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
    if (shuffled) return pairZoom(shuffle(course.qs.slice()));
    return pairZoom(shuffle(course.qs.slice(), rng(day + ':' + course.id)));
  }

  // 稽古: every type the courses ask, weighed by how often its keys are
  // needed and how it has gone (records.js drillPick, counting this run's
  // questions too); never the same type twice in a row.
  function drillTypes() {
    var out = [];
    LV.COURSES.forEach(function (c) { c.qs.forEach(function (t) { if (Q[t] && out.indexOf(t) < 0) out.push(t); }); });
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
    var qs = questionsFor(course, day, shuffled);
    S.run = {
      course: course,
      day: day,
      qs: qs,
      shuffled: shuffled,
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
      seed: course.practice || shuffled ? course.id + ':' + Math.random() : day + ':' + course.id
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
    if (!b || b.phase !== 'play' || S.screen !== 'game') return;
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
    if (Date.now() < S.repeatUntil) S.graceUntil = Date.now() + 500;
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
    S.session.windows.forEach(function (w) { T.panesOf(w).forEach(function (p) { if (p.mode === 'copy') p.mode = null; }); });
    q.setup(rng(b.seed + ':' + b.i));
    b.q = q;
    b.type = type;
    b.stage = 0;
    b.peek = false;
    b.limit = qLimit(type);
    b.qStart = performance.now();
    // `l` is this question's 目安: the records measure it against that.
    b.qlog[b.i] = { t: type, s: null, m: 0, l: b.limit };
    S.clipboard = '';
    S.pasted = '';
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
      pauses: b.pauses, paused: paused, shuffled: b.shuffled, drill: drill
    };
    if (drill) { result.bestStreak = REC.drillStreak(qlog); result.bestBefore = REC.drillBest(); }
    var sum = REC.add({
      course: b.course.id, prefix: S.conf ? S.conf.prefix.label : 'C-b', conf: S.conf ? 1 : undefined,
      time: +time.toFixed(2), raw: +raw.toFixed(2), misses: misses, overs: b.overs, guides: b.guides,
      keys: b.keys, n: n, qs: qlog, drill: drill || undefined,
      pauses: b.pauses || undefined, paused: paused || undefined, shuffled: b.shuffled || undefined
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
      result.ghost = { name: b.ghost.name, time: b.ghost.time, diff: +(time - b.ghost.time).toFixed(2) };
    }
    S.result = result;
    S.navAfter = performance.now() + 700;
    shareRun(sum.runId);
    S.run = null;
    showScreen('result');
    // A best time past the first run gets the long fanfare, a new rank the
    // climbing one; the screen's own tune follows either.
    AU.play(result.record && result.count > 1 ? 'record' : result.rankUp ? 'rankup' : 'clear', 'title');
  }

  // ---- rendering ----------------------------------------------------------

  function render() {
    syncBody();
    if (S.screen === 'title') renderTitle();
    if (S.screen === 'game') { renderSashizu(); renderPlaybar(); renderTerm(); renderStatus(); renderTabArrow(); renderKeybar(); }
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
    var runs = (all.runs || []).filter(function (r) { var c = REC.courseOf(r.course); return c && !c.practice; });
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
      '<small>' + esc(tx('今日はみんな同じ順番で出る。日本時間の 0 時に変わる。')) + '</small>';
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

  // 腕前: the level from the latest five runs, its title, and how much
  // faster per question the next level is. A still bar, no motion.
  function skillHTML(sk, from) {
    if (!sk) return '<div class="sk-none">' + esc(tx('腕前 ―　一度はじめると、ここに Lv が出る')) + '</div>';
    var cur = LV.paceFor(sk.lv), nxt = sk.next;
    var frac = nxt != null ? Math.max(0, Math.min(1, (cur - sk.pace) / (cur - nxt))) : 1;
    var up = from && from.lv < sk.lv;
    return '<div class="sk-row"><span class="sk-lab">' + tx('腕前') + '</span><span class="sk-lv' + (up ? ' up' : '') + '">' +
      (up ? '<small>Lv.' + from.lv + ' → </small>' : '') + 'Lv.' + sk.lv + '</span></div>' +
      '<div class="sk-bar" aria-hidden="true"><i style="width:' + Math.round(frac * 100) + '%"></i></div>' +
      '<div class="sk-note">' + (nxt != null ? tx('次の Lv.{0} まで、1 問あたり {1} 秒速く', sk.lv + 1, sk.toNext.toFixed(2)) : tx('最高の Lv。')) +
      tx('（直近 {0} 回の平均 {1} 秒／問）', sk.runs, sk.pace.toFixed(2)) + '</div>';
  }

  // The top bar: the 腕前, always in view.
  function renderMeta(all) {
    var sk = REC.skill(all);
    $('#title-meta').textContent = sk ? tx('腕前 Lv.{0}', sk.lv) : 'prefix ' + prefixLabel();
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
      // The title the best holds and the next one; on a house not yet
      // entered, whether the one before is at 三段 or better: the step up.
      var nr = best ? LV.nextRank(c, best.time) : null;
      var prev = !runs.length && i > 0 ? REC.best(LV.COURSES[i - 1].id, all) : null;
      var prevRank = prev ? LV.nextRank(LV.COURSES[i - 1], prev.time) : null;
      var stepUp = prevRank && LV.RANKS.map(function (x) { return x.title; }).indexOf(prevRank.rank) <= 2;
      html += '<li><button type="button" class="wing' + (c.id === pick ? ' hot' : '') + '" data-course="' + c.id + '">' +
        planHTML(c) +
        '<span class="wing-main"><span class="wing-name">' + esc(c.title) +
        '<span class="wing-n">' + nQ(c.qs.length) + '</span>' +
        '<span class="wing-mode' + (c.recommended ? ' rec' : '') + '">' + esc(c.mode) + '</span>' +
        // The key that starts this course (navKey): someone who knows tmux goes straight to 上級 with 3.
        '<kbd class="hk">' + (i + 1) + '</kbd></span>' +
        '<span class="wing-desc">' + tx('目安は 1 問 {0}〜{1} 秒。', limitRange(c)[0], limitRange(c)[1]) + esc(c.desc) + '</span></span>' +
        '<span class="wing-best"><small>' + tx('自己ベスト') + '</small><b>' + (best ? fmt(best.time) : '—') + '</b>' +
        '<small>' + (runs.length ? (a5 != null ? tx('五回平均 {0} ・ ', a5.toFixed(1)) : '') + tx('{0} 回', runs.length) : tx('お手本 {0} 秒', LV.par(c))) + '</small>' +
        (nr ? '<small class="wing-rank">' + esc(nr.next ? tx('{0}まで あと {1} 秒', tx(nr.next), nr.gap.toFixed(1)) : tx('最高の称号 {0}', tx(nr.rank))) + '</small>' : '') +
        (stepUp ? '<small class="wing-next">' + esc(tx('次はここ（{0}で {1}）', LV.COURSES[i - 1].title, tx(prevRank.rank))) + '</small>' : '') +
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
  }

  // Whether this question's 手順 is folded: its type is learnt (覚えた), or
  // this is the 稽古, and the 目安 has not passed yet.
  function folded(b) {
    var e = b.learnt && b.learnt[b.qs[b.i]];
    return (!!b.course.drill || !!(e && e.learnt)) && b.stage === 0 && !b.peek;
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
      (LV.KEYS[a] || []).forEach(function (k) {
        var o = ownKey(k);
        if (o.none) return;
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
      html += '<p class="learnt-note">' + tx(b.course.drill ? '思い出して押す。手順は {0} 秒後か、ミスのあとに出る。' : '覚えた問題。{0} 秒で手順が出る。', LV.PEEK_AFTER) + '</p>';
    }
    html += '<div class="andon' + (b.stage ? ' lit' : '') + '"><div class="andon-l"><span>' + tx('目安 {0} 秒', b.limit) + '</span><b class="andon-over"></b></div>' +
      '<div class="gauge"><i class="left"></i><i class="over"></i></div>';
    html += '</div>';
    el.innerHTML = html;
    renderClock();
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
      html += '<div class="ob-guide learnt ob-prompt">' + c + tx(b.course.drill ? '稽古' : '覚えた ✓') + '<span class="ob-txt">' + tx('思い出して押す。{0} 秒で手順が出る', LV.PEEK_AFTER) + '</span></div>';
    }
    return html;
  }

  // The ghost in the bar: who it is, and after each question how far ahead
  // or behind you are. It changes only when a question is solved.
  function ghostHTML(b) {
    if (!b.ghost) return '';
    var who = b.ghost.today ? tx('今日の一番 {0}', b.ghost.name) : tx('自分のベスト');
    var d = b.ghostDiff;
    var txt = d == null ? tx('{0}秒', b.ghost.time.toFixed(1)) : tx('{0}秒', (d <= 0 ? '−' : '+') + Math.abs(d).toFixed(1));
    return '<span class="pb-ghost' + (d == null ? '' : d <= 0 ? ' ahead' : ' behind') + '" title="' + esc(tx('影: {0}', who)) + '">' + tx('影') + ' <small>' + esc(who) + '</small> <b>' + txt + '</b></span>';
  }

  function renderPlaybar() {
    var b = S.run;
    var el = $('#playbar');
    if (!b || !el) return;
    var key = [b.i, b.phase, b.misses, b.streak >= 3 ? b.streak : 0, b.ghost ? b.ghost.name : '', b.ghostDiff].join('|');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.innerHTML = '<span class="pb-course">' + esc(b.course.title) + tx(' ・ 問題 ') + '<b>' + qCount(b, ' / ') + '</b></span>' +
      (b.streak >= 3 ? '<span class="pb-streak">' + tx('{0} 連', b.streak) + '</span>' : '') +
      (S.conf ? '<span class="pb-conf">' + tx('自分のキー設定（prefix {0}）', prefixLabel()) + '</span>' : '') +
      '<span class="pb-sp"></span>' +
      (b.misses ? '<span class="pb-pen">' + tx('ミス {0}（+{1}秒）', b.misses, b.penalty) + '</span>' : '') +
      ghostHTML(b) +
      '<span class="pb-time"><span>0.0</span><small>' + tx('秒') + '</small></span>';
    renderClock();
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
      el.className = 'pane' + (isActive ? ' active' : '') + (wanted[p.id] ? ' wanted' + (wanted[p.id] === 'close' ? ' wanted-close' : '') : '') + (size ? ' ' + size : '') + (el.dataset.anim ? ' ' + el.dataset.anim : '');
      // --numw: the room the number (and the Z flag) takes at the top right.
      el.style.cssText = 'left:' + (r.x * cw) + 'px;top:' + (r.y * ch) + 'px;width:' + wpx + 'px;height:' + hpx + 'px;--numw:' + numWidth(wpx, win.zoomed) + 'px';
      var decorKey = room + '|' + size;
      if (el.dataset.decor !== decorKey) {
        el.dataset.decor = decorKey;
        el.firstChild.innerHTML = '';
      }
      // The pane's number, always on and dim, as prefix q shows it.
      el.children[1].innerHTML = '<span class="pnum">' + idx + '</span>' + (p.name ? '<span class="pt-name">' + esc(p.name) + '</span>' : '') + (win.zoomed ? '<span class="zoom-flag">Z</span>' : '');
      var body = el.children[2];
      body.className = 'pane-body' + (p.mode === 'copy' ? ' copy' : '');
      body.dataset.paneBody = p.id;
      // The order is printed just above the prompt of the pane you stand in.
      // In copy mode the text scrolls, so it is pinned to the pane's foot.
      var order = '';
      body.innerHTML = (p.mode === 'copy' ? '<div class="copy-ind" data-copy-ind="' + p.id + '">[0/0]</div>' : '') +
        linesHTML(p.lines, p.mode === 'copy' ? p : null) +
        (p.mode === 'copy' ? copyLineHTML(p, p.lines.length, lineAt(p, p.lines.length), '', null)
          : order + '<div class="sh-line"><span class="sh-prompt">' + esc(promptText(p)) + '</span>' + withCursor(p.input, p.cur, isActive) + '</div>');
      var pin = $(':scope > .motd', el);
      if (order && p.mode === 'copy') {
        if (!pin) { pin = document.createElement('div'); el.appendChild(pin); }
        pin.className = 'motd pinned';
        pin.innerHTML = motdHTML(run, move, fold);
      } else if (pin) pin.remove();
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
          // After a page move the cursor lands on the top visible line.
          var lines = $$('[data-ln]', el);
          for (var i = 0; i < lines.length; i++) if (lines[i].offsetTop >= el.scrollTop) { goLine(p, Number(lines[i].dataset.ln)); break; }
          p.syncCursor = false;
          markCursor(el, p);
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
    var x1 = ar.left - tr.left + ar.width / 2, y1 = Math.min(bottom - 10, (top + bottom) / 2);
    var x2 = Math.max(12, Math.min(tr.width - 12, r.left - tr.left + Math.min(r.width / 2, 40))), y2 = tr.height - 4;
    // A window question: the guide card sits where the arrow's middle would
    // be, and the arrow then leaves from the card's foot, never behind it.
    if (b && b.phase === 'play' && b.q && !$(':scope > .guide-card:not(.tab)', term)) {
      var card = placeCard(term, (x1 + x2) / 2, (y1 + y2) / 2, motdHTML(b, fold ? null : guideMove(b), fold), '', 'tab');
      x1 = card.offsetLeft + card.offsetWidth / 2;
      y1 = card.offsetTop + card.offsetHeight + 2;
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

  function markCursor(el, p) {
    $$('.cl', el).forEach(function (x) { x.classList.remove('cl'); });
    // The cursor cell of the line left behind goes; the next render draws it anew.
    $$('span.cursor', el).forEach(function (x) { x.className = ''; });
    var line = $('[data-ln="' + p.cy + '"]', el);
    if (line) line.classList.add('cl');
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
    } else if (S.run && S.run.q) S.run.q.show.forEach(function (a) { (LV.KEYS[a] || []).forEach(function (l) { var o = ownKey(l); if (!o.none) labels.push(o.label); }); });
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
    bar.innerHTML = html;
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

  // The counts (net.js): nothing but the step, the course and the question.
  function count(e, n) { if (NET && NET.ev) NET.ev(e, S.run ? S.run.course.id : '', n); }

  function leaveRun() {
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
    var c = REC.courseOf(r.course);
    var diff = r.time - r.par;
    var verdict = diff <= 0
      ? tx('お手本 {0} 秒より <b>{1} 秒</b> 速い', r.par, Math.abs(diff).toFixed(1))
      : tx('お手本 {0} 秒まで あと <b>{1} 秒</b>', r.par, diff.toFixed(1));
    var sub = '';
    if (r.count === 1) sub = tx('はじめての挑戦。これが出発点。');
    else if (r.record) sub = tx('★ 自己ベスト更新（{0} → {1}）', r.best.toFixed(1), r.time.toFixed(1));
    else if (r.delta < 0) sub = tx('前回より {0} 秒 速い。自己ベストまで あと {1} 秒', Math.abs(r.delta).toFixed(1), r.bestDelta.toFixed(1));
    else sub = tx('前回より {0} 秒 遅い。自己ベストまで あと {1} 秒', r.delta.toFixed(1), r.bestDelta.toFixed(1));
    if (r.ao5 != null) sub += tx(' ・ 五回平均 {0}', (r.ao5Prev != null ? r.ao5Prev.toFixed(1) + ' → ' : '') + r.ao5.toFixed(1));
    var rankLine = r.rankUp
      ? tx('称号が「{0}」から <b>{1}</b> に上がった', esc(tx(r.rankFrom)), esc(tx(r.rank)))
      : tx('今回の称号 <b>{0}</b>', esc(tx(r.rank)));
    // What the next title needs on this course: the number to beat next time.
    var nr = LV.nextRank(c, r.time, r.n);
    rankLine += '<small>' + esc(nr.next ? tx('{0}まで あと {1} 秒（{2} 秒以内）', tx(nr.next), nr.gap.toFixed(1), Math.round(nr.need)) : tx('最高の称号。')) + '</small>';
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
      '<div class="em-verdict">' + verdict + '<span class="em-tip">' + esc(sub) + '</span></div></div>' +
      '<div class="em-rank' + (r.rankUp ? ' up' : '') + '"><span class="hanko" aria-hidden="true">' + (EN ? esc(tx(r.rank)) : esc(r.rank).replace(/^(.{3})(.+)$/, '$1<br>$2')) + '</span><span>' + rankLine + '</span></div>' +
      '<div class="skill em-skill">' + skillHTML(r.skill, r.skillFrom) + '</div>' +
      learntHTML(r) +
      '<dl class="em-facts">' +
      '<div><dt>' + tx('1 問あたり') + '</dt><dd>' + tx('{0}秒', r.avg.toFixed(2)) + '</dd></div>' +
      '<div><dt>' + tx('実時間') + '</dt><dd>' + tx('{0}秒', r.raw.toFixed(1)) + '</dd></div>' +
      '<div><dt>' + tx('ミス') + '</dt><dd>' + tx('{0}（+{1}秒）', r.misses, r.misses * LV.MISS_PENALTY) + '</dd></div>' +
      '<div><dt>' + tx('目安超え') + '</dt><dd>' + nQ(r.overs) + '</dd></div>' +
      '<div><dt>' + tx('自己ベスト') + '</dt><dd>' + fmt(r.record ? r.time : r.best) + '</dd></div>' +
      '<div><dt>' + tx('押したキー') + '</dt><dd>' + r.keys + '</dd></div>' +
      '</dl>' +
      resultNetHTML(r) +
      slowestHTML(r) +
      shareHTML(r) +
      spark(r.spark) +
      '<div class="spark-l"><span>' + (slow ? esc(tx('いちばん時間がかかった問題: {0}（{1} → {2}）', tx(slow.text), prefixLabel(), slowKeys.join(' '))) : r.overs ? '' : tx('目安超えなし。どの問題も目安のうちに解いた')) + '</span>' +
      (r.spark && r.spark.length > 1 ? '<span class="spark-key"><i class="rec"></i>' + tx('自己ベスト') + ' <i class="now"></i>' + tx('今回') + '</span>' : '') + '</div>' +
      (r.tip ? '<div class="tips"><div class="tips-head">' + tx('豆知識') + (r.tipFor ? tx(' ・ {0}', esc(typeName(r.tipFor))) : '') + '</div><p>' + esc(r.tip) + '</p></div>' : '') +
      '<div class="cta"><button type="button" class="btn primary" data-course="' + r.course + '">' + (c.practice ? tx('もう一度 稽古') : tx('もう一度')) + '<kbd class="hk">Enter</kbd></button>' +
      (up ? '<button type="button" class="btn primary" data-course="' + up.id + '">' + esc(tx('{0}へ進む', up.title)) + '<kbd class="hk">N</kbd></button>' : '') +
      (!c.practice ? '<button type="button" class="btn" data-course="' + r.course + '" data-shuffle="1">' + tx('順番を変えて') + '</button>' : '') +
      (!c.practice ? '<button type="button" class="btn" data-course="keiko">' + tx('稽古（手順なし）') + '<kbd class="hk">K</kbd></button>' : '') +
      '<button type="button" class="btn" data-records="' + (c.practice ? lastCourse(REC.load()) : r.course) + '">' + tx('記録を見る') + '<kbd class="hk">R</kbd></button>' +
      '<button type="button" class="btn ghost" data-title="1">' + tx('コース選択へ') + '<kbd class="hk">Esc</kbd></button></div>';
    renderMeta();
    if ((isRec || r.rankUp) && S.celebrated !== r.runId) { S.celebrated = r.runId; celebrate(); }
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
      '<button type="button" class="btn" data-records="' + lastCourse(REC.load()) + '">' + tx('記録を見る') + '<kbd class="hk">R</kbd></button>' +
      '<button type="button" class="btn ghost" data-title="1">' + tx('コース選択へ') + '<kbd class="hk">Esc</kbd></button></div>';
    renderMeta();
    if (isBest && r.bestBefore && S.celebrated !== r.runId) { S.celebrated = r.runId; celebrate(); }
  }

  // The next house up (入門 → 中級 → 上級) after a run of 三段 or better, while
  // that house has never been entered: the moment to step up.
  function nextCourse(r) {
    var i = LV.COURSES.map(function (c) { return c.id; }).indexOf(r.course);
    var up = i >= 0 ? LV.COURSES[i + 1] : null;
    if (!up || REC.runsOf(up.id, REC.load()).length) return null;
    var at = LV.RANKS.map(function (x) { return x.title; }).indexOf(r.rank);
    return at >= 0 && at <= 2 ? up : null;
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
    var why = REC.courseOf(r.course).practice ? 'practice' : r.shuffled ? 'shuffled' : r.paused > LV.PAUSE_MAX ? 'paused' : null;
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
      r.board = { state: e && e.status === 400 && NET.state().name ? 'refused' : 'offline' };
    }).then(function () { if (S.screen === 'result' && S.result === r) renderResult(); });
  }

  // The run as a few lines to paste anywhere, Wordle style: one square a
  // question (green: under half the 目安, yellow: within it, red: over it or
  // a wrong key), the time against お手本, the rank and the link.
  var SITE = 'https://t29mato.github.io/games/tmux-dojo/';
  function shareText(r) {
    var c = REC.courseOf(r.course);
    var sq = (r.qlog || []).map(function (q) {
      return q.m || q.o ? '🟥' : q.s != null && q.s <= REC.limitOf(q, c) / 2 ? '🟩' : '🟨';
    });
    var rows = [];
    for (var i = 0; i < sq.length; i += 10) rows.push(sq.slice(i, i + 10).join(''));
    var day = LV.dayKey(r.at), d = day.split('-');
    return tx('tmux 道場 {0} {1} {2}秒（お手本 {3}秒）{4}', EN ? dayLabel(day) : +d[1] + '/' + +d[2], c.title, r.time.toFixed(1), r.par, tx(r.rank)) + '\n' +
      rows.join('\n') + '\n' + SITE + (EN ? '?lang=en' : '');
  }

  function shareHTML(r) {
    if (REC.courseOf(r.course).practice) return '';
    var text = shareText(r);
    return '<div class="share"><pre class="share-text">' + esc(text) + '</pre>' +
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
        esc(r.ghost.name === '自分' ? tx('自分のベスト') : r.ghost.name), r.ghost.time.toFixed(1), Math.abs(d).toFixed(1)) + '</p>';
    }
    var b = r.board;
    if (!b) return html;
    if (b.state === 'sending') html += '<p class="em-board">' + tx('今日のランキングに載せている……') + '</p>';
    if (b.state === 'ok') html += '<p class="em-board">' + tx('今日のランキング <b>{0} 位</b> ／ {1} 人', b.rank, b.total) + ' ' + tx('・') + ' <a href="#" data-board="' + r.course + '">' + tx('ランキングを見る') + '</a></p>';
    if (b.state === 'refused') html += '<p class="em-board dim">' + tx('この記録はランキングに載せられなかった（手で解いた記録だけが載る）。') + '</p>';
    if (b.state === 'offline') html += '<p class="em-board dim">' + tx('ランキングにつながらなかった（記録には残る）。') + '</p>';
    if (b.state === 'paused') html += '<p class="em-board dim">' + tx('途中で {0} 秒 止まっていたので、今日のランキングには載せない（記録には残る）。', r.paused.toFixed(1)) + '</p>';
    if (b.state === 'shuffled') html += '<p class="em-board dim">' + tx('順番を変えた回は、今日のランキングには載せない（記録には残る）。') + '</p>';
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
    var span = S.boardSpan || BOARD_SPAN;
    var seg = '<div class="seg rec-span" role="group" aria-label="' + tx('期間') + '">' +
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
          return '<tr class="' + (me && r.name === me ? 'is-me' : '') + '"><td class="c-n">' + r.rank + '</td><td>' + esc(r.name) + '</td><td class="r-time">' + tx('{0}秒', r.time.toFixed(1)) + '</td><td class="r-note c-n">' + esc(r.day.slice(5).replace('-', '/')) + '</td></tr>';
        }).join('') + '</tbody></table>';
    };
    var note = me ? '<p class="rec-empty">' + tx('「{0}」として載る。名前は「引き継ぎ」で変えられる。', esc(me)) + '</p>'
      : '<p class="rec-empty">' + tx('名前を付けると、遊ぶたびに自分の一番が載る。名前は「引き継ぎ」で付けられる。') + '</p>';
    body.innerHTML = '<div class="rec-panel"><div class="rec-head">' + tx('ランキング ・ {0}', esc(REC.courseOf(id).title)) + '</div>' + seg +
      '<div class="board-body">' + (cached ? table(cached.rows) : '<p class="rec-empty">' + tx(offline ? 'オフラインなのでランキングは見られない' : '読み込み中……') + '</p>') + '</div>' + note + '</div>';
    if (cached && Date.now() - cached.at < 15000) return;
    if (offline) return;
    // Looking at the boards is the player's choice; reading sends nothing of theirs.
    NET.board(id, span).then(function (rows) {
      S.boardCache = S.boardCache || {};
      S.boardCache[key] = { rows: rows, at: Date.now() };
      if (S.screen === 'records' && S.recTab === 'board' && S.recCourse === id && (S.boardSpan || BOARD_SPAN) === span) renderRecords();
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
      '<small class="nf-msg">' + tx(st.name ? '遊ぶたびに、その回の記録がランキングに載る。' : '名前を付けると、遊ぶたびにランキングに載る。') + '</small></form></div>';
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
    $$('#records-screen [data-rec-tab]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.recTab === tab ? 'true' : 'false'); });
    // The course row keeps its space on the 引き継ぎ tab: nothing below jumps.
    $('#records-screen .rec-seg').classList.toggle('off', tab === 'sync');
    var body = $('#records-body');
    if (tab === 'board') { renderBoard(body, id); return; }
    if (tab === 'sync') { renderSync(body); return; }
    var st = REC.stats(id);
    if (!st) {
      body.innerHTML = '<div class="rec-log"><p>' + tx('{0}（{1}）の記録は、まだ白紙。', esc(c.title), esc(c.mode)) + '</p><p>' + tx('一度はじめると、ここに上達が描かれていく。') + '</p></div>' +
        '<div class="cta"><button type="button" class="btn primary" data-course="' + id + '">' + tx('{0}をはじめる', esc(c.title)) + '</button></div>' + rankPanel(c, '') + drillPanel();
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
      '<div class="rec-tile"><small>' + tx('最高の称号') + '</small><b>' + esc(st.bestRank ? tx(st.bestRank) : '—') + '</b></div>' +
      '<div class="rec-tile"><small>' + tx('挑戦回数') + '</small><b>' + tx('{0} 回', st.count) + '</b></div>' +
      '<div class="rec-tile"><small>' + tx('五回平均') + '</small><b>' + fmt(a5) + '</b></div>' +
      '</div>';
    var chart = '<div class="rec-panel"><div class="rec-head">' + tx('タイムの移り変わり（直近 {0} 回）', Math.min(20, st.count)) + '</div>' + recChart(st.runs, c, st.best) + '</div>' +
      dailyChart(REC.dailyBest(id), c);
    var rows = st.runs.slice(0, 20).map(function (r) {
      var note = r.legacy ? tx('旧記録') : tx('ミス {0}', r.misses) + (r.overs ? tx(' ・ 目安超え {0}', r.overs) : '') + (r.timeouts ? tx(' ・ 時間切れ {0}', r.timeouts) : '');
      return '<tr class="' + (r.rec ? 'is-rec' : '') + '"><td class="c-n">' + recDate(r.at) + '</td><td class="r-time">' + tx('{0}秒', r.time.toFixed(1)) + '</td><td class="r-note">' + note + '</td><td class="r-rank">' + esc(tx(r.rank)) + '</td><td class="r-star">' + (r.rec ? '★' : '') + '</td></tr>';
    }).join('');
    var table = '<div class="rec-panel"><div class="rec-head">' + tx('直近の記録') + '</div><table class="rec-table"><thead><tr><th>' + tx('日付') + '</th><th>' + tx('タイム') + '</th><th class="r-note">' + tx('内訳') + '</th><th>' + tx('称号') + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    body.innerHTML = '<div class="rec-log">' + head + '</div>' + tiles + rankPanel(c, st.bestRank) + chart + weakPanel(id) + drillPanel() + learntPanel() + table;
  }

  // Every title and the time it needs on this course (misses included),
  // the one you hold marked.
  function rankPanel(c, mine) {
    var n = c.qs.length, mul = c.rankMul || 1;
    var rows = LV.RANKS.map(function (r, i) {
      var t = isFinite(r.max) ? tx('{0} 秒以内', Math.round(r.max * mul * n)) : tx('{0} 秒より遅い', Math.round(LV.RANKS[i - 1].max * mul * n));
      var per = isFinite(r.max) ? tx('{0} 秒', (r.max * mul).toFixed(1)) : '';
      return '<tr class="' + (r.title === mine ? 'is-rec' : '') + '"><td class="r-rank">' + esc(tx(r.title)) + '</td><td class="r-time">' + t + '</td><td class="r-note">' + per + '</td><td class="r-star">' + (r.title === mine ? tx('いまここ') : '') + '</td></tr>';
    }).join('');
    // Not "目安": that word is the per-question time limit elsewhere.
    return '<div class="rec-panel rec-ranks"><div class="rec-head">' + tx('称号の一覧（{0}・{1} 問）', esc(c.title), n) + '</div><table class="rec-table"><thead><tr><th>' + tx('称号') + '</th><th>' + tx('タイム') + '</th><th class="r-note">' + tx('1 問あたり') + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="rec-empty">' + esc(tx('称号は武道の段位になぞらえている: 見習い → 初段 → 三段 → 師範代 → 師範。お手本は師範代のタイム。')) + '</p></div>';
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
    if (c.skipped.length) {
      html += '<details><summary>' + tx('読み飛ばした {0} 行', c.skipped.length) + '</summary><ul>' + c.skipped.map(function (x) { return row(x, x.why); }).join('') + '</ul></details>';
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
    var saved = store.load();
    applyTheme(saved.theme === 'dark' || saved.theme === 'light' ? saved.theme : null);
    applySound(saved.sound !== false);
    // The side panel is the detail; the order is in the house.
    S.detail = saved.detail === true;
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
    $('#conf-reset').addEventListener('click', function () { $('#conf-text').value = ''; applyConf('', true); });
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
    $('#course-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-course]');
      if (b) startRun(b.dataset.course);
    });
    $$('.to-title').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (endDrill()) return;
        leaveRun();
        showScreen('title');
      });
    });
    $('#result-screen').addEventListener('click', function (e) {
      if (e.target.closest('[data-share]')) { copyShare(); return; }
      var r = e.target.closest('[data-records]');
      if (r) { S.recTab = 'growth'; openRecords(r.dataset.records || null, 'result'); return; }
      var bd = e.target.closest('[data-board]');
      if (bd) { e.preventDefault(); S.recTab = 'board'; S.boardSpan = BOARD_SPAN; openRecords(bd.dataset.board, 'result'); return; }
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
      handleKey(JSON.parse(b.dataset.k));
      render();
    });
    $('#keybar').addEventListener('pointerdown', function (e) {
      // Buttons must not take focus away from the sink on phones.
      if (e.target.closest('button') && !e.target.closest('button').dataset.type) e.preventDefault();
    });

    window.addEventListener('resize', function () { if (S.screen === 'game') render(); });
    setInterval(function () { if (S.screen === 'game' && !S.confirm && !S.prompt && !S.message) renderStatus(); }, 30000);

    showScreen('title');

    // A read-only view for the tests. Playing still goes through the keyboard.
    window.tmuxDa = {
      records: function () { return JSON.parse(JSON.stringify(REC.load())); },
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
          activePane: ap ? ap.id : null,
          panes: win ? T.panesOf(win).map(function (p) { return p.id; }) : [],
          copyMode: ap ? ap.mode === 'copy' : false,
          copyAt: ap && ap.mode === 'copy' ? { ln: ap.cy, col: ap.cx, sel: ap.sel == null ? null : [ap.sel, ap.selx], lines: ap.lines.length } : null,
          input: ap ? ap.input : null,
          cursor: ap ? (ap.cur == null ? ap.input.length : ap.cur) : null,
          promptValue: S.prompt ? S.prompt.value : null,
          clipboard: S.clipboard,
          run: b ? {
            course: b.course.id, phase: b.phase, i: b.i, n: b.qs.length, type: b.type, misses: b.misses,
            stage: b.stage, overs: b.overs, guides: b.guides, limit: b.limit,
            shuffled: b.shuffled, pauses: b.pauses, paused: b.paused,
            drill: !!b.course.drill, target: b.target, peek: !!b.peek, streak: b.streak || 0,
            order: b.q ? qText(b) : null,
            qs: b.qs.slice(), day: b.day,
            folded: b.q && b.phase === 'play' ? folded(b) : false,
            goals: b.q && b.phase === 'play' ? goalMarks().length : 0,
            goal: S.qGoal,
            note: (S.qNote || []).slice(),
            next: b.q && b.phase === 'play' ? guideMove(b) : null
          } : null,
          result: S.result,
          recCourse: S.screen === 'records' ? S.recCourse : null,
          detail: S.detail, conf: S.conf ? { prefix: S.conf.prefix.label, binds: S.conf.binds.length, navigator: S.conf.navigator } : null,
          cols: S.cols, rows: S.rows
        };
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
