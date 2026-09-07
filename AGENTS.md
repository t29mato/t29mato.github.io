# AGENTS.md

This repository (`t29mato.github.io`) is a personal portfolio/blog site built with Jekyll + the minima theme. It is built and published as-is via GitHub Pages.

## Language rule

- All content added to this repository (blog posts, page copy, HTML experiment pages, commit-facing docs, etc.) must be written in **English**, regardless of the language used in the conversation/instructions.

## Rules for adding content

### 1. Verification / technical articles (Markdown) → `_posts/`

- Use Jekyll's standard blogging feature as-is.
- File name: `_posts/YYYY-MM-DD-slug.md`
- Example front matter:
  ```yaml
  ---
  layout: post
  title: "Article Title"
  date: 2026-07-31
  description: "Short summary of the article (shown in the Overview section of post.html)"
  tags: [tag1, tag2]
  ---
  ```
- `_layouts/post.html` already exists, so no new layout is needed.
- Only introduce a custom collection (e.g. `_verifications`) in `_config.yml` once the number of articles grows enough to warrant splitting by genre. Until then, use `_posts` only.

### 2. Self-made static HTML (self-contained pages)

- Use this when publishing a finished static HTML page as-is (visualizations, demos, animations, experiment outputs, etc.).
- **Important: do not add front matter (a YAML block starting with `---`).**
  - Files without front matter are copied by Jekyll as-is, without Liquid processing, so the page renders exactly as written and is unaffected by the site theme (minima).
  - Adding front matter turns it into a Jekyll page, which will have the theme's layout applied and may break the page.
- Pick the location by what the page is and where it's linked from:
  - Animated reconstructions/explainers listed on `/animations/` → `/animations/<slug>/index.html` (put related CSS/JS/video/images in the same folder).
  - Games listed on `/games/` that don't warrant an external deploy → `/experiments/<slug>/index.html`. Games that get their own build pipeline (e.g. deployed to Vercel) link out to that URL directly instead; `/experiments/` is for the ones that don't.
  - Anything else self-contained and not yet claimed by a showcase page (`/games/`, `/animations/`, `/tools/`) → `/experiments/<slug>/` as the default catch-all.
- Published URL: `https://t29mato.github.io/<location>/<slug>/`, matching wherever the file was placed above.
- If a related verification article exists in `_posts`, link to this page from that article.

## Keeping the homelab page current (`/homelab/`)

`/homelab/` publishes the state of the home cluster — four Mac minis, a
switch, and the laptop that drives them. It exists to be *updated*, not
written once, and the update is expected to be made by whichever Claude Code
session happens to be running in the lab when something actually changes.

### Where the truth lives

| File | What it is |
|---|---|
| `_data/homelab/inventory.json` | The single source of truth for the page: hosts, network, software stack, services, house rules. `homelab.md` renders it and holds no facts of its own. |
| `_data/homelab/changelog.json` | The `git log` block, newest first. One entry per real change. |
| `homelab/topology/index.html` | **The diagram. Hand-drawn, and a source file** — edit it directly. 19 KB of SVG laid out so no two copper runs cross, which is why it is not generated. `/homelab/` embeds this exact file. |
| `_scripts/check-topology.mjs` | Holds the drawing against the inventory, and re-checks the rules that made it publishable. Run it after touching either. Not site content; `_`-prefixed. |
| `assets/lab.js` | Points the `/homelab/` topology frame at that file with `?embed=1` and keeps its theme in step with the site toggle. |
| `homelab/spec/*.json`, `homelab/changes/*`, `_scripts/strip-webfont.mjs` | **Retired.** Left in place because dated changelog entries link to the delta pages and those URLs are published. Nothing regenerates them; nothing reads the spec. Do not update the spec to match a change — it is a record of what the diagram used to be built from. |
| `homelab/changes/<YYYY-MM-DD>/index.receipt.json` | Written by `compare` beside the delta. **Keep it** — it is the machine-readable count of what changed, plus the hashes it was computed from. Unlike the `visual-check` receipt, this one is provenance, not a test log. |

`_data/` is never published by Jekyll, so the inventory itself is not served.

The diagram opens the page, in an `<iframe>` pointed at
`/homelab/topology/?embed=1`. `embed=1` is its inline mode: it drops the
page's own heading and outer padding, because the parent already provides that
context. The same file stands alone at `/homelab/topology/`.

**It is drawn, not generated, and that is a trade with a cost.** A generated
diagram could not disagree with its source; this one can, and there is now a
live status band a few centimetres above it. A drawing that quietly said
`planned` about a host the band was calling `up` would be worse than no
drawing, because both look authoritative and only one is right. That is what
`_scripts/check-topology.mjs` exists to prevent — it reads the statuses back
out of the SVG and holds them against the inventory, and it fails on an
address, an external request or a missing theme hook while it is in there.

### The update loop

1. Edit `_data/homelab/inventory.json` to match reality, and bump
   `updated_at` to today.
2. Add one entry to the top of `_data/homelab/changelog.json`: `date`,
   `title`, `body`, and `delta` (a site path, or `null`).
3. If the *topology* changed — a host appeared, a link changed, something was
   added or removed — **edit `homelab/topology/index.html` by hand.** It is an
   SVG somebody laid out; there is no generator to re-run and no spec to edit
   first. Match what is already there: a node is a `<rect class="node ...">`
   plus its `<text class="id ...">`, a status word carries a `st-<status>`
   class, and copper drops leave the port strip at levels chosen so that no
   two runs cross. Keep that property — it is the reason this drawing exists
   rather than a generated one.

4. Run the check, always, whether you touched the drawing or only the
   inventory:

   ```bash
   node _scripts/check-topology.mjs
   ```

   It fails if a host's status differs between the two files, if a host is in
   one and not the other, if an address or an external request has appeared, or
   if the theme and embed hooks the parent page depends on have been lost.
   Those last ones are silent in the only theme you happened to be looking at,
   which is why a script asks and not a person.

**Look at it, in both themes and at a phone width.** There is no headless
Chrome on the minis, but there is a Firefox, and it screenshots without a
display — the snap confinement means the output path has to be inside `$HOME`,
which is the only trick to it:

```bash
B=file://$PWD/homelab/topology/index.html
MOZ_HEADLESS=1 firefox --screenshot ~/shots/dark.png  --window-size=1280,900 "$B?embed=1&theme=dark"
MOZ_HEADLESS=1 firefox --screenshot ~/shots/light.png --window-size=1280,900 "$B?embed=1&theme=light"
MOZ_HEADLESS=1 firefox --screenshot ~/shots/narrow.png --window-size=390,780 "$B?embed=1&theme=dark"
```

Passing checks say the file is well-formed; they say nothing about whether the
labels collide. That is a failure a person spots in five seconds and a test
suite passes over for years, so "the check is green" is never the sentence
that finishes a change to this drawing.

**At 390px the drawing scrolls sideways inside its own box rather than
reflowing.** That is the same thing `.lab-hosts` does with a wide table on this
site, and it is deliberate: losing the alignment would cost more than losing
the width.

### Rendering a page in a real browser, on a machine with no screen

The snap Firefox above is the short route and needs nothing installed. What it
will not do is write outside `$HOME`, which is confinement and not a bug — a
screenshot path under `/tmp` fails by hanging until it is killed, with no error
worth reading. That cost an afternoon once; put the output in `~/shots`.

A headless Chromium is the alternative when a page needs Chrome's engine
specifically, unpacked without root at `~/pw-deps/bin/chrome`.

Whichever engine: passing checks say a file is well-formed and say nothing
about what it looks like. Colliding labels, a drawing that overflows a laptop
viewport, a palette that only resolves in the theme the author was using — all
of these pass every check and are obvious in five seconds to anyone who opens
the page. "The check is green" is never the sentence that finishes a visual
change.

Two things about the order and the caveats:

- **Run it after `strip-webfont.mjs`, never before.** Removing the web font
  changes the typeface and therefore every text measurement, so a pass on the
  unstripped file says nothing about the file that gets published.
- The wrapper passes `--no-sandbox`, because Ubuntu 24.04 restricts
  unprivileged user namespaces through AppArmor and Chrome's zygote aborts
  without it. That is a real reduction in isolation, and it is acceptable only
  because what gets rendered is HTML this machine generated itself. Do not
  point that wrapper at the open web.
- `visual-check` writes PNGs, an `index.visual-check.json` and a contact-sheet
  HTML beside the page. **Delete all of them** — unlike the `compare` receipt,
  they are a test log, and the PNGs would otherwise be published.

If the wrapper is missing (a fresh mini), rebuild it without root:

```bash
mkdir -p ~/pw-deps && cd ~/pw-deps
apt-get download libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 \
  libatspi2.0-0t64 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libasound2t64 libcups2t64 libxkbcommon0 libpango-1.0-0 libcairo2 libxi6 \
  libxrender1 libavahi-common3 libavahi-client3 libxcb-render0 libxcb-shm0 \
  libpixman-1-0 libfribidi0 libthai0 libharfbuzz0b libdatrie1 libgraphite2-3
mkdir -p root && for d in *.deb; do dpkg -x "$d" root/; done
```

`dpkg -x` only unpacks; nothing is installed and no other user is affected.
Then `LD_LIBRARY_PATH` must name both `root/usr/lib/x86_64-linux-gnu` and
`root/lib/x86_64-linux-gnu`, which is what the wrapper script does.

**How many packages you need depends on which binary you run**, and the two
Playwright ships are not interchangeable:

| Binary | Direct libraries missing on a bare Ubuntu 24.04 | Packages needed |
|---|---|---|
| `chromium_headless_shell-*/…/headless_shell` | 12 | the first 17 above |
| `chromium-*/…/chrome` (full) | 16 | all 27 |

The full browser additionally links `libcairo`, `libpango` and `libcups`, and
those three drag in the whole second row of that list — pixman and the xcb
render/shm pair behind cairo, harfbuzz/fribidi/thai (and their own datrie and
graphite2) behind pango's text shaping, avahi behind cups. `headless_shell` is
built without them. So a list that works for one binary silently leaves the
other eight libraries short; check with `ldd <binary> | grep 'not found'`
rather than assuming.

On macOS, none of this applies: use the system Chrome.

### The live status band

`/homelab/` is hand-written and ships with the build, with one exception: the
band under the intro, which is the lab as it is right now.

| File | What it is |
|---|---|
| `api/status.js` | A Vercel serverless function. `POST` takes a heartbeat from one reporter inside the lab (bearer token); `GET` returns the merged public view. Excluded from the Jekyll build in `_config.yml` — without that, Jekyll copies it into `_site` and serves its source at the same path, which both publishes the source and shadows the function. |
| `assets/lab-status.js` | Reads that endpoint and renders the band. Polls every 15s, and only while the tab is visible. |
| `.lab-live*` in `assets/main.scss` | Its styles. `.lab-status` is shared with the hand-written tables below, so both use one vocabulary of states. |
| `status_endpoint:` in `_config.yml` | Where the band fetches from. Unset means "this origin", which is right on Vercel. **GitHub Pages has no serverless functions**, so a copy served from there needs the absolute Vercel URL here — otherwise the band reads a 404 as "the lab is unreachable", which is the wrong answer delivered convincingly. |

The other half does not live in this repo. `~/labstat/` on mini-1 is the
reporter: it queries that machine's Prometheus for host facts, asks systemd
about the user units Prometheus cannot see, and posts the result every minute.
Its `etc/labstat.conf` holds the ingest token at mode 600 and is never
committed. See `~/labstat/README.md` on that machine.

**It is pushed, never scraped, and that is the whole design.** A status view
served from inside the lab renders "the lab is unreachable" as a spinner: the
observer must not be inside the thing observed. So each host posts outward on
its own timer, the edge holds the last thing it said, and the page reads only
that. The house rule about inbound connections stays exactly true — nothing in
the lab accepts a connection and no port is forwarded.

**Absence is the signal.** Nothing has to report that a host died; its beat
stops. A reporter silent for three of its own intervals goes `stale`, and every
subject it was the sole observer of becomes `unknown` — deliberately not
`down`, because a dead observer is not evidence about what it was observing.
Where two reporters watch the same subject, a live observation beats a stale
one and the worse state wins, so a camera one host cannot reach is never
painted green by a host that can.

**pi-1 is the right primary reporter, once it exists.** The battery backs
gw-1, sw-1 and pi-1 and deliberately not the minis, so in a power cut pi-1 is
the only host still up with a network — it can report "power cut, minis down"
where a mini-based watchdog would just go silent along with everything else.

Known and unfixed: if the uplink or gw-1 goes, nothing can push, and from
outside that is indistinguishable from the whole lab being off. Closing it
needs a second observer outside the house. Until then the page says `unknown`,
which is the honest answer.

`vercel.json` sends `X-Robots-Tag: noindex` on everything it serves. The site
is published from GitHub Pages and this deployment is a second public copy of
it; `jekyll-seo-tag` already puts a canonical pointing at `t29mato.github.io`
on every page, but canonical is a hint and this is not. Only the Vercel copy is
affected — GitHub Pages never reads this file.

`vercel.json` also pins `"regions": ["hnd1"]`. The Upstash database is in Tokyo and
Vercel defaults functions to `iad1`, so without this every Redis command
crossed the Pacific and back — twice per read, because a view is `KEYS` then
`MGET`. It is not a comment-friendly file (the schema rejects unknown keys, so
that one line has to be explained here instead).

Environment, set in the Vercel project and nowhere in this repo:
`KV_REST_API_URL` and `KV_REST_API_TOKEN` (Upstash Redis REST), and
`HOMELAB_INGEST_TOKEN`, the shared secret every reporter sends.

### Working on this repo from more than one machine

Every mini gets its own clone, and more than one agent session may be awake at
once. Two rules keep that from hurting, and they follow from one observation:
**the only files here that cannot be merged are the ones that never needed to
be.**

**1. Whoever changes a host's status changes both files, in the same commit.**
The inventory and the drawing say the same thing twice, and a commit that
moves only one of them is how they start disagreeing. `check-topology.mjs` is
what stops that reaching main, but it only helps if it is run — and it is
cheaper to keep the pair together than to fix a split later.

The drawing is a normal text file now: it merges, and its conflicts are worth
reading. That is a change from when it was rendered, when the only correct
resolution was to throw the conflict away and re-render.

**2. Rebase, do not merge.**

```bash
git config pull.rebase true    # once per clone
git pull && git push
```

A merge commit for a one-line change to `inventory.json` buries the history
this page is partly for.

Prose and data — `AGENTS.md`, `_data/homelab/*.json`, the markdown pages — may
be edited from any machine. They are small and they merge. That matters more
than it sounds: agent memory is per-machine and does not travel, so anything a
session on one mini learns is lost unless it lands in this repo or in an issue.
A rule that stops other machines writing documentation would quietly throw away
the reason for having them.

If the generated pages ever become a real nuisance, the structural fix is to
stop committing them and render them in CI from `homelab/spec/`. That is a
bigger change than it looks — GitHub Pages would have to build from a workflow
rather than from the branch — and it is not worth doing before the pain is
real.

### What must never go on this page

The page is world-readable, and the lab is a home. None of the following
belongs in the inventory, the diagram, the changelog or the commit message:

- IP addresses, MAC addresses, real hostnames, SSID or router details. Hosts
  appear under logical names only (`mini-1`, `sw-1`, `air-1`, `gw-1`).
- The router's make, model or firmware version. Naming the switch is fine —
  an unmanaged switch has no address, no admin page and no firmware to
  attack. A router has all three, so its model is a shopping list of CVEs to
  try against whoever does get onto the LAN. Publish the role
  ("Wi-Fi 6 router"), never the product.
- Addressing values. Describing the *scheme* — DHCP reservations on the
  router, keyed to MAC — is useful and safe. The subnet, the ranges and the
  individual addresses are not.
- SSH configuration detail, public keys, tokens, or anything that names a
  remote-access path into the LAN.
- **Anything that answers "is anyone home right now".** This used to be
  written as a blanket ban on real-time resolution, and the live status band
  narrows it rather than lifting it — the reasoning was never about freshness,
  it was about occupancy, and freshness was standing in for it. What a machine
  is doing (up, down, disk, load, whether an upload succeeded) is about the
  hardware. **How recently a camera saw something is about a person**, so
  camera event recency and event counts are not published, and
  `api/status.js` enforces that with a field whitelist rather than leaving it
  to whoever writes the next reporter. The same test applies to anything added
  later: if the number changes because somebody walked through a room, it does
  not go on the endpoint. The hand-written parts of the page still state a date
  and still move in days, and during a long absence it is still better not to
  update them at all than to publish a fresher timestamp.
- Photographs that place the hardware in an identifiable home.

## Keeping the hikes page current (`/hikes/`)

`/hikes/` draws every recorded outing on a map and keeps the checklist of
Fukada's 100 famous mountains. Like `/homelab/`, it is rendered from data
files and holds no facts of its own.

The current state of the work — decisions taken, where the raw data is,
what is still open, and the tooling gotchas — is in `HIKES-HANDOFF.md` at
the repo root (excluded from the build). Read it before continuing.

### Where the truth lives

| File | What it is |
|---|---|
| `_gpx/{yamap,strava,yamareco}/*.gpx` | The raw exports, named `{date}_{title}_{id}.gpx` (Strava: `{date}_{Hike\|BCSki}_{title}_{id}.gpx`). **Git-ignored** and never published; the id in the name is what the service links are built from. Yamareco tracks are public at `https://www.yamareco.com/modules/yamareco/track-{id}.gpx` and need no login. |
| `_data/hikes/names.json` | Peak keyword -> English name and summit height. The build names an outing after the highest keyword found in its titles; an unnamed outing is listed by the build so an entry can be added. |
| `_data/hikes/hyakumeizan.json` | The 100 famous mountains with approximate summit points (from the tracks where a summit has been reached; `not` patterns stop `小仙丈ヶ岳` reading as `仙丈ヶ岳`). |
| `_data/hikes/strava-index.json` | Every Strava export by id/date/type, so a same-day outing gets its Strava link and sport even when that GPX is not on disk. |
| `_data/hikes/overrides.json` | Per-outing corrections (`sport`, `en`, `status`), keyed by outing id or date. Applied last. |
| `_data/hikes/outings.json` | **Generated.** The index Liquid renders. |
| `assets/hikes/tracks.json` | **Generated.** What the map fetches: simplified tracks, high points, elevation profiles, the 100 peaks with done/to-go. |

### The update loop

1. Drop the new export into `_gpx/<source>/` with the file name convention
   above. Nothing else needs a date bump: the build stamps `updated_at`.
2. `node _scripts/build-hikes.mjs` — no dependencies. Read its report:
   `UNNAMED` rows want a keyword in `names.json`; `SPORT GUESSED` rows are
   winter days without a Strava type, corrected in `overrides.json` if the
   guess is wrong; `PEAK MATCHED BY NAME BUT >800 m` means a summit point in
   `hyakumeizan.json` is off and should be moved to the track's high point.
3. Commit the two generated files with the data edits. The raw GPX stays out.

Sport is one of `hike` (walking, trekking, climbing), `ski` (printed as
`backcountry ski`) and `run` (printed as `trail run`). It comes from Strava's
`<type>` when the day has a Strava file or an index entry, from a `trail run`
word in the title, otherwise a winter day on a snow-country mountain is
guessed as backcountry ski and reported. The word is always `backcountry ski`, never
`ski`: a groomed slope is not a mountain. A title containing `撤退` marks the
day `turned back`, which draws the red ring and never credits a summit.

A famous mountain counts as done when a track passes within 500 m of its
summit point and reaches within 150 m of its height, or within 2.5 km when
the title names the peak. The page is the only place on this site that
fetches from a third party (OpenTopoMap tiles); `/privacy/` says so.

## Other notes

- The top page (`index.md`) is composed of `_includes/*.md` files (projects, publications, presentations, etc.). This portfolio section is independent from blog posts (`_posts`), so adding an article does not require touching these include files.
- The full post list is at `/blog/` (`blog.md`, `layout: home`), which auto-lists everything in `_posts`.
- GitHub Pages treats any markdown file as a Jekyll page by default (`jekyll-optional-front-matter`), and minima's header nav lists every page that has a title — so a repo-root `.md` file with a heading (like this one) will otherwise get built into a live page and show up in the nav. Because of this:
  - `_config.yml` has an explicit `header_pages:` list. Don't rely on the "show every page with a title" default — add new nav entries to this list deliberately.
  - `_config.yml` `exclude:` lists repo-root files that are for tooling/humans only, not site content (currently `AGENTS.md`). Add any future non-site markdown file here too.
