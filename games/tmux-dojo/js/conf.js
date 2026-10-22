// tmux 道場: reads a pasted .tmux.conf. Only what the game can do is
// taken: the prefix, bind / unbind of the commands the game has, and the
// vim-tmux-navigator plugin (as it binds its keys by default). Every other
// line is listed back with the reason it was passed over, never dropped
// silently.
//
// A binding's action is written as the default prefix key that does the
// same thing in the game ({key: '%'} for split-window -h), so app.js runs it
// through its own default table and the 手順 can swap one key for another.
(function () {
  'use strict';

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
    bind: 'TN', 'bind-key': 'TN', unbind: 'T', 'unbind-key': 'T', set: 't', 'set-option': 't', setw: 't', 'set-window-option': 't',
    'split-window': 'cltFe', splitw: 'cltFe', 'select-pane': 'tT', selectp: 'tT', 'select-window': 't', selectw: 't',
    'resize-pane': 'txy', resizep: 'txy', 'confirm-before': 'pct', confirm: 'pct', 'command-prompt': 'IpFtT',
    'new-window': 'cntFe', neww: 'cntFe', 'swap-pane': 'st', swapp: 'st', 'kill-pane': 't', killp: 't', 'kill-window': 't', killw: 't'
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
      if (dir) return { key: ARROW[dir], say: { L: '左', R: '右', U: '上', D: '下' }[dir] + 'のペインへ' };
      if (f.l) return { key: ';', say: '直前のペインへ' };
      if (f.t === ':.+' || f.t === '+' || f.t === '.+') return { key: 'o', say: '次のペインへ' };
      return { why: 'その select-pane はゲームにない' };
    }
    if (/^(last-pane|lastp)$/.test(cmd)) return { key: ';', say: '直前のペインへ' };
    if (RESIZE_CMD.test(cmd)) {
      if (f.Z) return { key: 'z', say: '全画面にする・戻す' };
      if (dir) {
        var n = parseInt(rest[0], 10);
        return { resize: dir, n: n > 0 ? Math.min(n, 50) : 1, say: '境目を' + { L: '左', R: '右', U: '上', D: '下' }[dir] + 'へ' + (n > 0 ? n : 1) + 'マスずらす' };
      }
      return { why: 'その resize-pane はゲームにない' };
    }
    if (/^(kill-pane|killp)$/.test(cmd)) return { key: 'x', now: true, say: 'ペインを閉じる（確認なし）' };
    if (/^(kill-window|killw)$/.test(cmd)) return { key: '&', now: true, say: 'ウィンドウを閉じる（確認なし）' };
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
      if (t) return { key: t[1], say: t[1] + ' 番のウィンドウへ' };
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
      if (!tpl) return { key: ':', say: 'コマンドを打つ' };
      return { why: 'その command-prompt はゲームにない' };
    }
    if (/^(copy-mode)$/.test(cmd)) return { key: '[', say: 'スクロールする（コピーモード）' };
    if (/^(paste-buffer|pasteb)$/.test(cmd)) return { key: ']', say: '貼り付ける' };
    if (/^(swap-pane|swapp)$/.test(cmd)) {
      if (f.U) return { key: '{', say: '前のペインと入れ替える' };
      if (f.D) return { key: '}', say: '次のペインと入れ替える' };
      return { why: 'その swap-pane はゲームにない' };
    }
    if (/^(next-layout|nextl)$/.test(cmd)) return { key: ' ', say: '並べ方を変える' };
    if (/^(detach-client|detach)$/.test(cmd)) return { key: 'd', say: 'デタッチする' };
    if (/^(choose-tree|choose-session|choose-window)$/.test(cmd)) return { key: 's', say: 'セッションを選ぶ' };
    if (cmd === 'send-prefix') return { run: 'send-prefix', say: 'prefix をシェルに送る' };
    if (/^(send-keys|send)$/.test(cmd) && rest.length === 1 && /^(C-l|\^l)$/i.test(rest[0])) return { run: 'clear', say: '画面を消す' };
    if (/^(source-file|source)$/.test(cmd)) return { run: 'noop', say: '設定を読み直す（ゲームでは何も起きない）' };
    if (/^(display-panes|displayp)$/.test(cmd)) return { why: 'ペイン番号の表示はゲームにない' };
    return { why: cmd + ' はゲームにない' };
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

  // The whole file → {prefix, prefix2, binds, unbinds, unbindAll, used, skipped, navigator, custom}.
  function parse(text) {
    var c = { prefix: parseKey('C-b'), prefix2: null, binds: [], unbinds: [], unbindAll: false, used: [], skipped: [], navigator: false };
    function use(l, say) { c.used.push({ no: l.no, line: l.text.trim(), say: say }); }
    function skip(l, why) { c.skipped.push({ no: l.no, line: l.text.trim(), why: why }); }
    function addBind(table, key, act, repeat, l) {
      // A later bind of the same key wins, as in tmux.
      c.binds = c.binds.filter(function (b) { return !(b.table === table && same(b.key, key)); });
      c.binds.push({ table: table, key: key, act: act, repeat: !!repeat, no: l ? l.no : 0 });
    }
    lines(text).forEach(function (l) {
      var cmds = words(l.text);
      if (!cmds.length) return;
      var argv = cmds[0], cmd = argv[0];
      if (/^(set|set-option)$/.test(cmd)) {
        var p = flags(argv), name = p.rest[0], val = p.rest[1];
        if (name === 'prefix' || name === 'prefix2') {
          var k = val === 'None' ? null : parseKey(val);
          if (val !== 'None' && !k) return skip(l, 'そのキーは読めない: ' + val);
          if (name === 'prefix') { if (!k) return skip(l, 'prefix なしでは遊べない'); c.prefix = k; use(l, 'prefix を ' + k.label + ' にする'); }
          else { c.prefix2 = k; use(l, k ? '2 つ目の prefix を ' + k.label + ' にする' : '2 つ目の prefix をなくす'); }
          return;
        }
        if (name === '@plugin') {
          if (/(^|\/)vim-tmux-navigator$/.test(val || '')) {
            c.navigator = true;
            NAVIGATOR.forEach(function (n) { addBind(n.table, parseKey(n.key), action(n.argv), false, l); });
            return use(l, 'vim-tmux-navigator: Ctrl+h/j/k/l でペインを移動、Ctrl+\\ で直前のペイン、prefix → Ctrl+l で画面を消す');
          }
          if (/(^|\/)tpm$/.test(val || '')) return use(l, 'TPM（プラグインの管理）');
          return skip(l, 'このプラグインはゲームにない');
        }
        if (/^(mode-keys|status-keys)$/.test(name)) return skip(l, 'ゲームのコピーモードと入力欄のキーは決まっている');
        return skip(l, '見た目や動きの設定（ゲームには関係ない）');
      }
      if (/^(setw|set-window-option)$/.test(cmd)) return skip(l, '見た目や動きの設定（ゲームには関係ない）');
      if (/^(run|run-shell)$/.test(cmd) && /tpm/.test(l.text)) return use(l, 'TPM を動かす（プラグインはゲームが再現する）');
      if (/^(bind|bind-key)$/.test(cmd)) {
        var b = flags(argv);
        var table = b.f.n ? 'root' : b.f.T ? b.f.T : 'prefix';
        if (table !== 'root' && table !== 'prefix') return skip(l, table + ' の表のキー（コピーモードなど）はゲームでは変えられない');
        var key = parseKey(b.rest[0]);
        if (!key) return skip(l, 'そのキーは読めない: ' + b.rest[0]);
        var inner = b.rest.slice(1);
        if (!inner.length) return skip(l, 'コマンドがない');
        // `bind x a \; b`: the first command is the one that counts.
        var act = action(inner);
        if (act.why) return skip(l, act.why);
        addBind(table, key, act, b.f.r, l);
        return use(l, (table === 'root' ? 'prefix なしで ' : 'prefix → ') + key.label + ' で ' + act.say + (b.f.r ? '（続けて押せる）' : ''));
      }
      if (/^(unbind|unbind-key)$/.test(cmd)) {
        var u = flags(argv);
        var ut = u.f.n ? 'root' : u.f.T ? u.f.T : 'prefix';
        if (u.f.a) {
          if (ut !== 'prefix') return skip(l, ut + ' の表はゲームでは変えられない');
          c.unbindAll = true;
          c.binds = c.binds.filter(function (x) { return x.table !== 'prefix'; });
          return use(l, 'prefix のあとのキーを全部外す');
        }
        if (ut !== 'root' && ut !== 'prefix') return skip(l, ut + ' の表はゲームでは変えられない');
        var uk = parseKey(u.rest[0]);
        if (!uk) return skip(l, 'そのキーは読めない: ' + u.rest[0]);
        c.binds = c.binds.filter(function (x) { return !(x.table === ut && same(x.key, uk)); });
        c.unbinds.push({ table: ut, key: uk });
        return use(l, (ut === 'root' ? '' : 'prefix → ') + uk.label + ' を外す');
      }
      if (/^(source-file|source|if-shell|if)$/.test(cmd)) return skip(l, '別のファイルやシェルはゲームでは読めない');
      return skip(l, cmd + ' はゲームにない');
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
    lookup: lookup, overridden: overridden, isPrefix: isPrefix, SAMPLE_NAVIGATOR: SAMPLE_NAVIGATOR, SAMPLE_NOCONFIRM: SAMPLE_NOCONFIRM
  };
})();
