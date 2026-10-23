// tmux 道場 in two languages. The Japanese text is the key: t('{0} へ移動する',
// label) gives the Japanese as written, or its English from EN. The language
// comes from ?lang=en|ja, then the last choice, then the browser.
(function () {
  'use strict';

  var STORE = 'tmux-da-lang';

  function pick() {
    try {
      var q = new URLSearchParams(window.location.search).get('lang');
      if (q === 'en' || q === 'ja') { try { window.localStorage.setItem(STORE, q); } catch (e) { /* fine */ } return q; }
    } catch (e) { /* old browsers */ }
    try {
      var s = window.localStorage.getItem(STORE);
      if (s === 'en' || s === 'ja') return s;
    } catch (e) { /* private mode */ }
    var n = (navigator.languages && navigator.languages[0]) || navigator.language || 'ja';
    return /^ja/i.test(n) ? 'ja' : 'en';
  }

  var lang = pick();
  var EN = (window.ADV && window.ADV.EN) || {};
  var missing = {};

  // t(template, a, b, …): {0}, {1}… are filled in after the lookup. English
  // plurals: {0:run|runs} is "run" when the argument is 1, "runs" otherwise.
  function t(s) {
    var out = s;
    if (lang === 'en') {
      if (Object.prototype.hasOwnProperty.call(EN, s)) out = EN[s];
      else if (/[ぁ-んァ-ヶ一-龠]/.test(s) && !missing[s]) { missing[s] = 1; if (window.console) console.warn('[i18n] no English for: ' + s); }
    }
    var args = arguments;
    return args.length > 1 ? out.replace(/\{(\d)(?::([^{}|]*)\|([^{}]*))?\}/g, function (m, i, one, many) {
      var v = args[+i + 1];
      if (one != null) return String(v) === '1' ? one : many;
      return v == null ? '' : String(v);
    }) : out;
  }

  // The page's own text: [data-t] elements take their HTML as the key;
  // data-t-aria / data-t-ph / data-t-title translate those attributes.
  function apply(root) {
    root = root || document;
    if (lang === 'ja') return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-t]'), function (el) {
      if (!el.dataset.tKey) el.dataset.tKey = el.getAttribute('data-t') || el.innerHTML.trim();
      el.innerHTML = t(el.dataset.tKey);
    });
    [['data-t-aria', 'aria-label'], ['data-t-ph', 'placeholder'], ['data-t-title', 'title']].forEach(function (p) {
      Array.prototype.forEach.call(root.querySelectorAll('[' + p[0] + ']'), function (el) {
        el.setAttribute(p[1], t(el.getAttribute(p[0]) || el.getAttribute(p[1])));
      });
    });
    document.documentElement.lang = 'en';
    document.title = 'tmux Dojo';
  }

  function set(l) {
    try { window.localStorage.setItem(STORE, l); } catch (e) { /* fine */ }
    var u = new URL(window.location.href);
    u.searchParams.delete('lang');
    window.location.replace(u.toString());
  }

  window.ADV = window.ADV || {};
  window.ADV.i18n = { lang: lang, t: t, apply: apply, set: set, missing: function () { return Object.keys(missing); } };
})();
