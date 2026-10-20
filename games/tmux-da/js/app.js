// tmux打, browser edition: screens, input, the fake shells, the
// level loop, the arena. The tmux model is in tmux.js, the levels and the
// courses in levels.js, the music in audio.js.
(function () {
  'use strict';

  var T = ADV.tmux, LV = ADV.levels, ART = ADV.art, AU = ADV.audio, REC = ADV.records;
  var LAST = LV.LAST_LEVEL;
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
    },
    clear: function () {
      try {
        // Arena records survive "記録を消す", which is about the story.
        var keep = store.load();
        window.localStorage.removeItem(STORE_KEY);
        if (keep.arena || keep.runs) window.localStorage.setItem(STORE_KEY, JSON.stringify({ schema: keep.schema, arena: keep.arena || {}, runs: keep.runs || [] }));
      } catch (e) { /* ignore */ }
    }
  };

  // ---- state ---------------------------------------------------------------

  var S = {
    screen: 'title',
    mode: 'story',         // 'story' | 'arena'
    prefix: 'C-b',
    level: 1,
    sessions: [],
    session: null,
    armed: false,          // prefix pressed, waiting for the key
    repeatUntil: 0,        // tmux repeat-time window for -r bindings
    confirm: null,         // {text, yes}
    prompt: null,          // {label, value, done}
    picker: null,          // {items, idx}: choose-tree / workspace picker
    clipboard: '',
    detached: false,
    outer: null,           // the shell outside tmux
    phase: 0,              // level 11: 1 once detached
    target: null,          // pane id the level is about
    allies: null,          // level 22: pane ids that must survive
    size: null,            // level 6: {w, h} at setup
    count: 0,              // level 7: windows at setup
    mp: null,              // chapter 3: {max, left}
    lastAction: null,      // what the last key did, for the arena's miss check
    battle: null,          // arena run or boss fight
    message: null,
    messageTimer: 0,
    briefOpen: false,
    briefOpenedAt: 0,
    cols: 80, rows: 24, cellW: 8, cellH: 18,
    hinted: false,
    free: false,           // finale reached, playing on
    sound: true
  };

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function prefixKey() { return S.prefix === 'C-a' ? 'a' : 'b'; }
  function prefixLabel() { return LV.prefixLabel(S.prefix); }
  function curLevel() { return LV.level(Math.min(S.level, LAST)); }

  function syncBody() {
    var b = document.body;
    b.dataset.screen = S.screen;
    b.dataset.mode = S.mode;
    b.dataset.level = String(S.level);
    b.dataset.armed = S.armed ? '1' : (Date.now() < S.repeatUntil ? 'repeat' : '0');
    b.dataset.brief = S.briefOpen ? '1' : '0';
    b.dataset.detached = S.detached ? '1' : '0';
    b.dataset.chapter = String(LV.chapterOf(Math.min(S.level, LAST)).n);
  }

  // ---- theme and sound ------------------------------------------------------

  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var dark = t === 'dark' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    $$('.theme-toggle').forEach(function (b) {
      b.setAttribute('aria-label', dark ? 'ライトテーマにする' : 'ダークテーマにする');
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
  function bgmForScreen() {
    if (S.screen === 'title') return 'title';
    if (S.screen === 'arena') return 'title';
    if (S.screen === 'records') return 'title';
    if (S.screen === 'finale') return 'title';
    if (S.mode === 'arena') return 'battle';
    if (S.level === LAST && !S.free) return 'boss';
    return LV.chapterOf(Math.min(S.level, LAST)).bgm;
  }

  function music() { AU.play(bgmForScreen()); }

  // ---- the fake shells ---------------------------------------------------

  var SCENE_LS = {
    treasure: 'treasure-chest/  telescope',
    monster: 'monster  claws  teeth',
    scroll: 'ancient-scroll.txt',
    stairs: 'stairs-down/  torch',
    door: 'door  keyhole'
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
    if (pane.scene === 'door') { doorCommand(pane, line); return; }
    var argv = line.trim().split(/\s+/);
    var cmd = argv[0] || '';
    if (!cmd) return;
    switch (cmd) {
      case 'help':
        pane.lines.push('使えるコマンド: ls  echo  cat  pwd  clear  exit  tmux  help');
        pane.lines.push('tmux の操作は ' + prefixLabel() + ' を押して離してからキーを押す。説明は ' + prefixLabel() + ' → i');
        break;
      case 'ls':
        pane.lines.push(SCENE_LS[pane.scene] || 'map.txt  torch  rations');
        break;
      case 'pwd':
        pane.lines.push('/home/adventurer/dungeon');
        break;
      case 'echo':
        pane.lines.push(argv.slice(1).join(' '));
        break;
      case 'cat':
        if (argv[1] === 'map.txt') pane.lines.push('冒険の地図: 24 の試練が待っている。下のステータスバーが現在地だ。');
        else if (argv[1] === 'ancient-scroll.txt') pane.lines.push('長すぎて画面に収まらない。コピーモード（' + prefixLabel() + ' → [）で読もう。');
        else pane.lines.push('cat: ' + (argv[1] || '') + ': そんなファイルはない');
        break;
      case 'clear':
        pane.lines.push({ clear: true });
        break;
      case 'exit':
        if (!T.killPane(win, pane.id)) {
          if (!T.killWindow(S.session, win.id)) pane.lines.push('最後の窓は閉じられない。ここが冒険の舞台だ。');
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

  function doorCommand(pane, line) {
    var pw = pane.password || '';
    if (pw && line.indexOf(pw) >= 0 && pane.pasted) {
      pane.opened = true;
      pane.lines.push({ html: '<span class="sh-yellow">ゴゴゴゴ……　扉が開いた！</span>' });
      AU.se('open');
    } else if (pw && line.indexOf(pw) >= 0) {
      pane.lines.push({ html: '<span class="sh-dim">扉は手で書いた文字には応えない。古文書から写した合言葉を貼り付けよう。</span>' });
    } else if (line.trim()) {
      pane.lines.push({ html: '<span class="sh-dim">扉はびくともしない……</span>' });
    }
    pane.pasted = false;
  }

  function promptText(pane) { return pane && pane.scene === 'door' ? '合言葉> ' : '~/dungeon $ '; }

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
    if (cmd === 'tmux' || cmd === 'tmux-da') {
      var sub = argv[1] || '';
      if (cmd === 'tmux-da' || /^(a|attach|attach-session)$/.test(sub)) { attach(); return; }
      if (sub === 'ls' || sub === 'list-sessions') { sessionLines().forEach(function (l) { o.lines.push(l); }); return; }
      if (sub === '' || sub === 'new' || sub === 'new-session') {
        o.lines.push({ html: '<span class="sh-dim">それは新しいセッションを作るコマンド。冒険のセッションは裏で生きている —— tmux attach で戻ろう。</span>' });
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
        o.lines.push('README.md  tmux-da');
        break;
      case 'pwd':
        o.lines.push('/home/adventurer');
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
      S.outer.lines.push({ html: '<span class="sh-dim">ヒント: セッションは裏で生きている。tmux attach と打てば戻れる（tmux ls で確かめられる）。</span>' });
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
    var w = T.createWindow(s, name === 'adv' ? 'home' : 'zsh');
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
    S.session = makeSession('adv');
    S.session.attached = true;
    S.detached = false;
    S.phase = 0;
    S.armed = false;
    S.confirm = null;
    S.prompt = null;
    S.picker = null;
    S.free = false;
  }

  // ---- staging -----------------------------------------------------------

  function stagePane(pane, scene, name, opts) {
    opts = opts || {};
    pane.scene = scene;
    pane.name = name;
    pane.lines = [];
    pane.mode = null;
    if (scene === 'scroll') {
      var total = opts.length || 300;
      pane.lines.push({ html: '<span class="sh-cyan">==== 古文書 第一行 ====</span>', text: '==== 古文書 第一行 ====' });
      pane.lines.push({ html: '<span class="sh-yellow">合言葉は「ひらけ、ごま」</span>', text: '合言葉は「ひらけ、ごま」' });
      for (var i = 3; i <= total; i++) {
        var txt;
        // Short enough for a half-width pane on a phone (about 22 cells).
        if (opts.secret && i === opts.secretAt) {
          var s = 'secret: ' + opts.secret;
          var num = (i < 100 ? ' ' : '') + (i < 10 ? ' ' : '') + i;
          pane.lines.push({ html: '<span class="sh-dim">' + num + '</span>  <span class="sh-yellow">' + esc(s) + '</span>', text: num + '  ' + s });
          continue;
        }
        if (i % 50 === 0) txt = '—— 第' + (i / 50 + 1) + '章 ——';
        else if (i % 17 === 0) txt = '……墨が途切れる……';
        else txt = '……長い文章が続く……';
        var n = (i < 100 ? ' ' : '') + (i < 10 ? ' ' : '') + i;
        pane.lines.push({ html: '<span class="sh-dim">' + n + '</span>  ' + esc(txt), text: n + '  ' + txt });
      }
      pane.lines.push('');
      pane.lines.push(opts.secret ? '合言葉は、ひみつ（英語）と書かれた行にある。検索しよう。' : '上には何が書いてあった？ コピーモードで一番上まで戻ろう。');
    }
    if (scene === 'door') {
      pane.password = opts.password;
      pane.opened = false;
      pane.lines.push({ html: '<span class="sh-dim">合言葉を貼り付けて Enter を押せ。</span>' });
    }
  }

  function inactivePanes(win) {
    return T.panesOf(win).filter(function (p) { return p.id !== win.active; });
  }

  // A new window in the current session, built from a list of scenes.
  // shape: 'single' | 'lr' | 'tb' | 'tiled' | 'evenh' | 'evenv'. Returns {win, panes}.
  function room(name, scenes, shape, activeAt) {
    var win = T.createWindow(S.session, name);
    T.selectWindow(S.session, win.id);
    var panes = [T.activePane(win)];
    for (var i = 1; i < scenes.length; i++) panes.push(T.splitPane(win, panes[panes.length - 1].id, shape === 'tb' || shape === 'evenv' ? 'tb' : 'lr', null, true));
    var layout = { tiled: 'tiled', evenh: 'even-horizontal', evenv: 'even-vertical', lr: 'even-horizontal', tb: 'even-vertical' }[shape];
    if (layout && panes.length > 1) T.applyLayout(win, layout);
    scenes.forEach(function (sc, j) {
      if (!sc) return;
      var names = { treasure: '宝箱', monster: 'モンスター', scroll: '古文書', door: '扉', ally: '仲間' };
      stagePane(panes[j], sc.scene || sc, names[sc.scene || sc] || '', sc.opts);
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

  function removeWindow(name) {
    var w = windowByName(name);
    if (w && S.session.windows.length > 1) T.killWindow(S.session, w.id);
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

  // ---- story levels ----------------------------------------------------------

  var SECRET_A = 'ruby-7731';
  var SECRET_B = 'onyx-2048';

  function setupLibrary() {
    removeWindow('library');
    var r = room('library', [{ scene: 'scroll', opts: { secret: SECRET_A, secretAt: 137 } }], 'single');
    S.target = r.panes[0].id;
    return r;
  }

  function setup(n) {
    var win = T.activeWindow(S.session);
    S.mp = null;
    var lv = LV.level(Math.min(n, LAST));
    if (lv && lv.mp) S.mp = { max: lv.mp, left: lv.mp };
    switch (n) {
      case 3: {
        if (T.panesOf(win).length < 2) T.splitPane(win, win.active, 'tb', null, true);
        var others = inactivePanes(win);
        var pick = others[others.length - 1];
        stagePane(pick, 'treasure', '宝箱');
        S.target = pick.id;
        break;
      }
      case 5: {
        win.zoomed = false;
        var m = T.splitPane(win, win.active, 'tb', null, true);
        stagePane(m, 'monster', 'モンスター');
        S.target = m.id;
        break;
      }
      case 4:
        // Zoom does nothing with a single pane (e.g. after resuming here).
        if (T.panesOf(win).length < 2) T.splitPane(win, win.active, 'lr', null, true);
        break;
      case 6: {
        // Resizing needs a neighbour. Resuming at this level starts a fresh
        // session with one pane, which left the level unwinnable.
        win.zoomed = false;
        if (T.panesOf(win).length < 2) T.splitPane(win, win.active, 'lr', null, true);
        S.target = win.active;
        var r = T.rectOf(win, win.active, S.cols, S.rows);
        S.size = r ? { w: r.w, h: r.h } : { w: 0, h: 0 };
        break;
      }
      case 7:
        S.count = S.session.windows.length;
        break;
      case 9: {
        var has = S.session.windows.some(function (w) { return w.name === 'home'; });
        if (!has) T.createWindow(S.session, 'home');
        break;
      }
      case 10: {
        var home = windowByName('home');
        if (!home) home = T.createWindow(S.session, 'home');
        home.zoomed = false;
        var sp = T.splitPane(home, home.active, 'tb', null, true);
        stagePane(sp, 'scroll', '古文書');
        S.target = sp.id;
        break;
      }
      case 11:
        S.phase = 0;
        break;
      case 12: {
        removeWindow('tower');
        var r12 = room('tower', [null, null, 'treasure'], 'evenh', 2);
        S.target = r12.panes[2].id;
        break;
      }
      case 13: {
        removeWindow('hall');
        room('hall', [null, null, null, null], 'evenv', 0);
        break;
      }
      case 14:
        setupLibrary();
        break;
      case 15: {
        var lib = windowByName('library');
        if (!lib || !paneExists(S.target)) setupLibrary();
        break;
      }
      case 16: {
        var lib16 = windowByName('library');
        if (!lib16 || !paneExists(S.target)) lib16 = setupLibrary().win;
        T.selectWindow(S.session, lib16.id);
        var scroll = T.findPane(S.session, S.target).pane;
        scroll.mode = null;
        var door = T.splitPane(lib16, scroll.id, 'lr', null, true);
        stagePane(door, 'door', '扉', { password: SECRET_A });
        S.target = door.id;
        break;
      }
      case 17: {
        removeWindow('trap');
        room('trap', ['monster', 'monster'], 'lr', 0);
        break;
      }
      case 18:
        if (sessionByName('adv')) switchSession(sessionByName('adv'));
        break;
      case 19: {
        var castle = sessionByName('castle') || makeSession('castle');
        switchSession(castle);
        break;
      }
      case 20: {
        if (sessionByName('castle')) switchSession(sessionByName('castle'));
        removeWindow('fort');
        room('fort', [null], 'single');
        break;
      }
      case 21: {
        removeWindow('fort');
        removeWindow('vault');
        var r21 = room('vault', [null, null, null, 'treasure'], 'tiled', 0);
        S.target = r21.panes[3].id;
        break;
      }
      case 22: {
        removeWindow('vault');
        removeWindow('den');
        var r22 = room('den', ['ally', 'monster', 'monster', 'ally', 'monster'], 'tiled', 0);
        S.target = null;
        S.allies = [r22.panes[0].id, r22.panes[3].id];
        S.monsters = [r22.panes[1].id, r22.panes[2].id, r22.panes[4].id];
        break;
      }
      case 23: {
        removeWindow('den');
        removeWindow('library');
        removeWindow('gate');
        S.clipboard = '';
        room('library', [{ scene: 'scroll', opts: { secret: SECRET_B, secretAt: 211 } }], 'single');
        var r23 = room('gate', [null, { scene: 'door', opts: { password: SECRET_B } }], 'lr', 0);
        S.target = r23.panes[1].id;
        break;
      }
      case 24:
        prepareBattle('boss');
        break;
    }
  }

  function check(n) {
    var win = T.activeWindow(S.session);
    var lay = T.layout(win, S.cols, S.rows);
    switch (n) {
      case 1: return shares(lay.panes, 'y');
      case 2: return shares(lay.panes, 'x');
      case 3: return win.active === S.target;
      case 4: return win.zoomed;
      case 5: return !paneExists(S.target);
      case 6: {
        var hit = T.findPane(S.session, S.target);
        if (!hit) { setup(6); return false; }
        var r = T.rectOf(hit.win, S.target, S.cols, S.rows);
        if (!r || hit.win.zoomed) return false;
        return Math.abs(r.w - S.size.w) >= 8 || Math.abs(r.h - S.size.h) >= 4;
      }
      case 7: return S.session.windows.length > S.count;
      case 8: return S.session.windows.some(function (w) { return w.name === 'camp'; });
      case 9: return win.name === 'home';
      case 10: {
        var hit10 = T.findPane(S.session, S.target);
        if (!hit10) { setup(10); return false; }
        if (hit10.pane.mode !== 'copy' || hit10.win.id !== win.id) return false;
        var info = scrollInfo(hit10.pane);
        return info && info.history > 50 && info.pos >= info.history - 2;
      }
      case 11:
        if (!S.session.attached) { S.phase = 1; return false; }
        return S.phase === 1;
      case 12: {
        var h12 = T.findPane(S.session, S.target);
        if (!h12) return false;
        var r12 = rectUnzoomed(h12.win, S.target);
        return !!r12 && r12.x === 0;
      }
      case 13: {
        var hall = windowByName('hall');
        return !!hall && hall.layoutName === 'tiled' && T.panesOf(hall).length === 4;
      }
      case 14: {
        var h14 = T.findPane(S.session, S.target);
        return !!h14 && h14.pane.mode === 'copy' && lineText(h14.pane.lines[h14.pane.cy]).indexOf('secret: ' + SECRET_A) >= 0;
      }
      case 15: return S.clipboard.indexOf(SECRET_A) >= 0;
      case 16:
      case 23: {
        var d = T.findPane(S.session, S.target);
        return !!d && !!d.pane.opened;
      }
      case 17: return !windowByName('trap');
      case 18: return !!sessionByName('castle');
      case 19: return S.session.name === 'adv' && !!sessionByName('castle');
      case 20: {
        var fort = windowByName('fort');
        return !!fort && isTrident(fort);
      }
      case 21: {
        var h21 = T.findPane(S.session, S.target);
        if (!h21) return false;
        var r21 = rectUnzoomed(h21.win, S.target);
        return h21.win.active === S.target && h21.win.zoomed && r21 && r21.x === 0 && r21.y === 0;
      }
      case 22: {
        var alliesOk = S.allies.every(paneExists);
        if (!alliesOk) { fail('仲間の窓を閉じてしまった！'); return false; }
        return S.monsters.every(function (id) { return !paneExists(id); });
      }
      case 24: return !!(S.battle && S.battle.won);
    }
    return false;
  }

  function isTrident(win) {
    var root = win.root;
    return root.type === 'split' && root.dir === 'lr' && root.a.type === 'pane' &&
      root.b.type === 'split' && root.b.dir === 'tb' && root.b.a.type === 'pane' && root.b.b.type === 'pane';
  }

  function shares(rects, key) {
    var seen = {};
    for (var i = 0; i < rects.length; i++) {
      if (seen[rects[i][key]]) return true;
      seen[rects[i][key]] = true;
    }
    return false;
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

  // Chapter 3: running out of MP, or a forbidden move, resets the level.
  function fail(text) {
    S.failing = text;
  }

  function resetLevel(text) {
    S.failing = null;
    S.armed = false;
    S.confirm = null;
    S.prompt = null;
    S.picker = null;
    AU.play('gameover', bgmForScreen());
    setup(S.level);
    storyPose('hurt', 900);
    render();
    S.fails = S.fails || {};
    S.fails[S.level] = (S.fails[S.level] || 0) + 1;
    var advice = S.fails[S.level] >= 2
      ? levelActs(S.level).map(function (a) { return LV.HINTS[a]; })
      : [];
    openNotice(text, 'もう一度。MP は満タンに戻った。', null, advice);
  }

  // The hero in the quest band: cheering after a clear, hurt after a failure.
  function storyPose(pose, ms) {
    S.heroPose = pose;
    clearTimeout(S.storyPoseTimer);
    S.storyPoseTimer = setTimeout(function () { S.heroPose = null; if (S.screen === 'game' && !S.battle) renderQuest(); }, ms);
  }

  // After every change: render, then see whether the level is done.
  function tick() {
    render();
    if (S.mode === 'arena') { battleTick(); return; }
    // The boss fight calls tick() again itself once it is won.
    if (S.level === LAST && S.battle && !S.battle.won) { battleTick(); return; }
    if (S.level <= LAST && !S.free && check(S.level)) {
      var prev = S.level;
      S.level += 1;
      store.save({ level: S.level });
      S.armed = false;
      S.repeatUntil = 0;
        if (S.level <= LAST) {
        setup(S.level);
        storyPose('hero_win', 2500);
        render();
        celebrate();
        AU.play('levelup', bgmForScreen());
        openBrief(S.level, prev);
      } else {
        S.battle = null;
        render();
        celebrate();
        AU.play('victory', 'title');
        showFinale();
      }
      return;
    }
    if (S.failing) { resetLevel(S.failing); return; }
    if (S.mp && S.mp.left <= 0) resetLevel('MP が つきた！');
  }

  // ---- key handling ------------------------------------------------------

  // k: {key, code, ctrl, alt, shift, meta}. Returns true when consumed.
  function handleKey(k) {
    if (S.screen !== 'game') return false;
    if (S.briefOpen) {
      if (isModifierOnly(k.key)) return false;
      if (S.typing) { finishTyping(); return true; }
      // A key still repeating from the move that cleared the level must not
      // blow straight past the next chapter.
      if (Date.now() - S.briefOpenedAt > 300) {
        closeBrief();
      }
      return true;
    }
    if (S.battle && S.battle.phase !== 'fight') return !isModifierOnly(k.key);
    if (isModifierOnly(k.key)) return false;
    S.lastAction = null;
    var consumed = handleGameKey(k);
    if (consumed) {
      if (S.mp && S.mode === 'story') S.mp.left -= 1;
      if (S.battle) S.battle.keys += 1;
      if (S.lastAction && S.lastAction !== 'unbound' && S.lastAction !== 'brief') AU.se('cmd');
      tick();
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
          S.outer.lines.push({ html: '<span class="sh-dim">（ここは tmux の外。prefix は効かない。tmux attach で戻ろう）</span>' });
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
        : T.panesOf(win).length < 2 ? '窓が 1 つだけなので動かせない。先に窓を分けよう'
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
            if (!T.killWindow(S.session, win.id)) message('最後の窓は閉じられない');
          }
        }
      };
      return true;
    }
    if (key === '&') {
      S.lastAction = 'kill_window';
      S.confirm = {
        text: 'kill-window ' + win.name + '? (y/n)',
        yes: function () { if (!T.killWindow(S.session, win.id)) message('最後の部屋は閉じられない'); }
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
      // Mid-battle the clock keeps running, so show this question's keys instead.
      if (S.battle) return true;
      openBrief(Math.min(S.level, LAST), null);
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
    message('そのキーには割り当てがない（説明は ' + prefixLabel() + ' → i）');
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
      if (!T.killPane(win, pane.id)) message('最後の窓は閉じられない');
      S.lastAction = 'close';
    } else if (/^(kill-window|killw)$/.test(cmd)) {
      if (!T.killWindow(S.session, win.id)) message('最後の部屋は閉じられない');
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

  // ---- the arena and the boss ---------------------------------------------------
  // A battle is a fixed list of questions. Each question builds a fresh
  // session, asks for one result, and checks the state after every key.

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

  // Every question: text, the actions it may use (others are misses), the
  // key actions to show in practice mode, setup(r) and check().
  var Q = {
    split_lr: {
      text: '窓を左右に分けよ', allow: ['split_lr'], show: ['split_lr'],
      setup: function (r) { var x = room('home', r() < 0.5 ? [null] : [null, null], 'tb', 0); S.q0 = splitCount(x.win, 'lr'); },
      check: function () { return splitCount(T.activeWindow(S.session), 'lr') > S.q0; }
    },
    split_tb: {
      text: '窓を上下に分けよ', allow: ['split_tb'], show: ['split_tb'],
      setup: function (r) { var x = room('home', r() < 0.5 ? [null] : [null, null], 'lr', 0); S.q0 = splitCount(x.win, 'tb'); },
      check: function () { return splitCount(T.activeWindow(S.session), 'tb') > S.q0; }
    },
    focus: {
      text: '宝箱の窓へ移れ', allow: [], show: ['focus'],
      setup: function (r) {
        var n = 3 + pickInt(r, 2), t = 1 + pickInt(r, n - 1);
        var sc = []; for (var i = 0; i < n; i++) sc.push(i === t ? 'treasure' : null);
        var x = room('home', sc, 'tiled', 0); S.target = x.panes[t].id;
      },
      check: function () { return T.activeWindow(S.session).active === S.target; }
    },
    zoom: {
      text: '今の窓を全画面にせよ', allow: ['zoom'], show: ['zoom'],
      setup: function (r) { room('home', r() < 0.5 ? [null, null] : [null, null, null], 'tiled', 0); },
      check: function () { return T.activeWindow(S.session).zoomed; }
    },
    unzoom: {
      text: '全画面を元に戻せ', allow: ['zoom'], show: ['zoom'],
      setup: function () { var x = room('home', [null, null, null], 'tiled', 0); x.win.zoomed = true; },
      check: function () { return !T.activeWindow(S.session).zoomed; }
    },
    close: {
      text: 'モンスターの窓を閉じよ', allow: ['close'], show: ['focus', 'close'],
      setup: function (r) {
        var n = 2 + pickInt(r, 2), t = pickInt(r, n);
        var sc = []; for (var i = 0; i < n; i++) sc.push(i === t ? 'monster' : null);
        var x = room('home', sc, 'tiled', t === 0 ? 1 : 0); S.target = x.panes[t].id;
      },
      check: function () { return !paneExists(S.target); }
    },
    new_window: {
      text: '新しい部屋（ウィンドウ）を作れ', allow: ['new_window'], show: ['new_window'],
      setup: function () { room('home', [null], 'single'); },
      ready: function () { S.q0 = S.session.windows.length; },
      check: function () { return S.session.windows.length > S.q0; }
    },
    select_window: {
      text: null, allow: ['select_window'], show: ['select_window'],
      setup: function (r) {
        var names = ['home', 'camp', 'cave'];
        names.forEach(function (n) { room(n, [null], 'single'); });
        var from = pickInt(r, 3), to = (from + 1 + pickInt(r, 2)) % 3;
        T.selectWindow(S.session, windowByName(names[from]).id);
        S.qText = names[to] + ' の部屋へ行け';
        S.q0 = names[to];
      },
      check: function () { return T.activeWindow(S.session).name === S.q0; }
    },
    resize: {
      text: '今の窓の幅を広げるか狭めよ', allow: ['resize'], show: ['resize'],
      setup: function (r) {
        var x = room('home', [null, null], 'lr', pickInt(r, 2));
        var rr = T.rectOf(x.win, x.win.active, S.cols, S.rows);
        S.q0 = rr ? rr.w : 0;
      },
      check: function () {
        var w = T.activeWindow(S.session);
        var rr = T.rectOf(w, w.active, S.cols, S.rows);
        return !!rr && !w.zoomed && Math.abs(rr.w - S.q0) >= 5;
      }
    },
    swap: {
      text: '宝箱の窓を左端へ運べ', allow: ['swap'], show: ['swap'],
      setup: function (r) {
        var n = 2 + pickInt(r, 2);
        var sc = []; for (var i = 0; i < n; i++) sc.push(i === n - 1 ? 'treasure' : null);
        var x = room('home', sc, 'evenh', n - 1); S.target = x.panes[n - 1].id;
      },
      check: function () {
        var h = T.findPane(S.session, S.target);
        var rr = h && rectUnzoomed(h.win, S.target);
        return !!rr && rr.x === 0;
      }
    },
    rename: {
      text: 'この部屋の名前を camp にせよ', allow: ['rename'], show: ['rename'],
      setup: function () { room('zsh', [null], 'single'); },
      check: function () { return T.activeWindow(S.session).name === 'camp'; }
    },
    kill_window: {
      text: '部屋 trap を丸ごと閉じよ', allow: ['kill_window', 'select_window'], show: ['select_window', 'kill_window'],
      setup: function (r) {
        room('home', [null], 'single');
        room('trap', ['monster', 'monster'], 'lr', 0);
        if (r() < 0.4) T.selectWindow(S.session, windowByName('home').id);
      },
      check: function () { return !windowByName('trap'); }
    },
    copy_top: {
      text: '古文書の一番上を読め', allow: ['copy'], show: ['copy'],
      setup: function () { var x = room('home', ['scroll'], 'single'); stagePane(x.panes[0], 'scroll', '古文書', { length: 160 }); S.target = x.panes[0].id; },
      check: function () {
        var h = T.findPane(S.session, S.target);
        if (!h || h.pane.mode !== 'copy') return false;
        var info = scrollInfo(h.pane);
        return info && info.history > 30 && info.pos >= info.history - 2;
      }
    },
    find_zoom: {
      text: '宝箱の窓を全画面にせよ', allow: ['zoom'], show: ['focus', 'zoom'],
      setup: function (r) {
        var t = 1 + pickInt(r, 3);
        var sc = [null, null, null, null]; sc[t] = 'treasure';
        var x = room('home', sc, 'tiled', 0); S.target = x.panes[t].id;
      },
      check: function () { var w = T.activeWindow(S.session); return w.active === S.target && w.zoomed; }
    },
    trident: {
      text: '左に 1 つ、右に上下 2 つの窓を組め', allow: ['split_lr', 'split_tb'], show: ['split_lr', 'split_tb'],
      setup: function () { room('home', [null], 'single'); },
      check: function () { return isTrident(T.activeWindow(S.session)); }
    },
    two_monsters: {
      text: 'モンスター 2 匹を倒せ', allow: ['close'], show: ['focus', 'close'],
      setup: function (r) {
        var a = 1 + pickInt(r, 3), b = 1 + (a + pickInt(r, 2)) % 3;
        if (b === a) b = a === 3 ? 1 : a + 1;
        var sc = [null, null, null, null]; sc[a] = 'monster'; sc[b] = 'monster';
        var x = room('home', sc, 'tiled', 0); S.q0 = [x.panes[a].id, x.panes[b].id];
      },
      check: function () { return !paneExists(S.q0[0]) && !paneExists(S.q0[1]); }
    },
    new_and_home: {
      text: '新しい部屋を作り、home に戻れ', allow: ['new_window', 'select_window'], show: ['new_window', 'select_window'],
      setup: function () { room('home', [null], 'single'); S.q1 = false; },
      ready: function () { S.q0 = S.session.windows.length; },
      check: function () {
        if (S.session.windows.length > S.q0) S.q1 = true;
        return S.q1 && T.activeWindow(S.session).name === 'home';
      }
    },
    swap_zoom: {
      text: '宝箱を左端に運び、全画面にせよ', allow: ['swap', 'zoom'], show: ['swap', 'zoom'],
      setup: function () { var x = room('home', [null, null, 'treasure'], 'evenh', 2); S.target = x.panes[2].id; },
      check: function () {
        var h = T.findPane(S.session, S.target);
        if (!h) return false;
        var rr = rectUnzoomed(h.win, S.target);
        return h.win.zoomed && h.win.active === S.target && rr && rr.x === 0;
      }
    }
  };

  var MONSTERS = {
    slime: 'プルプル', bat: 'ヤミコウモリ', knight: 'カゲナイト', boss: '魔王ターミナス'
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

  function prepareBattle(kind, courseId) {
    var course = kind === 'boss' ? null : LV.COURSES.filter(function (c) { return c.id === courseId; })[0];
    // Like 寿司打: the same questions every time, in a new order each run.
    var qs = shuffle((kind === 'boss' ? LV.BOSS.qs : course.qs).slice());
    S.battle = {
      kind: kind,
      course: course,
      qs: qs,
      limit: kind === 'boss' ? LV.BOSS.limit : course.limit,
      i: 0,
      phase: 'ready',
      hp: kind === 'boss' ? LV.BOSS.hp : 0,
      maxHp: kind === 'boss' ? LV.BOSS.hp : 0,
      penalty: 0, misses: 0, timeouts: 0, keys: 0,
      start: 0, qStart: 0, end: 0,
      won: false,
      monster: kind === 'boss' ? 'boss' : course.monster,
      seed: (kind === 'boss' ? 'boss' : course.id) + ':' + Math.random()
    };
  }

  function startBattle() {
    var b = S.battle;
    b.phase = 'count';
    b.i = 0;
    b.penalty = 0; b.misses = 0; b.timeouts = 0; b.keys = 0;
    b.qlog = [];
    if (b.kind === 'boss') b.hp = b.maxHp;
    b.log = (MONSTERS[b.monster] || '') + 'が あらわれた！';
    $('#quest').dataset.hud = '';
    AU.play(b.kind === 'boss' ? 'boss' : 'battle');
    var n = 3;
    banner(String(n), 'count');
    var step = function () {
      if (S.battle !== b) return;
      n -= 1;
      if (n > 0) { banner(String(n), 'count'); AU.se('tick'); b.timer = setTimeout(step, reduceMotion ? 250 : 650); return; }
      banner('たたかう！', 'go');
      b.phase = 'fight';
      b.start = performance.now();
      loadQuestion();
      render();
      startClock();
    };
    b.timer = setTimeout(step, reduceMotion ? 250 : 650);
    render();
  }

  function loadQuestion() {
    var b = S.battle;
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
    b.qStart = performance.now();
    b.qlog[b.i] = { t: type, s: null, m: 0 };
    S.clipboard = '';
  }

  function battleTick() {
    var b = S.battle;
    if (!b || b.phase !== 'fight') return;
    var free = ['brief', 'focus', 'yank_start', 'search', 'cmd'];
    if (S.lastAction && free.indexOf(S.lastAction) < 0 &&
        (S.lastAction === 'unbound' || b.q.allow.indexOf(S.lastAction) < 0)) {
      miss();
    }
    if (b.q.check()) {
      AU.se('hit');
      hitFlash();
      var spell = spellsFor(b.q) || 'こうげき';
      var used = (performance.now() - b.qStart) / 1000;
      // Faster answers hit harder.
      var dmg = Math.max(3, Math.round(40 - used * 6));
      b.qlog[b.i].s = +used.toFixed(2);
      b.i += 1;
      if (b.i >= b.qs.length) { finishBattle(true); return; }
      loadQuestion();
      render();
      castFx(spell, MONSTERS[b.monster], dmg);
    }
  }

  function miss() {
    var b = S.battle;
    b.misses += 1;
    b.penalty += LV.MISS_PENALTY;
    if (b.qlog[b.i]) b.qlog[b.i].m += 1;
    AU.se('miss');
    flash('miss', 'ミス +' + LV.MISS_PENALTY + '秒');
    renderHud();
    hurtFx('ゆうしゃは じゅもんを まちがえた！');
  }

  function startClock() {
    clearInterval(S.clock);
    S.clock = setInterval(function () {
      var b = S.battle;
      if (!b || b.phase !== 'fight' || S.screen !== 'game') { clearInterval(S.clock); return; }
      var used = (performance.now() - b.qStart) / 1000;
      if (used > b.limit) timeout();
      renderHud();
    }, 100);
  }

  function timeout() {
    var b = S.battle;
    b.timeouts += 1;
    if (b.qlog[b.i]) b.qlog[b.i].to = 1;
    if (b.kind === 'boss') {
      b.hp -= 1;
      AU.se('hurt');
      flash('hurt', '魔王の攻撃！');
      shake();
      if (b.hp <= 0) { finishBattle(false); return; }
    } else {
      b.penalty += LV.TIMEOUT_PENALTY;
      AU.se('miss');
      flash('miss', '時間切れ +' + LV.TIMEOUT_PENALTY + '秒');
    }
    b.i += 1;
    if (b.i >= b.qs.length) { finishBattle(b.kind === 'boss'); return; }
    loadQuestion();
    render();
    hurtFx(b.kind === 'boss' ? '魔王の こうげき！ ゆうしゃは ダメージを うけた！' : '時間切れ！ ' + MONSTERS[b.monster] + 'は にげだした。');
  }

  function finishBattle(won) {
    var b = S.battle;
    clearInterval(S.clock);
    b.phase = 'done';
    b.end = performance.now();
    if (b.kind === 'boss') {
      if (won) {
        b.won = true;
        tick();
      } else {
        AU.play('gameover', 'boss');
        openNotice('ゆうしゃは たおれた……', '魔王の命令に、時間内に答えよう。もう一度挑む。', function () { startBattle(); });
      }
      return;
    }
    var time = (b.end - b.start) / 1000 + b.penalty;
    var result = {
      course: b.course.id, time: time, raw: (b.end - b.start) / 1000, misses: b.misses, timeouts: b.timeouts,
      keys: b.keys, n: b.qs.length, avg: time / b.qs.length
    };
    var sum = REC.add({
      course: b.course.id, prefix: S.prefix,
      time: +time.toFixed(2), raw: +result.raw.toFixed(2), misses: b.misses, timeouts: b.timeouts,
      keys: b.keys, n: b.qs.length, qs: b.qlog
    });
    for (var k in sum) result[k] = sum[k];
    var pool = [];
    b.qs.forEach(function (t) { Q[t].show.forEach(function (a) { pool = pool.concat(LV.tipsFor(a)); }); });
    result.tip = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    S.result = result;
    AU.play('victory', 'title');
    S.mode = 'story';
    S.battle = null;
    showScreen('arena');
  }

  // ---- rendering ----------------------------------------------------------

  function render() {
    syncBody();
    if (S.screen === 'title') renderTitle();
    if (S.screen === 'game') { renderQuest(); renderTerm(); renderStatus(); renderKeybar(); }
    if (S.screen === 'finale') renderFinale();
    if (S.screen === 'arena') renderArena();
    if (S.screen === 'records') renderRecords();
  }

  function keycaps(list) {
    return list.map(function (k) { return '<kbd>' + esc(k) + '</kbd>'; }).join('');
  }

  function renderTitle() {
    var saved = S.level;
    $('#map-slot').innerHTML = ART.worldMap(Math.min(saved, LAST + 1), LAST, LV.LEVELS, LV.CHAPTERS);
    $$('#title-screen [data-prefix]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.prefix === S.prefix ? 'true' : 'false'); });
    var cont = $('#btn-continue');
    if (saved > 1 && saved <= LAST) {
      cont.hidden = false;
      var ch = LV.chapterOf(saved);
      cont.innerHTML = '続きから <span class="sub">第' + ch.n + '章 Lv ' + saved + ' ' + esc(LV.level(saved).title) + '</span>';
    } else if (saved > LAST) {
      cont.hidden = false;
      cont.innerHTML = '早見表を見る <span class="sub">全面クリア済み</span>';
    } else cont.hidden = true;
    $('#btn-start').innerHTML = saved > 1 ? '最初から<span class="sub">記録を消す</span>' : '冒険を始める<span class="sub">1 面ずつ覚える</span>';
    $('#title-meta').textContent = 'prefix ' + prefixLabel();
    var all = REC.load(), runs = all.runs || [];
    var rb = $('#btn-records');
    rb.hidden = !runs.length;
    if (runs.length) {
      var last = runs[runs.length - 1], b = REC.best(last.course, all), c = REC.courseOf(last.course);
      rb.innerHTML = '記録の間<span class="sub">通算 ' + runs.length + ' 戦' + (b && c ? ' ・ ' + esc(c.title) + ' 最高 ' + b.time.toFixed(1) + '秒' : '') + '</span>';
    }
  }

  function gauge(left, max, cls) {
    var pct = max ? Math.max(0, Math.min(100, left / max * 100)) : 0;
    return '<span class="gauge ' + (cls || '') + '"><i style="width:' + pct + '%"></i></span>';
  }

  function renderQuest() {
    if (S.battle) { renderHud(); return; }
    var q = $('#quest');
    q.classList.remove('hud');
    q.dataset.hud = '';
    var lv = curLevel();
    var ch = LV.chapterOf(Math.min(S.level, LAST));
    var dots = '';
    for (var i = ch.first; i <= ch.last; i++) {
      dots += '<i class="' + (i < S.level ? 'done' : i === S.level ? 'now' : '') + '" title="' + esc(LV.level(i).title) + '"></i>';
    }
    if (S.level > LAST) {
      q.innerHTML = '<div class="q-hero">' + ART.sprite('hero_win', 'q-hero-spr') + '</div><div class="q-lv"><span class="q-num">★</span></div><div class="q-main"><div class="q-title">全面クリア</div><div class="q-goal">自由に遊べる。早見表は ' + esc(prefixLabel()) + ' → i</div></div>';
      return;
    }
    var keys = LV.KEYS[lv.action] || [];
    var right = '';
    if (S.mp) {
      right = '<div class="q-mp">' + goalSVG(S.level, 'small') + '<span class="mp-label">MP</span>' + gauge(S.mp.left, S.mp.max, S.mp.left <= S.mp.max * 0.25 ? 'low' : '') + '<span class="mp-num">' + Math.max(0, S.mp.left) + '<small>/' + S.mp.max + '</small></span></div>';
      var acts = [];
      levelActs(S.level).forEach(function (a) { (LV.KEYS[a] || []).forEach(function (k) { if (acts.indexOf(k) < 0) acts.push(k); }); });
      if (acts.length) right += '<div class="q-keys"><kbd class="pfx">' + esc(prefixLabel()) + '</kbd><span class="arrow">→</span>' + keycaps(acts) + '</div>';
    } else if (keys.length) {
      right = '<div class="q-keys">' + (lv.action === 'yank' ? '' : '<kbd class="pfx">' + esc(prefixLabel()) + '</kbd><span class="arrow">→</span>') + keycaps(keys) + '</div>';
    }
    q.innerHTML =
      '<div class="q-hero' + (S.heroPose === 'hurt' ? ' hurt' : '') + '">' + ART.sprite(S.heroPose === 'hero_win' ? 'hero_win' : 'hero', 'q-hero-spr') + '</div>' +
      '<div class="q-lv">' + ART.icon(lv.icon, 'q-icon') + '<span class="q-num">Lv ' + S.level + '<small>/' + LAST + '</small></span></div>' +
      '<div class="q-main"><div class="q-ch">第' + ch.n + '章 ' + esc(ch.title) + '</div><div class="q-title">' + esc(lv.title) + '</div>' +
      '<div class="q-goal">' + esc(lv.goal) + '</div></div>' +
      right +
      '<div class="q-dots">' + dots + '</div>';
  }

  function qText(b) { return S.qText || b.q.text; }

  // The battle band: the monster, the order, the clock.
  // The battle band: the hero on the left, the foe on the right, the order
  // and the clock between them. It is rebuilt only when the question, the
  // phase or the score changes, so poses and effects can play out; the clock
  // ticks update the numbers in place.
  function renderHud() {
    var b = S.battle;
    var q = $('#quest');
    if (!b) return;
    q.classList.add('hud');
    var key = [b.i, b.phase, b.hp, b.misses, b.timeouts].join(':');
    if (q.dataset.hud !== key) {
      var entering = q.dataset.hudI !== String(b.i) && b.phase === 'fight' && b.kind !== 'boss';
      q.dataset.hud = key;
      q.dataset.hudI = String(b.i);
      var keys = [];
      var hints = [];
      if (b.q && b.phase === 'fight') b.q.show.forEach(function (a) { keys = keys.concat(LV.KEYS[a] || []); if (LV.HINTS[a]) hints.push(LV.HINTS[a]); });
      var html = '<div class="hud-hero"><span class="hero-pose">' + ART.sprite('hero', 'hud-spr') + '</span></div>';
      html += '<div class="hud-main">';
      html += '<div class="hud-name">' + (b.kind === 'boss' ? '魔王戦' : esc(b.course.title)) + '</div>';
      html += '<div class="hud-order">' + (b.phase === 'fight' && b.q ? '▶ ' + esc(qText(b)) : b.phase === 'count' ? '▶ かまえて……' : '') + '</div>';
      if (keys.length) html += '<div class="hud-keys"><kbd class="pfx">' + esc(prefixLabel()) + '</kbd><span class="arrow">→</span>' + keycaps(keys) + '</div>';
      if (hints.length) html += '<div class="hud-hint">' + hints.map(esc).join('<br>') + '</div>';
      html += '<div class="hud-limit">' + gauge(1, 1, '') + '</div>';
      html += '<div class="hud-log">' + esc(b.log || '') + '</div>';
      html += '</div>';
      html += '<div class="hud-foe' + (entering ? ' enter' : '') + '"><span class="foe">' + ART.sprite(b.monster, 'hud-spr') + '</span><span class="dmg"></span><span class="foe-name">' + esc(MONSTERS[b.monster] || '') + '</span></div>';
      html += '<div class="hud-side">';
      if (b.kind === 'boss') {
        html += '<div class="hud-stat"><span>魔王</span>' + gauge(b.qs.length - b.i, b.qs.length, 'boss') + '</div>';
        var hearts = '';
        for (var i = 0; i < b.maxHp; i++) hearts += '<i class="' + (i < b.hp ? 'on' : '') + '"></i>';
        html += '<div class="hud-stat"><span>HP</span><span class="hearts">' + hearts + '</span></div>';
      } else {
        html += '<div class="hud-time">0.0<small>秒</small></div>';
        html += '<div class="hud-stat">' + (b.penalty ? '<span class="pen">+' + b.penalty + '秒</span>' : '') + '<span>ミス ' + b.misses + '</span></div>';
      }
      html += '<div class="hud-count">' + Math.min(b.i + 1, b.qs.length) + ' / ' + b.qs.length + '</div>';
      html += '</div>';
      q.innerHTML = html;
    }
    var now = performance.now();
    var used = b.phase === 'fight' ? (now - b.qStart) / 1000 : 0;
    var left = Math.max(0, b.limit - used);
    var bar = $('.hud-limit .gauge', q);
    if (bar) { bar.classList.toggle('low', left < 3); $('i', bar).style.width = (left / b.limit * 100) + '%'; }
    var t = $('.hud-time', q);
    if (t) t.firstChild.nodeValue = (b.phase === 'fight' ? (now - b.start) / 1000 : 0).toFixed(1);
  }

  // The spell names for what a question asks: the actions it shows, less moving around.
  function spellsFor(q) {
    var names = [];
    q.show.forEach(function (a) {
      if (a === 'focus' && q.show.length > 1) return;
      for (var n = 1; n <= LAST; n++) {
        var lv = LV.level(n);
        if (lv.action === a && lv.spell) { names.push(lv.spell); return; }
      }
    });
    return names.join('・');
  }

  function heroPose(pose, ms) {
    var el = $('#quest .hero-pose');
    if (!el) return;
    el.innerHTML = ART.sprite(pose === 'hurt' ? 'hero' : pose, 'hud-spr');
    el.classList.toggle('hurt', pose === 'hurt');
    clearTimeout(S.poseTimer);
    S.poseTimer = setTimeout(function () {
      var e2 = $('#quest .hero-pose');
      if (e2) { e2.innerHTML = ART.sprite('hero', 'hud-spr'); e2.classList.remove('hurt'); }
    }, ms || 450);
  }

  function hudLog(text) {
    if (S.battle) S.battle.log = text;
    var el = $('#quest .hud-log');
    if (el) el.textContent = text;
  }

  // A question answered: the hero casts, the foe takes damage.
  function castFx(spell, foe, dmg) {
    heroPose('hero_cast', 500);
    var d = $('#quest .dmg');
    if (d && !reduceMotion) { d.textContent = String(dmg); d.classList.remove('show'); void d.offsetWidth; d.classList.add('show'); }
    hudLog('ゆうしゃは ' + spell + 'を となえた！ ' + foe + (S.battle && S.battle.kind === 'boss' ? 'に ' + dmg + ' のダメージ！' : 'を たおした！'));
  }

  function hurtFx(text) {
    heroPose('hurt', 450);
    hudLog(text);
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
      html += '<div class="pane-title"><span>' + idx + (p.name ? ' ' + esc(p.name) : '') + '</span>' + (win.zoomed ? '<span class="zoom-flag">Z</span>' : '') + '</div>';
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

  function sceneHTML(p) {
    if (p.scene === 'treasure') {
      return '<div class="scene"><div class="scene-art">' + ART.sprite('treasure') + '<span class="sparkle s1"></span><span class="sparkle s2"></span><span class="sparkle s3"></span></div>' +
        '<div class="scene-cap">宝箱を見つけた？ この窓を選ぼう。</div></div>';
    }
    if (p.scene === 'monster') {
      return '<div class="scene"><div class="scene-art">' + ART.sprite('monster') + '<span class="roar">ガオー！</span></div>' +
        '<div class="scene-cap">この窓を選んで、閉じて退治しよう。</div></div>';
    }
    if (p.scene === 'ally') {
      return '<div class="scene"><div class="scene-art">' + ART.sprite('ally') + '</div>' +
        '<div class="scene-cap">仲間の窓。閉じてはいけない。</div></div>';
    }
    if (p.scene === 'door') {
      return '<div class="scene"><div class="scene-art">' + ART.sprite(p.opened ? 'door_open' : 'door') + '</div>' +
        '<div class="scene-cap">' + (p.opened ? '扉は開いている。' : '合言葉を貼り付けて Enter。') + '</div></div>';
    }
    if (p.scene === 'scroll') {
      return '<div class="scene scroll-head"><div class="parchment-roll"></div></div>';
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
    html += '<span class="st-host">"dungeon"</span><span class="st-clock">' + clock() + '</span></span>';
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
    if (S.battle && S.battle.q) S.battle.q.show.forEach(function (a) { labels = labels.concat(LV.KEYS[a] || []); });
    else if (S.level <= LAST) labels = curLevel().keys || [];
    labels.forEach(function (label) { add(label, keyFromLabel(label), 'k-level'); });
    if (S.detached || S.level === 11 || S.level > LAST || S.prompt) add('Enter', { key: 'Enter' });
    if (!S.battle) add('i', { key: 'i' });
    var html = '';
    keys.forEach(function (x) {
      html += '<button type="button" class="key ' + x.cls + '" data-k="' + esc(JSON.stringify(x.k)) + '"' + (x.cls === 'k-prefix' && S.armed ? ' aria-pressed="true"' : '') + '>' + esc(x.label) + '</button>';
    });
    html += '<button type="button" class="key k-type" data-type="1">abc…</button>';
    bar.innerHTML = html;
  }

  // ---- overlays: the message window -------------------------------------------

  // The story text appears letter by letter, the way an old RPG speaks.
  function typeOut(el) {
    var nodes = $$('[data-type]', el);
    var texts = nodes.map(function (n) { return n.textContent; });
    if (reduceMotion) return;
    nodes.forEach(function (n) { n.textContent = ''; });
    S.typing = { nodes: nodes, texts: texts };
    var ni = 0, ci = 0;
    clearInterval(S.typeTimer);
    S.typeTimer = setInterval(function () {
      if (!S.typing) { clearInterval(S.typeTimer); return; }
      if (ni >= nodes.length) { finishTyping(); return; }
      ci += 2;
      nodes[ni].textContent = texts[ni].slice(0, ci);
      if (ci % 6 === 0) AU.se('blip');
      if (ci >= texts[ni].length) { ni += 1; ci = 0; }
    }, 22);
  }

  function finishTyping() {
    if (!S.typing) return;
    clearInterval(S.typeTimer);
    S.typing.nodes.forEach(function (n, i) { n.textContent = S.typing.texts[i]; });
    S.typing = null;
    S.briefOpenedAt = Date.now() - 200;
  }

  var ELDER = {
    1: 'よく来た、若き勇者よ。この世界では、窓（ペイン）と部屋（ウィンドウ）を操る者が強い。まずは壁を一枚立てることから始めるのじゃ。',
    2: '村での修行、見事であった。塔では窓を入れ替え、古文書を探して写す術を学ぶ。そして新しい世界への渡り方もな。',
    3: 'この先は魔王の城。城の中では魔力（MP）が限られておる。覚えた呪文を、迷わず唱えるのじゃ。'
  };

  function openBrief(n, prev) {
    var b = $('#brief');
    var lv = LV.level(n);
    var ch = LV.chapterOf(n);
    var keys = LV.KEYS[lv.action] || [];
    var html = '';
    if (prev) {
      var p = LV.level(prev);
      var learned = LV.HINTS[p.action];
      html += '<div class="dq-log has-hero">' + ART.sprite('hero_win', 'log-hero');
      html += '<p data-type>★「' + esc(p.title) + '」を クリアした！</p>';
      html += '<p data-type>ゆうしゃの レベルが ' + n + ' に あがった！</p>';
      if (p.spell && learned) html += '<p data-type>じゅもん「' + esc(p.spell) + '」を おぼえた！</p>';
      else if (p.spell) html += '<p data-type>わざ「' + esc(p.spell) + '」を みにつけた！</p>';
      html += '</div>';
      if (LV.chapterOf(prev).n !== ch.n) html += '<div class="chapter-card"><span>第' + ch.n + '章</span>' + esc(ch.title) + '<small>' + esc(ch.sub) + '</small></div>';
    }
    // The elder greets the hero at the start of each chapter.
    if (n === ch.first && ELDER[ch.n]) {
      html += '<div class="elder">' + ART.sprite('elder', 'elder-spr') + '<p data-type>長老「' + esc(ELDER[ch.n]) + '」</p></div>';
    }
    html += '<div class="brief-head">' + ART.icon(lv.icon, 'brief-icon') + '<div><div class="brief-eyebrow">冒険の書 ・ 第' + ch.n + '章 ' + esc(ch.title) + ' ・ ' + n + ' / ' + LAST + '</div><h2 class="brief-title">' + esc(lv.title) + '</h2></div></div>';
    html += '<div class="brief-story">' + lv.story.map(function (t) { return '<p data-type>' + esc(t) + '</p>'; }).join('') + '</div>';
    html += '<dl class="brief-facts"><dt>目標</dt><dd>' + esc(lv.goal) + '</dd>';
    if (goalSVG(n)) html += '<dt>完成形</dt><dd>' + goalSVG(n, 'big') + '</dd>';
    if (lv.mp) {
      html += '<dt>MP</dt><dd>' + lv.mp + '（キーを 1 回押すごとに 1 減る）</dd>';
      html += '<dt>キー</dt><dd>' + levelActs(n).map(function (a) { return '<div class="brief-hint">' + esc(LV.HINTS[a]) + '</div>'; }).join('') + '</dd>';
    } else if (lv.action === 'boss') {
      html += '<dt>HP</dt><dd>' + LV.BOSS.hp + '（' + LV.BOSS.limit + ' 秒以内に答えられないと 1 減る）</dd>';
    } else if (keys.length) {
      html += '<dt>キー</dt><dd><div class="brief-keys">' + (lv.action === 'yank' ? '' : '<kbd class="pfx">' + esc(prefixLabel()) + '</kbd><span class="arrow">→</span>') + keycaps(keys) + '</div><div class="brief-hint">' + esc(LV.hint(S.prefix, lv.action)) + '</div></dd>';
    }
    html += '</dl>';
    var tips = lv.mp ? [] : LV.tipsFor(lv.action);
    if (tips.length) html += '<div class="tips"><div class="tips-head">豆知識</div>' + tips.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div>';
    html += '<div class="brief-foot">説明をもう一度見る: ' + esc(prefixLabel()) + ' → i<span class="brief-dismiss">何かキーを押すと閉じる ▼</span></div>';
    var card = $('.brief-card', b);
    card.innerHTML = html;
    b.hidden = false;
    S.briefOpen = true;
    S.briefOpenedAt = Date.now();
    syncBody();
    typeOut(card);
  }

  // Keys for the chapter 3 levels.
  function levelActs(n) {
    return { 20: ['split_lr', 'split_tb'], 21: ['focus', 'swap', 'zoom'], 22: ['focus', 'close'], 23: ['select_window', 'focus', 'search', 'yank', 'paste'] }[n] || [];
  }

  // The shape a chapter 3 level asks for, as a small drawing.
  function goalSVG(n, cls) {
    var out = '<svg class="goal-svg ' + (cls || '') + '" viewBox="0 0 48 30" aria-hidden="true">';
    var frame = '<rect class="g-frame" x="1" y="1" width="46" height="28"/>';
    if (n === 20) {
      out += frame + '<line x1="24" y1="1" x2="24" y2="29"/><line x1="24" y1="15" x2="47" y2="15"/>';
    } else if (n === 21) {
      out += frame + '<rect class="g-fill" x="1" y="1" width="23" height="14"/><line x1="24" y1="1" x2="24" y2="29"/><line x1="1" y1="15" x2="47" y2="15"/>' +
        '<text x="12.5" y="11" text-anchor="middle">宝</text><text x="36" y="25" text-anchor="middle" class="g-dim">→ Z</text>';
    } else if (n === 22) {
      out += frame + '<line x1="16.3" y1="1" x2="16.3" y2="15"/><line x1="31.6" y1="1" x2="31.6" y2="15"/><line x1="1" y1="15" x2="47" y2="15"/><line x1="24" y1="15" x2="24" y2="29"/>' +
        '<text x="8.6" y="11" text-anchor="middle">仲</text><text x="24" y="11" text-anchor="middle" class="g-x">×</text><text x="39.3" y="11" text-anchor="middle" class="g-x">×</text>' +
        '<text x="12.5" y="25" text-anchor="middle">仲</text><text x="36" y="25" text-anchor="middle" class="g-x">×</text>';
    } else return '';
    return out + '</svg>';
  }

  // A one-off message window (failures, the boss), closed by any key.
  function openNotice(title, text, then, advice) {
    var b = $('#brief');
    var help = advice && advice.length
      ? '<div class="elder">' + ART.sprite('elder', 'elder-spr') + '<div><p data-type>長老「迷っておるようじゃな。使う呪文はこれじゃ。」</p>' +
        advice.map(function (h) { return '<p class="brief-hint">' + esc(prefixLabel()) + ' → ' + esc(h) + '</p>'; }).join('') + '</div></div>'
      : '';
    $('.brief-card', b).innerHTML = '<div class="dq-log"><p data-type>' + esc(title) + '</p><p data-type>' + esc(text) + '</p></div>' + help + '<div class="brief-foot"><span></span><span class="brief-dismiss">何かキーを押すと閉じる ▼</span></div>';
    b.hidden = false;
    S.briefOpen = true;
    S.briefOpenedAt = Date.now();
    S.afterBrief = then || null;
    syncBody();
    typeOut($('.brief-card', b));
  }

  function closeBrief() {
    $('#brief').hidden = true;
    S.briefOpen = false;
    S.typing = null;
    clearInterval(S.typeTimer);
    syncBody();
    focusSink();
    var then = S.afterBrief;
    S.afterBrief = null;
    if (then) { then(); return; }
    if (S.battle && S.battle.phase === 'ready' && S.screen === 'game') startBattle();
  }

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

  function flash(kind, text) {
    banner(text, kind);
  }

  function hitFlash() {
    var q = $('#quest');
    if (!q || reduceMotion) return;
    q.classList.remove('hit');
    void q.offsetWidth;
    q.classList.add('hit');
  }

  function shake() {
    if (reduceMotion) return;
    var t = $('.term-wrap');
    t.classList.remove('shake');
    void t.offsetWidth;
    t.classList.add('shake');
  }

  function celebrate() {
    if (reduceMotion) return;
    var fx = $('#fx');
    var colors = ['c1', 'c2', 'c3', 'c4'];
    for (var i = 0; i < 42; i++) {
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
    if (name !== 'game') { clearInterval(S.clock); $('#brief').hidden = true; S.briefOpen = false; }
    syncBody();
    render();
    if (name !== 'game' || S.mode === 'story') music();
  }

  function startGame() {
    S.mode = 'story';
    S.battle = null;
    newSession();
    S.free = S.level > LAST;
    showScreen('game');
    // The terminal needs its size before a stage can be measured.
    render();
    if (S.level <= LAST) {
      if (S.level >= 12) fastForward(S.level);
      setup(S.level);
    }
    render();
    if (S.level <= LAST) openBrief(S.level, null);
    focusSink();
  }

  // Resuming in chapter 2 or 3 starts from a fresh session; put back what
  // the earlier levels would have left (the castle session, for one).
  function fastForward(level) {
    if (level >= 20 && !sessionByName('castle')) {
      makeSession('castle');
    }
  }

  function showFinale() {
    S.free = true;
    S.briefOpen = false;
    $('#brief').hidden = true;
    showScreen('finale');
  }

  function renderFinale() {
    var rows = LV.cheat();
    var html = '';
    rows.forEach(function (r, i) {
      html += '<tr><td class="c-n">' + (i + 1) + '</td><td class="c-goal">' + ART.icon(r.icon, 'c-icon') + esc(r.goal) + '</td><td class="c-spell">' + esc(r.spell || '') + '</td><td class="c-key">' + esc(r.key) + '</td></tr>';
    });
    $('#cheat-body').innerHTML = html;
    $('#cheat-meta').textContent = 'prefix = ' + prefixLabel();
    $('#trophy').innerHTML = ART.sprite('hero_win', 'finale-hero') + ART.sprite('trophy') + ART.sprite('elder', 'finale-elder');
  }

  function fmt(t) { return t == null ? '—' : t.toFixed(1) + '秒'; }

  function sec(t) { return t.toFixed(1) + ' 秒'; }

  // The last few runs as bars, oldest first; the shape matters, not the numbers.
  function spark(list) {
    if (!list || list.length < 2) return '';
    var max = Math.max.apply(null, list.map(function (r) { return r.time; }));
    var bars = list.map(function (r, i) {
      var h = Math.max(2, Math.round(r.time / max * 8)) * 3;
      return '<i class="' + (r.rec ? 'rec' : '') + (i === list.length - 1 ? ' now' : '') + '" style="height:' + h + 'px"></i>';
    }).join('');
    return '<div class="spark" aria-label="直近 ' + list.length + ' 回のタイム"><span class="spark-label">直近 ' + list.length + ' 回</span><span class="spark-bars">' + bars + '</span></div>';
  }

  // What the result log says about this run against the earlier ones.
  function growthLines(r) {
    var out = [];
    if (r.count === 1) out.push('<p>はじめての挑戦。これが きみの出発点だ。</p>');
    else if (r.record) out.push('<p class="rec">★ 新記録！ これまでの最高より <b>' + Math.abs(r.bestDelta).toFixed(1) + ' 秒</b> はやい</p>');
    else if (r.delta < 0) out.push('<p>前回より <b>' + Math.abs(r.delta).toFixed(1) + ' 秒</b> はやくなった</p>');
    else out.push('<p>前回より ' + r.delta.toFixed(1) + ' 秒 おそい。自己ベストまで あと ' + r.bestDelta.toFixed(1) + ' 秒</p>');
    if (r.rankUp) out.push('<p class="rec">称号が <b>' + esc(r.rankFrom) + '</b> から <b>' + esc(r.rank) + '</b> に あがった！</p>');
    else if (r.parFirst) out.push('<p class="rec">目標タイム ' + r.par + ' 秒を 切った！</p>');
    return out.slice(0, 2).join('');
  }

  function renderArena() {
    var all = REC.load();
    var saved = all.arena || {};
    var html = '';
    LV.COURSES.forEach(function (c) {
      var best = saved[REC.recordKey(c.id)];
      var count = REC.runsOf(c.id, all).length;
      var n = c.qs.length;
      html += '<li><button type="button" class="course" data-course="' + c.id + '">' +
        '<span class="course-spr">' + ART.sprite(c.monster) + '</span>' +
        '<span class="course-main"><span class="course-title">' + esc(c.title) +
        '<span class="course-mode' + (c.recommended ? ' rec' : '') + '">' + esc(c.mode) + (c.recommended ? ' ★' : '') + '</span>' +
        '<small>' + esc(c.sub) + ' ・ ' + n + ' 問</small></span>' +
        '<span class="course-desc">' + esc(c.desc) + '</span></span>' +
        '<span class="course-best"><small>最高記録</small>' + (best ? fmt(best.time) : '—') +
        '<small class="course-par">目標 ' + LV.par(c) + '秒' + (count ? ' ・ ' + count + ' 戦' : '') + '</small></span>' +
        '</button></li>';
    });
    $('#course-list').innerHTML = html;
    $('#arena-meta').textContent = 'prefix ' + prefixLabel();
    $('#arena-hero').innerHTML = ART.sprite(S.result ? 'hero_win' : 'hero', 'arena-hero-spr');
    var r = S.result;
    var res = $('#arena-result');
    if (!r) { res.hidden = true; return; }
    res.hidden = false;
    res.dataset.runId = r.runId || '';
    var course = REC.courseOf(r.course);
    res.innerHTML =
      '<div class="dq-log"><p>' + esc(course.title) + 'を せいはした！</p>' + growthLines(r) + '</div>' +
      '<div class="res-time">' + r.time.toFixed(1) + '<small>秒</small></div>' +
      '<div class="res-rank">称号 <b>' + esc(r.rank) + '</b></div>' +
      '<dl class="res-facts">' +
      '<dt>1 問あたり</dt><dd>' + r.avg.toFixed(2) + '秒</dd>' +
      '<dt>実時間</dt><dd>' + r.raw.toFixed(1) + '秒</dd>' +
      '<dt>ミス</dt><dd>' + r.misses + '（+' + (r.misses * LV.MISS_PENALTY) + '秒）</dd>' +
      '<dt>時間切れ</dt><dd>' + r.timeouts + '（+' + (r.timeouts * LV.TIMEOUT_PENALTY) + '秒）</dd>' +
      '<dt>押したキー</dt><dd>' + r.keys + '</dd>' +
      '<dt>これまでの最高</dt><dd>' + fmt(r.best) + '</dd>' +
      '<dt>目標タイム</dt><dd>' + r.par + '秒' + (r.parMet ? ' ✓' : '') + '</dd>' +
      '<dt>通算</dt><dd>' + r.count + ' 戦目</dd>' +
      '</dl>' +
      spark(r.spark) +
      (r.tip ? '<div class="tips"><div class="tips-head">豆知識</div><p>' + esc(r.tip) + '</p></div>' : '') +
      '<div class="cta"><button type="button" class="btn primary" data-course="' + r.course + '">もう一度</button>' +
      '<button type="button" class="btn" data-records="' + r.course + '">記録を見る</button></div>';
  }

  // ---- 記録の間 --------------------------------------------------------------

  function openRecords(course, from) {
    S.recordsFrom = from || S.screen;
    if (course) S.recCourse = course;
    if (!S.recCourse) {
      var all = REC.load();
      var last = (all.runs || []).slice(-1)[0];
      S.recCourse = last ? last.course : 'normal';
    }
    showScreen('records');
  }

  function recDate(at) {
    var d = new Date(at);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // Up to 20 latest runs as pixel bars: gold for a record, a dotted line at
  // the best and a faint one at the target time. The SVG stretches to the
  // box; the labels are HTML on top so their text keeps its size.
  function recChart(runs, c, best) {
    var list = runs.slice(0, 20).reverse();
    var W = 200, H = 100;
    var par = LV.par(c);
    var max = Math.max(par, Math.max.apply(null, list.map(function (r) { return r.time; }))) * 1.12;
    var y = function (t) { return +(H - t / max * H).toFixed(2); };
    var svg = '<svg class="rec-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true">';
    list.forEach(function (r, i) {
      svg += '<rect class="bar' + (r.rec ? ' rec' : '') + (i === list.length - 1 ? ' now' : '') + '" x="' + (i * 10 + 1.5) + '" y="' + y(r.time) + '" width="7" height="' + (H - y(r.time)) + '"><title>' +
        esc(recDate(r.at) + ' ' + r.time.toFixed(1) + '秒 ミス ' + r.misses) + '</title></rect>';
    });
    svg += '<line class="par" x1="0" x2="' + W + '" y1="' + y(par) + '" y2="' + y(par) + '" vector-effect="non-scaling-stroke"/>';
    if (best != null) svg += '<line class="best" x1="0" x2="' + W + '" y1="' + y(best) + '" y2="' + y(best) + '" vector-effect="non-scaling-stroke"/>';
    svg += '</svg>';
    var lbl = '<span class="lbl par-l" style="top:' + y(par) + '%">目標 ' + par + '秒</span>';
    if (best != null) lbl += '<span class="lbl best-l" style="top:' + y(best) + '%">最高 ' + best.toFixed(1) + '秒</span>';
    return '<div id="rec-chart" class="rec-chart" role="img" aria-label="タイム推移">' + svg + lbl + '</div>';
  }

  function renderRecords() {
    var id = S.recCourse;
    var c = REC.courseOf(id);
    $$('#records-screen [data-rec-course]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.recCourse === id ? 'true' : 'false'); });
    $('#records-hero').innerHTML = ART.sprite(c.monster, 'arena-hero-spr');
    var st = REC.stats(id);
    var body = $('#records-body');
    if (!st) {
      body.innerHTML = '<div class="dq-log rec-log"><p>' + esc(c.title) + '（' + esc(c.mode) + '）の記録は まだない。</p><p>一度走ると、ここに きみの成長が 刻まれる。</p></div>' +
        '<div class="cta"><button type="button" class="btn primary" data-course="' + id + '">' + esc(c.title) + 'に挑む</button></div>';
      return;
    }
    var gain = st.first.time - st.best;
    var head = st.count === 1
      ? '<p>挑戦 1 回。もう一度走ると、ここに成長が出る。</p>'
      : '<p>はじめて ' + sec(st.first.time) + ' → 自己ベスト ' + sec(st.best) + (gain > 0 ? '（<b>−' + gain.toFixed(1) + ' 秒</b>）。ゆうしゃは つよくなった。' : '。') + '</p>';
    var tiles =
      '<div class="rec-tiles">' +
      '<div class="rec-tile"><small>自己ベスト</small><b>' + fmt(st.best) + '</b></div>' +
      '<div class="rec-tile"><small>称号</small><b>' + esc(st.bestRank || '—') + '</b></div>' +
      '<div class="rec-tile"><small>挑戦回数</small><b>' + st.count + ' 戦</b></div>' +
      '<div class="rec-tile"><small>直近 5 回の平均</small><b>' + fmt(st.recentAvg) + '</b></div>' +
      '</div>';
    var chart = '<div class="rec-panel"><div class="rec-head">タイム推移（直近 ' + Math.min(20, st.count) + ' 回）</div>' + recChart(st.runs, c, st.best) + '</div>';
    var rows = st.runs.slice(0, 20).map(function (r) {
      var note = r.legacy ? '旧記録' : 'ミス ' + r.misses + (r.timeouts ? ' ・ 時間切れ ' + r.timeouts : '');
      return '<tr class="' + (r.rec ? 'is-rec' : '') + '"><td class="c-n">' + recDate(r.at) + '</td><td class="r-time">' + r.time.toFixed(1) + '秒</td><td class="r-note">' + note + '</td><td class="r-rank">' + esc(r.rank) + '</td><td class="r-star">' + (r.rec ? '★' : '') + '</td></tr>';
    }).join('');
    var table = '<div class="rec-panel"><div class="rec-head">直近の記録</div><table class="cheat rec-table"><thead><tr><th>日付</th><th>タイム</th><th class="r-note">ミス</th><th>称号</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    body.innerHTML = '<div class="dq-log rec-log">' + head + '</div>' + tiles + chart + weakPanel(id) + table;
  }

  function weakPanel(id) {
    var w = REC.weakness(id, 10);
    if (!w) return '<div class="rec-panel rec-weak"><div class="rec-head">にがてな じゅもん</div><p class="rec-empty">2 回走ると、苦手が見えてくる。</p></div>';
    var row = function (e) {
      var q = Q[e.type];
      var keys = [];
      q.show.forEach(function (a) { (LV.KEYS[a] || []).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
      return '<li><span class="w-spell">' + esc(spellsFor(q) || 'こうげき') + '</span><span class="w-text">' + esc(q.text) + '</span>' +
        '<span class="w-num">平均 ' + e.avg.toFixed(1) + '秒 ・ ミス ' + Math.round(e.missRate * 100) + '%</span>' +
        '<span class="w-keys"><kbd class="pfx">' + esc(prefixLabel()) + '</kbd><span class="arrow">→</span>' + keycaps(keys) + '</span></li>';
    };
    return '<div class="rec-panel rec-weak"><div class="rec-head">にがてな じゅもん（直近 ' + w.runs + ' 戦）</div><ol class="weak-list">' +
      w.weak.map(row).join('') + '</ol>' +
      (w.strong ? '<p class="w-strong">とくい: <b>' + esc(spellsFor(Q[w.strong.type]) || '') + '</b> 平均 ' + w.strong.avg.toFixed(1) + '秒</p>' : '') + '</div>';
  }

  function startArena(courseId) {
    S.result = null;
    S.mode = 'arena';
    newSession();
    prepareBattle('arena', courseId);
    showScreen('game');
    render();
    startBattle();
    focusSink();
  }

  function resetAll() {
    store.clear();
    S.level = 1;
    store.save({ prefix: S.prefix });
    startGame();
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
    if (typeof saved.level === 'number' && saved.level >= 1 && saved.level <= LAST + 1) S.level = saved.level;
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
    $('#btn-start').addEventListener('click', function () {
      if (S.level > 1) { if (!window.confirm('記録を消して最初から始める？')) return; }
      resetAll();
    });
    $('#btn-continue').addEventListener('click', function () {
      store.save({ prefix: S.prefix });
      if (S.level > LAST) { S.free = true; showScreen('finale'); return; }
      startGame();
    });
    $('#btn-arena').addEventListener('click', function () {
      store.save({ prefix: S.prefix });
      S.result = null;
      showScreen('arena');
    });
    $$('.to-title').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (S.battle) { clearTimeout(S.battle.timer); clearInterval(S.clock); }
        S.battle = null;
        S.mode = 'story';
        S.briefOpen = false; $('#brief').hidden = true; showScreen('title');
      });
    });
    $('#btn-free').addEventListener('click', function () {
      if (!S.session) { newSession(); }
      S.free = true;
      S.mode = 'story';
      showScreen('game');
      focusSink();
    });
    $('#btn-finale-arena').addEventListener('click', function () { S.result = null; showScreen('arena'); });
    $('#btn-reset').addEventListener('click', function () {
      if (!window.confirm('記録を消して最初から始める？')) return;
      resetAll();
    });
    $('#arena-screen').addEventListener('click', function (e) {
      var r = e.target.closest('[data-records]');
      if (r) { openRecords(r.dataset.records || null, 'arena'); return; }
      var b = e.target.closest('[data-course]');
      if (b) startArena(b.dataset.course);
    });
    $('#btn-records').addEventListener('click', function () { store.save({ prefix: S.prefix }); openRecords(null, 'title'); });
    $('#records-screen').addEventListener('click', function (e) {
      var t = e.target.closest('[data-rec-course]');
      if (t) { S.recCourse = t.dataset.recCourse; AU.se('cursor'); renderRecords(); return; }
      var b = e.target.closest('[data-course]');
      if (b) { startArena(b.dataset.course); return; }
      if (e.target.closest('#btn-records-back')) { S.result = null; showScreen(S.recordsFrom === 'title' ? 'title' : 'arena'); return; }
      if (e.target.closest('#btn-records-arena')) { S.result = null; showScreen('arena'); return; }
      if (e.target.closest('#btn-records-clear')) {
        if (!window.confirm('闘技場の記録をすべて消す？')) return;
        REC.clearArena();
        renderRecords();
      }
    });
    $('#brief').addEventListener('click', function () {
      if (!S.briefOpen) return;
      if (S.typing) { finishTyping(); return; }
      closeBrief();
    });

    document.addEventListener('keydown', onKeyDown);
    var sink = $('#sink');
    sink.addEventListener('input', onSinkInput);
    $('#term').addEventListener('pointerdown', function () { focusSink(); });
    $('#keybar').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.type) { $('#sink').focus(); return; }
      var k = JSON.parse(b.dataset.k);
      handleKey(k);
      // Keep the game's key state visible without stealing focus from the sink.
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
        return {
          screen: S.screen, mode: S.mode, level: S.level, prefix: S.prefix,
          armed: S.armed, detached: S.detached, briefOpen: S.briefOpen,
          session: S.session ? S.session.name : null,
          sessions: S.sessions.map(function (s) { return s.name; }),
          windows: S.session ? S.session.windows.map(function (w) { return { index: w.index, name: w.name, active: w.id === S.session.active, panes: T.panesOf(w).length, zoomed: w.zoomed, layout: w.layoutName }; }) : [],
          activeWindow: win ? win.name : null,
          activeScene: ap ? (ap.scene || null) : null,
          activePaneName: ap ? ap.name : null,
          copyMode: ap ? ap.mode === 'copy' : false,
          input: ap ? ap.input : null,
          cursor: ap ? (ap.cur == null ? ap.input.length : ap.cur) : null,
          promptValue: S.prompt ? S.prompt.value : null,
          copyLine: ap && ap.mode === 'copy' ? lineText(ap.lines[ap.cy]) : null,
          clipboard: S.clipboard,
          mp: S.mp ? S.mp.left : null,
          battle: S.battle ? { kind: S.battle.kind, phase: S.battle.phase, i: S.battle.i, n: S.battle.qs.length, type: S.battle.type, misses: S.battle.misses, hp: S.battle.hp, order: S.battle.q ? qText(S.battle) : null } : null,
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
