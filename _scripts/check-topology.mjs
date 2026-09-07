/*
 * Does the topology diagram still agree with the inventory?
 *
 * The diagram is hand-drawn now. That was the deliberate choice — the geometry
 * is tuned so that no two copper runs cross, and no generator was going to
 * arrive at it — but it costs the one thing a generated diagram gave for free:
 * it could not disagree with its source.
 *
 * `/homelab/` puts a live status band a few centimetres above this drawing. A
 * diagram that quietly said `planned` about a host the band was calling `up`
 * would be worse than having no diagram, because both would look authoritative
 * and only one would be right. So the drawing may be hand-made, but it is not
 * allowed to drift: this reads the statuses back out of the SVG and holds them
 * against `_data/homelab/inventory.json`.
 *
 * It also enforces the three rules that made this file publishable in the
 * first place, because those are exactly the things a later edit forgets:
 * no external request, no addresses, no front matter.
 *
 *     node _scripts/check-topology.mjs
 *
 * Exits non-zero and says what to fix. Not site content; `_`-prefixed, so
 * Jekyll never builds it.
 */

import { readFileSync } from "node:fs";

const DIAGRAM = "homelab/topology/index.html";
const INVENTORY = "_data/homelab/inventory.json";

const html = readFileSync(DIAGRAM, "utf8");
const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));

const problems = [];

/* ---------------------------------------------------------------- status --
 *
 * Read by position rather than from the authoring comments: a comment can be
 * updated while the picture is not, and it is the picture a reader believes.
 * Each node writes its id, then its status within the next few elements.
 */
function statusInDrawing(id) {
  const at = html.indexOf(`>${id}</text>`);
  if (at === -1) return null;
  const window = html.slice(at, at + 400);
  const m = window.match(/class="st-(\w+)"/);
  return m ? m[1] : null;
}

for (const host of inventory.hosts) {
  const drawn = statusInDrawing(host.id);
  if (drawn === null) {
    problems.push(`${host.id} is in the inventory but not in the diagram`);
  } else if (drawn !== host.status) {
    problems.push(
      `${host.id}: the inventory says "${host.status}", the diagram draws "${drawn}"`
    );
  }
}

/* A host removed from the inventory but left in the drawing is the same class
   of lie in the other direction. */
const known = new Set(inventory.hosts.map((h) => h.id));
for (const m of html.matchAll(/<text class="id[^"]*"[^>]*>([a-z][a-z0-9-]{1,15})<\/text>/g)) {
  if (!known.has(m[1])) {
    problems.push(`${m[1]} is drawn but is not in the inventory`);
  }
}

/* ------------------------------------------------------------ publishable --
 *
 * Every other page on this site makes no third-party request on load, and the
 * one page that is about not leaking anything is not going to be the
 * exception. w3.org appears in SVG namespace declarations and is never
 * fetched.
 */
const external = [...html.matchAll(/https?:\/\/[^"' )]+/g)]
  .map((m) => m[0])
  .filter((u) => !u.startsWith("http://www.w3.org/"));
if (external.length) {
  problems.push(`external requests: ${[...new Set(external)].join(", ")}`);
}

/* The disclosure rule, mechanically. Describing the addressing scheme is safe
   and useful; the values are not. */
for (const [what, re] of [
  ["an IP address", /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  ["a MAC address", /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/i],
  /* No separate rule for a subnet. A real one carries an address, so the rule
     above already catches it — and a bare /nn matches `font: 14px/1.5`, which
     is how the first version of this check failed on a file that was clean. */
]) {
  const hit = html.match(re);
  if (hit) problems.push(`${what} appears in the diagram: ${hit[0]}`);
}

/* Front matter would turn this into a Jekyll page, wrap it in the site layout
   and break it. It is served as-is precisely because it has none. */
if (html.startsWith("---")) {
  problems.push("front matter is present — Jekyll would apply the theme layout");
}

/* The parent page hands the theme in two ways and sets it a third time later.
   Losing any one of them looks fine in whichever theme the author was using. */
for (const [what, re] of [
  ["?theme=", /["']theme["']/],
  ["data-theme", /data-theme/],
  ["a MutationObserver for a later theme change", /MutationObserver/],
  ["?embed=1", /embed/],
]) {
  if (!re.test(html)) problems.push(`the diagram no longer honours ${what}`);
}

if (problems.length) {
  console.error(`${DIAGRAM} disagrees with ${INVENTORY}:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nThe inventory is the source of truth. Edit the diagram to match it."
  );
  process.exit(1);
}

console.log(
  `${DIAGRAM}: ${inventory.hosts.length} hosts, all agreeing with the inventory; ` +
    "no external request, no addresses, theme and embed hooks intact."
);
