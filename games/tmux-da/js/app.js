// tmux からくり屋敷, browser edition: screens, input, the fake shells and
// the run loop. The tmux model is in tmux.js, the courses and keys in
// levels.js, the records in records.js, the sound in audio.js.
(function () {
  'use strict';

  var T = ADV.tmux, LV = ADV.levels, AU = ADV.audio, REC = ADV.records;
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
    confirm: null,         // {text, yes}
    prompt: null,          // {label, value, done}
    picker: null,          // {idx}: choose-tree
    clipboard: '',
    detached: false,
    outer: null,           // the shell outside tmux
    target: null,          // pane id the question is about
    lastAction: null,      // what the last key did, for the miss check
    run: null,             // the course being played
    result: null,          // the last finished run, for the result screen
    message: null,
    messageTimer: 0,
    cols: 80, rows: 24, cellW: 8, cellH: 18,
    hinted: false,
    sound: true
  };

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function prefixKey() { return S.prefix === 'C-a' ? 'a' : 'b'; }
  function prefixLabel() { return LV.prefixLabel(S.prefix); }

  function syncBody() {
    var b = document.body;
    b.dataset.screen = S.screen;
    b.dataset.armed = S.armed ? '1' : (Date.now() < S.repeatUntil ? 'repeat' : '0');
    b.dataset.detached = S.detached ? '1' : '0';
    b.dataset.stage = S.run && S.run.phase === 'play' ? String(S.run.stage) : '0';
  }

  // ---- theme and sound ------------------------------------------------------

  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var dark = t === 'dark' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    $$('.theme-toggle').forEach(function (b) {
      b.setAttribute('aria-label', dark ? '昼の屋敷にする' : '夜の屋敷にする');
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
      b.setAttribute('aria-label', on ? '音を消す' : '音を出す');
      b.textContent = on ? '♪' : '×';
    });
  }

  // The tune that belongs to where the player is.
  function music() { AU.play(S.screen === 'game' ? 'play' : 'title'); }

  // ---- the fake shells ---------------------------------------------------

  var SCENE_LS = {
    kakejiku: 'kakejiku.txt  tokonoma/',
    akima: '',
    makimono: 'makimono.txt'
  };

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
        pane.lines.push('使えるコマンド: ls  echo  cat  pwd  clear  exit  tmux  help');
        pane.lines.push('tmux の操作は ' + prefixLabel() + ' を押して離してからキーを押す。押すキーは左の指図に出ている');
        break;
      case 'ls':
        if (SCENE_LS[pane.scene] !== '') pane.lines.push(SCENE_LS[pane.scene] || 'shoji.txt  andon');
        break;
      case 'pwd':
        pane.lines.push('/home/yashiki/' + (pane.name || 'ma'));
        break;
      case 'echo':
        pane.lines.push(argv.slice(1).join(' '));
        break;
      case 'cat':
        if (argv[1] === 'makimono.txt') pane.lines.push('長すぎて画面に収まらない。コピーモード（' + prefixLabel() + ' → [）で読もう。');
        else if (argv[1] === 'kakejiku.txt') pane.lines.push('「屋敷を出ても、仕掛けはそのまま。」');
        else pane.lines.push('cat: ' + (argv[1] || '') + ': そんなファイルはない');
        break;
      case 'clear':
        pane.lines.push({ clear: true });
        break;
      case 'exit':
        if (!T.killPane(win, pane.id)) {
          if (!T.killWindow(S.session, win.id)) pane.lines.push('最後の間は閉じられない。');
        }
        S.lastAction = 'close';
        break;
      case 'tmux':
        if (argv[1] === 'ls' || argv[1] === 'list-sessions') sessionLines().forEach(function (l) { pane.lines.push(l); });
        else if (!argv[1] || /^(a|attach|attach-session|new|new-session)$/.test(argv[1])) {
          pane.lines.push('sessions should be nested with care, unset $TMUX to force');
          pane.lines.push({ html: '<span class="sh-dim">（もう tmux の中にいる。デタッチは ' + esc(prefixLabel()) + ' → ' + esc(LV.HINTS.detach) + '）</span>' });
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
        o.lines.push({ html: '<span class="sh-dim">それは新しいセッションを作るコマンド。屋敷は裏でそのまま残っている —— tmux attach で戻ろう。</span>' });
        return;
      }
      o.lines.push('usage: tmux [attach|ls]');
      return;
    }
    switch (cmd) {
      case 'help':
        o.lines.push('使えるコマンド: tmux attach  tmux ls  ls  echo  clear  help');
        break;
      case 'ls':
        o.lines.push('README.md');
        break;
      case 'pwd':
        o.lines.push('/home/yashiki');
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
      S.outer.lines.push({ html: '<span class="sh-dim">ヒント: 屋敷は裏でそのまま残っている。tmux attach と打てば戻れる（tmux ls で確かめられる）。</span>' });
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
    var w = T.createWindow(s, name === 'yashiki' ? '母屋' : 'zsh');
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
    S.session = makeSession('yashiki');
    S.session.attached = true;
    S.detached = false;
    S.armed = false;
    S.confirm = null;
    S.prompt = null;
    S.picker = null;
  }

  // ---- staging: the rooms of the house -------------------------------------

  // Panes with nothing to do get a room name, so every pane has a label.
  var ROOM_NAMES = ['茶の間', '座敷', '納戸', '書院', '次の間', '仏間'];
  var SCENE_NAMES = { kakejiku: '掛け軸の間', akima: '空き間', makimono: '巻物の間' };

  function stagePane(pane, scene, name, opts) {
    opts = opts || {};
    pane.scene = scene;
    pane.name = name;
    pane.lines = [];
    pane.mode = null;
    if (scene === 'makimono') {
      var total = opts.length || 160;
      pane.lines.push({ html: '<span class="sh-head">==== 巻物 書き出し ====</span>', text: '==== 巻物 書き出し ====' });
      pane.lines.push({ html: '<span class="sh-gold">「屋敷を出ても、仕掛けはそのまま。」</span>', text: '「屋敷を出ても、仕掛けはそのまま。」' });
      for (var i = 3; i <= total; i++) {
        // Short enough for a half-width pane on a phone (about 22 cells).
        var txt = i % 50 === 0 ? '—— 第' + (i / 50 + 1) + '巻 ——' : i % 17 === 0 ? '……墨がかすれる……' : '……長い文が続く……';
        var n = (i < 100 ? ' ' : '') + (i < 10 ? ' ' : '') + i;
        pane.lines.push({ html: '<span class="sh-dim">' + n + '</span>  ' + esc(txt), text: n + '  ' + txt });
      }
      pane.lines.push('');
      pane.lines.push('書き出しには何とあった？ コピーモードで頭まで巻き戻そう。');
    }
  }

  // A new window in the current session, built from a list of scenes.
  // shape: 'single' | 'lr' | 'tb' | 'tiled' | 'evenh'. Returns {win, panes}.
  function room(name, scenes, shape, activeAt) {
    var win = T.createWindow(S.session, name);
    T.selectWindow(S.session, win.id);
    var panes = [T.activePane(win)];
    for (var i = 1; i < scenes.length; i++) panes.push(T.splitPane(win, panes[panes.length - 1].id, shape === 'tb' ? 'tb' : 'lr', null, true));
    var layout = { tiled: 'tiled', evenh: 'even-horizontal', lr: 'even-horizontal', tb: 'even-vertical' }[shape];
    if (layout && panes.length > 1) T.applyLayout(win, layout);
    var free = ROOM_NAMES.slice();
    scenes.forEach(function (sc, j) {
      if (sc) stagePane(panes[j], sc, SCENE_NAMES[sc] || '');
      else panes[j].name = free.shift();
    });
    win.active = panes[activeAt || 0].id;
    win.last = null;
    return { win: win, panes: panes };
  }

  function windowByName(name, session) {
    var found = null;
    (session || S.session).windows.forEach(function (w) { if (!found && w.name === name) found = w; });
    return found;
  }

  // The rectangle a pane would have with the window unzoomed.
  function rectUnzoomed(win, id) {
    var z = win.zoomed;
    win.zoomed = false;
    var r = T.rectOf(win, id, S.cols, S.rows);
    win.zoomed = z;
    return r;
  }

  function paneExists(id) { return !!T.findPane(S.session, id); }

  function isTrident(win) {
    var root = win.root;
    return root.type === 'split' && root.dir === 'lr' && root.a.type === 'pane' &&
      root.b.type === 'split' && root.b.dir === 'tb' && root.b.a.type === 'pane' && root.b.b.type === 'pane';
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

  function isPrefix(k) {
    return k.ctrl && !k.alt && !k.meta && !k.shift && k.key.toLowerCase() === prefixKey();
  }

  function handleGameKey(k) {
    if (S.detached) {
      if (isPrefix(k)) {
        if (!S.hinted) {
          S.hinted = true;
          S.outer.lines.push({ html: '<span class="sh-dim">（ここは屋敷の外。合図は効かない。tmux attach で戻ろう）</span>' });
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
      message('tmux のコピーは tmux の中にある。' + prefixLabel() + ' → ] で貼る');
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
        if (pane.mode !== 'copy') lineEdit(pane, 'input', { key: prefixKey(), ctrl: true });
        return true;
      }
      AU.se('prefix');
      S.armed = true;
      return true;
    }

    if (S.armed) {
      S.armed = false;
      return prefixedKey(k, win, pane);
    }


    if (Date.now() < S.repeatUntil) {
      var r = resizeBinding(k);
      if (r) { resize(win, pane, r); armRepeat(); S.lastAction = 'resize'; return true; }
      S.repeatUntil = 0;
    }

    if (pane.mode === 'copy') return copyModeKey(k, pane);

    if (k.key === 'Escape') return true;
    return editLine(pane, k, function (line) { runPaneCommand(pane, line); });
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
        : T.panesOf(win).length < 2 ? '間が 1 つだけなので動かせない。先に襖を立てよう'
        : 'この向きにはもう動かせない。反対向きか、' + other + ' を試そう');
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
      var nb = T.neighbour(win, S.cols, S.rows, moves[key]);
      if (nb) T.selectPane(win, nb.id);
      else if (win.zoomed) { win.zoomed = false; message('全画面を解除した'); }
      S.lastAction = 'focus';
      return true;
    }

    if (key === '%') { T.splitPane(win, pane.id, 'lr', null, false); S.lastAction = 'split_lr'; return true; }
    if (key === '"') { T.splitPane(win, pane.id, 'tb', null, false); S.lastAction = 'split_tb'; return true; }
    if (key === 'z') { win.zoomed = !win.zoomed; S.lastAction = 'zoom'; return true; }
    if (key === 'x') {
      var idx = T.paneIndex(S.session, win, pane);
      S.lastAction = 'close';
      S.confirm = {
        text: 'kill-pane ' + idx + '? (y/n)',
        yes: function () {
          if (!T.killPane(win, pane.id)) {
            if (!T.killWindow(S.session, win.id)) message('最後の間は閉じられない');
          }
        }
      };
      return true;
    }
    if (key === '&') {
      S.lastAction = 'kill_window';
      S.confirm = {
        text: 'kill-window ' + win.name + '? (y/n)',
        yes: function () { if (!T.killWindow(S.session, win.id)) message('最後の棟は閉じられない'); }
      };
      return true;
    }
    if (key === 'c') { var w = T.createWindow(S.session, 'zsh'); T.selectWindow(S.session, w.id); S.lastAction = 'new_window'; return true; }
    if (key === 'n') { T.nextWindow(S.session, 1); S.lastAction = 'select_window'; return true; }
    if (key === 'p') { T.nextWindow(S.session, -1); S.lastAction = 'select_window'; return true; }
    if (/^[0-9]$/.test(key)) {
      var target = T.windowByIndex(S.session, Number(key));
      if (target) T.selectWindow(S.session, target.id);
      else message('ウィンドウ ' + key + ' はない');
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
      message('押すキーは左の指図に書いてある');
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
    if (key === 'l') { if (S.session.last && T.windowById(S.session, S.session.last)) T.selectWindow(S.session, S.session.last); S.lastAction = 'select_window'; return true; }
    if (key === ';') { if (win.last && T.findPane(S.session, win.last)) T.selectPane(win, win.last); S.lastAction = 'focus'; return true; }
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
      S.lastAction = 'new_window';
    } else if (/^(rename-window|renamew)$/.test(cmd)) {
      if (argv[1]) win.name = argv.slice(1).join(' ');
      S.lastAction = 'rename';
    } else if (/^(split-window|splitw)$/.test(cmd)) {
      var lr = argv.indexOf('-h') > 0;
      T.splitPane(win, pane.id, lr ? 'lr' : 'tb', null, false);
      S.lastAction = lr ? 'split_lr' : 'split_tb';
    } else if (/^(kill-pane|killp)$/.test(cmd)) {
      if (!T.killPane(win, pane.id)) message('最後の間は閉じられない');
      S.lastAction = 'close';
    } else if (/^(kill-window|killw)$/.test(cmd)) {
      if (!T.killWindow(S.session, win.id)) message('最後の棟は閉じられない');
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
    message('見つからない: ' + pane.search.term);
  }

  function yank(pane) {
    var a = Math.min(pane.sel, pane.cy), b = Math.max(pane.sel, pane.cy);
    var out = [];
    for (var i = a; i <= b; i++) if (!(pane.lines[i] && pane.lines[i].clear)) out.push(lineText(pane.lines[i]).replace(/\s+$/, ''));
    S.clipboard = out.join('\n');
    pane.sel = null;
    pane.mode = null;
    S.lastAction = 'yank';
    message('コピーした: ' + S.clipboard.split('\n')[0].trim().slice(0, 40));
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

  function message(text) {
    S.message = text;
    clearTimeout(S.messageTimer);
    S.messageTimer = setTimeout(function () { S.message = null; renderStatus(); }, 1800);
  }

  // Real keyboard events become the normalised key object.
  function onKeyDown(e) {
    AU.unlock();
    if (S.screen !== 'game') return;
    var t = e.target;
    if (t && t !== document.body && t.id !== 'sink' && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    var k = { key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
    if (handleKey(k)) e.preventDefault();
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
  // A run is a fixed list of questions (仕掛け). Each builds a fresh session,
  // asks for one result, and checks the state after every key. A question
  // is never skipped: past its 目安 the keys light up (行灯), and at 1.5
  // times it a step-by-step guide (指南) appears.

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

  var WINGS = ['母屋', '離れ', '蔵'];

  // A move the guide can show: the prefix first or not, the key labels to
  // light (as in LV.KEYS), and what to do in words.
  function mv(keys, text, noPrefix) { return { pfx: !noPrefix, keys: keys, text: text }; }

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
      var nb = T.neighbour(win, S.cols, S.rows, d);
      if (!nb || !goal) return;
      var r = T.rectOf(win, nb.id, S.cols, S.rows);
      var dist = nb.id === id ? -1 : Math.abs((r.x + r.w / 2) - (goal.x + goal.w / 2)) + Math.abs((r.y + r.h / 2) - (goal.y + goal.h / 2));
      if (!best || dist < best.dist) best = { d: d, dist: dist };
    });
    win.zoomed = z;
    if (!best) return null;
    var p = T.findPane(S.session, id);
    var name = p && p.pane.name ? p.pane.name : 'その間';
    return mv([ARROWS[best.d]], name + 'は' + DIR_WORDS[best.d] + '。' + ARROWS[best.d] + ' を押して渡る');
  }

  function closeMove(id) {
    if (S.confirm) return mv(['y'], '確かめられたら y を押す', true);
    return moveTo(id) || mv(['x'], 'x を押して間を閉じる');
  }

  function windowMove(name, verb) {
    var w = windowByName(name);
    if (!w) return null;
    return mv(['0-9'], name + 'は ' + w.index + ' 番。' + w.index + ' を押して' + (verb || '渡る'));
  }

  function resizeMove() {
    var win = T.activeWindow(S.session);
    var r = T.rectOf(win, win.active, S.cols, S.rows);
    var label = LV.KEYS.resize[r && r.x === 0 ? 1 : 0];
    return mv([label], label + ' を押す' + (/^Option/.test(label) ? '（1 回で 5 マス）' : '（1 回 1 マス。続けて 5 回）'));
  }

  function swapMove() {
    return moveTo(S.target) || mv(['{'], '{ を押す（掛け軸の間が左へ回る）');
  }

  function atLeft(id) {
    var h = T.findPane(S.session, id);
    var rr = h && rectUnzoomed(h.win, id);
    return !!rr && rr.x === 0;
  }

  // Every question: text, the tmux command it teaches, the actions it may
  // use (others are misses), the key actions to show, setup(r), check() and
  // next(): the move the guide shows from the current state.
  var Q = {
    split_lr: {
      text: '襖を立てて、左右に仕切れ', cmd: 'split-window -h', allow: ['split_lr'], show: ['split_lr'],
      setup: function (r) { var x = room(WINGS[0], r() < 0.5 ? [null] : [null, null], 'tb', 0); S.q0 = splitCount(x.win, 'lr'); },
      check: function () { return splitCount(T.activeWindow(S.session), 'lr') > S.q0; },
      next: function () { return mv(['%'], '% を押す（Shift+5）。襖が縦に立つ'); }
    },
    split_tb: {
      text: '襖を立てて、上下に仕切れ', cmd: 'split-window -v', allow: ['split_tb'], show: ['split_tb'],
      setup: function (r) { var x = room(WINGS[0], r() < 0.5 ? [null] : [null, null], 'lr', 0); S.q0 = splitCount(x.win, 'tb'); },
      check: function () { return splitCount(T.activeWindow(S.session), 'tb') > S.q0; },
      next: function () { return mv(['"'], '" を押す（ダブルクォート）。襖が横に立つ'); }
    },
    focus: {
      text: '掛け軸の間へ渡れ', cmd: 'select-pane -L/-R/-U/-D', allow: [], show: ['focus'],
      setup: function (r) {
        var n = 3 + pickInt(r, 2), t = 1 + pickInt(r, n - 1);
        var sc = []; for (var i = 0; i < n; i++) sc.push(i === t ? 'kakejiku' : null);
        var x = room(WINGS[0], sc, 'tiled', 0); S.target = x.panes[t].id;
      },
      check: function () { return T.activeWindow(S.session).active === S.target; },
      next: function () { return moveTo(S.target); }
    },
    zoom: {
      text: '襖を外して、この間を大広間にせよ', cmd: 'resize-pane -Z', allow: ['zoom'], show: ['zoom'],
      setup: function (r) { room(WINGS[0], r() < 0.5 ? [null, null] : [null, null, null], 'tiled', 0); },
      check: function () { return T.activeWindow(S.session).zoomed; },
      next: function () { return mv(['z'], 'z を押す。いまの間が画面いっぱいになる'); }
    },
    unzoom: {
      text: '襖を戻して、大広間を元の間に', cmd: 'resize-pane -Z', allow: ['zoom'], show: ['zoom'],
      setup: function () { var x = room(WINGS[0], [null, null, null], 'tiled', 0); x.win.zoomed = true; },
      check: function () { return !T.activeWindow(S.session).zoomed; },
      next: function () { return mv(['z'], 'もう一度 z を押す。大広間が元に戻る'); }
    },
    close: {
      text: '空き間を閉じよ', cmd: 'kill-pane', allow: ['close'], show: ['focus', 'close'],
      setup: function (r) {
        var n = 2 + pickInt(r, 2), t = pickInt(r, n);
        var sc = []; for (var i = 0; i < n; i++) sc.push(i === t ? 'akima' : null);
        var x = room(WINGS[0], sc, 'tiled', t === 0 ? 1 : 0); S.target = x.panes[t].id;
      },
      check: function () { return !paneExists(S.target); },
      next: function () { return closeMove(S.target); }
    },
    new_window: {
      text: '離れを建てよ（新しい棟）', cmd: 'new-window', allow: ['new_window'], show: ['new_window'],
      setup: function () { room(WINGS[0], [null], 'single'); },
      ready: function () { S.q0 = S.session.windows.length; },
      check: function () { return S.session.windows.length > S.q0; },
      next: function () { return mv(['c'], 'c を押す（create）。新しい棟が建つ'); }
    },
    select_window: {
      text: null, cmd: 'select-window -t 番号', allow: ['select_window'], show: ['select_window'],
      setup: function (r) {
        WINGS.forEach(function (n) { room(n, [null], 'single'); });
        var from = pickInt(r, 3), to = (from + 1 + pickInt(r, 2)) % 3;
        T.selectWindow(S.session, windowByName(WINGS[from]).id);
        S.qText = WINGS[to] + 'へ渡り廊下を渡れ';
        S.q0 = WINGS[to];
      },
      check: function () { return T.activeWindow(S.session).name === S.q0; },
      next: function () { return windowMove(S.q0); }
    },
    resize: {
      text: '襖をずらして、この間を広げるか狭めよ', cmd: 'resize-pane -L/-R', allow: ['resize'], show: ['resize'],
      setup: function (r) {
        var x = room(WINGS[0], [null, null], 'lr', pickInt(r, 2));
        var rr = T.rectOf(x.win, x.win.active, S.cols, S.rows);
        S.q0 = rr ? rr.w : 0;
      },
      check: function () {
        var w = T.activeWindow(S.session);
        var rr = T.rectOf(w, w.active, S.cols, S.rows);
        return !!rr && !w.zoomed && Math.abs(rr.w - S.q0) >= 5;
      },
      next: resizeMove
    },
    swap: {
      text: '掛け軸の間を左端へ回せ', cmd: 'swap-pane -U', allow: ['swap'], show: ['swap'],
      setup: function (r) {
        var n = 2 + pickInt(r, 2);
        var sc = []; for (var i = 0; i < n; i++) sc.push(i === n - 1 ? 'kakejiku' : null);
        var x = room(WINGS[0], sc, 'evenh', n - 1); S.target = x.panes[n - 1].id;
      },
      check: function () { return atLeft(S.target); },
      next: swapMove
    },
    rename: {
      text: 'この棟に camp と名札を掛けよ', cmd: 'rename-window', allow: ['rename'], show: ['rename'],
      setup: function () { room('zsh', [null], 'single'); },
      check: function () { return T.activeWindow(S.session).name === 'camp'; },
      next: function () {
        if (S.prompt) return mv([], 'Ctrl+u で今の名前を消し、camp と打って Enter', true);
        return mv([','], ', を押す（カンマ）。名札を書く欄が出る');
      }
    },
    kill_window: {
      text: '棟「蔵」を丸ごと閉めよ', cmd: 'kill-window', allow: ['kill_window', 'select_window'], show: ['select_window', 'kill_window'],
      setup: function (r) {
        room(WINGS[0], [null], 'single');
        room(WINGS[2], ['akima', 'akima'], 'lr', 0);
        if (r() < 0.4) T.selectWindow(S.session, windowByName(WINGS[0]).id);
      },
      check: function () { return !windowByName(WINGS[2]); },
      next: function () {
        if (S.confirm) return mv(['y'], '確かめられたら y を押す', true);
        if (T.activeWindow(S.session).name !== WINGS[2]) return windowMove(WINGS[2]);
        return mv(['&'], '& を押す（アンパサンド）。棟ごと閉める');
      }
    },
    copy_top: {
      text: '巻物を頭まで巻き戻せ', cmd: 'copy-mode → history-top', allow: ['copy'], show: ['copy'],
      setup: function () { var x = room(WINGS[0], ['makimono'], 'single'); S.target = x.panes[0].id; },
      check: function () {
        var h = T.findPane(S.session, S.target);
        if (!h || h.pane.mode !== 'copy') return false;
        var info = scrollInfo(h.pane);
        return info && info.history > 30 && info.pos >= info.history - 2;
      },
      next: function () {
        var p = T.activePane(T.activeWindow(S.session));
        if (p.mode === 'copy') return mv(['g'], 'g を押す。巻物の頭まで一気に戻る', true);
        return mv(['['], '[ を押す。巻物を読むコピーモードに入る');
      }
    },
    find_zoom: {
      text: '掛け軸の間を大広間にせよ', cmd: 'select-pane → resize-pane -Z', allow: ['zoom'], show: ['focus', 'zoom'],
      setup: function (r) {
        var t = 1 + pickInt(r, 3);
        var sc = [null, null, null, null]; sc[t] = 'kakejiku';
        var x = room(WINGS[0], sc, 'tiled', 0); S.target = x.panes[t].id;
      },
      check: function () { var w = T.activeWindow(S.session); return w.active === S.target && w.zoomed; },
      next: function () { return moveTo(S.target) || mv(['z'], 'z を押して大広間に'); }
    },
    trident: {
      text: '左に一間、右に上下二間を仕切れ', cmd: 'split-window -h → -v', allow: ['split_lr', 'split_tb'], show: ['split_lr', 'split_tb'],
      setup: function () { room(WINGS[0], [null], 'single'); },
      check: function () { return isTrident(T.activeWindow(S.session)); },
      next: function () {
        var win = T.activeWindow(S.session);
        var n = T.panesOf(win).length;
        if (n === 1) return mv(['%'], '% を押して、まず左右に仕切る');
        if (n === 2 && win.root.dir === 'lr') {
          return moveTo(win.root.b.pane.id) || mv(['"'], '右の間で " を押して、上下に仕切る');
        }
        return mv(['x'], '形が違う。x → y で間を閉じて、% → " の順にやり直す');
      }
    },
    two_akima: {
      text: '空き間を二つとも閉じよ', cmd: 'kill-pane ×2', allow: ['close'], show: ['focus', 'close'],
      setup: function (r) {
        var a = 1 + pickInt(r, 3), b = 1 + (a + pickInt(r, 2)) % 3;
        if (b === a) b = a === 3 ? 1 : a + 1;
        var sc = [null, null, null, null]; sc[a] = 'akima'; sc[b] = 'akima';
        var x = room(WINGS[0], sc, 'tiled', 0); S.q0 = [x.panes[a].id, x.panes[b].id];
      },
      check: function () { return !paneExists(S.q0[0]) && !paneExists(S.q0[1]); },
      next: function () {
        var left = S.q0.filter(paneExists);
        return left.length ? closeMove(left[0]) : null;
      }
    },
    new_and_home: {
      text: '離れを建てて、母屋へ戻れ', cmd: 'new-window → select-window', allow: ['new_window', 'select_window'], show: ['new_window', 'select_window'],
      setup: function () { room(WINGS[0], [null], 'single'); S.q1 = false; },
      ready: function () { S.q0 = S.session.windows.length; },
      check: function () {
        if (S.session.windows.length > S.q0) S.q1 = true;
        return S.q1 && T.activeWindow(S.session).name === WINGS[0];
      },
      next: function () { return S.q1 ? windowMove(WINGS[0], '戻る') : mv(['c'], 'c を押して離れを建てる'); }
    },
    swap_zoom: {
      text: '掛け軸の間を左端へ回し、大広間にせよ', cmd: 'swap-pane → resize-pane -Z', allow: ['swap', 'zoom'], show: ['swap', 'zoom'],
      setup: function () { var x = room(WINGS[0], [null, null, 'kakejiku'], 'evenh', 2); S.target = x.panes[2].id; },
      check: function () {
        var h = T.findPane(S.session, S.target);
        return !!h && h.win.zoomed && h.win.active === S.target && atLeft(S.target);
      },
      next: function () { return atLeft(S.target) ? (moveTo(S.target) || mv(['z'], 'z を押して大広間に')) : swapMove(); }
    }
  };

  // A new order, avoiding the same question twice in a row where it can.
  function shuffle(a) {
    for (var tries = 0; tries < 50; tries++) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      if (a.every(function (x, n) { return n === 0 || a[n - 1] !== x; })) break;
    }
    return a;
  }

  function prepareRun(courseId) {
    var course = REC.courseOf(courseId) || REC.courseOf('normal');
    S.run = {
      course: course,
      // The same questions every time, in a new order each run.
      qs: shuffle(course.qs.slice()),
      limit: course.limit,
      i: 0,
      phase: 'ready',
      penalty: 0, misses: 0, overs: 0, guides: 0, keys: 0,
      start: 0, qStart: 0, end: 0,
      stage: 0,
      seed: course.id + ':' + Math.random()
    };
  }

  function beginRun() {
    var b = S.run;
    b.phase = 'count';
    b.i = 0;
    b.penalty = 0; b.misses = 0; b.overs = 0; b.guides = 0; b.keys = 0;
    b.streak = 0;
    b.qlog = [];
    $('#sashizu').dataset.key = '';
    var n = 3;
    var NUM = { 3: '三', 2: '二', 1: '一' };
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

  function loadQuestion() {
    var b = S.run;
    var type = b.qs[b.i];
    var q = Q[type];
    newSession();
    // Each question builds its own windows; the default one goes away after.
    var base = S.session.windows[0];
    base.name = '';
    S.qText = null;
    S.target = null;
    q.setup(rng(b.seed + ':' + b.i));
    if (S.session.windows.length > 1) T.killWindow(S.session, base.id);
    S.session.windows.forEach(function (w, i) { w.index = S.session.baseIndex + i; });
    S.session.last = null;
    // Counts taken after the default window is gone.
    if (q.ready) q.ready();
    b.q = q;
    b.type = type;
    b.stage = 0;
    b.qStart = performance.now();
    b.qlog[b.i] = { t: type, s: null, m: 0 };
    S.clipboard = '';
  }

  function qText(b) { return S.qText || b.q.text; }

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
      if (b.streak % 5 === 0) chip('good', '五連の仕掛け ・ 手際よし');
      b.i += 1;
      if (b.i >= b.qs.length) { finishRun(); return; }
      loadQuestion();
      render();
    }
  }

  function miss() {
    var b = S.run;
    b.misses += 1;
    b.streak = 0;
    b.penalty += LV.MISS_PENALTY;
    if (b.qlog[b.i]) b.qlog[b.i].m += 1;
    AU.se('miss');
    chip('miss', '仕掛け違い +' + LV.MISS_PENALTY + ' 秒');
    termFlash('miss');
    shake();
  }

  // The 行灯: past the 目安 the keys light up; at 1.5 times it, the 指南.
  function startClock() {
    clearInterval(S.clock);
    S.clock = setInterval(function () {
      var b = S.run;
      if (!b || b.phase !== 'play' || S.screen !== 'game') { clearInterval(S.clock); return; }
      var used = (performance.now() - b.qStart) / 1000;
      var stage = used > b.limit * LV.GUIDE_AT ? 2 : used > b.limit ? 1 : 0;
      if (stage > b.stage) {
        var log = b.qlog[b.i];
        if (b.stage < 1) { b.overs += 1; log.o = 1; b.streak = 0; }
        if (stage === 2) { b.guides += 1; log.g = 1; }
        b.stage = stage;
        AU.se(stage === 2 ? 'shinan' : 'andon');
        syncBody();
        renderSashizu();
      }
      renderClock();
    }, 100);
  }

  function finishRun() {
    var b = S.run;
    clearInterval(S.clock);
    b.phase = 'done';
    b.end = performance.now();
    var raw = (b.end - b.start) / 1000;
    var time = raw + b.penalty;
    var result = {
      course: b.course.id, time: time, raw: raw, misses: b.misses, overs: b.overs, guides: b.guides,
      keys: b.keys, n: b.qs.length, avg: time / b.qs.length
    };
    var sum = REC.add({
      course: b.course.id, prefix: S.prefix,
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
    S.result = result;
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
    if (S.screen === 'game') { renderSashizu(); renderPlaybar(); renderTerm(); renderStatus(); renderKeybar(); }
    if (S.screen === 'result') renderResult();
    if (S.screen === 'records') renderRecords();
  }

  function keycaps(list, lit) {
    return list.map(function (k) { return '<kbd' + (lit && lit.indexOf(k) >= 0 ? ' class="next"' : '') + '>' + esc(k) + '</kbd>'; }).join('');
  }

  var KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  function kanji(n) {
    if (n < 10) return KANJI[n];
    if (n < 20) return '十' + (n % 10 ? KANJI[n % 10] : '');
    return KANJI[Math.floor(n / 10)] + '十' + (n % 10 ? KANJI[n % 10] : '');
  }

  function fmt(t) { return t == null ? '—' : t.toFixed(1) + '秒'; }

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
    var last = (all.runs || []).slice(-1)[0];
    return last && REC.courseOf(last.course) ? last.course : 'normal';
  }

  function renderTitle() {
    var all = REC.load();
    $$('#title-screen [data-prefix]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.prefix === S.prefix ? 'true' : 'false'); });
    var pick = lastCourse(all);
    var html = '';
    LV.COURSES.forEach(function (c) {
      var runs = REC.runsOf(c.id, all);
      var best = REC.best(c.id, all);
      var a5 = ao5(runs);
      html += '<li><button type="button" class="wing' + (c.id === pick ? ' hot' : '') + '" data-course="' + c.id + '">' +
        planHTML(c) +
        '<span class="wing-main"><span class="wing-name">' + esc(c.title) +
        '<span class="wing-n">' + c.qs.length + ' 仕掛け</span>' +
        '<span class="wing-mode' + (c.recommended ? ' rec' : '') + '">' + esc(c.mode) + '</span></span>' +
        '<span class="wing-desc">目安 ' + c.limit + ' 秒／仕掛け。' + esc(c.desc) + '</span></span>' +
        '<span class="wing-best"><small>自己ベスト</small><b>' + (best ? fmt(best.time) : '—') + '</b>' +
        '<small>' + (runs.length ? (a5 != null ? '五回平均 ' + a5.toFixed(1) + ' ・ ' : '') + runs.length + ' 回' : '当主の刻 ' + LV.par(c) + ' 秒') + '</small></span>' +
        '</button></li>';
    });
    $('#course-list').innerHTML = html;
    $('#enter-sub').textContent = REC.courseOf(pick).title + ' から';
    $('#btn-enter').dataset.course = pick;
    var n = (all.runs || []).length;
    $('#records-sub').textContent = n ? '通算 ' + n + ' 回' : '記録を見る';
    $('#title-meta').textContent = '合図 ' + prefixLabel();
  }

  // The order on the left: the question, its keys, the 目安 and the 指南.
  // Rebuilt only when the question, the stage or the key state changes; the
  // clock ticks update the gauge in place.
  function renderSashizu() {
    var el = $('#sashizu');
    var b = S.run;
    if (!el || !b) return;
    var playing = b.phase === 'play' && b.q;
    var move = playing && b.stage > 0 ? b.q.next() : null;
    var key = [b.i, b.phase, b.stage, S.armed ? 1 : 0, S.confirm ? 1 : 0, S.prompt ? 1 : 0, move ? move.text : ''].join('|');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    var n = b.qs.length;
    var html = '<div class="sz-lab"><span>指 図</span><b>' + kanji(Math.min(b.i + 1, n)) + ' ／ ' + kanji(n) + '</b></div>';
    if (!playing) {
      html += '<div class="sz-q">' + (b.phase === 'count' ? '屋敷に入る……' : '') + '</div>';
      el.innerHTML = html;
      return;
    }
    html += '<div class="sz-q">' + esc(qText(b)) + '</div>';
    var keys = [];
    b.q.show.forEach(function (a) { (LV.KEYS[a] || []).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
    var lit = move ? move.keys : [];
    var pfxCls = 'pfx' + (move && move.pfx ? (S.armed ? ' done' : ' next') : '');
    html += '<div class="sz-keys"><kbd class="' + pfxCls + '">' + esc(prefixLabel()) + '</kbd><span class="arr">→</span>' + keycaps(keys, lit) + '</div>';
    var hints = [];
    b.q.show.forEach(function (a) { if (LV.HINTS[a]) hints.push(LV.HINTS[a]); });
    html += '<div class="sz-hint">' + hints.map(esc).join('<br>') + '</div>';
    html += '<div class="sz-cmd">tmux: <code>' + esc(b.q.cmd) + '</code></div>';
    html += '<div class="andon' + (b.stage ? ' lit' : '') + '"><div class="andon-l"><span>目安 ' + b.limit + ' 秒</span><b class="andon-over"></b></div>' +
      '<div class="gauge"><i class="left"></i><i class="over"></i></div>';
    if (b.stage === 2 && move) {
      var steps = [];
      if (move.pfx) steps.push({ text: '合図 ' + prefixLabel() + ' を押して離す', done: S.armed });
      steps.push({ text: move.text, done: false });
      var now = steps.findIndex(function (s) { return !s.done; });
      html += '<div class="shinan"><div class="shinan-t"><i></i>行灯がともった ― 指南</div><ol>' +
        steps.map(function (s, i) {
          return '<li class="' + (s.done ? 'done' : i === now ? 'now' : '') + '"><span class="no">' + kanji(i + 1) + '</span>' + esc(s.text) + (s.done ? ' ✓' : '') + '</li>';
        }).join('') + '</ol></div>';
    } else if (b.stage === 1) {
      html += '<p class="andon-note">目安を過ぎた。押すキーが光っている。</p>';
    }
    html += '</div>';
    el.innerHTML = html;
    renderClock();
  }

  function renderPlaybar() {
    var b = S.run;
    var el = $('#playbar');
    if (!b || !el) return;
    var key = [b.i, b.phase, b.misses, b.streak >= 3 ? b.streak : 0].join('|');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.innerHTML = '<span class="pb-course">' + esc(b.course.title) + ' ・ 仕掛け <b>' + Math.min(b.i + 1, b.qs.length) + ' / ' + b.qs.length + '</b></span>' +
      (b.streak >= 3 ? '<span class="pb-streak">' + b.streak + ' 連</span>' : '') +
      '<span class="pb-sp"></span>' +
      (b.misses ? '<span class="pb-pen">仕掛け違い ' + b.misses + '（+' + b.penalty + '秒）</span>' : '') +
      '<span class="pb-time"><span>0.0</span><small>秒</small></span>';
    renderClock();
  }

  // The running clock and the 目安 gauge: green while there is time left,
  // then a red bar that grows with the overrun.
  function renderClock() {
    var b = S.run;
    if (!b) return;
    var now = performance.now();
    var t = $('#playbar .pb-time span');
    if (t) t.textContent = (b.phase === 'play' ? (now - b.start) / 1000 + b.penalty : 0).toFixed(1);
    var used = b.phase === 'play' ? (now - b.qStart) / 1000 : 0;
    var left = $('#sashizu .gauge .left'), over = $('#sashizu .gauge .over'), o = $('#sashizu .andon-over');
    if (left) left.style.width = Math.max(0, (b.limit - used) / b.limit * 100) + '%';
    if (over) over.style.width = Math.min(100, Math.max(0, (used - b.limit) / (b.limit * (LV.GUIDE_AT - 1)) * 100)) + '%';
    if (o) o.textContent = used > b.limit ? '超過 +' + (used - b.limit).toFixed(1) + ' 秒' : '';
  }

  // Short notes under the order: a streak, a wrong key.
  function chip(kind, text) {
    var box = $('#chips');
    if (!box) return;
    var c = document.createElement('span');
    c.className = 'chip ' + kind;
    c.textContent = text;
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

  function renderTerm() {
    var term = $('#term');
    measureCells();
    if (S.detached) {
      term.innerHTML = '<div class="outer-shell"><div class="pane-body outer-body">' + linesHTML(S.outer.lines) +
        '<div class="sh-line"><span class="sh-prompt">$ </span>' + withCursor(S.outer.input, S.outer.cur, true) + '</div></div></div>';
      var ob = $('.outer-body', term);
      ob.scrollTop = ob.scrollHeight;
      return;
    }
    var win = T.activeWindow(S.session);
    var lay = T.layout(win, S.cols, S.rows);
    var cw = S.cellW, ch = S.cellH;
    var active = null;
    lay.panes.forEach(function (r) { if (r.pane.id === win.active) active = r; });
    var html = '';
    lay.panes.forEach(function (r) {
      var p = r.pane;
      var isActive = p.id === win.active;
      var idx = T.paneIndex(S.session, win, p);
      html += '<div class="pane' + (isActive ? ' active' : '') + (p.scene ? ' scene-' + p.scene : '') + '" data-pane-id="' + p.id + '" data-scene="' + (p.scene || '') + '" style="left:' + (r.x * cw) + 'px;top:' + (r.y * ch) + 'px;width:' + (r.w * cw) + 'px;height:' + (r.h * ch) + 'px">';
      html += '<div class="pane-title"><span class="pt-idx">' + idx + '</span>' + (p.name ? '<span class="pt-name">' + esc(p.name) + '</span>' : '') + (win.zoomed ? '<span class="zoom-flag">大広間</span>' : '') + '</div>';
      html += '<div class="pane-body' + (p.mode === 'copy' ? ' copy' : '') + '" data-pane-body="' + p.id + '">';
      if (p.mode === 'copy') html += '<div class="copy-ind" data-copy-ind="' + p.id + '">[0/0]</div>';
      html += sceneHTML(p);
      html += linesHTML(p.lines, p.mode === 'copy' ? p : null);
      html += '<div class="sh-line"><span class="sh-prompt">' + esc(promptText(p)) + '</span>' + withCursor(p.input, p.cur, isActive && p.mode !== 'copy') + '</div>';
      html += '</div></div>';
    });
    lay.borders.forEach(function (b) {
      var near = false;
      if (active) {
        if (b.dir === 'v') near = (active.x + active.w === b.x || active.x === b.x + 1) && active.y < b.y + b.len && b.y < active.y + active.h;
        else near = (active.y + active.h === b.y || active.y === b.y + 1) && active.x < b.x + b.len && b.x < active.x + active.w;
      }
      html += '<div class="border ' + b.dir + (near ? ' near' : '') + '" style="left:' + (b.x * cw) + 'px;top:' + (b.y * ch) + 'px;width:' + ((b.dir === 'v' ? 1 : b.len) * cw) + 'px;height:' + ((b.dir === 'v' ? b.len : 1) * ch) + 'px"></div>';
    });
    if (S.picker) html += pickerHTML();
    term.innerHTML = html;
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

  function markCursor(el, p) {
    $$('.cl', el).forEach(function (x) { x.classList.remove('cl'); });
    var line = $('[data-ln="' + p.cy + '"]', el);
    if (line) line.classList.add('cl');
  }

  function pickerHTML() {
    var html = '<div class="picker" role="listbox" aria-label="セッション">';
    html += '<div class="picker-head">(choose-tree)  ↑↓ で選んで Enter</div>';
    S.sessions.forEach(function (s, i) {
      html += '<div class="picker-row' + (i === S.picker.idx ? ' on' : '') + '">(' + i + ') ' + esc(s.name) + ': ' + s.windows.length + ' windows' + (s === S.session ? ' (attached)' : '') + '</div>';
    });
    return html + '</div>';
  }

  // What a staged pane shows above its shell: the room's name, large.
  function sceneHTML(p) {
    if (p.scene === 'kakejiku') {
      return '<div class="scene"><div class="room-name">掛け軸の間</div><div class="kakejiku-art"></div><div class="scene-cap">ここへ渡る</div></div>';
    }
    if (p.scene === 'akima') {
      return '<div class="scene dim"><div class="room-name">空き間</div><div class="scene-cap">閉じる間</div></div>';
    }
    if (p.scene === 'makimono') {
      return '<div class="scene makimono-head"><div class="makimono-roll"></div></div>';
    }
    return '';
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
      html += '<span class="st-win' + (w.id === S.session.active ? ' cur' : '') + '">' + w.index + ':' + esc(w.name) + flag + '</span>';
    });
    html += '</span><span class="st-right">';
    if (S.armed) html += '<span class="st-prefix">PREFIX</span>';
    else if (Date.now() < S.repeatUntil) html += '<span class="st-prefix repeat">REPEAT</span>';
    var ap = T.activePane(win);
    if (ap.mode === 'copy') html += '<span class="st-mode">COPY' + (ap.sel != null ? ' SEL' : '') + '</span>';
    if (S.clipboard) html += '<span class="st-clip" title="コピーした内容">📋</span>';
    html += '<span class="st-host">"yashiki"</span><span class="st-clock">' + clock() + '</span></span>';
    bar.innerHTML = html;
  }

  function clock() {
    var d = new Date();
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  // Turn a key label from levels.js into a key object for the phone key bar.
  function keyFromLabel(label) {
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
    add(S.prefix === 'C-a' ? 'C-a' : 'C-b', { key: prefixKey(), ctrl: true }, 'k-prefix');
    add('Esc', { key: 'Escape' });
    add('←', { key: 'ArrowLeft' }); add('↑', { key: 'ArrowUp' }); add('↓', { key: 'ArrowDown' }); add('→', { key: 'ArrowRight' });
    var labels = [];
    if (S.run && S.run.q) S.run.q.show.forEach(function (a) { labels = labels.concat(LV.KEYS[a] || []); });
    labels.forEach(function (label) { add(label, keyFromLabel(label), 'k-level'); });
    if (S.confirm) add('y', { key: 'y' });
    if (S.detached || S.prompt) add('Enter', { key: 'Enter' });
    var html = '';
    keys.forEach(function (x) {
      html += '<button type="button" class="key ' + x.cls + '" data-k="' + esc(JSON.stringify(x.k)) + '"' + (x.cls === 'k-prefix' && S.armed ? ' aria-pressed="true"' : '') + '>' + esc(x.label) + '</button>';
    });
    html += '<button type="button" class="key k-type" data-type="1">abc…</button>';
    bar.innerHTML = html;
  }

  // ---- effects -------------------------------------------------------------

  function banner(text, kind) {
    var el = $('#banner');
    if (!el) return;
    el.textContent = text;
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
    newSession();
    prepareRun(courseId);
    $('#chips').innerHTML = '';
    $('#playbar').dataset.key = '';
    showScreen('game');
    render();
    beginRun();
    focusSink();
  }

  function leaveRun() {
    if (S.run) { clearTimeout(S.run.timer); clearInterval(S.clock); }
    S.run = null;
  }

  function sec(t) { return t.toFixed(1) + ' 秒'; }

  // The last few runs as bars, oldest first; the shape matters, not the numbers.
  function spark(list) {
    if (!list || list.length < 2) return '';
    var max = Math.max.apply(null, list.map(function (r) { return r.time; }));
    return '<div class="spark" aria-label="直近 ' + list.length + ' 回のタイム">' + list.map(function (r, i) {
      return '<i class="' + (r.rec ? 'rec' : '') + (i === list.length - 1 ? ' now' : '') + '" style="height:' + Math.max(8, Math.round(r.time / max * 100)) + '%"></i>';
    }).join('') + '</div>';
  }

  function wareki(d) {
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  // The result as a hand scroll (絵巻): the time, against 当主の刻, the rank
  // as a seal, the details and the last ten runs.
  function renderResult() {
    var r = S.result;
    var el = $('#result-body');
    if (!r || !el) return;
    var c = REC.courseOf(r.course);
    var diff = r.time - r.par;
    var verdict = diff <= 0
      ? '当主の刻 ' + r.par + ' 秒を <b>' + Math.abs(diff).toFixed(1) + ' 秒</b> 上回った'
      : '当主の刻 ' + r.par + ' 秒まで あと <b>' + diff.toFixed(1) + ' 秒</b>';
    var sub = '';
    if (r.count === 1) sub = 'はじめての挑戦。これが出発点。';
    else if (r.record) sub = '★ 自己ベスト更新（' + r.best.toFixed(1) + ' → ' + r.time.toFixed(1) + '）';
    else if (r.delta < 0) sub = '前回より ' + Math.abs(r.delta).toFixed(1) + ' 秒 速い。自己ベストまで あと ' + r.bestDelta.toFixed(1) + ' 秒';
    else sub = '前回より ' + r.delta.toFixed(1) + ' 秒 遅い。自己ベストまで あと ' + r.bestDelta.toFixed(1) + ' 秒';
    if (r.ao5 != null) sub += ' ・ 五回平均 ' + (r.ao5Prev != null ? r.ao5Prev.toFixed(1) + ' → ' : '') + r.ao5.toFixed(1);
    var rankLine = r.rankUp
      ? '称号が「' + esc(r.rankFrom) + '」から <b>' + esc(r.rank) + '</b> に上がった'
      : '称号 <b>' + esc(r.rank) + '</b>';
    var slow = r.slow ? Q[r.slow] : null;
    var slowKeys = [];
    if (slow) slow.show.forEach(function (a) { (LV.KEYS[a] || []).forEach(function (k) { if (slowKeys.indexOf(k) < 0) slowKeys.push(k); }); });
    var isRec = !!(r.record && r.count > 1);
    el.classList.toggle('is-rec', isRec);
    el.innerHTML =
      '<div class="em-hd">絵 巻 ・ ' + kanji(Math.min(r.count, 99)) + ' 回 目</div>' +
      '<h2 class="em-title">奥の間に辿り着いた。</h2>' +
      '<div class="em-sub">' + esc(c.title) + ' ・ 仕掛け ' + r.n + ' ・ ' + wareki(r.at) + '</div>' +
      '<div class="em-row"><div class="em-time">' + r.time.toFixed(1) + '<small>秒</small></div>' +
      '<div class="em-verdict">' + verdict + '<span class="em-tip">' + esc(sub) + '</span></div></div>' +
      '<div class="em-rank' + (r.rankUp ? ' up' : '') + '"><span class="hanko" aria-hidden="true">' + esc(r.rank).replace(/^(.{3})(.+)$/, '$1<br>$2') + '</span><span>' + rankLine + '</span></div>' +
      '<dl class="em-facts">' +
      '<div><dt>1 仕掛けあたり</dt><dd>' + r.avg.toFixed(2) + '秒</dd></div>' +
      '<div><dt>実時間</dt><dd>' + r.raw.toFixed(1) + '秒</dd></div>' +
      '<div><dt>仕掛け違い</dt><dd>' + r.misses + '（+' + (r.misses * LV.MISS_PENALTY) + '秒）</dd></div>' +
      '<div><dt>灯り（目安超過）</dt><dd>' + r.overs + ' 仕掛け ・ 指南 ' + r.guides + '</dd></div>' +
      '<div><dt>自己ベスト</dt><dd>' + fmt(r.record ? r.time : r.best) + '</dd></div>' +
      '<div><dt>押したキー</dt><dd>' + r.keys + '</dd></div>' +
      '</dl>' +
      spark(r.spark) +
      '<div class="spark-l"><span>' + (slow ? '灯りがいちばん長かった仕掛け: ' + esc(slow.text || '棟を渡る') + '（' + esc(prefixLabel()) + ' → ' + slowKeys.map(esc).join(' ') + '）' : r.overs ? '' : '灯りなし。どの仕掛けも目安のうちに解いた') + '</span>' +
      (r.spark && r.spark.length > 1 ? '<span>■ 自己ベスト ■ 今回</span>' : '') + '</div>' +
      (r.tip ? '<div class="tips"><div class="tips-head">豆知識</div><p>' + esc(r.tip) + '</p></div>' : '') +
      '<div class="cta"><button type="button" class="btn primary" data-course="' + r.course + '">もう一度 屋敷へ</button>' +
      '<button type="button" class="btn" data-records="' + r.course + '">絵巻を開く</button>' +
      '<button type="button" class="btn ghost" data-title="1">見取り図へ</button></div>';
    if ((isRec || r.rankUp) && S.celebrated !== r.runId) { S.celebrated = r.runId; celebrate(); }
  }

  // ---- 絵巻: the run history ------------------------------------------------

  function openRecords(course, from) {
    S.recordsFrom = from || S.screen;
    S.recCourse = course || S.recCourse || lastCourse(REC.load());
    showScreen('records');
  }

  function recDate(at) {
    var d = new Date(at);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // Up to 20 latest runs as bars: vermilion for a record, a dotted line at
  // the best and a faint one at 当主の刻. The SVG stretches to the box; the
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
        esc(recDate(r.at) + ' ' + r.time.toFixed(1) + '秒 仕掛け違い ' + r.misses) + '</title></rect>';
    });
    svg += '<line class="par" x1="0" x2="' + W + '" y1="' + y(par) + '" y2="' + y(par) + '" vector-effect="non-scaling-stroke"/>';
    if (best != null) svg += '<line class="best" x1="0" x2="' + W + '" y1="' + y(best) + '" y2="' + y(best) + '" vector-effect="non-scaling-stroke"/>';
    svg += '</svg>';
    var lbl = '<span class="lbl par-l" style="top:' + y(par) + '%">当主の刻 ' + par + '秒</span>';
    if (best != null) lbl += '<span class="lbl best-l" style="top:' + y(best) + '%">自己ベスト ' + best.toFixed(1) + '秒</span>';
    return '<div id="rec-chart" class="rec-chart" role="img" aria-label="タイムの移り変わり">' + svg + lbl + '</div>';
  }

  function renderRecords() {
    var id = S.recCourse;
    var c = REC.courseOf(id);
    $$('#records-screen [data-rec-course]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.recCourse === id ? 'true' : 'false'); });
    var st = REC.stats(id);
    var body = $('#records-body');
    if (!st) {
      body.innerHTML = '<div class="rec-log"><p>' + esc(c.title) + '（' + esc(c.mode) + '）の絵巻は、まだ白紙。</p><p>一度屋敷に入ると、ここに上達が描かれていく。</p></div>' +
        '<div class="cta"><button type="button" class="btn primary" data-course="' + id + '">' + esc(c.title) + 'に入る</button></div>';
      return;
    }
    var gain = st.first.time - st.best;
    var head = st.count === 1
      ? '<p>挑戦 1 回。もう一度入ると、ここに上達が出る。</p>'
      : '<p>はじめて ' + sec(st.first.time) + ' → 自己ベスト ' + sec(st.best) + (gain > 0 ? '（<b>−' + gain.toFixed(1) + ' 秒</b>）' : '') + '</p>';
    var a5 = ao5(st.runs);
    var tiles =
      '<div class="rec-tiles">' +
      '<div class="rec-tile"><small>自己ベスト</small><b>' + fmt(st.best) + '</b></div>' +
      '<div class="rec-tile"><small>称号</small><b>' + esc(st.bestRank || '—') + '</b></div>' +
      '<div class="rec-tile"><small>挑戦回数</small><b>' + st.count + ' 回</b></div>' +
      '<div class="rec-tile"><small>五回平均</small><b>' + fmt(a5) + '</b></div>' +
      '</div>';
    var chart = '<div class="rec-panel"><div class="rec-head">タイムの移り変わり（直近 ' + Math.min(20, st.count) + ' 回）</div>' + recChart(st.runs, c, st.best) + '</div>';
    var rows = st.runs.slice(0, 20).map(function (r) {
      var note = r.legacy ? '旧記録' : '違い ' + r.misses + (r.overs ? ' ・ 灯り ' + r.overs : '') + (r.guides ? ' ・ 指南 ' + r.guides : '') + (r.timeouts ? ' ・ 時間切れ ' + r.timeouts : '');
      return '<tr class="' + (r.rec ? 'is-rec' : '') + '"><td class="c-n">' + recDate(r.at) + '</td><td class="r-time">' + r.time.toFixed(1) + '秒</td><td class="r-note">' + note + '</td><td class="r-rank">' + esc(r.rank) + '</td><td class="r-star">' + (r.rec ? '★' : '') + '</td></tr>';
    }).join('');
    var table = '<div class="rec-panel"><div class="rec-head">直近の記録</div><table class="rec-table"><thead><tr><th>日付</th><th>タイム</th><th class="r-note">内訳</th><th>称号</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    body.innerHTML = '<div class="rec-log">' + head + '</div>' + tiles + chart + weakPanel(id) + table;
  }

  function weakPanel(id) {
    var w = REC.weakness(id, 10);
    if (!w) return '<div class="rec-panel rec-weak"><div class="rec-head">灯りが多い仕掛け</div><p class="rec-empty">2 回入ると、苦手な仕掛けが見えてくる。</p></div>';
    var row = function (e) {
      var q = Q[e.type];
      var keys = [];
      q.show.forEach(function (a) { (LV.KEYS[a] || []).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
      return '<li><span class="w-text">' + esc(q.text || '母屋・離れ・蔵を渡る') + '</span>' +
        '<span class="w-num">平均 ' + e.avg.toFixed(1) + '秒 ・ 違い ' + Math.round(e.missRate * 100) + '%' + (e.overs ? ' ・ 灯り ' + e.overs : '') + '</span>' +
        '<span class="w-keys"><kbd class="pfx">' + esc(prefixLabel()) + '</kbd><span class="arr">→</span>' + keycaps(keys) + '</span></li>';
    };
    return '<div class="rec-panel rec-weak"><div class="rec-head">灯りが多い仕掛け（直近 ' + w.runs + ' 回）</div><ol class="weak-list">' +
      w.weak.map(row).join('') + '</ol>' +
      (w.strong ? '<p class="w-strong">得意: <b>' + esc(Q[w.strong.type].text || '棟を渡る') + '</b> 平均 ' + w.strong.avg.toFixed(1) + '秒</p>' : '') + '</div>';
  }

  function focusSink() {
    // Only phones need the sink focused (it raises the soft keyboard).
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      var sink = $('#sink');
      if (sink && S.screen === 'game') sink.focus();
    }
  }

  // ---- wiring ------------------------------------------------------------

  function init() {
    var saved = store.load();
    if (saved.prefix === 'C-a' || saved.prefix === 'C-b') S.prefix = saved.prefix;
    applyTheme(saved.theme === 'dark' || saved.theme === 'light' ? saved.theme : null);
    applySound(saved.sound !== false);

    $$('.theme-toggle').forEach(function (b) { b.addEventListener('click', toggleTheme); });
    $$('.sound-toggle').forEach(function (b) {
      b.addEventListener('click', function () { applySound(!S.sound); store.save({ sound: S.sound }); if (S.sound) music(); });
    });
    document.addEventListener('pointerdown', function () { AU.unlock(); }, true);
    $$('#title-screen [data-prefix]').forEach(function (b) {
      b.addEventListener('click', function () { S.prefix = b.dataset.prefix; store.save({ prefix: S.prefix }); AU.se('cursor'); renderTitle(); });
    });
    $('#btn-enter').addEventListener('click', function () { startRun($('#btn-enter').dataset.course || 'normal'); });
    $('#btn-records').addEventListener('click', function () { openRecords(null, 'title'); });
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
      var r = e.target.closest('[data-records]');
      if (r) { openRecords(r.dataset.records || null, 'result'); return; }
      var b = e.target.closest('[data-course]');
      if (b) { startRun(b.dataset.course); return; }
      if (e.target.closest('[data-title]')) showScreen('title');
    });
    $('#records-screen').addEventListener('click', function (e) {
      var t = e.target.closest('[data-rec-course]');
      if (t) { S.recCourse = t.dataset.recCourse; AU.se('cursor'); renderRecords(); return; }
      var b = e.target.closest('[data-course]');
      if (b) { startRun(b.dataset.course); return; }
      if (e.target.closest('#btn-records-back')) { showScreen(S.recordsFrom === 'result' && S.result ? 'result' : 'title'); return; }
      if (e.target.closest('#btn-records-clear')) {
        if (!window.confirm('絵巻の記録をすべて消す？')) return;
        REC.clearArena();
        renderRecords();
      }
    });

    document.addEventListener('keydown', onKeyDown);
    var sink = $('#sink');
    sink.addEventListener('input', onSinkInput);
    $('#term').addEventListener('pointerdown', function () { focusSink(); });
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
          windows: S.session ? S.session.windows.map(function (w) { return { index: w.index, name: w.name, active: w.id === S.session.active, panes: T.panesOf(w).length, zoomed: w.zoomed }; }) : [],
          activeWindow: win ? win.name : null,
          activeScene: ap ? (ap.scene || null) : null,
          copyMode: ap ? ap.mode === 'copy' : false,
          input: ap ? ap.input : null,
          cursor: ap ? (ap.cur == null ? ap.input.length : ap.cur) : null,
          promptValue: S.prompt ? S.prompt.value : null,
          clipboard: S.clipboard,
          run: b ? {
            course: b.course.id, phase: b.phase, i: b.i, n: b.qs.length, type: b.type, misses: b.misses,
            stage: b.stage, overs: b.overs, guides: b.guides,
            order: b.q ? qText(b) : null,
            goal: b.type === 'select_window' ? S.q0 : null,
            next: b.q && b.phase === 'play' ? b.q.next() : null
          } : null,
          result: S.result,
          recCourse: S.screen === 'records' ? S.recCourse : null,
          cols: S.cols, rows: S.rows
        };
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
