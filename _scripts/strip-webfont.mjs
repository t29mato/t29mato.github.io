#!/usr/bin/env node
/**
 * Strip the Google-Fonts <link>s out of an archify-delivered diagram page.
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
 * Run this after every `archify deliver` / `archify compare`. It exits
 * non-zero if it matches nothing, so an upstream template change is noticed
 * rather than silently skipped.
 *
 *   node _scripts/strip-webfont.mjs homelab/topology/index.html
 */
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node _scripts/strip-webfont.mjs <file.html> [...]");
  process.exit(2);
}

const PATTERNS = [
  /[ \t]*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com"[^>]*>\n?/g,
  /[ \t]*<link href="https:\/\/fonts\.googleapis\.com\/[^"]*"[\s\S]*?>\n?/g,
  /[ \t]*<noscript>\s*<link href="https:\/\/fonts\.googleapis\.com\/[^"]*"[^>]*>\s*<\/noscript>\n?/g,
];

let failed = false;
for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const pattern of PATTERNS) after = after.replace(pattern, "");

  if (after === before) {
    console.error(`${file}: no web-font links found — check the archify template`);
    failed = true;
    continue;
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(after)) {
    console.error(`${file}: a web-font reference survived the strip`);
    failed = true;
    continue;
  }
  writeFileSync(file, after);
  console.log(`${file}: stripped (${before.length - after.length} bytes)`);
}
process.exit(failed ? 1 : 0);
