// A small tmux: sessions, windows, a binary tree of panes, and the layout
// maths tmux does in cells. No DOM in here; app.js renders it.
(function () {
  'use strict';

  var nextPaneId = 0;
  var nextWindowId = 0;
  // tmux's next_active_point: every pane remembers when it was last active,
  // so a move with several candidates picks the most recent one.
  var nextActivePoint = 1;

  function createSession(opts) {
    return {
      name: opts.name || 'adv',
      baseIndex: opts.baseIndex || 0,
      paneBaseIndex: opts.paneBaseIndex || 0,
      windows: [],
      active: null,     // window id
      last: null,       // previous window id
      attached: true,
      createdAt: new Date()
    };
  }

  function createPane(scene) {
    return {
      id: 'p' + (nextPaneId++),
      scene: scene || null,     // 'treasure' | 'monster' | 'scroll' | 'stairs' | null
      name: '',
      lines: [],                // shell output; strings or {html:...}
      input: '',
      mode: null,               // null | 'copy'
      scrollTop: 0,             // copy mode only, in px (set by the renderer)
      cleared: 0,
      activePoint: 0
    };
  }

  // window_set_active_pane: the pane becomes active and stamps its turn.
  function setActive(win, paneId) {
    win.active = paneId;
    var ps = panesOf(win);
    for (var i = 0; i < ps.length; i++) if (ps[i].id === paneId) ps[i].activePoint = nextActivePoint++;
  }

  // `pane`: an existing pane to build the window round (break-pane).
  function createWindow(session, name, pane) {
    pane = pane || createPane(null);
    pane.activePoint = nextActivePoint++;
    var win = {
      id: 'w' + (nextWindowId++),
      index: freeIndex(session),
      name: name || 'zsh',
      root: { type: 'pane', pane: pane },
      active: pane.id,
      last: null,
      zoomed: false,
      layoutName: null,
      // next-layout goes on from the last layout set, through splits and
      // closes too (tmux's lastlayout): its place in LAYOUTS, -1 for none.
      lastLayout: -1
    };
    // tmux keeps windows sorted by index.
    session.windows.push(win);
    session.windows.sort(function (a, b) { return a.index - b.index; });
    return win;
  }

  // The lowest window index not in use (what new-window gives).
  function freeIndex(session) {
    var used = {};
    session.windows.forEach(function (w) { used[w.index] = true; });
    var index = session.baseIndex;
    while (used[index]) index++;
    return index;
  }

  function windowById(session, id) {
    for (var i = 0; i < session.windows.length; i++) if (session.windows[i].id === id) return session.windows[i];
    return null;
  }

  function activeWindow(session) { return windowById(session, session.active); }

  function leaves(node, out) {
    out = out || [];
    if (node.type === 'pane') out.push(node.pane);
    else { leaves(node.a, out); leaves(node.b, out); }
    return out;
  }

  function panesOf(win) { return leaves(win.root); }

  function findPane(session, id) {
    for (var i = 0; i < session.windows.length; i++) {
      var ps = panesOf(session.windows[i]);
      for (var j = 0; j < ps.length; j++) if (ps[j].id === id) return { win: session.windows[i], pane: ps[j] };
    }
    return null;
  }

  function activePane(win) {
    var ps = panesOf(win);
    for (var i = 0; i < ps.length; i++) if (ps[i].id === win.active) return ps[i];
    return ps[0];
  }

  function paneIndex(session, win, pane) {
    var ps = panesOf(win);
    for (var i = 0; i < ps.length; i++) if (ps[i].id === pane.id) return i + session.paneBaseIndex;
    return -1;
  }

  // ---- layout -------------------------------------------------------------
  // Each split node has `ratio`: the share of the axis given to child a.
  // Cells: a gets round(ratio * (size - 1)), one cell is the border, b the rest.
  // A node a layout made sizes its cells as tmux does instead (layouts below):
  // `even` (a chain of that many cells, the spare cells to the first ones),
  // `tile` ({d, m}: m cells of a d-wide grid row, the spare to the last) or
  // `main` (the main pane's cells). `mirror` draws child a after child b
  // (to the right, or below), so the main pane keeps its number 0.

  var MIN = 2;

  function splitSizes(size, node) {
    var a;
    if (typeof node === 'number') a = Math.round(node * (size - 1));
    else if (node.even) a = Math.ceil((size - (node.even - 1)) / node.even);
    else if (node.tile) a = (node.tile.m - 1) * Math.floor((size - (node.tile.d - 1)) / node.tile.d) + (node.tile.m - 2);
    else if (node.main) a = node.main;
    else a = Math.round(node.ratio * (size - 1));
    if (a < MIN) a = MIN;
    if (size - 1 - a < MIN) a = size - 1 - MIN;
    if (a < 1) a = 1;
    return { a: a, b: Math.max(1, size - 1 - a) };
  }

  // Returns {panes: [{pane, x, y, w, h}], borders: [{dir, x, y, len, node}]}
  function layout(win, cols, rows) {
    var rects = [], borders = [];
    if (win.zoomed) {
      rects.push({ pane: activePane(win), x: 0, y: 0, w: cols, h: rows });
      return { panes: rects, borders: borders };
    }
    function walk(node, x, y, w, h) {
      if (node.type === 'pane') { rects.push({ pane: node.pane, x: x, y: y, w: w, h: h }); return; }
      var m = node.mirror;
      if (node.dir === 'lr') {
        var s = splitSizes(w, node), first = m ? s.b : s.a;
        walk(node.a, m ? x + s.b + 1 : x, y, s.a, h);
        borders.push({ dir: 'v', x: x + first, y: y, len: h, node: node });
        walk(node.b, m ? x : x + s.a + 1, y, s.b, h);
      } else {
        var t = splitSizes(h, node), top = m ? t.b : t.a;
        walk(node.a, x, m ? y + t.b + 1 : y, w, t.a);
        borders.push({ dir: 'h', x: x, y: y + top, len: w, node: node });
        walk(node.b, x, m ? y : y + t.a + 1, w, t.b);
      }
    }
    walk(win.root, 0, 0, cols, rows);
    return { panes: rects, borders: borders };
  }

  function rectOf(win, paneId, cols, rows) {
    var l = layout(win, cols, rows);
    for (var i = 0; i < l.panes.length; i++) if (l.panes[i].pane.id === paneId) return l.panes[i];
    return null;
  }

  // ---- operations ----------------------------------------------------------

  function parentOf(root, paneId) {
    var found = null;
    function walk(node, parent) {
      if (found) return;
      if (node.type === 'pane') { if (node.pane.id === paneId) found = { node: node, parent: parent }; return; }
      walk(node.a, node); walk(node.b, node);
    }
    walk(root, null);
    return found;
  }

  // dir: 'lr' (tmux split-window -h, new pane to the right) or 'tb' (-v, below).
  function splitPane(win, paneId, dir, scene, keepFocus) {
    var hit = parentOf(win.root, paneId);
    if (!hit) return null;
    var fresh = createPane(scene);
    var split = { type: 'split', dir: dir, ratio: 0.5, a: hit.node, b: { type: 'pane', pane: fresh } };
    if (!hit.parent) win.root = split;
    else if (hit.parent.a === hit.node) hit.parent.a = split;
    else hit.parent.b = split;
    win.zoomed = false;
    win.layoutName = null;
    if (!keepFocus) { win.last = win.active; setActive(win, fresh.id); }
    return fresh;
  }

  // Returns false if it was the last pane of the window. As tmux's
  // window_lost_pane: the focus goes to the last pane, else the previous
  // one in order, else the next.
  function killPane(win, paneId) {
    var hit = parentOf(win.root, paneId);
    if (!hit || !hit.parent) return false;
    var before = panesOf(win);
    var at = -1;
    for (var k = 0; k < before.length; k++) if (before[k].id === paneId) at = k;
    var sibling = hit.parent.a === hit.node ? hit.parent.b : hit.parent.a;
    var gp = parentOfNode(win.root, hit.parent);
    if (!gp) win.root = sibling;
    else if (gp.a === hit.parent) gp.a = sibling;
    else gp.b = sibling;
    win.zoomed = false;
    win.layoutName = null;
    if (win.active === paneId) {
      var ps = panesOf(win);
      var pick = null;
      for (var i = 0; i < ps.length; i++) if (ps[i].id === win.last) pick = ps[i];
      if (!pick) pick = at > 0 ? before[at - 1] : before[at + 1];
      setActive(win, pick.id);
      win.last = null;
    } else if (win.last === paneId) win.last = null;
    return true;
  }

  // break-pane: the pane leaves its window for a new one of its own, which
  // becomes the current window (as tmux does without -d). The window it
  // left keeps its other panes. A window of one pane is not refused: tmux
  // 3.x just moves it to the next free index (0,1 → 0,2), so `moved` says.
  // `stay` (break-pane -d): the new window is not selected.
  function breakPane(session, win, paneId, stay) {
    var hit = parentOf(win.root, paneId);
    if (!hit) return null;
    if (!hit.parent) {
      win.index = freeIndex(session);
      session.windows.sort(function (a, b) { return a.index - b.index; });
      if (!stay) selectWindow(session, win.id);
      return win;
    }
    var pane = hit.node.pane;
    killPane(win, paneId);
    var fresh = createWindow(session, null, pane);
    if (!stay) selectWindow(session, fresh.id);
    return fresh;
  }

  function parentOfNode(root, target) {
    var found = null;
    function walk(node) {
      if (found || node.type === 'pane') return;
      if (node.a === target || node.b === target) { found = node; return; }
      walk(node.a); walk(node.b);
    }
    walk(root);
    return found;
  }

  function selectPane(win, paneId) {
    if (win.active === paneId) return false;
    win.last = win.active;
    setActive(win, paneId);
    win.zoomed = false;
    return true;
  }

  // tmux select-pane -L/-R/-U/-D: the adjacent pane in that direction that
  // overlaps the active one; among several, the one that was active most
  // recently (window_pane_choose_best), ties to the first in layout order.
  // As tmux's window_pane_find_left/right/up/down, it wraps round at the
  // window edge (the far side's rooms), unless noWrap.
  // `from` and `recent` (arrowPath) ask the same from another pane, with
  // `recent` as the one that would then be the most recently active.
  function neighbour(win, cols, rows, dir, noWrap, from, recent) {
    var l = layout(win, cols, rows);
    var me = null;
    for (var i = 0; i < l.panes.length; i++) if (l.panes[i].pane.id === (from || win.active)) me = l.panes[i];
    if (!me) return null;
    var edge;
    if (dir === 'L') edge = me.x === 0 ? (noWrap ? null : cols + 1) : me.x;
    if (dir === 'R') edge = me.x + me.w >= cols ? (noWrap ? null : -1) : me.x + me.w;
    if (dir === 'U') edge = me.y === 0 ? (noWrap ? null : rows + 1) : me.y;
    if (dir === 'D') edge = me.y + me.h >= rows ? (noWrap ? null : -1) : me.y + me.h;
    if (edge == null) return null;
    var best = null;
    for (var j = 0; j < l.panes.length; j++) {
      var r = l.panes[j];
      if (r === me) continue;
      var ok = false;
      if (dir === 'L') ok = r.x + r.w + 1 === edge && overlap(r.y, r.h, me.y, me.h);
      if (dir === 'R') ok = edge + 1 === r.x && overlap(r.y, r.h, me.y, me.h);
      if (dir === 'U') ok = r.y + r.h + 1 === edge && overlap(r.x, r.w, me.x, me.w);
      if (dir === 'D') ok = edge + 1 === r.y && overlap(r.x, r.w, me.x, me.w);
      if (!ok) continue;
      if (!best || r.pane.id === recent || (best.pane.id !== recent && r.pane.activePoint > best.pane.activePoint)) best = r;
    }
    return best ? best.pane : null;
  }

  // The first arrow of the shortest way from the active pane to `paneId`,
  // walking as tmux would (of several panes in a direction, the one active
  // last: on the way, the pane just left). A greedy nearest step can swing
  // between two panes for ever (↓ to a wide pane, ↑ back to where you were);
  // this never does. Null when plain arrows do not get there.
  function arrowPath(win, cols, rows, paneId) {
    var seen = {}, queue = [{ at: win.active, prev: null, first: null }];
    while (queue.length) {
      var s = queue.shift();
      for (var i = 0; i < 4; i++) {
        var d = 'LRUD'[i];
        var nb = neighbour(win, cols, rows, d, true, s.at, s.prev);
        if (!nb) continue;
        var first = s.first || d;
        if (nb.id === paneId) return first;
        var key = nb.id + '|' + s.at;
        if (seen[key]) continue;
        seen[key] = 1;
        queue.push({ at: nb.id, prev: s.at, first: first });
      }
    }
    return null;
  }

  function overlap(a, al, b, bl) { return a < b + bl && b < a + al; }

  // Resize like tmux's layout_resize_pane: find the nearest ancestor split on
  // this axis, and move its border by `n` cells. -L/-U move it towards the
  // origin, -R/-D away from it; the sign is the caller's choice. A zoomed
  // window is unzoomed first, as resize-pane does.
  function resizePane(win, paneId, axis, n, cols, rows) {
    win.zoomed = false;
    var chain = [];
    (function walk(node, path) {
      if (node.type === 'pane') { if (node.pane.id === paneId) chain = path.slice(); return; }
      walk(node.a, path.concat([node])); walk(node.b, path.concat([node]));
    })(win.root, []);
    var target = null;
    for (var i = chain.length - 1; i >= 0; i--) if (chain[i].dir === axis) { target = chain[i]; break; }
    if (!target) return false;
    var size = sizeOfNode(win, target, cols, rows, axis);
    var span = size - 1;
    if (span < 2 * MIN + 1) return false;
    var cur = splitSizes(size, target).a;
    // Child a drawn after b (a mirrored layout): its border moves the other way.
    var want = cur + (target.mirror ? -n : n);
    if (want < MIN) want = MIN;
    if (span - want < MIN) want = span - MIN;
    if (want === cur) return false;
    target.ratio = want / span;
    // Moved by hand: the layout's own sizing gives way to the ratio.
    delete target.even; delete target.tile; delete target.main;
    win.layoutName = null;
    return true;
  }

  function sizeOfNode(win, target, cols, rows, axis) {
    var found = null;
    function walk(node, x, y, w, h) {
      if (found) return;
      if (node === target) { found = axis === 'lr' ? w : h; return; }
      if (node.type === 'pane') return;
      if (node.dir === 'lr') {
        var s = splitSizes(w, node);
        walk(node.a, x, y, s.a, h); walk(node.b, x + s.a + 1, y, s.b, h);
      } else {
        var t = splitSizes(h, node);
        walk(node.a, x, y, w, t.a); walk(node.b, x, y + t.a + 1, w, t.b);
      }
    }
    walk(win.root, 0, 0, cols, rows);
    return found || 0;
  }

  function selectWindow(session, winId) {
    if (session.active === winId) return false;
    session.last = session.active;
    session.active = winId;
    return true;
  }

  function nextWindow(session, step) {
    var i = -1;
    for (var k = 0; k < session.windows.length; k++) if (session.windows[k].id === session.active) i = k;
    var n = session.windows.length;
    var j = ((i + step) % n + n) % n;
    return selectWindow(session, session.windows[j].id);
  }

  function windowByIndex(session, index) {
    for (var i = 0; i < session.windows.length; i++) if (session.windows[i].index === index) return session.windows[i];
    return null;
  }

  // As tmux's session_detach of the current window: the last window, else
  // the previous one, else the next.
  function killWindow(session, winId) {
    var idx = -1;
    for (var i = 0; i < session.windows.length; i++) if (session.windows[i].id === winId) idx = i;
    if (idx < 0 || session.windows.length < 2) return false;
    session.windows.splice(idx, 1);
    if (session.active === winId) {
      var last = windowById(session, session.last);
      session.active = (last || session.windows[Math.max(0, idx - 1)]).id;
      session.last = null;
    } else if (session.last === winId) session.last = null;
    // renumber-windows on: a window gone closes the gap (tmux does it only then).
    if (session.renumber) renumberWindows(session);
    return true;
  }

  // swap-pane: the two panes trade places in the tree. The active pane id
  // does not change, so the focus follows the pane that moved, as in tmux.
  function swapPanes(win, idA, idB) {
    if (idA === idB) return false;
    var na = parentOf(win.root, idA), nb = parentOf(win.root, idB);
    if (!na || !nb) return false;
    var tmp = na.node.pane;
    na.node.pane = nb.node.pane;
    nb.node.pane = tmp;
    win.zoomed = false;
    return true;
  }

  // tmux swap-pane -U / -D: trade places with the previous / next pane.
  function swapStep(win, step) {
    var ps = panesOf(win);
    if (ps.length < 2) return false;
    var at = 0;
    for (var i = 0; i < ps.length; i++) if (ps[i].id === win.active) at = i;
    var other = ps[((at + step) % ps.length + ps.length) % ps.length];
    return swapPanes(win, win.active, other.id);
  }

  // rotate-window (prefix C-o, -U): every pane's contents move one place
  // up in the order (the first goes to the end); -D (prefix M-o, `down`)
  // the other way. The focus stays where it is on screen, so it lands on
  // the pane that moved in.
  function rotateWindow(win, down) {
    var nodes = [];
    (function walk(node) { if (node.type === 'pane') nodes.push(node); else { walk(node.a); walk(node.b); } })(win.root);
    if (nodes.length < 2) return false;
    var at = 0;
    for (var i = 0; i < nodes.length; i++) if (nodes[i].pane.id === win.active) at = i;
    var panes = nodes.map(function (n) { return n.pane; });
    var n = panes.length;
    for (var j = 0; j < n; j++) nodes[j].pane = panes[(j + (down ? n - 1 : 1)) % n];
    win.zoomed = false;
    win.last = null;
    setActive(win, nodes[at].pane.id);
    return true;
  }

  // join-pane (move-pane): pane `srcId` of window `src` leaves it and splits
  // pane `dstId` of window `dst`, below it (dir 'tb', -v) or to its right
  // ('lr', -h); `before` (-b) puts it above or to the left. It becomes the
  // active pane unless `keepFocus` (-d). A window left with no pane closes.
  // Returns the pane, or null.
  function joinPane(session, src, srcId, dst, dstId, dir, before, keepFocus) {
    if (srcId === dstId) return null;
    var hit = parentOf(src.root, srcId);
    if (!hit || !parentOf(dst.root, dstId)) return null;
    var pane = hit.node.pane;
    if (!hit.parent) {
      if (src === dst || !killWindow(session, src.id)) return null;
    } else killPane(src, srcId);
    var at = parentOf(dst.root, dstId);
    var leaf = { type: 'pane', pane: pane };
    var split = { type: 'split', dir: dir, ratio: 0.5, a: before ? leaf : at.node, b: before ? at.node : leaf };
    if (!at.parent) dst.root = split;
    else if (at.parent.a === at.node) at.parent.a = split;
    else at.parent.b = split;
    dst.zoomed = false;
    dst.layoutName = null;
    if (!keepFocus) { dst.last = dst.active; setActive(dst, pane.id); }
    return pane;
  }

  // swap-window: the two windows trade numbers. As tmux 3.8 does it, the
  // current number stays current (so the focus goes to the window swapped
  // in), unless -d (`follow`): then the current window keeps the focus at
  // its new number, and the other one becomes the last.
  function swapWindows(session, idA, idB, follow) {
    var a = windowById(session, idA), b = windowById(session, idB);
    if (!a || !b || a === b) return false;
    var t = a.index; a.index = b.index; b.index = t;
    session.windows.sort(function (x, y) { return x.index - y.index; });
    if (session.active === a.id || session.active === b.id) {
      var cur = session.active === a.id ? a : b, other = cur === a ? b : a;
      if (follow) session.last = other.id;
      else session.active = other.id;
    }
    return true;
  }

  // move-window -t: the window to a free number (tmux refuses one in use,
  // "index in use"). Returns false when it cannot.
  function moveWindow(session, winId, index) {
    var w = windowById(session, winId);
    if (!w || windowByIndex(session, index) && windowByIndex(session, index) !== w) return false;
    w.index = index;
    session.windows.sort(function (x, y) { return x.index - y.index; });
    return true;
  }

  // move-window -r: the numbers made consecutive again from base-index.
  function renumberWindows(session) {
    session.windows.forEach(function (w, i) { w.index = session.baseIndex + i; });
  }

  // ---- layouts (select-layout / next-layout) --------------------------------
  // In next-layout's order (prefix Space), as tmux 3.8 cycles them; the
  // prefix M-1 to M-7 keys pick them in LAYOUT_KEYS' order. Sized as tmux
  // sizes them: the even ones share the cells out (the spare to the first
  // panes), tiled makes rows of columns (the spare to the last row and
  // column), and the main pane is main-pane-height (24) rows high or
  // main-pane-width (80) columns wide, the others even beside it.

  var LAYOUTS = ['even-horizontal', 'even-vertical', 'main-horizontal', 'main-horizontal-mirrored', 'main-vertical', 'main-vertical-mirrored', 'tiled'];
  var LAYOUT_KEYS = ['even-horizontal', 'even-vertical', 'main-horizontal', 'main-vertical', 'tiled', 'main-horizontal-mirrored', 'main-vertical-mirrored'];
  var MAIN_HEIGHT = 24, MAIN_WIDTH = 80;

  // A chain of splits along `dir` that shares the axis evenly.
  function chain(list, dir) {
    if (list.length === 1) return list[0];
    return { type: 'split', dir: dir, ratio: 1 / list.length, even: list.length, a: list[0], b: chain(list.slice(1), dir) };
  }

  // A row (or the column of rows) of tiled: `m` cells of a grid `d` wide,
  // nested from the left so each takes the grid's width.
  function tileRow(list, dir, d) {
    var m = list.length;
    if (m === 1) return list[0];
    return { type: 'split', dir: dir, ratio: (m - 1) / m, tile: { d: d, m: m }, a: tileRow(list.slice(0, -1), dir, m - 1), b: list[m - 1] };
  }

  function applyLayout(win, name) {
    var at = LAYOUTS.indexOf(name);
    if (at < 0) return false;
    win.lastLayout = at;
    var nodes = panesOf(win).map(function (p) { return { type: 'pane', pane: p }; });
    if (nodes.length < 2) { win.layoutName = name; return false; }
    var root;
    if (name === 'even-horizontal') root = chain(nodes, 'lr');
    else if (name === 'even-vertical') root = chain(nodes, 'tb');
    else if (name === 'main-horizontal') root = { type: 'split', dir: 'tb', ratio: 0.6, main: MAIN_HEIGHT, a: nodes[0], b: chain(nodes.slice(1), 'lr') };
    else if (name === 'main-horizontal-mirrored') root = { type: 'split', dir: 'tb', ratio: 0.6, main: MAIN_HEIGHT, mirror: true, a: nodes[0], b: chain(nodes.slice(1), 'lr') };
    else if (name === 'main-vertical') root = { type: 'split', dir: 'lr', ratio: 0.6, main: MAIN_WIDTH, a: nodes[0], b: chain(nodes.slice(1), 'tb') };
    else if (name === 'main-vertical-mirrored') root = { type: 'split', dir: 'lr', ratio: 0.6, main: MAIN_WIDTH, mirror: true, a: nodes[0], b: chain(nodes.slice(1), 'tb') };
    else {
      // tmux's layout_set_tiled: rows and columns grow in turn until all fit.
      var rows = 1, cols = 1, n = nodes.length;
      while (rows * cols < n) { rows++; if (rows * cols < n) cols++; }
      var rowsList = [];
      for (var i = 0; i < n; i += cols) {
        var row = nodes.slice(i, i + cols);
        // A short last row: its cells are as wide as the others, the last takes the rest.
        rowsList.push(row.length === 1 ? row[0] : row.length < cols ? shortRow(row, cols) : tileRow(row, 'lr', cols));
      }
      root = tileRow(rowsList, 'tb', rowsList.length);
    }
    win.root = root;
    win.zoomed = false;
    win.layoutName = name;
    return true;
  }

  function shortRow(row, cols) {
    var r = tileRow(row, 'lr', row.length);
    r.tile = { d: cols, m: row.length };
    return r;
  }

  // select-layout -E (prefix E): the pane and the ones beside it along the
  // same split (tmux's one layout cell: here a run of same-way splits)
  // share that axis evenly.
  function spreadOut(win, paneId) {
    var hit = parentOf(win.root, paneId);
    if (!hit || !hit.parent) return false;
    var top = hit.parent, dir = top.dir, up;
    while ((up = parentOfNode(win.root, top)) && up.dir === dir) top = up;
    var list = [];
    (function flat(n) { if (n.type === 'split' && n.dir === dir && !n.mirror) { flat(n.a); flat(n.b); } else list.push(n); })(top);
    var fresh = chain(list, dir);
    up = parentOfNode(win.root, top);
    if (!up) win.root = fresh;
    else if (up.a === top) up.a = fresh;
    else up.b = fresh;
    win.zoomed = false;
    win.layoutName = null;
    return true;
  }

  function nextLayout(win, back) {
    var n = LAYOUTS.length, at = win.lastLayout == null ? -1 : win.lastLayout;
    var to = back ? (at <= 0 ? n - 1 : at - 1) : (at + 1) % n;
    return applyLayout(win, LAYOUTS[to]) || true;
  }

  window.ADV = window.ADV || {};
  // ---- copy mode: the vi word moves and f/t, on plain text lines ----------

  // tmux's word-separators: each of these is a word of its own.
  var WORD_SEP = '!"#$%&\'()*+,-./:;<=>?@[\\]^`{|}~';
  // 0 a space (a line's end too), 1 a word character, 2 a separator; `big`
  // (W B E): anything but a space is one kind.
  function charKind(ch, big) { return !ch || /\s/.test(ch) ? 0 : big || WORD_SEP.indexOf(ch) < 0 ? 1 : 2; }

  // next-word (w), next-word-end (e), previous-word (b) over `lines` (the
  // texts in order), from line `j` column `c`; `big`: W E B. Returns {j, c}.
  function copyWord(lines, j, c, what, big) {
    var run = [];
    lines.forEach(function (t, i) {
      for (var x = 0; x < t.length; x++) run.push({ j: i, c: x, ch: t[x] });
      if (i < lines.length - 1 || !t.length) run.push({ j: i, c: t.length, ch: '\n' });
    });
    var n = run.length, at = -1;
    if (!n) return { j: j, c: c };
    for (var i = 0; i < n; i++) if (run[i].j === j && (at < 0 || run[i].c <= c)) at = i;
    if (at < 0) at = 0;
    var kind = function (x) { return charKind(run[x].ch, big); };
    var p = at;
    if (what === 'w') {
      var k0 = kind(p);
      if (k0) while (p < n && kind(p) === k0) p++;
      while (p < n && !kind(p)) p++;
      if (p >= n) p = n - 1;
    } else if (what === 'e') {
      p++;
      while (p < n && !kind(p)) p++;
      if (p >= n) p = n - 1;
      else { var k1 = kind(p); while (p + 1 < n && kind(p + 1) === k1) p++; }
    } else {
      p--;
      while (p > 0 && !kind(p)) p--;
      if (p < 0) p = 0;
      var k2 = kind(p);
      while (p > 0 && k2 && kind(p - 1) === k2) p--;
    }
    return { j: run[p].j, c: run[p].c };
  }

  // f F t T: the column the jump lands on in `text` from `cx`, or cx.
  function copyJump(text, cx, type, ch) {
    var i;
    cx = Math.min(cx, text.length);
    if (type === 'f') i = text.indexOf(ch, cx + 1);
    else if (type === 't') { i = text.indexOf(ch, cx + 2); if (i >= 0) i -= 1; }
    else if (type === 'F') i = cx > 0 ? text.lastIndexOf(ch, cx - 1) : -1;
    else { i = cx > 1 ? text.lastIndexOf(ch, cx - 2) : -1; if (i >= 0) i += 1; }
    return i >= 0 ? i : cx;
  }

  window.ADV.tmux = {
    copyWord: copyWord,
    copyJump: copyJump,
    swapPanes: swapPanes,
    swapStep: swapStep,
    rotateWindow: rotateWindow,
    applyLayout: applyLayout,
    nextLayout: nextLayout,
    spreadOut: spreadOut,
    LAYOUTS: LAYOUTS,
    LAYOUT_KEYS: LAYOUT_KEYS,
    joinPane: joinPane,
    swapWindows: swapWindows,
    moveWindow: moveWindow,
    renumberWindows: renumberWindows,
    createSession: createSession,
    createWindow: createWindow,
    createPane: createPane,
    freeIndex: freeIndex,
    windowById: windowById,
    windowByIndex: windowByIndex,
    activeWindow: activeWindow,
    activePane: activePane,
    panesOf: panesOf,
    paneIndex: paneIndex,
    findPane: findPane,
    parentOf: parentOf,
    layout: layout,
    rectOf: rectOf,
    splitPane: splitPane,
    killPane: killPane,
    breakPane: breakPane,
    killWindow: killWindow,
    selectPane: selectPane,
    neighbour: neighbour,
    arrowPath: arrowPath,
    resizePane: resizePane,
    selectWindow: selectWindow,
    nextWindow: nextWindow
  };
})();
