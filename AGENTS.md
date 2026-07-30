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

### 2. Self-made experiment HTML (self-contained pages) → `/experiments/<slug>/`

- Use this when publishing a finished static HTML page as-is (visualizations, demos, experiment outputs, etc.).
- Location: `/experiments/<slug>/index.html` (put related CSS/JS/images in the same folder).
- **Important: do not add front matter (a YAML block starting with `---`).**
  - Files without front matter are copied by Jekyll as-is, without Liquid processing, so the page renders exactly as written and is unaffected by the site theme (minima).
  - Adding front matter turns it into a Jekyll page, which will have the theme's layout applied and may break the page.
- Published URL: `https://t29mato.github.io/experiments/<slug>/`
- If a related verification article exists in `_posts`, link to this page from that article.

## Other notes

- The top page (`index.md`) is composed of `_includes/*.md` files (projects, publications, presentations, etc.). This portfolio section is independent from blog posts (`_posts`), so adding an article does not require touching these include files.
- The full post list is at `/blog/` (`blog.md`, `layout: home`), which auto-lists everything in `_posts`.
- GitHub Pages treats any markdown file as a Jekyll page by default (`jekyll-optional-front-matter`), and minima's header nav lists every page that has a title — so a repo-root `.md` file with a heading (like this one) will otherwise get built into a live page and show up in the nav. Because of this:
  - `_config.yml` has an explicit `header_pages:` list (currently just `blog.md`). Don't rely on the "show every page with a title" default — add new nav entries to this list deliberately.
  - `_config.yml` `exclude:` lists repo-root files that are for tooling/humans only, not site content (currently `AGENTS.md`). Add any future non-site markdown file here too.
