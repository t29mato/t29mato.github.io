#!/usr/bin/env node
/**
 * Strip the Google-Fonts <link>s out of an archify-generated diagram page.
 *
 * Archify loads JetBrains Mono from fonts.googleapis.com. Every other page on
 * this site is set in the visitor's own system monospace and makes no
 * third-party request; a diagram page that quietly calls Google on load would
 * be the only exception, on the one section of the site that is explicitly
 * about not leaking anything about a home network.
 *
 * Removing the links is safe: archify's font-family already ends in a full
 * system-monospace fallback, the load was async and non-blocking anyway, and
 * image export uses local()-only @font-face rules that never touch the
 * network. The page simply renders in the same face as the rest of the site.
 *
 * Two encodings have to be handled. A `deliver`ed page carries the links as
 * ordinary markup. A `compare` delta page carries the before/after snapshots
 * inside `<iframe srcdoc="...">`, where the same links are HTML-escaped — and
 * they are just as live once the browser parses that srcdoc, so the escaped
 * copies have to go too.
 *
 * Run this after every `archify deliver` and `archify compare`. It is
 * idempotent, and exits non-zero if a file still references a web font
 * afterwards, so an upstream template change is noticed rather than skipped.
 *
 *   node _scripts/strip-webfont.mjs homelab/topology/index.html
 */
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node _scripts/strip-webfont.mjs <file.html> [...]");
  process.exit(2);
}

const FONT_HOST = String.raw`fonts\.(?:googleapis|gstatic)\.com`;

const PATTERNS = [
  // <link ... fonts.googleapis.com ...> — the attribute list may wrap lines.
  new RegExp(String.raw`[ \t]*<link\b[^>]*${FONT_HOST}[^>]*>\n?`, "g"),
  // The same element, escaped inside an iframe srcdoc.
  new RegExp(String.raw`[ \t]*&lt;link\b(?:(?!&gt;)[\s\S])*?${FONT_HOST}(?:(?!&gt;)[\s\S])*?&gt;\n?`, "g"),
  // Whatever <noscript> wrapper is left behind once its only child is gone.
  /[ \t]*<noscript>\s*<\/noscript>\n?/g,
  /[ \t]*&lt;noscript&gt;\s*&lt;\/noscript&gt;\n?/g,
];

const stillReferences = (text) => new RegExp(FONT_HOST).test(text);

let failed = false;
for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const pattern of PATTERNS) after = after.replace(pattern, "");

  if (stillReferences(after)) {
    console.error(`${file}: a web-font reference survived the strip — check the archify template`);
    failed = true;
    continue;
  }
  if (after === before) {
    console.log(`${file}: already clean`);
    continue;
  }
  writeFileSync(file, after);
  console.log(`${file}: stripped (${before.length - after.length} bytes)`);
}
process.exit(failed ? 1 : 0);
