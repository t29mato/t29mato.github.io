/*
 * The topology pane on /homelab/.
 *
 * The diagram is archify's own standalone page, embedded rather than copied
 * in: regenerating the artifact updates this page with nothing to edit here.
 * `?embed=1` is archify's inline mode — it drops the cards and the guided
 * view rail, which this page already says in its own words further down.
 *
 * Two things still have to be handled from this side.
 *
 * The theme. archify resolves its own from ?theme=, then its own storage key,
 * then the OS — none of which know about this site's toggle. So the src is
 * not in the markup at all: it is written once, from the theme the site has
 * already resolved, and the frame therefore never paints in the wrong one.
 *
 * Later presses of the toggle set data-theme inside the frame directly
 * rather than re-pointing src, because a reload would throw away whatever
 * the reader had panned or zoomed to. Re-pointing is the fallback for the
 * case where the frame has not finished loading yet.
 */
(function () {
  var frame = document.getElementById("lab-topology");
  if (!frame || !frame.getAttribute("data-src")) return;

  var base = frame.getAttribute("data-src");
  var root = document.documentElement;
  var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");

  /* The same three states as assets/theme.js: an explicit choice wins, and
     with no choice the site is dark unless the OS asks for light. */
  function current() {
    var set = root.getAttribute("data-theme");
    if (set === "dark" || set === "light") return set;
    return systemDark && systemDark.matches === false ? "light" : "dark";
  }

  function point(theme) {
    frame.src = base + "?embed=1&theme=" + theme;
  }

  point(current());

  function sync() {
    var theme = current();
    try {
      frame.contentDocument.documentElement.setAttribute("data-theme", theme);
    } catch (e) {
      /* Still loading, or the document would not take it. */
      point(theme);
    }
  }

  if (window.MutationObserver) {
    new MutationObserver(sync).observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
  }

  /* A reader who never chose keeps following the OS, same as the site does. */
  if (systemDark && systemDark.addEventListener) {
    systemDark.addEventListener("change", function () {
      if (!root.getAttribute("data-theme")) sync();
    });
  }
})();
