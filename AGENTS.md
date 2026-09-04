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
| `homelab/spec/current.architecture.json` | The archify source for the topology diagram. Published as-is next to the diagram. |
| `homelab/spec/history/<YYYY-MM-DD>.architecture.json` | The spec as it stood before a change, kept so a delta can be computed. |
| `homelab/topology/index.html` | Generated. Never hand-edit — regenerate it. `/homelab/` embeds this exact file, so regenerating it updates the page with nothing to edit in the markup. |
| `assets/lab.js` | Points the `/homelab/` topology frame at that file in archify's `?embed=1` mode and keeps its theme in step with the site toggle. |
| `_scripts/strip-webfont.mjs` | Post-processing for the two generated pages above. Not site content; `_`-prefixed, so Jekyll never builds it. |
| `homelab/changes/<YYYY-MM-DD>/index.html` | Generated delta for one dated change, when there was a topology change worth showing. |
| `homelab/changes/<YYYY-MM-DD>/index.receipt.json` | Written by `compare` beside the delta. **Keep it** — it is the machine-readable count of what changed, plus the hashes it was computed from. Unlike the `visual-check` receipt, this one is provenance, not a test log. |

`_data/` is never published by Jekyll, so the inventory itself is not served;
the architecture spec under `homelab/spec/` is, deliberately — it is the
diagram's source and contains nothing that is not already on the page.

The diagram opens the page, in an `<iframe>` pointed at
`/homelab/topology/?embed=1`. `embed=1` is archify's own inline mode: it
drops the viewer's cards and guided-view rail, which is what we want, because
that supporting detail is already on the page as `stack.txt` and `RULES`.
The full viewer, cards and all, stays one click away at `/homelab/topology/`.

### The update loop

1. Edit `_data/homelab/inventory.json` to match reality, and bump
   `updated_at` to today.
2. Add one entry to the top of `_data/homelab/changelog.json`: `date`,
   `title`, `body`, and `delta` (a site path, or `null`).
3. If the *topology* changed — a host appeared, a link changed, a component
   was added or removed — copy the previous spec into history first, then
   edit the current one:

   ```bash
   cp homelab/spec/current.architecture.json \
      homelab/spec/history/<previous-updated_at>.architecture.json
   # ...now edit homelab/spec/current.architecture.json...
   ```

4. Validate, then regenerate the diagram. Both commands run from the archify
   skill directory (`~/.agents/skills/archify`, installed with
   `npx skills add tt-a1i/archify -g`):

   ```bash
   cd ~/.agents/skills/archify
   node bin/archify.mjs validate architecture <repo>/homelab/spec/current.architecture.json --quality showcase --json
   node bin/archify.mjs deliver  architecture <repo>/homelab/spec/current.architecture.json <repo>/homelab/topology/index.html --quality showcase --json
   ```

   Showcase acceptance means all 9 checks pass with 0 errors and 0 warnings.
   Anything less is not ready to publish. The optional
   `node bin/archify.mjs visual-check <output.html>` needs a local Chrome or
   Chromium and writes an `index.visual-check.json` receipt beside the page —
   delete that receipt, it is not site content.

   Then, back in the repo, strip the web font archify links in. Every other
   page on this site is set in the visitor's own monospace and makes no
   third-party request; a diagram page calling Google on load would be the
   only exception, on the one section that is about not leaking anything:

   ```bash
   node _scripts/strip-webfont.mjs homelab/topology/index.html
   ```

   The script exits non-zero if it matches nothing, so an upstream template
   change gets noticed. Re-run `node bin/archify.mjs check <output.html>`
   afterwards — it should still report 9/9.

5. Only if the topology changed, generate the delta and point the changelog
   entry's `delta` at it:

   ```bash
   node bin/archify.mjs compare architecture \
     <repo>/homelab/spec/history/<previous>.architecture.json \
     <repo>/homelab/spec/current.architecture.json \
     <repo>/homelab/changes/<today>/index.html --quality showcase --json
   ```

   Strip the web font from the delta page too:
   `node _scripts/strip-webfont.mjs homelab/changes/<today>/index.html`. A
   delta page carries its before/after snapshots inside `<iframe srcdoc>`,
   where the font links are HTML-escaped but just as live; the script handles
   both encodings and is safe to re-run.

   A delta page is ~2 MB, so generate one for a real structural change and
   not for a wording fix.

   History snapshots are per publishing *day*, not per edit — and so are
   deltas. Several changes on the same day may each get their own changelog
   entry, but they share one delta page: re-run the same `compare`, with the
   same base, over the updated spec, and point every topology-touching entry
   from that day at it. The reader still gets an honest "what changed today",
   and the repo does not collect a 2 MB page per edit.

**Component and connection ids are permanent.** `compare` matches on
`components[].id` and `connections[].id`, so renaming an id reads as "one
thing removed, another added". Give every connection an explicit `id`, and
retire an id rather than reusing it for something else.

### Checking a generated page in a real browser

On the Ubuntu minis there is a headless Chromium, installed without root, at
`~/pw-deps/bin/chrome`. Point archify at it:

```bash
export ARCHIFY_CHROME="$HOME/pw-deps/bin/chrome"
node bin/archify.mjs visual-check <output.html> --json
```

This is the check that catches what `validate` cannot: whether the page
actually fits a laptop screen. It found `scrollHeight 1221` against a 900px
viewport once, which no amount of composition checking would have reported.

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
- Anything with real-time resolution. The page states a date and moves in
  days; it is not a live dashboard, because "what is up right now" is also
  "whether anyone is home right now". During a long absence, do not update
  it at all rather than publishing a fresher timestamp.
- Photographs that place the hardware in an identifiable home.

## Other notes

- The top page (`index.md`) is composed of `_includes/*.md` files (projects, publications, presentations, etc.). This portfolio section is independent from blog posts (`_posts`), so adding an article does not require touching these include files.
- The full post list is at `/blog/` (`blog.md`, `layout: home`), which auto-lists everything in `_posts`.
- GitHub Pages treats any markdown file as a Jekyll page by default (`jekyll-optional-front-matter`), and minima's header nav lists every page that has a title — so a repo-root `.md` file with a heading (like this one) will otherwise get built into a live page and show up in the nav. Because of this:
  - `_config.yml` has an explicit `header_pages:` list. Don't rely on the "show every page with a title" default — add new nav entries to this list deliberately.
  - `_config.yml` `exclude:` lists repo-root files that are for tooling/humans only, not site content (currently `AGENTS.md`). Add any future non-site markdown file here too.
