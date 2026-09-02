/* The homepage prompt, made real. Progressive enhancement over the static
   session in _includes/home.html: this file finds the idle prompt, swaps it
   for an <input>, and answers a small set of commands (help lists them).

   Two rules keep it honest:
   - No second copy of the site map. The filesystem is *parsed* from the
     static tree and picks blocks already on the page, so a new section added
     there shows up here for free.
   - Everything typed goes into the DOM via textContent, never innerHTML.

   Vanilla JS, homepage only, nothing here is required to reach any page —
   the static tree rows stay the real navigation. */
(function () {
  "use strict";

  var form = document.getElementById("tty-form");
  var input = document.getElementById("tty-input");
  var history = document.getElementById("tty-history");
  var idle = document.getElementById("tty-idle");
  var hint = document.getElementById("tty-hint");
  var cwdEl = document.getElementById("tty-cwd");
  var sectionsNav = document.querySelector('.tty-block[aria-label="Site sections"]');
  var picksNav = document.querySelector('.tty-block[aria-label="Recommended"]');
  if (!form || !input || !history || !sectionsNav) return;

  /* ---- the three files only the live prompt can see ---- */

  var NOW_TXT =
    "Currently poking at: Herd (a local dev environment), Orca (a strange " +
    "little step-sequencer), and Zed as a daily editor. Also running a " +
    "4-node cluster of 2011 Mac Minis, mostly because old hardware deserves " +
    "a second job.";

  var INTERESTS_TXT =
    "Diving, mountains, and board games I end up building instead of just " +
    "playing. Most of what's under after-hours/ started here.";

  /* uses.txt carries a real link, so it is a list of segments: strings stay
     text, {href, text} becomes an anchor. The post URL comes from Liquid via
     data attributes on the form — no guessed slugs. */
  var USES_TXT = [
    "zsh with a Starship prompt, fzf for history search, zoxide for " +
    "directory jumps, eza in place of ls, bat in place of cat.\n" +
    "The full rebuild is written up in ",
    { href: form.dataset.zshUrl, text: form.dataset.zshTitle || "the blog" },
    "."
  ];

  /* ---- filesystem, parsed from the static session ----
     Node shapes: {t:"dir", children}   plain directory (amber)
                  {t:"page", href, desc} a real site section (cyan, a link)
                  {t:"file", body}      body: string or segment list */

  function dir(children) { return { t: "dir", children: children }; }
  function file(body) { return { t: "file", body: body }; }

  var siteChildren = {};
  var currentGroup = null;
  sectionsNav.querySelectorAll(".tty-group, a.tty-trow").forEach(function (el) {
    if (el.classList.contains("tty-group")) {
      currentGroup = {};
      siteChildren[el.textContent.replace(/\/$/, "")] = dir(currentGroup);
    } else if (currentGroup) {
      var node = el.querySelector(".tty-node");
      var desc = el.querySelector(".tty-desc");
      currentGroup[node.textContent.replace(/\/$/, "")] = {
        t: "page",
        href: el.getAttribute("href"),
        desc: desc ? desc.textContent : ""
      };
    }
  });

  var whoamiEl = document.querySelector("h1.tty-out");
  var readmeEl = document.querySelector("p.tty-out");

  var root = dir({
    "README": file(readmeEl ? readmeEl.textContent : ""),
    "now.txt": file(NOW_TXT),
    "interests.txt": file(INTERESTS_TXT),
    "uses.txt": file(USES_TXT),
    "site": dir(siteChildren)
  });

  /* ---- path plumbing ---- */

  var cwd = []; /* parts relative to ~ */

  function resolve(str) {
    var base = cwd.slice();
    var s = (str || "").replace(/^["']|["']$/g, "");
    if (s === "") return base;
    if (s === "~") return [];
    if (s[0] === "~" || s[0] === "/") {
      base = [];
      s = s.replace(/^~?\/?/, "");
    }
    var parts = base;
    s.split("/").forEach(function (seg) {
      if (seg === "" || seg === ".") return;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    });
    return parts;
  }

  function nodeAt(parts) {
    var n = root;
    for (var i = 0; i < parts.length; i++) {
      if (n.t !== "dir" || !n.children[parts[i]]) return null;
      n = n.children[parts[i]];
    }
    return n;
  }

  /* `cd works` should work from anywhere, so a path that resolves to nothing
     gets a second chance as a bare section name. */
  function findSection(name) {
    var clean = name.replace(/\/$/, "");
    var found = null;
    Object.keys(siteChildren).forEach(function (g) {
      Object.keys(siteChildren[g].children).forEach(function (s) {
        if (s === clean) found = { parts: ["site", g, s], node: siteChildren[g].children[s] };
      });
    });
    if (!found && siteChildren[clean]) found = { parts: ["site", clean], node: siteChildren[clean] };
    if (!found && clean === "site") found = { parts: ["site"], node: root.children.site };
    return found;
  }

  function pathString(parts) {
    return parts.length ? "~/" + parts.join("/") : "~";
  }

  /* ---- output plumbing ---- */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function out(node) { history.appendChild(node); }

  function outLine(cls, text) { out(el("p", "tty-out " + (cls || ""), text)); }

  function outErr(text) { outLine("tty-err", text); }

  function echoCmd(raw) {
    var p = el("p", "tty-cmdline");
    var prompt = el("span", "tty-prompt", "tomoya@mato ");
    prompt.appendChild(el("span", "tty-path", pathString(cwd)));
    prompt.appendChild(document.createTextNode(" $"));
    p.appendChild(prompt);
    p.appendChild(document.createTextNode(" "));
    p.appendChild(el("span", "tty-cmd", raw));
    out(p);
  }

  /* ---- commands ---- */

  function cmdLs(arg) {
    var parts = resolve(arg);
    var n = nodeAt(parts);
    if (!n && arg) {
      var f = findSection(arg);
      if (f) { parts = f.parts; n = f.node; }
    }
    if (!n) return outErr("ls: " + arg + ": No such file or directory");
    if (n.t === "file") return outLine("", arg);
    if (n.t === "page") {
      /* a section is a page, not a browsable dir — nudge toward cd */
      outLine("tty-dim", "# " + (n.desc || "a page on this site"));
      return outLine("tty-dim", "# try: cd " + parts[parts.length - 1]);
    }
    var row = el("p", "tty-out tty-ls");
    Object.keys(n.children).sort().forEach(function (name) {
      var c = n.children[name];
      if (c.t === "page") {
        var a = el("a", "tty-ls-page", name + "/");
        a.href = c.href;
        row.appendChild(a);
      } else if (c.t === "dir") {
        row.appendChild(el("span", "tty-ls-dir", name + "/"));
      } else {
        row.appendChild(el("span", "tty-ls-file", name));
      }
    });
    out(row);
  }

  function cmdCd(arg) {
    if (!arg) { cwd = []; cwdEl.textContent = "~"; return; }
    var parts = resolve(arg);
    var n = nodeAt(parts);
    if (!n) {
      var f = findSection(arg);
      if (f) { parts = f.parts; n = f.node; }
    }
    if (!n) return outErr("cd: no such file or directory: " + arg);
    if (n.t === "file") return outErr("cd: not a directory: " + arg);
    if (n.t === "page") {
      outLine("tty-dim", "# opening " + parts[parts.length - 1] + "/ …");
      window.location.href = n.href;
      return;
    }
    cwd = parts;
    cwdEl.textContent = pathString(cwd);
  }

  function catBody(body) {
    var p = el("p", "tty-out");
    if (typeof body === "string") {
      p.textContent = body;
    } else {
      body.forEach(function (seg) {
        if (typeof seg === "string") p.appendChild(document.createTextNode(seg));
        else {
          var a = el("a", "", seg.text);
          a.href = seg.href;
          p.appendChild(a);
        }
      });
    }
    out(p);
  }

  function cmdCat(arg) {
    if (!arg) return outErr("usage: cat <file> — try: cat now.txt");
    var parts = resolve(arg);
    var n = nodeAt(parts);
    /* the static session greps ~/site/picks; cat-ing it should work too */
    if (!n && parts[parts.length - 1] === "picks" && picksNav) {
      var clone = picksNav.cloneNode(true);
      clone.removeAttribute("aria-label");
      return out(clone);
    }
    if (!n) {
      var f = findSection(arg);
      if (f) { parts = f.parts; n = f.node; }
    }
    if (!n) return outErr("cat: " + arg + ": No such file or directory");
    if (n.t === "dir") return outErr("cat: " + arg + ": Is a directory");
    if (n.t === "page") {
      outLine("", n.desc || "");
      return outLine("tty-dim", "# a page, not a file — try: cd " + parts[parts.length - 1]);
    }
    catBody(n.body);
  }

  function cmdTree(arg) {
    /* bare `tree` mirrors the session's own `tree ~/site` */
    var parts = arg ? resolve(arg) : ["site"];
    var n = nodeAt(parts);
    if (!n && arg) {
      var f = findSection(arg);
      if (f) { parts = f.parts; n = f.node; }
    }
    if (!n) return outErr("tree: " + arg + ": No such file or directory");
    if (n.t !== "dir") return outErr("tree: " + (arg || "") + ": Not a directory");

    var block = el("nav", "tty-block");
    block.appendChild(el("span", "tty-line tty-dim", pathString(parts)));
    var counts = { dir: 0, page: 0, file: 0 };

    function walk(node, prefix) {
      var names = Object.keys(node.children);
      names.forEach(function (name, i) {
        var c = node.children[name];
        var last = i === names.length - 1;
        var branch = prefix + (last ? "└──" : "├──");
        if (c.t === "page") {
          counts.page++;
          var a = el("a", "tty-trow");
          a.href = c.href;
          var b = el("span", "tty-branch", branch);
          b.setAttribute("aria-hidden", "true");
          a.appendChild(b);
          a.appendChild(el("span", "tty-node", name + "/"));
          a.appendChild(el("span", "tty-desc", c.desc));
          block.appendChild(a);
        } else if (c.t === "dir") {
          counts.dir++;
          var line = el("span", "tty-line");
          line.appendChild(el("span", "tty-branch", branch + " "));
          line.appendChild(el("span", "tty-group", name + "/"));
          block.appendChild(line);
          walk(c, prefix + (last ? "    " : "│   "));
        } else {
          counts.file++;
          var fl = el("span", "tty-line");
          fl.appendChild(el("span", "tty-branch", branch + " "));
          fl.appendChild(el("span", "", name));
          block.appendChild(fl);
        }
      });
    }
    walk(n, "");

    var bits = [];
    if (counts.dir) bits.push(counts.dir + " directories");
    if (counts.page) bits.push(counts.page + " sections");
    if (counts.file) bits.push(counts.file + " files");
    block.appendChild(el("span", "tty-line tty-dim", bits.join(", ")));
    out(block);
  }

  function cmdHelp() {
    var lines = [
      ["ls [path]", "list what's here"],
      ["cd <section>", "go there for real — works, games, blog, …"],
      ["cat <file>", "read a file — now.txt, interests.txt, uses.txt, README"],
      ["tree [path]", "the site map, drawn"],
      ["pwd", "where you are"],
      ["whoami", "who I am"],
      ["clear", "wipe what you typed (the session above stays)"],
      ["help", "this list"]
    ];
    lines.forEach(function (l) {
      var p = el("p", "tty-out tty-help");
      p.appendChild(el("span", "tty-help-cmd", l[0]));
      p.appendChild(el("span", "tty-dim", l[1]));
      out(p);
    });
  }

  var commands = {
    ls: cmdLs,
    cd: cmdCd,
    cat: cmdCat,
    tree: cmdTree,
    help: cmdHelp,
    pwd: function () { outLine("", "/home/tomoya" + (cwd.length ? "/" + cwd.join("/") : "")); },
    whoami: function () { outLine("", whoamiEl ? whoamiEl.textContent : "tomoya"); },
    clear: function () { history.textContent = ""; },
    echo: function () { outLine("", [].slice.call(arguments).join(" ")); },
    open: function (arg) { cmdCd(arg); }
  };

  /* ---- the loop ---- */

  var typed = [];
  var typedIdx = 0;

  function run(raw) {
    var line = raw.trim();
    echoCmd(line);
    if (!line) return;
    typed.push(line);
    typedIdx = typed.length;
    var args = line.split(/\s+/).filter(function (a) { return a[0] !== "-"; });
    var cmd = args.shift();
    if (cmd === "clear") return commands.clear();
    if (commands[cmd]) commands[cmd].apply(null, args);
    else outErr("zsh: command not found: " + cmd);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    run(input.value);
    input.value = "";
    form.classList.remove("has-text");
    input.scrollIntoView({ block: "nearest" });
  });

  input.addEventListener("input", function () {
    form.classList.toggle("has-text", input.value.length > 0);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp" && typedIdx > 0) {
      typedIdx--;
      input.value = typed[typedIdx];
      e.preventDefault();
    } else if (e.key === "ArrowDown" && typedIdx < typed.length) {
      typedIdx++;
      input.value = typed[typedIdx] || "";
      e.preventDefault();
    }
    form.classList.toggle("has-text", input.value.length > 0);
  });

  /* enhancement on: the idle line steps aside for the live one */
  if (idle) idle.hidden = true;
  form.hidden = false;
  if (hint) hint.hidden = false;
})();
