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
        return raw ? JSON.parse(raw) : {};
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
    sessions: [],
    session: null,
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
    b.dataset.quiet = S.quiet ? '1' : '0';
    var dt = $('.detail-toggle');
    if (dt) { dt.setAttribute('aria-pressed', S.detail ? 'true' : 'false'); dt.textContent = S.detail ? tx('指示の詳細をしまう') : tx('手順の詳細を出す'); }
    var cs = $('#conf-state');
    if (cs) cs.textContent = S.conf ? tx('自分の設定（合図 {0}）', prefixLabel()) : tx('既定');
    var qt = $('.quiet-toggle');
    if (qt) { qt.textContent = S.quiet ? tx('静') : tx('動'); qt.setAttribute('aria-pressed', S.quiet ? 'true' : 'false'); qt.setAttribute('aria-label', S.quiet ? tx('飾りを動かす') : tx('飾りの動きを止める')); qt.title = S.quiet ? tx('静か（飾りは止まっている）') : tx('動く（飾りが動く）'); }
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
        pane.lines.push(tx('tmux の操作は {0} を押して離してからキーを押す。押すキーは画面の上の指示に出ている', prefixLabel()));
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
      if (/^(a|attach|attach-session)$/.test(sub)) { attach(); return; }
      if (sub === 'ls' || sub === 'list-sessions') { sessionLines().forEach(function (l) { o.lines.push(l); }); return; }
      if (sub === '' || sub === 'new' || sub === 'new-session') {
        o.lines.push({ html: '<span class="sh-dim">' + esc(tx('それは新しいセッションを作るコマンド。セッションは裏でそのまま残っている —— tmux attach で戻ろう。')) + '</span>' });
        return;
      }
      o.lines.push('usage: tmux [attach|ls]');
      return;
    }
    switch (cmd) {
      case 'help':
        o.lines.push(tx('使えるコマンド: tmux attach  tmux ls  ls  echo  clear  help'));
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
      S.outer.lines.push({ html: '<span class="sh-dim">' + esc(tx('ヒント: セッションは裏でそのまま残っている。tmux attach と打てば戻れる（tmux ls で確かめられる）。')) + '</span>' });
      render();
    }, 12000);
    $('#term').classList.add('powering-down');
    setTimeout(function () { $('#term').classList.remove('powering-down'); }, reduceMotion ? 0 : 700);
  }

  function attach() {
    S.detached = false;
    S.session.attached = true;
    clearTimeout(S.hintTimer);
    $('#term').classList.add('powering-up');
    setTimeout(function () { $('#term').classList.remove('powering-up'); }, reduceMotion ? 0 : 900);
  }

  // ---- sessions ------------------------------------------------------------

  function makeSession(name) {
    var s = T.createSession({ name: name, baseIndex: 0, paneBaseIndex: 0 });
    var w = T.createWindow(s, name === 'dojo' ? 'main' : 'zsh');
    s.active = w.id;
    S.sessions.push(s);
    return s;
  }

  function sessionByName(name) {
    for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].name === name) return S.sessions[i];
    return null;
  }

  function switchSession(s) {
    if (!s || s === S.session) return false;
    S.session.attached = false;
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
    return tx('ペイン {0}', h ? T.paneIndex(S.session, h.win, pane) : '?');
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

  // The house at the start of a run, the same for everyone: window main with one
  // pane on the left and two on the right (the classic editor-and-shells
  // layout), logs and build with two panes each. The focus starts on the big
  // pane of main and from then on goes only where the player takes it.
  function buildHouse() {
    newSession();
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
    note(tx('全画面を解除した'));
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
    if (k.meta) return false;

    if (S.confirm) {
      if (k.key === 'y' || k.key === 'Y') { var yes = S.confirm.yes; S.confirm = null; yes(); }
      else if (k.key === 'n' || k.key === 'N' || k.key === 'Escape' || k.key === 'q' || (k.ctrl && k.key === 'c')) S.confirm = null;
      return true;
    }
    if (S.prompt) {
      if (k.key === 'Enter') { var p = S.prompt; S.prompt = null; p.done(p.value); return true; }
      if (k.key === 'Escape' || (k.ctrl && (k.key === 'c' || k.key === 'g'))) { S.prompt = null; return true; }
      lineEdit(S.prompt, 'value', k);
      return true;
    }
    if (S.picker) return pickerKey(k);

    if (isPrefix(k)) {
      S.repeatUntil = 0;
        if (S.armed) {
        // Prefix twice: send-prefix. The shell gets the key itself, so C-b
        // (or C-a) still moves the cursor, as in a real tmux.
        S.armed = false;
        if (pane.mode !== 'copy') lineEdit(pane, 'input', prefixEvent());
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
      if (CF.overridden(S.conf, k)) { message('そのキーには割り当てがない'); S.lastAction = 'unbound'; return true; }
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

    if (k.key === 'Escape') return true;
    var nx = S.run && S.run.phase === 'play' && S.run.q ? guideMove(S.run) : null;
    if (nx && nx.pfx && nx.keys.indexOf(k.key) >= 0 && !k.ctrl && !k.alt) message(tx('{0} がシェルに入った。先に {1}（prefix）を押す', k.key, prefixLabel()));
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
      prefixedKey({ key: a.key, code: /^[0-9]$/.test(a.key) ? 'Digit' + a.key : undefined, ctrl: false, alt: false, shift: false, meta: false }, win, pane);
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
    if (!T.resizePane(win, pane.id, axis, n, S.cols, S.rows)) {
      var other = axis === 'lr' ? '↑ / ↓' : '← / →';
      message(win.zoomed ? '全画面中は大きさを変えられない（z で戻す）'
        : T.panesOf(win).length < 2 ? 'ペインが 1 つだけなので動かせない。先に分割しよう'
        : tx('この向きにはもう動かせない。反対向きか、{0} を試そう', other));
    }
  }

  function prefixedKey(k, win, pane) {
    var key = k.key;
    var rz = resizeBinding(k);
    if (rz) { resize(win, pane, rz); armRepeat(); S.lastAction = 'resize'; return true; }

    // Alt+1..5: select-layout (tmux). e.code survives Option's character remap on a Mac.
    if (k.alt && !k.ctrl && /^Digit[1-5]$/.test(k.code || '')) {
      T.applyLayout(win, T.LAYOUTS[Number(k.code.slice(5)) - 1]);
      S.lastAction = 'layout';
      return true;
    }
    if (k.ctrl || k.alt) { message('そのキーには割り当てがない'); S.lastAction = 'unbound'; return true; }

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
    if (key === 'z') { win.zoomed = !win.zoomed; S.lastAction = 'zoom'; return true; }
    if (key === 'x') {
      var idx = T.paneIndex(S.session, win, pane);
      S.lastAction = 'close';
      S.confirm = {
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
        text: 'kill-window ' + win.name + '? (y/n)',
        yes: function () { if (!T.killWindow(S.session, win.id)) message('最後のウィンドウは閉じられない'); }
      };
      return true;
    }
    if (key === 'c') { var w = T.createWindow(S.session, 'zsh'); T.selectWindow(S.session, w.id); nameRoom(T.activePane(w)); S.lastAction = 'new_window'; return true; }
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
      message('押すキーは画面の上の指示に出ている');
      return true;
    }
    if (key === '$') {
      S.lastAction = 'rename_session';
      var sess = S.session;
      S.prompt = { label: '(rename-session)', value: sess.name, done: function (v) { if (v.trim() && !sessionByName(v.trim())) sess.name = v.trim(); } };
      return true;
    }
    if (key === 's' || key === 'w') { openPicker(); S.lastAction = 'choose'; return true; }
    if (key === '(' || key === ')') {
      var at = S.sessions.indexOf(S.session);
      var n = S.sessions.length;
      switchSession(S.sessions[((at + (key === ')' ? 1 : -1)) % n + n) % n]);
      S.lastAction = 'choose';
      return true;
    }
    if (key === '{' || key === '}') { T.swapStep(win, key === '{' ? -1 : 1); S.lastAction = 'swap'; return true; }
    if (key === ' ') { T.nextLayout(win); S.lastAction = 'layout'; return true; }
    if (key === ']') { paste(pane); return true; }
    if (key === ':') { S.lastAction = 'cmd'; S.prompt = { label: ':', value: '', done: runTmuxCommand }; return true; }
    if (key === 'l') {
      if (S.session.last && T.windowById(S.session, S.session.last)) T.selectWindow(S.session, S.session.last);
      else message('no last window ― l は直前のウィンドウへ戻るキー。隣のペインへは矢印か o');
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
    S.lastAction = 'unbound';
    message('そのキーには割り当てがない');
    return true;
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
      var nn = argv.slice(1).join(' ').trim();
      if (nn && !sessionByName(nn)) S.session.name = nn;
      S.lastAction = 'rename_session';
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
      openPicker();
      S.lastAction = 'choose';
    } else if (/^(list-sessions|ls)$/.test(cmd)) {
      message(sessionLines().join(' / '));
    } else {
      message('unknown command: ' + cmd);
      S.lastAction = 'unbound';
    }
  }

  // ---- copy mode -----------------------------------------------------------

  function realLines(pane) {
    var out = [];
    for (var i = 0; i < pane.lines.length; i++) if (!(pane.lines[i] && pane.lines[i].clear)) out.push(i);
    return out;
  }

  function enterCopy(pane) {
    pane.mode = 'copy';
    var el = paneBodyEl(pane.id);
    pane.scrollTop = el ? el.scrollHeight - el.clientHeight : 0;
    var ls = realLines(pane);
    pane.cy = ls.length ? ls[ls.length - 1] : 0;
    pane.sel = null;
  }

  function stepLine(pane, from, dir) {
    var ls = realLines(pane);
    var at = ls.indexOf(from);
    if (at < 0) return ls.length ? ls[ls.length - 1] : 0;
    var j = Math.max(0, Math.min(ls.length - 1, at + dir));
    return ls[j];
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
    if (copies && pane.sel != null) { yank(pane); return true; }
    if (key === 'v' || key === 'y') { message(key === 'v' ? 'tmux の v は矩形選択の切り替え。選び始めは Space（emacs 式は C-Space）' : 'tmux の y には割り当てがない。コピーは Enter（emacs 式は M-w）'); return true; }
    if (key === 'q' || key === 'Escape' || key === 'Enter' || (k.ctrl && (key === 'c' || key === 'g'))) { pane.mode = null; return true; }
    if (begins) { pane.sel = pane.cy; S.lastAction = 'yank_start'; return true; }
    if (k.ctrl && key === 'p') { pane.cy = stepLine(pane, pane.cy, -1); pane.reveal = 'edge'; return true; }
    if (k.ctrl && key === 'n') { pane.cy = stepLine(pane, pane.cy, 1); pane.reveal = 'edge'; return true; }
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
    if (key === 'ArrowUp' || key === 'k') { pane.cy = stepLine(pane, pane.cy, -1); pane.reveal = 'edge'; return true; }
    if (key === 'ArrowDown' || key === 'j') { pane.cy = stepLine(pane, pane.cy, 1); pane.reveal = 'edge'; return true; }
    if (key === 'PageUp' || (k.alt && key === 'v') || (k.ctrl && key === 'b')) pane.scrollTop -= page;
    else if (key === 'PageDown' || (k.ctrl && key === 'v') || (k.ctrl && key === 'f')) pane.scrollTop += page;
    else if (k.ctrl && key === 'u') pane.scrollTop -= page / 2;
    else if (k.ctrl && key === 'd') pane.scrollTop += page / 2;
    else if (key === 'g' || key === 'Home') pane.scrollTop = 0;
    else if (key === 'G' || key === 'End') pane.scrollTop = max;
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
      if (lineText(pane.lines[j]).toLowerCase().indexOf(term) >= 0) {
        pane.cy = j;
        if (pane.sel == null) pane.reveal = 'center';
        else pane.reveal = 'edge';
        return;
      }
    }
    message(tx('見つからない: {0}', pane.search.term));
  }

  function yank(pane) {
    var a = Math.min(pane.sel, pane.cy), b = Math.max(pane.sel, pane.cy);
    var out = [];
    for (var i = a; i <= b; i++) if (!(pane.lines[i] && pane.lines[i].clear)) out.push(lineText(pane.lines[i]).replace(/\s+$/, ''));
    S.clipboard = out.join('\n');
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
    pane.pasted = true;
  }

  // ---- the session picker (choose-tree) ---------

  function openPicker() {
    S.picker = { idx: Math.max(0, S.sessions.indexOf(S.session)) };
  }

  function pickerKey(k) {
    var n = S.sessions.length;
    var key = k.key;
    if (key === 'ArrowUp' || key === 'k') S.picker.idx = (S.picker.idx - 1 + n) % n;
    else if (key === 'ArrowDown' || key === 'j') S.picker.idx = (S.picker.idx + 1) % n;
    else if (key === 'Enter') { switchSession(S.sessions[S.picker.idx]); S.picker = null; S.lastAction = 'choose'; }
    else if (/^[0-9]$/.test(key) && Number(key) < n) { switchSession(S.sessions[Number(key)]); S.picker = null; S.lastAction = 'choose'; }
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
    S.messageTimer = setTimeout(function () { S.message = null; renderStatus(); }, 1800);
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
    if (e.key === 'Unidentified' || e.key === 'Process' || e.isComposing) return;
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
      if ((k === 'k' || k === 'K') && !$('#btn-keiko').hidden) return go(function () { startRun('keiko'); });
      if (k === 'r' || k === 'R') return go(function () { S.recTab = 'growth'; openRecords(null, 'title'); });
      if (k === 'b' || k === 'B') return go(openBoard);
    } else if (S.screen === 'result' && S.result) {
      if (k === 'Enter' || k === ' ') return go(function () { startRun(S.result.course); });
      if ((k === 'k' || k === 'K') && REC.weakTypes(3).length) return go(function () { startRun('keiko'); });
      if (k === 'r' || k === 'R') return go(function () { S.recTab = 'growth'; openRecords(REC.courseOf(S.result.course).practice ? lastCourse(REC.load()) : S.result.course, 'result'); });
      if (k === 'Escape') return go(function () { showScreen('title'); });
    } else if (S.screen === 'records') {
      if (k === 'Escape') return go(function () { showScreen(S.recordsFrom === 'result' && S.result ? 'result' : 'title'); });
    }
  }

  // Soft keyboards may not produce usable keydown events; take the text.
  function onSinkInput(e) {
    var sink = e.target;
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
    win.zoomed = z;
    if (!best) return null;
    var p = T.findPane(S.session, id);
    var dir = tx(DIR_WORDS[best.d]);
    var where = best.dist < 0 && p ? tx('{0}の{1} へ', dir, paneLabel(p.pane)) : tx('{0}へ', dir);
    var m = mv([ARROWS[best.d]], tx('{0} を押す（{1}）', ARROWS[best.d], where));
    m.alt = altMoves(win, id);
    return m;
  }

  // Other ways to the pane in one step: o (the next pane in order) and ;
  // (the pane you were in last). Shown beside the 手順, never required.
  function altMoves(win, id) {
    var out = [];
    if (win.last === id && T.findPane(S.session, id)) {
      out.push(mv([';'], '直前のペインへ戻る'));
    }
    var ps = T.panesOf(win);
    var at = ps.findIndex(function (q) { return q.id === win.active; });
    if (ps.length > 2 && ps[(at + 1) % ps.length].id === id) out.push(mv(['o'], '次のペインへ'));
    else if (ps.length === 2) out.push(mv(['o'], 'もう一つのペインへ'));
    return out;
  }

  // ---- the 手順 in the player's own keys ----------------------------------

  // The default key labels of the 手順, as what they do.
  var LABEL_SIG = {
    '%': 'k:%', '"': 'k:"', '←': 'k:ArrowLeft', '→': 'k:ArrowRight', '↑': 'k:ArrowUp', '↓': 'k:ArrowDown',
    z: 'k:z', x: 'k:x', c: 'k:c', ',': 'k:,', n: 'k:n', p: 'k:p', l: 'k:l', '[': 'k:[', ']': 'k:]',
    '{': 'k:{', '}': 'k:}', '&': 'k:&', o: 'k:o', ';': 'k:;', ':': 'k::', $: 'k:$', s: 'k:s', d: 'k:d', Space: 'k: '
  };
  ['L', 'R', 'U', 'D'].forEach(function (d) { LABEL_SIG['Ctrl+' + ARROWS[d]] = 'r:' + d + ':1'; LABEL_SIG['Option+' + ARROWS[d]] = 'r:' + d + ':5'; });
  var ARROW_KEY = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' };
  // What to type at : when the player's file leaves an action with no key.
  var CMD_FOR = { 'k:%': 'split-window -h', 'k:"': 'split-window', 'k:x': 'kill-pane', 'k:&': 'kill-window', 'k:c': 'new-window', 'k:,': tx('rename-window 名前'), 'k:{': 'swap-pane -U', 'k:}': 'swap-pane -D', 'k: ': 'next-layout', 'k:d': 'detach' };

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
    if (found) return { label: found.key.label, pfx: found.table === 'prefix', n: found.act.n, root: found.table === 'root' };
    if (!CF.overridden(S.conf, labelEvent(label))) return { label: label, pfx: true, same: true };
    return { none: true, cmd: CMD_FOR[want] };
  }

  function ownMove(m) {
    if (!m || !m.pfx || m.keys.length !== 1) return m;
    var o = ownKey(m.keys[0]);
    if (o.same) return m;
    if (o.none) {
      return o.cmd ? mv([':'], tx('この設定ではキーがない。: を押して {0} と打ち Enter', o.cmd))
        : mv([], 'この設定ではこの操作のキーがない', true);
    }
    var text = m.text.replace(m.keys[0], o.label).replace(/（Shift\+\d）|（ダブルクォート）| \(Shift\+\d\)| \(double quote\)/g, '');
    if (o.n) text = text.replace(/（1 回[^）]*）| \(\d+ cells? per press[^)]*\)/, tx('（1 回 {0} マス{1}）', o.n, o.n < 5 ? tx('。続けて押す') : ''));
    if (o.root) text += tx('（prefix なし）');
    return { pfx: o.pfx, keys: [o.label], text: text };
  }

  // The move the 手順 shows now, in the player's keys.
  function guideMove(b) {
    var m = b.q.next();
    if (!m || !S.conf) return m;
    var out = ownMove(m);
    if (m.alt) {
      out = { pfx: out.pfx, keys: out.keys, text: out.text };
      out.alt = m.alt.map(ownMove).filter(function (a) { return a.keys.length && a.keys[0] !== ':' && a.keys[0] !== out.keys[0]; });
    }
    return out;
  }

  function closeMove(id) {
    if (S.confirm) return mv(['y'], 'y を押す（閉じる）', true);
    return moveTo(id) || mv(['x'], 'x を押す（確認が出る）');
  }

  // To window `id`: by its number, as the status bar shows it.
  function windowMove(id, verb) {
    var w = T.windowById(S.session, id);
    if (!w) return null;
    return mv(['0-9'], tx(verb ? '{0} を押す（{1} に戻る）' : '{0} を押す（{1} へ）', w.index, winLabel(w)));
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
      var cr = T.rectOf(copy, win.active, S.cols, S.rows);
      if (cr && r && (Math.abs(cr.w - S.q0.w) >= 5 || Math.abs(cr.h - S.q0.h) >= 3)) { pick = i; break; }
    }
    var lb = LV.KEYS.resize[pick];
    return mv([lb], tx(/^Option/.test(lb) ? '{0} を押す（1 回で 5 マス）' : '{0} を押す（1 回 1 マス。続けて 5 回）', lb));
  }

  // How far the active pane has moved since the question began.
  function resizedBy() {
    var w = T.activeWindow(S.session);
    var rr = S.q0 && T.rectOf(w, S.q0.id, S.cols, S.rows);
    if (!rr) return 0;
    return Math.max(Math.abs(rr.w - S.q0.w), Math.abs(rr.h - S.q0.h));
  }

  function swapMove() {
    return moveTo(S.target) || mv(['{'], '{ を押す（前のペインと入れ替わる。左上に着くまで）');
  }

  // Every question: text (the generic order, for lists; setup may write a
  // specific one into S.qText), the tmux command it teaches, the actions it
  // may use (others are misses), the key actions to show, setup(r): what it
  // needs of the live house and what it targets, check(), next(): the move
  // the guide shows from the current state, and goal(): what to change,
  // marked in the house itself (完成図) — {pane, mark, tag} on a room or
  // {tab, tag} on a window in the status bar ('+' for a new one).
  function activeId() { return T.activeWindow(S.session).active; }

  var Q = {
    split_lr: {
      text: '左右に分割する（split）', cmd: 'split-window -h', allow: ['split_lr'], show: ['split_lr'],
      goal: function () { return [{ pane: activeId(), mark: 'split-v', tag: 'ここを左右に' }]; },
      setup: function () { S.q0 = splitCount(T.activeWindow(S.session), 'lr'); },
      check: function () { return splitCount(T.activeWindow(S.session), 'lr') > S.q0; },
      next: function () { return mv(['%'], '% を押す（Shift+5）。右に新しいペインが開く'); }
    },
    split_tb: {
      text: '上下に分割する（split）', cmd: 'split-window -v', allow: ['split_tb'], show: ['split_tb'],
      goal: function () { return [{ pane: activeId(), mark: 'split-h', tag: 'ここを上下に' }]; },
      setup: function () { S.q0 = splitCount(T.activeWindow(S.session), 'tb'); },
      check: function () { return splitCount(T.activeWindow(S.session), 'tb') > S.q0; },
      next: function () { return mv(['"'], '" を押す（ダブルクォート）。下に新しいペインが開く'); }
    },
    focus: {
      text: '隣のペインへ移動する', cmd: 'select-pane -L/-R/-U/-D', allow: [], show: ['focus'],
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
      text: 'このペインを全画面にする（zoom）', cmd: 'resize-pane -Z', allow: ['zoom'], show: ['zoom'],
      goal: function () { return [{ pane: activeId(), mark: 'zoom', tag: 'ここを全画面に' }]; },
      setup: function () { needUnzoom(); needPanes(2); },
      check: function () { return T.activeWindow(S.session).zoomed; },
      next: function () { return mv(['z'], 'z を押す。このペインだけが画面いっぱいになる'); }
    },
    unzoom: {
      text: '全画面をやめて元の分割に戻す', cmd: 'resize-pane -Z', allow: ['zoom'], show: ['zoom'],
      goal: function () { return [{ pane: activeId(), mark: 'unzoom', tag: '元の分割に戻す' }]; },
      setup: function () { needZoom(); },
      check: function () { return !T.activeWindow(S.session).zoomed; },
      next: function () { return mv(['z'], 'もう一度 z を押す。元の分割に戻る'); }
    },
    close: {
      text: 'ペインを閉じる（kill-pane）', cmd: 'kill-pane', allow: ['close'], show: ['focus', 'close'],
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
      text: '新しいウィンドウを作る', cmd: 'new-window', allow: ['new_window'], show: ['new_window'],
      goal: function () { return [{ tab: '+', tag: '新しいウィンドウ' }]; },
      setup: function () { S.q0 = S.session.windows.length; },
      check: function () { return S.session.windows.length > S.q0; },
      next: function () { return mv(['c'], 'c を押す（create）。新しいウィンドウが開く'); }
    },
    select_window: {
      text: 'ほかのウィンドウへ移動する', cmd: 'select-window -t 番号', allow: ['select_window'], show: ['select_window'],
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
      text: 'このペインの大きさを変える（resize）', cmd: 'resize-pane -L/-R/-U/-D', allow: ['resize'], show: ['resize'],
      goal: function () { var d = resizedBy(); return [{ pane: S.q0.id, mark: 'resize', tag: d ? tx('いま {0} マス動いた（5 マスで成功）', d) : '境目を 5 マス以上動かす' }]; },
      setup: function () {
        needUnzoom(); needPanes(2);
        var win = T.activeWindow(S.session);
        var rr = T.rectOf(win, win.active, S.cols, S.rows);
        S.q0 = { id: win.active, w: rr ? rr.w : 0, h: rr ? rr.h : 0 };
      },
      // Only a resize counts: moving to a pane of another size is not one.
      check: function () {
        var w = T.activeWindow(S.session);
        var rr = T.rectOf(w, S.q0.id, S.cols, S.rows);
        return S.lastAction === 'resize' && !!rr && !w.zoomed && (Math.abs(rr.w - S.q0.w) >= 5 || Math.abs(rr.h - S.q0.h) >= 3);
      },
      next: resizeMove
    },
    swap: {
      text: 'ペインを左上まで入れ替えて動かす（swap）', cmd: 'swap-pane -U', allow: ['swap'], show: ['swap'],
      goal: function () { return [{ pane: S.target, mark: 'to-left', tag: '左上へ' }]; },
      setup: function (r) {
        needUnzoom(); needPanes(2);
        // The pane you are in, unless it is at the top left already.
        var p = isFirst(activeId()) ? pick(r, otherPanes()) : T.activePane(T.activeWindow(S.session));
        S.target = p.id;
        S.qText = function () { return tx('{0} を左上まで動かす（swap）', paneLabel(p)); };
      },
      check: function () { return isFirst(S.target); },
      next: swapMove
    },
    rename: {
      text: 'ウィンドウの名前を変える（rename）', cmd: 'rename-window', allow: ['rename'], show: ['rename'],
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
        if (S.prompt) return mv([], tx('Ctrl+u（か Backspace）で今の名前「{0}」を消し、{1} と打って Enter', S.prompt.value, S.q0.name), true);
        var w = T.windowById(S.session, S.q0.win);
        if (w && w.name !== S.q0.from && w.name !== S.q0.name) return mv([','], tx('名前が「{0}」になった。もう一度 , を押して、{1} に直す', w.name, S.q0.name));
        return mv([','], ', を押す（カンマ）。名前の入力欄が出る');
      }
    },
    kill_window: {
      text: 'ウィンドウを閉じる（kill-window）', cmd: 'kill-window', allow: ['kill_window', 'select_window'], show: ['select_window', 'kill_window'],
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
        if (S.confirm) return mv(['y'], 'y を押す（閉じる）', true);
        if (S.session.active !== S.q0) return windowMove(S.q0);
        return mv(['&'], '& を押す（確認が出る）');
      }
    },
    copy_top: {
      text: 'スクロールして一番上まで戻る（copy mode）', cmd: 'copy-mode → history-top', allow: ['copy'], show: ['copy'],
      goal: function () { return [{ pane: S.target, mark: 'top', tag: '一番上まで' }]; },
      setup: function () {
        var pane = T.activePane(T.activeWindow(S.session));
        pane.mode = null;
        pane.lines.push({ html: '<span class="sh-prompt">' + esc(promptText(pane)) + '</span>cat makimono.txt' });
        printScroll(pane);
        S.target = pane.id;
      },
      check: function () {
        var h = T.findPane(S.session, S.target);
        if (!h || h.pane.mode !== 'copy') return false;
        var info = scrollInfo(h.pane);
        return info && info.history > 30 && info.pos >= info.history - 2;
      },
      next: function () {
        var p = T.activePane(T.activeWindow(S.session));
        if (p.mode === 'copy') return mv(['g'], 'g を押す（一番上へ）', true);
        return mv(['['], '[ を押す（コピーモードに入る）');
      }
    },
    find_zoom: {
      text: 'ペインへ移動して全画面にする', cmd: 'select-pane → resize-pane -Z', allow: ['zoom'], show: ['focus', 'zoom'],
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
      text: '左右に分割し、右側をさらに上下に分割する', cmd: 'split-window -h → -v', allow: ['split_lr', 'split_tb'], show: ['split_lr', 'split_tb'],
      // The shape is read around the pane the question started in: a new
      // left-right split with it on the left and a top-bottom pair on the right.
      goal: function () {
        var s = tridentState();
        if (s === 'start') return [{ pane: S.q0.pane, mark: 'split-v', tag: 'まず左右に' }];
        if (s === 'right') return [{ pane: S.q0.right, mark: 'split-h', tag: '右側を上下に' }];
        return [{ pane: activeId(), mark: 'close', tag: '閉じてやり直す' }];
      },
      setup: function () {
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
        if (s === 'start') return mv(['%'], '% を押す（まず左右に）');
        if (s === 'right') return moveTo(S.q0.right) || mv(['"'], '" を押す（右側を上下に）');
        return mv(['x'], '形が違う。x → y でペインを閉じて、% → " の順にやり直す');
      }
    },
    two_akima: {
      text: 'ペインを二つ閉じる', cmd: 'kill-pane ×2', allow: ['close'], show: ['focus', 'close'],
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
      text: '新しいウィンドウを作って、元のウィンドウに戻る', cmd: 'new-window → select-window', allow: ['new_window', 'select_window'], show: ['new_window', 'select_window'],
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
      text: 'ペインを左上まで動かして全画面にする', cmd: 'swap-pane → resize-pane -Z', allow: ['swap', 'zoom'], show: ['swap', 'zoom'],
      goal: function () { return isFirst(S.target) ? [{ pane: S.target, mark: 'zoom', tag: 'ここを全画面に' }] : [{ pane: S.target, mark: 'to-left', tag: '左上へ' }]; },
      setup: function (r) {
        needUnzoom(); needPanes(2);
        var p = isFirst(activeId()) ? pick(r, otherPanes()) : T.activePane(T.activeWindow(S.session));
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
    two_akima: '二つ閉じる', new_and_home: '作って戻る', swap_zoom: '入れ替えて全画面'
  };
  function typeName(t) { return TYPE_NAMES[t] ? tx(TYPE_NAMES[t]) : t; }

  // A new order, avoiding the same question twice in a row where it can.
  // `rand` makes it repeatable (today's order); Math.random otherwise.
  function shuffle(a, rand) {
    rand = rand || Math.random;
    for (var tries = 0; tries < 50; tries++) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      if (a.every(function (x, n) { return n === 0 || a[n - 1] !== x; })) break;
    }
    return a;
  }

  // The ghost (影) to race: today's fastest player if faster than you, else
  // your own best. Your own is there at once; today's arrives if it can.
  function pickGhost(b) {
    if (b.course.practice) { b.ghost = null; return; }
    var own = REC.ghostOf(b.course.id);
    b.ghost = own;
    if (!NET || !NET.state().key) return;
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
  // the ランキング compares like with like. The 苦手の稽古 asks your weakest types.
  function questionsFor(course, day) {
    if (course.practice) {
      var weak = REC.weakTypes(3);
      var list = [];
      weak.forEach(function (t) { list.push(t, t, t); });
      return pairZoom(shuffle(list));
    }
    return pairZoom(shuffle(course.qs.slice(), rng(day + ':' + course.id)));
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

  function prepareRun(courseId) {
    var course = REC.courseOf(courseId) || REC.courseOf('easy');
    var day = LV.dayKey();
    S.run = {
      course: course,
      day: day,
      qs: questionsFor(course, day),
      // Question types learnt before this run: their 手順 stays folded.
      learnt: REC.learnt(),
      limit: course.limit,
      i: 0,
      phase: 'ready',
      penalty: 0, misses: 0, overs: 0, guides: 0, keys: 0,
      start: 0, qStart: 0, end: 0,
      stage: 0,
      ghostDiff: null,
      // Today's rooms are the same for everyone too.
      seed: course.practice ? course.id + ':' + Math.random() : day + ':' + course.id
    };
    pickGhost(S.run);
    prepGhost(S.run);
  }

  function beginRun() {
    var b = S.run;
    b.phase = 'count';
    b.i = 0;
    b.penalty = 0; b.misses = 0; b.overs = 0; b.guides = 0; b.keys = 0;
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
    var type = b.qs[b.i];
    var q = Q[type];
    // The house stays as it is; only a half-typed prompt or confirm is dropped.
    S.armed = false;
    S.confirm = null;
    S.prompt = null;
    S.picker = null;
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
    b.qStart = performance.now();
    b.qlog[b.i] = { t: type, s: null, m: 0 };
    S.clipboard = '';
  }

  function qText(b) { var t = S.qText; return typeof t === 'function' ? t() : t || tx(b.q.text); }

  // After every key: a miss, or the question solved.
  function runTick() {
    var b = S.run;
    if (!b || b.phase !== 'play') return;
    var free = ['brief', 'focus', 'yank_start', 'search', 'cmd'];
    if (S.lastAction && free.indexOf(S.lastAction) < 0 &&
        (S.lastAction === 'unbound' || b.q.allow.indexOf(S.lastAction) < 0)) {
      miss();
    }
    if (b.q.check()) {
      b.streak = (b.streak || 0) + 1;
      AU.se('hit', b.streak);
      termFlash('hit');
      var used = (performance.now() - b.qStart) / 1000;
      b.qlog[b.i].s = +used.toFixed(2);
      // Against the ghost: where you are now versus where it was here.
      if (b.ghost && b.ghost.cum) b.ghostDiff = (performance.now() - b.start) / 1000 + b.penalty - b.ghost.cum[b.i];
      if (b.streak % 5 === 0) chip('good', '5 問連続 ・ ミスなし');
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
    if (b.i >= b.qs.length) { finishRun(); return; }
    loadQuestion();
    render();
    startClock();
  }

  function miss() {
    var b = S.run;
    b.misses += 1;
    b.streak = 0;
    b.penalty += LV.MISS_PENALTY;
    if (b.qlog[b.i]) b.qlog[b.i].m += 1;
    AU.se('miss');
    chip('miss', tx('操作ミス +{0} 秒', LV.MISS_PENALTY));
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
      if (!b.peek && used > LV.PEEK_AFTER && folded(b)) { b.peek = true; renderSashizu(); renderTerm(); renderTabArrow(); }
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

  function finishRun() {
    var b = S.run;
    clearInterval(S.clock);
    b.phase = 'done';
    count('finish');
    b.end = performance.now();
    var raw = (b.end - b.start) / 1000;
    var time = raw + b.penalty;
    var result = {
      course: b.course.id, time: time, raw: raw, misses: b.misses, overs: b.overs, guides: b.guides,
      keys: b.keys, n: b.qs.length, avg: time / b.qs.length, qlog: b.qlog, limit: b.limit
    };
    var sum = REC.add({
      course: b.course.id, prefix: S.conf ? S.conf.prefix.label : 'C-b', conf: S.conf ? 1 : undefined,
      time: +time.toFixed(2), raw: +raw.toFixed(2), misses: b.misses, overs: b.overs, guides: b.guides,
      keys: b.keys, n: b.qs.length, qs: b.qlog
    });
    for (var k in sum) result[k] = sum[k];
    // The question that ran longest past its 目安, to practise next.
    var slow = null;
    b.qlog.forEach(function (q) { if (q.o && (!slow || q.s > slow.s)) slow = q; });
    result.slow = slow ? slow.t : null;
    var pool = [];
    b.qs.forEach(function (t) { Q[t].show.forEach(function (a) { pool = pool.concat(LV.tipsFor(a)); }); });
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

  function lastCourse(all) {
    var runs = (all.runs || []).filter(function (r) { var c = REC.courseOf(r.course); return c && !c.practice; });
    var last = runs.slice(-1)[0];
    return last ? last.course : 'easy';
  }

  // 今日の問題: every course asks in today's order, the same for everyone
  // (Japan time), so today's times compare. The day, your streak, and per
  // course today's top time on the boards.
  function dayLabel(day) { var p = day.split('-'); return tx('{0}月{1}日', +p[1], +p[2]); }

  function renderToday(all) {
    var el = $('#today');
    if (!el) return;
    var sk = REC.streak(all);
    var line = sk.days ? (sk.today ? tx('{0} 日連続', sk.days) : tx('{0} 日連続（今日まだ）', sk.days)) : '';
    el.innerHTML = '<b>' + esc(tx('今日の問題')) + '</b> <span class="today-day">' + esc(dayLabel(LV.dayKey())) + '</span>' +
      (line ? '<span class="today-streak">' + esc(line) + '</span>' : '') +
      '<small>' + esc(tx('今日はみんな同じ順番で出る。日本時間の 0 時に変わる。')) + '</small>';
  }

  function topHTML(id) {
    var t = S.tops && S.tops[id];
    if (!t) return '';
    return esc(tx('今日の一番 {0}', tx('{0}秒', t.time.toFixed(1))));
  }

  // Reading the boards sends nothing of the player's; only from the site.
  function loadTops() {
    if (!NET || !/^https?:$/.test(location.protocol) || S.topsAt && Date.now() - S.topsAt < 60000) return;
    S.topsAt = Date.now();
    S.tops = S.tops || {};
    LV.COURSES.forEach(function (c) {
      NET.board(c.id, 'today').then(function (rows) {
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
    $('#title-meta').textContent = sk ? tx('腕前 Lv.{0}', sk.lv) : tx('合図 {0}', prefixLabel());
  }

  function renderTitle() {
    var all = REC.load();
    $('#skill').innerHTML = skillHTML(REC.skill(all));
    var weak = REC.weakTypes(3);
    var kb = $('#btn-keiko');
    kb.hidden = !weak.length;
    if (weak.length) $('#keiko-sub').textContent = tx('苦手: {0}', weak.map(function (t) { return typeName(t); }).join(tx('・')));
    var pick = lastCourse(all);
    var html = '';
    LV.COURSES.forEach(function (c) {
      var runs = REC.runsOf(c.id, all);
      var best = REC.best(c.id, all);
      var a5 = ao5(runs);
      html += '<li><button type="button" class="wing' + (c.id === pick ? ' hot' : '') + '" data-course="' + c.id + '">' +
        planHTML(c) +
        '<span class="wing-main"><span class="wing-name">' + esc(c.title) +
        '<span class="wing-n">' + tx('{0} 問題', c.qs.length) + '</span>' +
        '<span class="wing-mode' + (c.recommended ? ' rec' : '') + '">' + esc(c.mode) + '</span></span>' +
        '<span class="wing-desc">' + tx('目安 {0} 秒／問。', c.limit) + esc(c.desc) + '</span></span>' +
        '<span class="wing-best"><small>' + tx('自己ベスト') + '</small><b>' + (best ? fmt(best.time) : '—') + '</b>' +
        '<small>' + (runs.length ? (a5 != null ? tx('五回平均 {0} ・ ', a5.toFixed(1)) : '') + tx('{0} 回', runs.length) : tx('お手本 {0} 秒', LV.par(c))) + '</small>' +
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
    renderMeta(all);
  }

  // Whether this question's 手順 is folded: its type is learnt (覚えた) and
  // the 目安 has not passed yet.
  function folded(b) {
    var e = b.learnt && b.learnt[b.qs[b.i]];
    return !!(e && e.learnt) && b.stage === 0 && !b.peek;
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
    var n = b.qs.length;
    var html = '<div class="sz-lab"><span>' + tx('指 図') + '</span><b>' + kanji(Math.min(b.i + 1, n)) + ' ／ ' + kanji(n) + '</b></div>';
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
    html += '<div class="sz-cmd">tmux: <code>' + esc(tx(b.q.cmd)) + '</code></div>';
    if (move) {
      html += '<div class="shinan"><div class="shinan-t">' + tx('手順') + '</div><ol>' +
        steps(move).map(function (s, i, all) {
          var now = all.findIndex(function (x) { return !x.done; });
          return '<li class="' + (s.done ? 'done' : i === now ? 'now' : '') + '"><span class="no">' + kanji(i + 1) + '</span>' + esc(s.text) + tick(s.done) + '</li>';
        }).join('') + '</ol></div>';
      if (move.alt && move.alt.length) html += '<span class="sz-alt">' + tx('別解: ') + move.alt.map(function (a) { return altHTML(a) + ' ' + esc(a.text); }).join(tx('、')) + '</span>';
    } else if (fold) {
      html += '<p class="learnt-note">' + tx('覚えた問題。{0} 秒で手順が出る。', LV.PEEK_AFTER) + '</p>';
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
    var n = b.qs.length;
    var c = '';
    // A question in two steps shows one step at a time; the whole order
    // stays above it, small.
    var st = b.q.step && b.q.step();
    var html = st ? '<div class="ob-whole">' + c + esc(qText(b)) + '</div>' : '';
    html += '<div class="motd-h">' + c + '<span class="ob-n">' + Math.min(b.i + 1, n) + '/' + n + '</span> ' +
      (st ? '<span class="ob-step">' + (st[0] ? tx('手順 {0}/{1}', st[0], st[1]) : tx('やり直し')) + '</span> ' : '') +
      '<b class="ob-q">' + esc(st ? tx(st[2]) : qText(b)) + '</b> <span class="ob-cmd">tmux: ' + esc(tx(b.q.cmd)) + '</span></div>';
    if (S.qNote.length) html += '<div class="ob-note">' + c + esc(S.qNote.join(tx('。'))) + '</div>';
    if (move) {
      var keys = '';
      steps(move).forEach(function (s, i) {
        if (i) keys += '<span class="arr">→</span>';
        if (s.key) keys += '<kbd class="pfx' + (s.done ? ' done' : ' next') + '">' + esc(s.key) + tick(s.done) + '</kbd>';
        else keys += s.keys.length ? keycaps(s.keys, S.armed || !move.pfx ? s.keys : []) : '<kbd>…</kbd>';
      });
      html += '<div class="ob-guide">' + c + '<span class="motd-go" aria-hidden="true">▶</span><span class="ob-keys">' + keys + '</span><span class="ob-txt">' + esc(move.text) + '</span></div>';
      if (move.alt && move.alt.length && !S.armed) html += '<div class="ob-alt">' + c + tx('別解') + ' ' + move.alt.map(altHTML).join(' ／ ') + '</div>';
    } else if (fold) {
      html += '<div class="ob-guide learnt">' + c + tx('覚えた ✓') + '<span class="ob-txt">' + tx('思い出して押す。{0} 秒で手順が出る', LV.PEEK_AFTER) + '</span></div>';
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
    el.innerHTML = '<span class="pb-course">' + esc(b.course.title) + tx(' ・ 問題 ') + '<b>' + Math.min(b.i + 1, b.qs.length) + ' / ' + b.qs.length + '</b></span>' +
      (b.streak >= 3 ? '<span class="pb-streak">' + tx('{0} 連', b.streak) + '</span>' : '') +
      (S.conf ? '<span class="pb-conf">' + tx('自分のキー設定（prefix {0}）', prefixLabel()) + '</span>' : '') +
      '<span class="pb-sp"></span>' +
      (b.misses ? '<span class="pb-pen">' + tx('操作ミス {0}（+{1}秒）', b.misses, b.penalty) + '</span>' : '') +
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
    if (o) o.textContent = used > b.limit ? tx('目安を過ぎた') : '';
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
    marks.forEach(function (g) { if (g.pane) wanted[g.pane] = true; });
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
      el.className = 'pane' + (isActive ? ' active' : '') + (wanted[p.id] ? ' wanted' : '') + (size ? ' ' + size : '') + (el.dataset.anim ? ' ' + el.dataset.anim : '');
      el.style.cssText = 'left:' + (r.x * cw) + 'px;top:' + (r.y * ch) + 'px;width:' + wpx + 'px;height:' + hpx + 'px';
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
        (p.mode === 'copy' ? '' : order) +
        '<div class="sh-line"><span class="sh-prompt">' + esc(promptText(p)) + '</span>' + withCursor(p.input, p.cur, isActive && p.mode !== 'copy') + '</div>';
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
    $$(':scope > .goal, :scope > .goal-arrow, :scope > .goal-key, :scope > .guide-card, :scope > .here-tag', term).forEach(function (x) { x.remove(); });
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
    if (playing && !anchor && active && !marks.some(function (g) { return g.tab; })) anchor = { x: (active.x + active.w / 2) * cw, y: (active.y + active.h / 2) * ch };
    // Where you stand, said in words on the pane itself: the card never covers it.
    if (playing && active) term.insertAdjacentHTML('beforeend', '<span class="here-tag" style="left:' + (active.x * cw + 6) + 'px;top:' + (active.y * ch + 6) + 'px">' + tx('いまここ') + '</span>');
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
          for (var i = 0; i < lines.length; i++) if (lines[i].offsetTop >= el.scrollTop) { p.cy = Number(lines[i].dataset.ln); break; }
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

  // The guide card: the order and the keys, in the one place the eyes go
  // (on the arrow, or on the pane to change). Kept inside the terminal.
  function placeCard(term, x, y, inner, tag, cls) {
    var el = document.createElement('div');
    el.className = 'guide-card motd' + (cls ? ' ' + cls : '');
    el.innerHTML = (tag ? '<div class="gc-tag">' + esc(tag) + '</div>' : '') + inner;
    term.appendChild(el);
    var w = el.offsetWidth, h = el.offsetHeight, W = term.clientWidth, H = term.clientHeight;
    // Never on top of "いまここ" or "ここへ": slide up or down off them,
    // whichever stays closest to the arrow.
    var tr = term.getBoundingClientRect();
    var keep = $$(':scope > .here-tag, :scope > .goal .goal-tag', term).map(function (k) {
      var r = k.getBoundingClientRect();
      return { l: r.left - tr.left - 4, t: r.top - tr.top - 4, r: r.right - tr.left + 4, b: r.bottom - tr.top + 4 };
    });
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
    // The status bar is a prompt now (rename): the card stays, on your pane.
    if (!tab) {
      if (b && b.phase === 'play' && b.q && S.prompt && !$(':scope > .guide-card', term)) {
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
    term.insertAdjacentHTML('beforeend', arrowSVG(x1, y1, x2, y2, 4, '', 'tab'));
    // A window question: the guide card rides this arrow.
    if (b && b.phase === 'play' && b.q && !$(':scope > .guide-card:not(.tab)', term)) {
      placeCard(term, arrowMid.x, arrowMid.y, motdHTML(b, fold ? null : guideMove(b), fold), '', 'tab');
    }
  }

  function tabGoal(name) {
    var found = null;
    goalMarks().forEach(function (g) { if (g.tab === name) found = g; });
    return found;
  }

  function goalMarks() {
    var b = S.run;
    if (!b || b.phase !== 'play' || !b.q || !b.q.goal || S.detached) return [];
    try { return (b.q.goal() || []).map(function (g) { var o = {}; for (var k in g) o[k] = g[k]; if (o.tag) o.tag = tx(o.tag); return o; }); } catch (e) { return []; }
  }

  function markCursor(el, p) {
    $$('.cl', el).forEach(function (x) { x.classList.remove('cl'); });
    var line = $('[data-ln="' + p.cy + '"]', el);
    if (line) line.classList.add('cl');
  }

  function pickerHTML() {
    var html = '<div class="picker" role="listbox" aria-label="' + tx('セッション') + '">';
    html += '<div class="picker-head">' + tx('(choose-tree)  ↑↓ で選んで Enter') + '</div>';
    S.sessions.forEach(function (s, i) {
      html += '<div class="picker-row' + (i === S.picker.idx ? ' on' : '') + '">(' + i + ') ' + esc(s.name) + ': ' + s.windows.length + ' windows' + (s === S.session ? ' (attached)' : '') + '</div>';
    });
    return html + '</div>';
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
    var a = -1, b = -1;
    if (copyPane && copyPane.sel != null) { a = Math.min(copyPane.sel, copyPane.cy); b = Math.max(copyPane.sel, copyPane.cy); }
    for (var j = 0; j < lines.length; j++) {
      var l = lines[j];
      if (l && l.clear) {
        if (j === lastClear) out += '<div class="sh-clear"></div>';
        continue;
      }
      var cls = 'sh-line';
      if (copyPane) {
        if (j === copyPane.cy) cls += ' cl';
        if (j >= a && j <= b) cls += ' sel';
      }
      var body = typeof l === 'string' ? (l === '' ? '&nbsp;' : esc(l)) : l.html;
      out += '<div class="' + cls + '" data-ln="' + j + '">' + body + '</div>';
    }
    return out;
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
    var html = '<span class="st-session">[' + esc(S.session.name) + ']</span><span class="st-wins">';
    S.session.windows.forEach(function (w) {
      var flag = w.id === S.session.active ? '*' : (w.id === S.session.last ? '-' : '');
      if (w.id === S.session.active && w.zoomed) flag += 'Z';
      var g = tabGoal(w.id);
      html += '<span class="st-win' + (w.id === S.session.active ? ' cur' : '') + (g ? ' goal-tab' + (g.mark === 'close' ? ' close' : '') : '') + '">' + w.index + ':' + esc(w.name) + flag + (g ? '<span class="goal-tag">' + esc(g.tag) + '</span>' : '') + '</span>';
    });
    var gn = tabGoal('+');
    if (gn) html += '<span class="st-win goal-tab new">' + S.session.windows.length + ':＋<span class="goal-tag">' + esc(gn.tag) + '</span></span>';
    html += '</span><span class="st-right">';
    if (S.armed) html += '<span class="st-prefix">PREFIX</span>';
    else if (Date.now() < S.repeatUntil) html += '<span class="st-prefix repeat">REPEAT</span>';
    var ap = T.activePane(win);
    if (ap.mode === 'copy') html += '<span class="st-mode">COPY' + (ap.sel != null ? ' SEL' : '') + '</span>';
    if (S.clipboard) html += '<span class="st-clip" title="' + tx('コピーした内容') + '">📋</span>';
    html += '<span class="st-host">"dojo"</span><span class="st-clock">' + clock() + '</span></span>';
    bar.innerHTML = html;
  }

  function clock() {
    var d = new Date();
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
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
    if (label === 'PgUp') return { key: 'PageUp' };
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
    if (S.run && S.run.q) S.run.q.show.forEach(function (a) { (LV.KEYS[a] || []).forEach(function (l) { var o = ownKey(l); if (!o.none) labels.push(o.label); }); });
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
    if (name !== 'result') music();
  }

  function startRun(courseId) {
    store.save({ prefix: S.prefix });
    S.result = null;
    buildHouse();
    prepareRun(courseId);
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
      return '<i class="' + (r.rec ? 'rec' : '') + (i === list.length - 1 ? ' now' : '') + '" style="height:' + Math.max(8, Math.round(r.time / max * 100)) + '%"></i>';
    }).join('') + '</div>';
  }

  function wareki(d) {
    if (EN) return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  // The result as a hand scroll (記録): the time, against お手本, the rank
  // as a seal, the details and the last ten runs.
  function renderResult() {
    var r = S.result;
    var el = $('#result-body');
    if (!r || !el) return;
    var c = REC.courseOf(r.course);
    var diff = r.time - r.par;
    var verdict = diff <= 0
      ? tx('お手本 {0} 秒を <b>{1} 秒</b> 上回った', r.par, Math.abs(diff).toFixed(1))
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
    var slow = r.slow ? Q[r.slow] : null;
    var slowKeys = [];
    if (slow) slow.show.forEach(function (a) { (LV.KEYS[a] || []).forEach(function (k) { if (slowKeys.indexOf(k) < 0) slowKeys.push(k); }); });
    var isRec = !!(r.record && r.count > 1);
    el.classList.toggle('is-rec', isRec);
    el.innerHTML =
      '<div class="em-hd">' + tx('絵 巻 ・ {0} 回 目', kanji(Math.min(r.count, 99))) + '</div>' +
      '<h2 class="em-title">' + (c.practice ? tx('稽古を終えた。') : tx('奥の間に辿り着いた。')) + '</h2>' +
      '<div class="em-sub">' + esc(tx('{0} ・ 問題 {1} ・ {2}', c.title, r.n, wareki(r.at))) + '</div>' +
      '<div class="em-row"><div class="em-time">' + r.time.toFixed(1) + '<small>' + tx('秒') + '</small></div>' +
      '<div class="em-verdict">' + verdict + '<span class="em-tip">' + esc(sub) + '</span></div></div>' +
      '<div class="em-rank' + (r.rankUp ? ' up' : '') + '"><span class="hanko" aria-hidden="true">' + (EN ? esc(tx(r.rank)) : esc(r.rank).replace(/^(.{3})(.+)$/, '$1<br>$2')) + '</span><span>' + rankLine + '</span></div>' +
      '<div class="skill em-skill">' + skillHTML(r.skill, r.skillFrom) + '</div>' +
      learntHTML(r) +
      '<dl class="em-facts">' +
      '<div><dt>' + tx('1 問あたり') + '</dt><dd>' + tx('{0}秒', r.avg.toFixed(2)) + '</dd></div>' +
      '<div><dt>' + tx('実時間') + '</dt><dd>' + tx('{0}秒', r.raw.toFixed(1)) + '</dd></div>' +
      '<div><dt>' + tx('操作ミス') + '</dt><dd>' + tx('{0}（+{1}秒）', r.misses, r.misses * LV.MISS_PENALTY) + '</dd></div>' +
      '<div><dt>' + tx('目安超え') + '</dt><dd>' + tx('{0} 問題', r.overs) + '</dd></div>' +
      '<div><dt>' + tx('自己ベスト') + '</dt><dd>' + fmt(r.record ? r.time : r.best) + '</dd></div>' +
      '<div><dt>' + tx('押したキー') + '</dt><dd>' + r.keys + '</dd></div>' +
      '</dl>' +
      resultNetHTML(r) +
      shareHTML(r) +
      spark(r.spark) +
      '<div class="spark-l"><span>' + (slow ? esc(tx('いちばん時間がかかった問題: {0}（{1} → {2}）', tx(slow.text), prefixLabel(), slowKeys.join(' '))) : r.overs ? '' : tx('目安超えなし。どの問題も目安のうちに解いた')) + '</span>' +
      (r.spark && r.spark.length > 1 ? '<span>' + tx('■ 自己ベスト ■ 今回') + '</span>' : '') + '</div>' +
      (r.tip ? '<div class="tips"><div class="tips-head">' + tx('豆知識') + '</div><p>' + esc(r.tip) + '</p></div>' : '') +
      '<div class="cta"><button type="button" class="btn primary" data-course="' + r.course + '">' + (c.practice ? tx('もう一度 稽古') : tx('もう一度')) + '<kbd class="hk">Enter</kbd></button>' +
      (!c.practice && REC.weakTypes(3).length ? '<button type="button" class="btn" data-course="keiko">' + tx('苦手を稽古') + '<kbd class="hk">K</kbd></button>' : '') +
      '<button type="button" class="btn" data-records="' + (c.practice ? lastCourse(REC.load()) : r.course) + '">' + tx('記録を見る') + '<kbd class="hk">R</kbd></button>' +
      '<button type="button" class="btn ghost" data-title="1">' + tx('コース選択へ') + '<kbd class="hk">Esc</kbd></button></div>';
    renderMeta();
    if ((isRec || r.rankUp) && S.celebrated !== r.runId) { S.celebrated = r.runId; celebrate(); }
  }

  // ---- ランキング and 合言葉 ---------------------------------------------------------
  // All optional: with no network the game is exactly as before.

  // After a run: bring the history in line with the other devices, then
  // enter the run on the boards when the player has a name.
  function shareRun(runId) {
    var r = S.result;
    if (!NET || !r) return;
    // Nothing leaves the browser until the player gives a name or a 合言葉.
    if (!NET.state().key) { r.board = REC.courseOf(r.course).practice ? null : { state: 'noname' }; return; }
    // 稽古 is kept in step between devices but never goes on the boards.
    if (REC.courseOf(r.course).practice) { NET.sync().catch(function () {}); return; }
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
      return q.m || q.o ? '🟥' : q.s != null && q.s <= r.limit / 2 ? '🟩' : '🟨';
    });
    var rows = [];
    for (var i = 0; i < sq.length; i += 10) rows.push(sq.slice(i, i + 10).join(''));
    var d = LV.dayKey(r.at).split('-');
    return tx('tmux 道場 {0} {1} {2}秒（お手本 {3}秒）{4}', +d[1] + '/' + +d[2], c.title, r.time.toFixed(1), r.par, tx(r.rank)) + '\n' +
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
    if (r.learntNew && r.learntNew.length) html += '<p class="em-learnt">' + tx('覚えた: ') + '<b>' + r.learntNew.map(typeName).map(esc).join(tx('・')) + '</b>' + tx('（次から手順を畳む）') + '</p>';
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
    if (b.state === 'ok') html += '<p class="em-board">' + tx('今日のランキング <b>{0} 位</b> ／ {1} 人', b.rank, b.total) + ' ・ <a href="#" data-board="' + r.course + '">' + tx('ランキングを見る') + '</a></p>';
    if (b.state === 'refused') html += '<p class="em-board dim">' + tx('この記録はランキングに載せられなかった（手で解いた記録だけが載る）。') + '</p>';
    if (b.state === 'noname') {
      html += '<form class="em-board name-form" data-name-form="result"><label>' + tx('名前を付けると、今日のランキングに載る') + '</label>' +
        '<span class="nf-row"><input name="name" maxlength="12" autocomplete="nickname" placeholder="' + tx('名前（12 文字まで）') + '"><button type="submit" class="btn">' + tx('ランキングに載せる') + '</button></span>' +
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
      msg.textContent = tx(e && e.status === 409 ? 'その名前は他の人が使っている。別の名前で。' :
        e && e.status === 400 ? '使えない名前。12 文字まで。' : 'つながらなかった。あとでもう一度。');
    });
  }

  // ランキング: each player's best for the course, today / this week / ever.
  function renderBoard(body, id) {
    var span = S.boardSpan || 'today';
    var seg = '<div class="seg rec-span" role="group" aria-label="' + tx('期間') + '">' +
      [['today', '今日'], ['week', '今週'], ['all', '全期間']].map(function (x) {
        return '<button type="button" data-span="' + x[0] + '" aria-pressed="' + (x[0] === span ? 'true' : 'false') + '">' + tx(x[1]) + '</button>';
      }).join('') + '</div>';
    var me = NET ? NET.state().name : null;
    var key = id + '|' + span;
    var cached = S.boardCache && S.boardCache[key];
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
      '<div class="board-body">' + (cached ? table(cached.rows) : '<p class="rec-empty">' + tx('読み込み中……') + '</p>') + '</div>' + note + '</div>';
    if (cached && Date.now() - cached.at < 15000) return;
    if (!NET) return;
    // Looking at the boards is the player's choice; reading sends nothing of theirs.
    NET.board(id, span).then(function (rows) {
      S.boardCache = S.boardCache || {};
      S.boardCache[key] = { rows: rows, at: Date.now() };
      if (S.screen === 'records' && S.recTab === 'board' && S.recCourse === id && (S.boardSpan || 'today') === span) renderRecords();
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
      '<form class="name-form" data-key-form><span class="nf-row"><input name="key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + tx('例: matsu-kaze-tsuru-482') + '"><button type="submit" class="btn">' + tx('この合言葉にする') + '</button></span>' +
      '<small class="nf-msg">' + tx('この端末の記録も、その合言葉の側に合わさる。') + '</small></form></div>' +
      '<div class="rec-panel"><div class="rec-head">' + tx('ランキングの名前') + '</div>' +
      '<form class="name-form" data-name-form="records"><span class="nf-row"><input name="name" maxlength="12" autocomplete="nickname" value="' + esc(st.name || '') + '" placeholder="' + tx('名前（12 文字まで）') + '"><button type="submit" class="btn">' + tx(st.name ? '変える' : '付ける') + '</button></span>' +
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
  function openBoard() {
    S.recTab = 'board'; S.boardSpan = 'today';
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
        esc(tx('{0} {1}秒 操作ミス {2}', recDate(r.at), r.time.toFixed(1), r.misses)) + '</title></rect>';
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
    $('#records-screen .rec-seg').hidden = tab === 'sync';
    var body = $('#records-body');
    if (tab === 'board') { renderBoard(body, id); return; }
    if (tab === 'sync') { renderSync(body); return; }
    var st = REC.stats(id);
    if (!st) {
      body.innerHTML = '<div class="rec-log"><p>' + tx('{0}（{1}）の記録は、まだ白紙。', esc(c.title), esc(c.mode)) + '</p><p>' + tx('一度はじめると、ここに上達が描かれていく。') + '</p></div>' +
        '<div class="cta"><button type="button" class="btn primary" data-course="' + id + '">' + tx('{0}に入る', esc(c.title)) + '</button></div>' + rankPanel(c, '');
      return;
    }
    var gain = st.first.time - st.best;
    var head = st.count === 1
      ? '<p>' + tx('挑戦 1 回。もう一度入ると、ここに上達が出る。') + '</p>'
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
    body.innerHTML = '<div class="rec-log">' + head + '</div>' + tiles + rankPanel(c, st.bestRank) + chart + weakPanel(id) + learntPanel() + table;
  }

  // Every title and the time it needs on this course (misses included),
  // the one you hold marked.
  function rankPanel(c, mine) {
    var n = c.qs.length, mul = c.rankMul || 1;
    var rows = LV.RANKS.map(function (r, i) {
      var t = isFinite(r.max) ? tx('{0} 秒以内', Math.round(r.max * mul * n)) : tx('{0} 秒より遅い', Math.round(LV.RANKS[i - 1].max * mul * n));
      var per = isFinite(r.max) ? tx('1 問 {0} 秒', (r.max * mul).toFixed(1)) : '';
      return '<tr class="' + (r.title === mine ? 'is-rec' : '') + '"><td class="r-rank">' + esc(tx(r.title)) + '</td><td class="r-time">' + t + '</td><td class="r-note">' + per + '</td><td class="r-star">' + (r.title === mine ? tx('いまここ') : '') + '</td></tr>';
    }).join('');
    return '<div class="rec-panel rec-ranks"><div class="rec-head">' + tx('称号の一覧（{0}・{1} 問）', esc(c.title), n) + '</div><table class="rec-table"><thead><tr><th>' + tx('称号') + '</th><th>' + tx('タイム') + '</th><th class="r-note">' + tx('目安') + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function weakPanel(id) {
    var w = REC.weakness(id, 10);
    if (!w) return '<div class="rec-panel rec-weak"><div class="rec-head">' + tx('目安を超えがちな問題') + '</div><p class="rec-empty">' + tx('2 回入ると、苦手な問題が見えてくる。') + '</p></div>';
    var row = function (e) {
      var q = Q[e.type];
      var keys = [];
      q.show.forEach(function (a) { (LV.KEYS[a] || []).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
      return '<li><span class="w-text">' + esc(tx(q.text)) + '</span>' +
        '<span class="w-num">' + tx('平均 {0}秒 ・ 違い {1}%', e.avg.toFixed(1), Math.round(e.missRate * 100)) + (e.overs ? tx(' ・ 目安超え {0}', e.overs) : '') + '</span>' +
        '<span class="w-keys"><kbd class="pfx">' + esc(prefixLabel()) + '</kbd><span class="arr">→</span>' + keycaps(keys) + '</span></li>';
    };
    return '<div class="rec-panel rec-weak"><div class="rec-head">' + tx('目安を超えがちな問題（直近 {0} 回）', w.runs) + '</div><ol class="weak-list">' +
      w.weak.map(row).join('') + '</ol>' +
      (w.strong ? '<p class="w-strong">' + tx('得意: ') + '<b>' + esc(tx(Q[w.strong.type].text)) + '</b> ' + tx('平均 {0}秒', w.strong.avg.toFixed(1)) + '</p>' : '') +
      (REC.weakTypes(3).length ? '<div class="cta"><button type="button" class="btn" data-course="keiko">' + tx('苦手だけ稽古する（{0}）', REC.weakTypes(3).map(typeName).join(tx('・'))) + '</button></div>' : '') +
      '</div>';
  }

  // Which question types are learnt (手順 folded) and how close the rest are.
  function learntPanel() {
    var l = REC.learnt();
    var types = Object.keys(TYPE_NAMES).filter(function (t) { return l[t]; });
    if (!types.length) return '';
    var done = types.filter(function (t) { return l[t].learnt; });
    return '<div class="rec-panel learnt-list"><div class="rec-head">' + tx('覚えた問題 {0} ／ {1}', done.length, types.length) + '</div><ul>' +
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
    html += '<h4>' + tx('使う {0} 行', c.used.length) + (c.custom ? tx('（合図 {0}）', esc(c.prefix.label)) : '') + '</h4>';
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
    // The side panel is the detail; the order is in the house. Quiet (no
    // looping decoration) unless the player asks for motion.
    S.detail = saved.detail === true;
    S.quiet = saved.quiet !== false;
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
    $('.quiet-toggle').addEventListener('click', function () { S.quiet = !S.quiet; store.save({ quiet: S.quiet }); syncBody(); });

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
        leaveRun();
        showScreen('title');
      });
    });
    $('#result-screen').addEventListener('click', function (e) {
      if (e.target.closest('[data-share]')) { copyShare(); return; }
      var r = e.target.closest('[data-records]');
      if (r) { S.recTab = 'growth'; openRecords(r.dataset.records || null, 'result'); return; }
      var bd = e.target.closest('[data-board]');
      if (bd) { e.preventDefault(); S.recTab = 'board'; S.boardSpan = 'today'; openRecords(bd.dataset.board, 'result'); return; }
      var b = e.target.closest('[data-course]');
      if (b) { startRun(b.dataset.course); return; }
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
    $('#term').addEventListener('pointerdown', function () { focusSink(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) pauseRun(); });
    window.addEventListener('pagehide', function () { if (S.run && S.run.phase !== 'done') count('quit', S.run.i); });
    count('visit');
    window.addEventListener('blur', pauseRun);
    $('#pause').addEventListener('pointerdown', function (e) { e.preventDefault(); resumeRun(); });
    // Vimium's Esc, a click on a key button: take the focus straight back.
    $('#sink').addEventListener('blur', function () { setTimeout(focusSink, 0); });
    $('#keybar').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.type) { $('#sink').focus(); return; }
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
          house: S.session ? S.session.createdAt.getTime() : null,
          windows: S.session ? S.session.windows.map(function (w) { return { index: w.index, name: w.name, active: w.id === S.session.active, panes: T.panesOf(w).length, zoomed: w.zoomed }; }) : [],
          activeWindow: win ? win.name : null,
          activeIndex: win ? win.index : null,
          activePane: ap ? ap.id : null,
          panes: win ? T.panesOf(win).map(function (p) { return p.id; }) : [],
          copyMode: ap ? ap.mode === 'copy' : false,
          input: ap ? ap.input : null,
          cursor: ap ? (ap.cur == null ? ap.input.length : ap.cur) : null,
          promptValue: S.prompt ? S.prompt.value : null,
          clipboard: S.clipboard,
          run: b ? {
            course: b.course.id, phase: b.phase, i: b.i, n: b.qs.length, type: b.type, misses: b.misses,
            stage: b.stage, overs: b.overs, guides: b.guides,
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
          quiet: S.quiet, detail: S.detail, conf: S.conf ? { prefix: S.conf.prefix.label, binds: S.conf.binds.length, navigator: S.conf.navigator } : null,
          cols: S.cols, rows: S.rows
        };
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
