// A small tmux: sessions, windows, a binary tree of panes, and the layout
// maths tmux does in cells. No DOM in here; app.js renders it.
(function () {
  'use strict';

  var nextPaneId = 0;
  var nextWindowId = 0;

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
      cleared: 0
    };
  }

  function createWindow(session, name) {
    var pane = createPane(null);
    var used = {};
    session.windows.forEach(function (w) { used[w.index] = true; });
    var index = session.baseIndex;
    while (used[index]) index++;
    var win = {
      id: 'w' + (nextWindowId++),
      index: index,
      name: name || 'zsh',
      root: { type: 'pane', pane: pane },
      active: pane.id,
      last: null,
      zoomed: false,
      layoutName: null
    };
    // tmux keeps windows sorted by index.
    session.windows.push(win);
    session.windows.sort(function (a, b) { return a.index - b.index; });
    return win;
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

  var MIN = 2;

  function splitSizes(size, ratio) {
    var a = Math.round(ratio * (size - 1));
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
      if (node.dir === 'lr') {
        var s = splitSizes(w, node.ratio);
        walk(node.a, x, y, s.a, h);
        borders.push({ dir: 'v', x: x + s.a, y: y, len: h, node: node });
        walk(node.b, x + s.a + 1, y, s.b, h);
      } else {
        var t = splitSizes(h, node.ratio);
        walk(node.a, x, y, w, t.a);
        borders.push({ dir: 'h', x: x, y: y + t.a, len: w, node: node });
        walk(node.b, x, y + t.a + 1, w, t.b);
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
    if (!keepFocus) { win.last = win.active; win.active = fresh.id; }
    return fresh;
  }

  // Returns false if it was the last pane of the window.
  function killPane(win, paneId) {
    var hit = parentOf(win.root, paneId);
    if (!hit || !hit.parent) return false;
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
      win.active = (pick || leaves(sibling)[0]).id;
      win.last = null;
    }
    return true;
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
    win.active = paneId;
    win.zoomed = false;
    return true;
  }

  // tmux select-pane -L/-R/-U/-D: the adjacent pane in that direction that
  // overlaps the active one; ties go to the first in layout order.
  function neighbour(win, cols, rows, dir) {
    var l = layout(win, cols, rows);
    var me = null;
    for (var i = 0; i < l.panes.length; i++) if (l.panes[i].pane.id === win.active) me = l.panes[i];
    if (!me) return null;
    var best = null;
    for (var j = 0; j < l.panes.length; j++) {
      var r = l.panes[j];
      if (r === me) continue;
      var ok = false;
      if (dir === 'L') ok = r.x + r.w + 1 === me.x && overlap(r.y, r.h, me.y, me.h);
      if (dir === 'R') ok = me.x + me.w + 1 === r.x && overlap(r.y, r.h, me.y, me.h);
      if (dir === 'U') ok = r.y + r.h + 1 === me.y && overlap(r.x, r.w, me.x, me.w);
      if (dir === 'D') ok = me.y + me.h + 1 === r.y && overlap(r.x, r.w, me.x, me.w);
      if (ok && !best) best = r;
    }
    return best ? best.pane : null;
  }

  function overlap(a, al, b, bl) { return a < b + bl && b < a + al; }

  // Resize like tmux's layout_resize_pane: find the nearest ancestor split on
  // this axis, and move its border by `n` cells. -L/-U move it towards the
  // origin, -R/-D away from it; the sign is the caller's choice.
  function resizePane(win, paneId, axis, n, cols, rows) {
    if (win.zoomed) return false;
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
    var cur = splitSizes(size, target.ratio).a;
    var want = cur + n;
    if (want < MIN) want = MIN;
    if (span - want < MIN) want = span - MIN;
    if (want === cur) return false;
    target.ratio = want / span;
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
        var s = splitSizes(w, node.ratio);
        walk(node.a, x, y, s.a, h); walk(node.b, x + s.a + 1, y, s.b, h);
      } else {
        var t = splitSizes(h, node.ratio);
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

  function killWindow(session, winId) {
    var idx = -1;
    for (var i = 0; i < session.windows.length; i++) if (session.windows[i].id === winId) idx = i;
    if (idx < 0 || session.windows.length < 2) return false;
    session.windows.splice(idx, 1);
    if (session.active === winId) {
      var last = windowById(session, session.last);
      session.active = (last || session.windows[Math.min(idx, session.windows.length - 1)]).id;
      session.last = null;
    }
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

  // ---- layouts (select-layout / next-layout) --------------------------------

  var LAYOUTS = ['even-horizontal', 'even-vertical', 'main-horizontal', 'main-vertical', 'tiled'];

  // A chain of splits along `dir` that shares the axis evenly.
  function chain(list, dir) {
    if (list.length === 1) return list[0];
    return { type: 'split', dir: dir, ratio: 1 / list.length, a: list[0], b: chain(list.slice(1), dir) };
  }

  function applyLayout(win, name) {
    var nodes = panesOf(win).map(function (p) { return { type: 'pane', pane: p }; });
    if (nodes.length < 2) { win.layoutName = name; return false; }
    var root;
    if (name === 'even-horizontal') root = chain(nodes, 'lr');
    else if (name === 'even-vertical') root = chain(nodes, 'tb');
    else if (name === 'main-horizontal') root = { type: 'split', dir: 'tb', ratio: 0.6, a: nodes[0], b: chain(nodes.slice(1), 'lr') };
    else if (name === 'main-vertical') root = { type: 'split', dir: 'lr', ratio: 0.6, a: nodes[0], b: chain(nodes.slice(1), 'tb') };
    else {
      var cols = Math.ceil(Math.sqrt(nodes.length));
      var rowsList = [];
      for (var i = 0; i < nodes.length; i += cols) rowsList.push(chain(nodes.slice(i, i + cols), 'lr'));
      root = chain(rowsList, 'tb');
    }
    win.root = root;
    win.zoomed = false;
    win.layoutName = name;
    return true;
  }

  function nextLayout(win) {
    var at = LAYOUTS.indexOf(win.layoutName);
    return applyLayout(win, LAYOUTS[(at + 1) % LAYOUTS.length]) || true;
  }

  window.ADV = window.ADV || {};
  window.ADV.tmux = {
    swapPanes: swapPanes,
    swapStep: swapStep,
    applyLayout: applyLayout,
    nextLayout: nextLayout,
    LAYOUTS: LAYOUTS,
    createSession: createSession,
    createWindow: createWindow,
    createPane: createPane,
    windowById: windowById,
    windowByIndex: windowByIndex,
    activeWindow: activeWindow,
    activePane: activePane,
    panesOf: panesOf,
    paneIndex: paneIndex,
    findPane: findPane,
    layout: layout,
    rectOf: rectOf,
    splitPane: splitPane,
    killPane: killPane,
    killWindow: killWindow,
    selectPane: selectPane,
    neighbour: neighbour,
    resizePane: resizePane,
    selectWindow: selectWindow,
    nextWindow: nextWindow
  };
})();
