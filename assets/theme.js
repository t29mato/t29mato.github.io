/*
 * Light/dark switch.
 *
 * The head has already applied any saved choice before paint; this file only
 * handles the button. Three states exist and they are not the same thing:
 *
 *   no data-theme attribute  — follow the OS (prefers-color-scheme)
 *   data-theme="dark"        — the reader chose dark, whatever the OS says
 *   data-theme="light"       — the reader chose light, whatever the OS says
 *
 * Pressing the button always writes an explicit choice, because someone who
 * reaches for it is telling us the automatic answer was wrong.
 */
(function () {
  var root = document.documentElement;
  var button = document.getElementById("theme-toggle");
  if (!button) return;

  var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");

  function current() {
    var set = root.getAttribute("data-theme");
    if (set === "dark" || set === "light") return set;
    // No choice saved. The stylesheet treats dark as the base and only goes
    // light when the OS explicitly asks for it, so mirror that here.
    return systemDark && systemDark.matches === false ? "light" : "dark";
  }

  function describe(theme) {
    var next = theme === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", "Switch to " + next + " theme");
    button.setAttribute("title", "Switch to " + next + " theme");
    // Used by CSS to decide which of the two icons to show.
    button.setAttribute("data-theme-state", theme);
  }

  describe(current());

  button.addEventListener("click", function () {
    var next = current() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch (e) {
      /* storage unavailable — the choice just will not survive the page */
    }
    describe(next);
  });

  // If the reader never chose, keep following the OS when it changes.
  if (systemDark && systemDark.addEventListener) {
    systemDark.addEventListener("change", function () {
      if (!root.getAttribute("data-theme")) describe(current());
    });
  }
})();
