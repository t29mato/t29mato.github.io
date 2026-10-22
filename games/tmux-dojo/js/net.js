// tmux 道場: the shared records. Everything here is optional: with no
// network (file://, offline, server down) the game keeps its records in the
// browser as before and nothing on screen breaks.
//
// A 合言葉 (sync key) is the player. It is made by the server on the first
// sync, kept in localStorage, and typed into another device to bring the
// same history there. The name on the boards belongs to the 合言葉.
(function () {
  'use strict';

  var REC = ADV.records;
  var STORE_KEY = 'tmux-da-net';
  var DEFAULT_API = 'https://tmux-da-api.starrydata-mcp-cloudflare.workers.dev';

  // ?api=http://localhost:8787 points a test page at a local server. Only a
  // local one: a link must not be able to send the 合言葉 anywhere else.
  var API = (function () {
    try {
      var q = new URLSearchParams(window.location.search).get('api');
      if (q && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(q)) return q.replace(/\/$/, '');
    } catch (e) { /* old browsers: the default */ }
    return DEFAULT_API;
  })();

  function read() {
    try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function save(patch) {
    var s = read();
    for (var k in patch) s[k] = patch[k];
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* a convenience */ }
    return s;
  }

  function call(method, path, body) {
    var opts = { method: method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'http ' + r.status); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  function state() { return read(); }

  function ensureKey() {
    var s = read();
    if (s.key) return Promise.resolve(s.key);
    return call('POST', '/v1/keys').then(function (j) { save({ key: j.key }); return j.key; });
  }

  // Send every run here, take back every run of the 合言葉, merge.
  function sync() {
    return ensureKey().then(function (key) {
      var runs = (REC.load().runs || []).filter(function (r) { return !r.legacy; });
      return call('POST', '/v1/sync', { key: key, runs: runs });
    }).then(function (j) {
      var added = REC.merge(j.runs);
      save({ name: j.name || null, syncedAt: new Date().toISOString() });
      return { added: added, name: j.name || null };
    });
  }

  // Another device's 合言葉: switch to it and bring its runs here (this
  // device's runs go up to it too).
  function useKey(key) {
    var k = String(key || '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
    if (!/^[a-z]+-[a-z]+-[a-z]+-\d{3}$/.test(k)) return Promise.reject(new Error('bad key'));
    var prev = read();
    save({ key: k, name: null });
    return sync().catch(function (e) { save({ key: prev.key || null, name: prev.name || null }); throw e; });
  }

  function setName(name) {
    return ensureKey().then(function (key) { return call('POST', '/v1/name', { key: key, name: name }); })
      .then(function (j) { save({ name: j.name }); return j.name; });
  }

  // Enter a finished run on the boards (only with a name).
  function submit(run) {
    var s = read();
    if (!s.key || !s.name || s.boards === false) return Promise.resolve(null);
    return call('POST', '/v1/scores', { key: s.key, run: run });
  }

  function board(course, span) {
    return call('GET', '/v1/board?course=' + encodeURIComponent(course) + '&span=' + encodeURIComponent(span)).then(function (j) { return j.rows || []; });
  }

  function ghost(course, span) {
    return call('GET', '/v1/ghost?course=' + encodeURIComponent(course) + '&span=' + encodeURIComponent(span)).then(function (j) { return j.ghost; });
  }

  // The counts: one step of a visit, with a random id that is not the
  // 合言葉. Not from file:// pages or with Do Not Track on. Never waits.
  function visitor() {
    var s = read();
    if (s.vid) return s.vid;
    var a = new Uint8Array(8);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    var v = 'v_' + Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    save({ vid: v });
    return v;
  }
  function ev(e, c, n) {
    try {
      if (!/^https?:$/.test(window.location.protocol) || navigator.doNotTrack === '1') return;
      // text/plain keeps it a simple request (no preflight); keepalive lets
      // it leave with the page.
      fetch(API + '/v1/ev', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ v: visitor(), e: e, c: c || '', n: n || 0 }) }).catch(function () {});
    } catch (err) { /* the counts never break the game */ }
  }

  function forget() { save({ key: null, name: null, syncedAt: null }); }

  window.ADV = window.ADV || {};
  window.ADV.net = {
    API: API, state: state, save: save, sync: sync, useKey: useKey, setName: setName,
    submit: submit, board: board, ghost: ghost, forget: forget, ev: ev
  };
})();
