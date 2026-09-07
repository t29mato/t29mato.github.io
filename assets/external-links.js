/* A link that leaves the site opens in a new tab.
 *
 * Doing this in the markup would mean an attribute on every link in
 * _includes/home.html, works.md, the posts, the footer — and on every link
 * written after this, which is the one that would be forgotten. One pass over
 * the document is the only version that stays true.
 *
 * The pass is a single sweep, not a MutationObserver: the map adds and removes
 * a tile element on every pan, and watching the whole document to catch two
 * links is the wrong trade. Markup that JavaScript writes carries its own
 * target — assets/hikes.js does, for the [yamareco] row and the tile credit.
 * Anything added later that writes links has to do the same.
 */
(function () {
  var links = document.querySelectorAll("a[href]");

  for (var i = 0; i < links.length; i++) {
    var a = links[i];

    /* `a.hostname` is the resolved host, so a relative path and a bare "#id"
       both read as this site, and mailto: and javascript: read as "" — one
       comparison covers every internal case. */
    if (!a.hostname || a.hostname === location.hostname) continue;

    /* _layouts/post.html already opens author links its own way. */
    if (a.target) continue;

    a.target = "_blank";
    if (!/(^|\s)noopener(\s|$)/.test(a.rel)) {
      a.rel = a.rel ? a.rel + " noopener" : "noopener";
    }
  }
})();
