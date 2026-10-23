// tmux 道場: reads a pasted .tmux.conf. Only what the game can do is
// taken: the prefix, bind / unbind of the commands the game has (the copy
// mode tables included), mode-keys, status-position, and the
// vim-tmux-navigator plugin (as it binds its keys by default). Every other
// line is listed back, never dropped silently: as 未対応 when it is
// something tmux does and the game cannot (its key then does nothing in
// the game, rather than falling back to the default), or as a setting that
// does not matter to the game.
//
// A binding's action is written as the default prefix key that does the
// same thing in the game ({key: '%'} for split-window -h), so app.js runs it
// through its own default table and the 手順 can swap one key for another.
(function () {
  'use strict';

  // The report is shown in the page's language (i18n.js); without it, as written.
  var tx = (window.ADV && window.ADV.i18n && window.ADV.i18n.t) || function (s) {
    var a = arguments;
    return s.replace(/\{(\d)\}/g, function (m, i) { return a[+i + 1]; });
  };

  var MAC = /Mac|iPhone|iPad/.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));

  // ---- keys ------------------------------------------------------------------

  var NAMES = {
    left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
    space: ' ', enter: 'Enter', escape: 'Escape', tab: 'Tab', bspace: 'Backspace',
    home: 'Home', end: 'End', ppage: 'PageUp', pageup: 'PageUp', pgup: 'PageUp',
    npage: 'PageDown', pagedown: 'PageDown', pgdn: 'PageDown', dc: 'Delete', ic: 'Insert'
  };
  var SHOW = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'BSpace', PageUp: 'PageUp', PageDown: 'PageDown', Home: 'Home', End: 'End', Delete: 'Delete', Insert: 'Insert' };

  // 'C-a', 'M-Left', '^b', '|', '"', 'S-Up' → {key, ctrl, alt, shift, label}.
  function parseKey(s) {
    if (s == null) return null;
    s = String(s);
    var k = { ctrl: false, alt: false, shift: false };
    if (/^\^./.test(s)) { k.ctrl = true; s = s.slice(1); }
    for (;;) {
      var m = /^([CMS])-(.+)$/.exec(s);
      if (!m) break;
      if (m[1] === 'C') k.ctrl = true; else if (m[1] === 'M') k.alt = true; else k.shift = true;
      s = m[2];
    }
    if (!s) return null;
    if (s.length === 1) k.key = k.ctrl ? s.toLowerCase() : s;
    else if (NAMES[s.toLowerCase()]) k.key = NAMES[s.toLowerCase()];
    else if (/^F([1-9]|1[0-2])$/.test(s)) k.key = s;
    else return null;
    k.label = keyLabel(k);
    return k;
  }

  function keyLabel(k) {
    var base = SHOW[k.key] || k.key;
    return (k.ctrl ? 'Ctrl+' : '') + (k.alt ? (MAC ? 'Option+' : 'Alt+') : '') + (k.shift && k.key.length > 1 ? 'Shift+' : '') + base;
  }

  // Does a key event {key, code, ctrl, alt, shift, meta} press this key?
  function matches(spec, e) {
    if (!spec || !e || e.meta) return false;
    if (!!e.ctrl !== spec.ctrl || !!e.alt !== spec.alt) return false;
    var key = String(e.key);
    if (spec.key.length > 1) return key === spec.key && (!!e.shift === spec.shift);
    if (spec.alt) {
      // Option remaps the character on a Mac: compare the physical key.
      var c = e.code || '';
      if (/^[a-z]$/i.test(spec.key) && c === 'Key' + spec.key.toUpperCase()) return true;
      if (/^[0-9]$/.test(spec.key) && c === 'Digit' + spec.key) return true;
    }
    if (spec.ctrl) return key.toLowerCase() === spec.key || (spec.key === '\\' && e.code === 'Backslash');
    return key === spec.key;
  }

  function same(a, b) { return !!a && !!b && a.key === b.key && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift; }

  // ---- lines -----------------------------------------------------------------

  // Splits a line like tmux: quotes, backslash escapes, `\;` between commands.
  function words(line) {
    var out = [[]], cur = '', has = false, q = null;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === q) { q = null; continue; }
        if (ch === '\\' && q === '"' && i + 1 < line.length) { cur += line[++i]; continue; }
        cur += ch; continue;
      }
      if (ch === '#' && !has) break;
      if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
      if (ch === '\\' && i + 1 < line.length) {
        if (line[i + 1] === ';' && !has) { i++; out.push([]); continue; }
        cur += line[++i]; has = true; continue;
      }
      if (/\s/.test(ch)) { if (has) { out[out.length - 1].push(cur); cur = ''; has = false; } continue; }
      if (ch === ';' && !has) { out.push([]); continue; }
      cur += ch; has = true;
    }
    if (has) out[out.length - 1].push(cur);
    return out.filter(function (c) { return c.length; });
  }

  // Joins a line ending in a backslash with the next.
  function lines(text) {
    var raw = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var l = raw[i], no = i + 1;
      while (/\\$/.test(l) && i + 1 < raw.length) l = l.slice(0, -1) + ' ' + raw[++i];
      out.push({ no: no, text: l });
    }
    return out;
  }

  // The flags of each command that take a value (tmux's getopt strings).
  var ARGS = {
    bind: 'TNt', 'bind-key': 'TNt', unbind: 'Tt', 'unbind-key': 'Tt', set: 't', 'set-option': 't', setw: 't', 'set-window-option': 't',
    'split-window': 'cltFe', splitw: 'cltFe', 'select-pane': 'tT', selectp: 'tT', 'select-window': 't', selectw: 't',
    'resize-pane': 'txy', resizep: 'txy', 'confirm-before': 'pct', confirm: 'pct', 'command-prompt': 'IpFtT',
    'new-window': 'cntFe', neww: 'cntFe', 'swap-pane': 'st', swapp: 'st', 'kill-pane': 't', killp: 't', 'kill-window': 't', killw: 't',
    'break-pane': 'nst', breakp: 'nst', 'send-keys': 'tN', send: 'tN', 'display-message': 'cdtF', display: 'cdtF',
    'choose-tree': 'FfKOt', 'choose-window': 'FfKOt', 'choose-session': 'FfKOt', 'copy-mode': 'st', 'paste-buffer': 'bst', pasteb: 'bst'
  };

  function flags(argv) {
    // tmux style: -abc, -t target, then the rest.
    var f = {}, rest = [], i = 1;
    var withArg = {};
    (ARGS[argv[0]] || 't').split('').forEach(function (c) { withArg[c] = 1; });
    for (; i < argv.length; i++) {
      var a = argv[i];
      if (a === '--') { i++; break; }
      if (!/^-[A-Za-z]+$/.test(a)) break;
      for (var j = 1; j < a.length; j++) {
        var c = a[j];
        if (withArg[c] && j === a.length - 1 && i + 1 < argv.length) { f[c] = argv[++i]; break; }
        f[c] = true;
      }
    }
    for (; i < argv.length; i++) rest.push(argv[i]);
    return { f: f, rest: rest };
  }

  var RESIZE_CMD = /^(resize-pane|resizep)$/;

  // One tmux command (argv) → what the game does for it, or {why}.
  function action(argv) {
    var cmd = argv[0], p = flags(argv), f = p.f, rest = p.rest;
    var dir = f.L ? 'L' : f.R ? 'R' : f.U ? 'U' : f.D ? 'D' : null;
    var ARROW = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown' };
    if (/^(split-window|splitw)$/.test(cmd)) return f.h ? { key: '%', say: '左右に分割する' } : { key: '"', say: '上下に分割する' };
    if (/^(select-pane|selectp)$/.test(cmd)) {
      if (f.T) return { why: 'ペインの名前はゲームでは : から付ける' };
      if (dir) return { key: ARROW[dir], say: { L: '左のペインへ', R: '右のペインへ', U: '上のペインへ', D: '下のペインへ' }[dir] };
      if (f.l) return { key: ';', say: '直前のペインへ' };
      if (f.t === ':.+' || f.t === '+' || f.t === '.+') return { key: 'o', say: '次のペインへ' };
      return { why: 'その select-pane はゲームにない' };
    }
    if (/^(last-pane|lastp)$/.test(cmd)) return { key: ';', say: '直前のペインへ' };
    if (RESIZE_CMD.test(cmd)) {
      if (f.Z) return { key: 'z', say: '全画面にする・戻す' };
      if (dir) {
        var n = parseInt(rest[0], 10);
        return { resize: dir, n: n > 0 ? Math.min(n, 50) : 1, say: tx('境目を{0}へ{1}マスずらす', tx({ L: '左', R: '右', U: '上', D: '下' }[dir]), n > 0 ? n : 1) };
      }
      return { why: 'その resize-pane はゲームにない' };
    }
    if (/^(kill-pane|killp)$/.test(cmd)) return { key: 'x', now: true, say: 'ペインを閉じる（確認なし）' };
    if (/^(kill-window|killw)$/.test(cmd)) return { key: '&', now: true, say: 'ウィンドウを閉じる（確認なし）' };
    if (/^(break-pane|breakp)$/.test(cmd)) return f.d ? { why: 'break-pane -d はゲームにない' } : { key: '!', say: 'ペインを別のウィンドウにする' };
    if (cmd === 'confirm-before' || cmd === 'confirm') {
      var inner = rest.length === 1 ? words(rest[0])[0] || [] : rest;
      var a = inner.length ? action(inner) : { why: 'confirm-before の中身がない' };
      if (a.now) { delete a.now; a.say = a.say.replace('（確認なし）', '（y で確かめる）'); }
      return a;
    }
    if (/^(new-window|neww)$/.test(cmd)) return { key: 'c', say: '新しいウィンドウ' };
    if (/^(next-window|next)$/.test(cmd)) return { key: 'n', say: '次のウィンドウへ' };
    if (/^(previous-window|prev)$/.test(cmd)) return { key: 'p', say: '前のウィンドウへ' };
    if (/^(last-window|last)$/.test(cmd)) return { key: 'l', say: '直前のウィンドウへ' };
    if (/^(select-window|selectw)$/.test(cmd)) {
      var t = /^:?(\d)$/.exec(f.t || '');
      if (t) return { key: t[1], say: tx('{0} 番のウィンドウへ', t[1]) };
      if (f.l) return { key: 'l', say: '直前のウィンドウへ' };
      if (f.n) return { key: 'n', say: '次のウィンドウへ' };
      if (f.p) return { key: 'p', say: '前のウィンドウへ' };
      return { why: 'その select-window はゲームにない' };
    }
    if (/^(rename-window|renamew)$/.test(cmd)) return { key: ',', say: 'ウィンドウの名前を変える' };
    if (/^(rename-session|rename)$/.test(cmd)) return { key: '$', say: 'セッションの名前を変える' };
    if (cmd === 'command-prompt') {
      var tpl = rest.join(' ');
      if (/rename-window/.test(tpl)) return { key: ',', say: 'ウィンドウの名前を変える' };
      if (/rename-session/.test(tpl)) return { key: '$', say: 'セッションの名前を変える' };
      if (/select-window/.test(tpl)) return { key: "'", say: '番号を打ってウィンドウへ' };
      if (!tpl) return { key: ':', say: 'コマンドを打つ' };
      return { why: 'その command-prompt はゲームにない' };
    }
    if (/^(copy-mode)$/.test(cmd)) return f.u ? { key: 'PageUp', say: 'コピーモードに入って 1 ページ上へ' } : { key: '[', say: 'スクロールする（コピーモード）' };
    if (/^(paste-buffer|pasteb)$/.test(cmd)) return { key: ']', say: '貼り付ける' };
    if (/^(swap-pane|swapp)$/.test(cmd)) {
      if (f.U) return { key: '{', say: '前のペインと入れ替える' };
      if (f.D) return { key: '}', say: '次のペインと入れ替える' };
      return { why: 'その swap-pane はゲームにない' };
    }
    if (/^(next-layout|nextl)$/.test(cmd)) return { key: ' ', say: '並べ方を変える' };
    if (/^(detach-client|detach)$/.test(cmd)) return { key: 'd', say: 'デタッチする' };
    // choose-tree -w (and choose-window) opens the tree with the windows shown.
    if (/^(choose-tree|choose-session|choose-window)$/.test(cmd)) return f.w || cmd === 'choose-window' ? { key: 'w', say: 'ウィンドウまで含めた一覧から選ぶ' } : { key: 's', say: 'セッションを選ぶ' };
    if (/^(switch-client|switchc)$/.test(cmd)) {
      if (f.p) return { key: '(', say: '前のセッションへ' };
      if (f.n) return { key: ')', say: '次のセッションへ' };
      if (f.l) return { key: 'L', say: '直前のセッションへ' };
      return { why: 'その switch-client はゲームにない' };
    }
    if (cmd === 'send-prefix') return { run: 'send-prefix', say: 'prefix をシェルに送る' };
    if (/^(send-keys|send)$/.test(cmd) && rest.length === 1 && /^(C-l|\^l)$/i.test(rest[0])) return { run: 'clear', say: '画面を消す' };
    if (/^(source-file|source)$/.test(cmd)) return { run: 'noop', say: '設定を読み直す（ゲームでは何も起きない）' };
    if (/^(display-message|display)$/.test(cmd)) return { run: 'say', text: rest.join(' '), say: 'メッセージを出す' };
    if (/^(display-panes|displayp)$/.test(cmd)) return { key: 'q', say: 'ペインに番号を出す（番号を押すとそこへ）' };
    if (/^(rotate-window|rotatew)$/.test(cmd)) return { key: 'o', ctrl: true, say: 'ペインを順に回す' };
    if (/^(choose-buffer)$/.test(cmd)) return { key: '=', say: 'コピーしたものの一覧から貼る' };
    if (/^(list-buffers|lsb)$/.test(cmd)) return { key: '#', say: 'コピーしたものの一覧を見る' };
    if (/^(list-keys|lsk)$/.test(cmd)) return { key: '?', say: 'キーの一覧を見る' };
    if (/^(clock-mode)$/.test(cmd)) return { key: 't', say: '時計を出す' };
    return { why: tx('{0} はゲームにない', cmd) };
  }

  // ---- copy mode -------------------------------------------------------------

  // The copy-mode commands (send-keys -X …) the game can do, with what to
  // say for them. app.js runs them through its own copy-mode keys.
  var COPY_CMDS = {
    'begin-selection': '選び始める', 'select-line': '行ごと選ぶ', 'rectangle-toggle': '矩形選択（ゲームでは何も起きない）',
    'copy-selection': 'コピーする（コピーモードに残る）', 'copy-selection-no-clear': 'コピーする（コピーモードに残る）', 'copy-selection-and-cancel': 'コピーして抜ける',
    'copy-pipe': 'コピーする（コピーモードに残る）', 'copy-pipe-no-clear': 'コピーする（コピーモードに残る）', 'copy-pipe-and-cancel': 'コピーして抜ける',
    'copy-end-of-line': '行の終わりまでコピーする', 'copy-end-of-line-and-cancel': '行の終わりまでコピーして抜ける', 'copy-line': '行をコピーする', 'copy-line-and-cancel': '行をコピーして抜ける',
    cancel: 'コピーモードを抜ける', 'clear-selection': '選ぶのをやめる',
    'cursor-up': '上へ', 'cursor-down': '下へ', 'cursor-left': '左へ', 'cursor-right': '右へ',
    'start-of-line': '行の頭へ', 'end-of-line': '行の終わりへ', 'history-top': '一番上へ', 'history-bottom': '一番下へ',
    'page-up': '1 ページ上へ', 'page-down': '1 ページ下へ', 'halfpage-up': '半ページ上へ', 'halfpage-down': '半ページ下へ',
    'search-backward': '上向きに検索', 'search-forward': '下向きに検索', 'search-again': '次を探す', 'search-reverse': '逆向きに次を探す'
  };

  // The old (tmux < 2.4) table names, `bind -t vi-copy v begin-selection`.
  var OLD_TABLES = { 'vi-copy': 'copy-mode-vi', 'emacs-copy': 'copy-mode' };

  // A copy-mode binding's command list → {copy: cmd, say} or {why}.
  function copyAction(inner) {
    var cmd;
    if (/^(send-keys|send)$/.test(inner[0])) {
      var p = flags(inner);
      if (!p.f.X || !p.rest.length) return { why: 'コピーモードのキーは send-keys -X の形だけ読める' };
      cmd = p.rest[0];
    } else cmd = inner[0];
    if (!COPY_CMDS[cmd]) return { why: tx('コピーモードの {0} はゲームにない', cmd) };
    return { copy: cmd, say: COPY_CMDS[cmd] };
  }

  // vim-tmux-navigator, as it binds its keys with no options set.
  var NAVIGATOR = [
    { table: 'root', key: 'C-h', argv: ['select-pane', '-L'] },
    { table: 'root', key: 'C-j', argv: ['select-pane', '-D'] },
    { table: 'root', key: 'C-k', argv: ['select-pane', '-U'] },
    { table: 'root', key: 'C-l', argv: ['select-pane', '-R'] },
    { table: 'root', key: 'C-\\', argv: ['select-pane', '-l'] },
    { table: 'prefix', key: 'C-l', argv: ['send-keys', 'C-l'] }
  ];

  var SAMPLE_NOCONFIRM = "# 確認なしで閉じる（y を押さない）\nbind x kill-pane\nbind & kill-window\n";
  var SAMPLE_NAVIGATOR = "# vim-tmux-navigator（TPM で入れる）\nset -g @plugin 'christoomey/vim-tmux-navigator'\nrun '~/.tmux/plugins/tpm/tpm'\n";

  // Options tmux has that the game does not follow: 未対応, not 関係ない.
  var UNSUPPORTED_OPTS = { 'renumber-windows': 'ゲームのウィンドウ番号は詰め直さない', 'status-keys': '入力欄のキーは決まっている（emacs 式）' };

  // The whole file → {prefix, prefix2, modeKeys, statusTop, binds, unbinds,
  // unbindAll, used, unsupported, skipped, navigator, custom}.
  function parse(text) {
    var c = { prefix: parseKey('C-b'), prefix2: null, baseIndex: 0, paneBaseIndex: 0, modeKeys: null, statusTop: false, binds: [], unbinds: [], unbindAll: false, used: [], unsupported: [], skipped: [], navigator: false };
    function use(l, say) { c.used.push({ no: l.no, line: l.text.trim(), say: tx(say) }); }
    // 未対応: tmux does it, the game cannot.
    function cannot(l, why) { c.unsupported.push({ no: l.no, line: l.text.trim(), why: tx(why) }); }
    // 関係ない: a setting the game has no use for.
    function skip(l, why) { c.skipped.push({ no: l.no, line: l.text.trim(), why: tx(why) }); }
    function addBind(table, key, act, repeat, l) {
      // A later bind of the same key wins, as in tmux.
      c.binds = c.binds.filter(function (b) { return !(b.table === table && same(b.key, key)); });
      c.binds.push({ table: table, key: key, act: act, repeat: !!repeat, no: l ? l.no : 0 });
    }
    lines(text).forEach(function (l) {
      var cmds = words(l.text);
      if (!cmds.length) return;
      var argv = cmds[0], cmd = argv[0];
      if (/^(set|set-option|setw|set-window-option)$/.test(cmd)) {
        var p = flags(argv), name = p.rest[0], val = p.rest[1];
        // Window numbers from 1 (and pane numbers): the status bar and the
        // number keys follow.
        if (name === 'base-index' || name === 'pane-base-index') {
          var bi = parseInt(val, 10);
          if (!(bi >= 0 && bi <= 9)) return cannot(l, tx('その番号は読めない: {0}', val));
          c[name === 'base-index' ? 'baseIndex' : 'paneBaseIndex'] = bi;
          return use(l, tx(name === 'base-index' ? 'ウィンドウの番号を {0} から始める' : 'ペインの番号を {0} から始める', bi));
        }
        // mode-keys picks the copy-mode keys (vi or emacs) the 手順 shows.
        if (name === 'mode-keys') {
          if (val !== 'vi' && val !== 'emacs') return cannot(l, tx('mode-keys は vi か emacs: {0}', val));
          c.modeKeys = val;
          return use(l, tx(val === 'vi' ? 'コピーモードのキーを vi 式にする' : 'コピーモードのキーを emacs 式にする'));
        }
        if (name === 'status-position') {
          if (val !== 'top' && val !== 'bottom') return cannot(l, tx('status-position は top か bottom: {0}', val));
          c.statusTop = val === 'top';
          return use(l, tx(val === 'top' ? 'ステータスバーを上に置く' : 'ステータスバーを下に置く'));
        }
        if (name === 'prefix' || name === 'prefix2') {
          var k = val === 'None' ? null : parseKey(val);
          if (val !== 'None' && !k) return cannot(l, tx('そのキーは読めない: {0}', val));
          if (name === 'prefix') { if (!k) return cannot(l, 'prefix なしでは遊べない'); c.prefix = k; use(l, tx('prefix を {0} にする', k.label)); }
          else { c.prefix2 = k; use(l, k ? tx('2 つ目の prefix を {0} にする', k.label) : '2 つ目の prefix をなくす'); }
          return;
        }
        if (name === '@plugin') {
          if (/(^|\/)vim-tmux-navigator$/.test(val || '')) {
            c.navigator = true;
            NAVIGATOR.forEach(function (n) { addBind(n.table, parseKey(n.key), action(n.argv), false, l); });
            return use(l, 'vim-tmux-navigator: Ctrl+h/j/k/l でペインを移動、Ctrl+\\ で直前のペイン、prefix → Ctrl+l で画面を消す');
          }
          if (/(^|\/)tpm$/.test(val || '')) return use(l, 'TPM（プラグインの管理）');
          return cannot(l, 'このプラグインはゲームにない');
        }
        if (/^@/.test(name || '')) return skip(l, 'プラグインの設定（ゲームには関係ない）');
        if (UNSUPPORTED_OPTS[name]) return cannot(l, UNSUPPORTED_OPTS[name]);
        return skip(l, '見た目や動きの設定（ゲームには関係ない）');
      }
      if (/^(run|run-shell)$/.test(cmd)) return /tpm/.test(l.text) ? use(l, 'TPM を動かす（プラグインはゲームが再現する）') : cannot(l, 'シェルのコマンドはゲームでは動かない');
      if (/^(bind|bind-key)$/.test(cmd)) {
        var b = flags(argv);
        var table = b.f.n ? 'root' : b.f.T ? b.f.T : b.f.t ? (OLD_TABLES[b.f.t] || b.f.t) : 'prefix';
        var key = parseKey(b.rest[0]);
        if (!key) return cannot(l, tx('そのキーは読めない: {0}', b.rest[0]));
        var inner = b.rest.slice(1);
        if (!inner.length) return cannot(l, 'コマンドがない');
        if (table === 'copy-mode-vi' || table === 'copy-mode') {
          var ca = copyAction(inner);
          // The key is taken either way: a copy command the game lacks
          // must not fall back to the game's own key.
          addBind(table, key, ca.why ? { none: true } : ca, false, l);
          if (ca.why) return cannot(l, ca.why);
          return use(l, tx(table === 'copy-mode-vi' ? 'コピーモード（vi 式）で {0}: {1}' : 'コピーモード（emacs 式）で {0}: {1}', key.label, tx(ca.say)));
        }
        if (table !== 'root' && table !== 'prefix') return cannot(l, tx('{0} の表のキーはゲームにない', table));
        // `bind x a \; b`: the first command is the one that counts.
        var act = action(inner);
        if (act.why) { addBind(table, key, { none: true }, false, l); return cannot(l, act.why); }
        addBind(table, key, act, b.f.r, l);
        return use(l, tx(table === 'root' ? 'prefix なしで {0} で {1}{2}' : 'prefix → {0} で {1}{2}', key.label, tx(act.say), b.f.r ? tx('（続けて押せる）') : ''));
      }
      if (/^(unbind|unbind-key)$/.test(cmd)) {
        var u = flags(argv);
        var ut = u.f.n ? 'root' : u.f.T ? u.f.T : u.f.t ? (OLD_TABLES[u.f.t] || u.f.t) : 'prefix';
        var copyT = ut === 'copy-mode-vi' || ut === 'copy-mode';
        if (u.f.a) {
          if (ut !== 'prefix') return cannot(l, tx('{0} の表をまとめて外すのはゲームにない', ut));
          c.unbindAll = true;
          c.binds = c.binds.filter(function (x) { return x.table !== 'prefix'; });
          return use(l, 'prefix のあとのキーを全部外す');
        }
        if (ut !== 'root' && ut !== 'prefix' && !copyT) return cannot(l, tx('{0} の表のキーはゲームにない', ut));
        var uk = parseKey(u.rest[0]);
        if (!uk) return cannot(l, tx('そのキーは読めない: {0}', u.rest[0]));
        c.binds = c.binds.filter(function (x) { return !(x.table === ut && same(x.key, uk)); });
        c.unbinds.push({ table: ut, key: uk });
        return use(l, tx(ut === 'root' ? '{0} を外す' : copyT ? 'コピーモードの {0} を外す' : 'prefix → {0} を外す', uk.label));
      }
      if (/^(source-file|source|if-shell|if)$/.test(cmd)) return cannot(l, '別のファイルやシェルはゲームでは読めない');
      return cannot(l, tx('{0} はゲームにない', cmd));
    });
    c.custom = !!(c.used.length || c.binds.length || c.unbinds.length || c.unbindAll || c.prefix.key !== 'b' || !c.prefix.ctrl);
    return c;
  }

  // The binding a key event fires in a table, or null.
  function lookup(c, table, e) {
    if (!c) return null;
    for (var i = c.binds.length - 1; i >= 0; i--) if (c.binds[i].table === table && matches(c.binds[i].key, e)) return c.binds[i];
    return null;
  }

  // The copy-mode tables that count: the one mode-keys names, else both
  // (the game takes the vi and the emacs keys alike).
  function copyTables(c) {
    return c.modeKeys === 'vi' ? ['copy-mode-vi'] : c.modeKeys === 'emacs' ? ['copy-mode'] : ['copy-mode-vi', 'copy-mode'];
  }

  // The player's copy-mode binding a key event fires, or null.
  function copyLookup(c, e) {
    if (!c) return null;
    var ts = copyTables(c);
    for (var i = 0; i < ts.length; i++) { var b = lookup(c, ts[i], e); if (b) return b; }
    return null;
  }

  // The label of the player's key for one of these copy commands, or null.
  function copyKey(c, cmds) {
    if (!c) return null;
    var ts = copyTables(c);
    for (var i = c.binds.length - 1; i >= 0; i--) {
      var b = c.binds[i];
      if (ts.indexOf(b.table) >= 0 && b.act.copy && cmds.indexOf(b.act.copy) >= 0) return b.key.label;
    }
    return null;
  }

  // Whether a default prefix key is gone: unbound, or bound to something else.
  function overridden(c, e) {
    if (!c) return false;
    if (c.unbindAll) return true;
    if (lookup(c, 'prefix', e)) return true;
    return c.unbinds.some(function (u) { return u.table === 'prefix' && matches(u.key, e); });
  }

  function isPrefix(c, e) {
    var p = c ? c.prefix : parseKey('C-b');
    return matches(p, e) || (!!c && !!c.prefix2 && matches(c.prefix2, e));
  }

  window.ADV = window.ADV || {};
  window.ADV.conf = {
    parse: parse, parseKey: parseKey, keyLabel: keyLabel, matches: matches, words: words,
    lookup: lookup, copyLookup: copyLookup, copyKey: copyKey, overridden: overridden, isPrefix: isPrefix,
    SAMPLE_NAVIGATOR: SAMPLE_NAVIGATOR, SAMPLE_NOCONFIRM: SAMPLE_NOCONFIRM
  };
})();
