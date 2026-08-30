# JellyGGumi Journal

Source for **[jellyggumi.github.io](https://jellyggumi.github.io)** — a Jekyll site with two
halves: first-hand guides to Korean culture, food and daily life written for visitors and
newcomers, and a family growth diary for INa (Jelly GGumi), born in South Korea on 6 June 2024.

Built on the [photorama](https://github.com/sunbliss/photorama) Jekyll theme, which is in turn
based on [Clean Blog](https://github.com/BlackrockDigital/startbootstrap-clean-blog-jekyll).
This README describes *this* site; the upstream theme's own setup notes do not apply here and
in places contradict this configuration.

---

## Layout

```
_posts/             source-checked guides and dated family records
_layouts/           default, page, post, home, journal_by_category, journal_by_tag
_includes/          head, nav, shared post card, disclosures, ads, footer, …
journal/            main, guide and family indexes, archive, and category/tag stubs
gallery/            album index plus one page per album
games/              games index; games/castle-war/ is a standalone canvas app
img/postcover/      semantic post covers plus matching .thumb.webp thumbnails
img/editorial/       labelled AI-generated still lifes for navigation and selected guide headers
img/source/         licensed source-derived reference images, one folder per guide slug
css/site.css        additions and corrections layered over the theme's main.css
tools/make_covers.py  regenerates the generated post covers
```

## Local build

There is no Gemfile; the site is published by GitHub Pages from the `gh-pages` source branch. To preview
locally you need `jekyll` and `jekyll-paginate`:

```sh
gem install jekyll jekyll-paginate
jekyll serve            # http://localhost:4000
```

`jekyll-paginate` is required. Without it `paginator` is nil and `/journal/` renders with no
posts — GitHub Pages loads it from its own plugin whitelist, so that failure only shows up
locally.

## Writing a post

Put a file in `_posts/` named `YYYY-MM-DD-Title-In-Kebab-Case.md`. Front matter:

```yaml
---
layout: "post"
title: "Title Case Headline"
subtitle: "One clarifying line"
description: "A standalone sentence of roughly 120-155 characters. Required — it becomes the
meta description, the Open Graph description and the search-result snippet."
active: "journal"
image:
  feature: "semantic-cover-name.jpg"
date: "2026-06-06"
header-img: "img/postcover/semantic-cover-name.jpg"
comments: false
tags: [Food, Seoul]
categories: [Food & Dining]
reviewed: "2026-08-29"
lastmod: "2026-08-29"
ai_assisted: true
content_type: guide
sources:
  - label: "Primary source title"
    publisher: "Responsible organisation"
    url: "https://example.gov/official-page"
sitemap:
  changefreq: monthly
  priority: 0.8
---
```

The body is a **bare HTML fragment**: no `<html>`, `<head>`, `<body>`, `<section>` or wrapper
`<div>`. The layout supplies the document and the reading column, and it renders `title` as the
page `<h1>` — so the body should not repeat the title as a heading.

### Taxonomy

Categories and tags are fixed sets. Adding a new one means adding a matching stub page, or its
archive URL 404s:

- category → `journal/category/<slug>.md` with `layout: journal_by_category` and `category:`
- tag → `journal/tag/<slug>.md` with `layout: journal_by_tag` and `tag:`

Current categories: `Cultural Tips`, `Food & Dining`, `Travel & Transport`, `Daily Life`,
`Family Diary`.

## Images

Post covers live in `img/postcover/`. New covers use semantic filenames and are normally
1200×674 or larger; legacy `pcNNN.jpg` assets remain valid. Every `image.feature` file needs a
matching basename ending in `.thumb.webp` for card grids. Gallery photographs are capped at
2048px on the long edge with a 700px `.thumb.webp` beside each one; grids load the thumbnail
and the lightbox loads the full file.

`tools/make_covers.py` regenerates the legacy graphic covers. It is deterministic — seeded per
filename — and asserts two things per cover: the headline region stays dark enough for white
text (≥4.5:1) and the motif region stays bright enough to be visible. Editorial still lifes in
`img/editorial/` are separate, visibly disclosed assets and must not be presented as family
documentary photographs. When a post sets `card-img` to an editorial `.jpg`, keep a 700×394
sibling named `.thumb.jpg`; listing cards load that smaller file while article headers and social
metadata keep the full image.

New automated guides additionally embed 4–12 licensed source-derived reference images
under `img/source/<slug>/` (`.png`, `.jpg`, `.jpeg` or `.webp`). Each is downloaded from an
inspected reference page, rights-verified in the run's internal
`_workspace/current/draft/source-image-manifest.json` sidecar, and rendered in exactly one
`<figure class="post-photo source-image">` with a caption naming the source page, license URL,
publisher and attribution. These are documentary reference images and are separate from the
disclosed AI covers in `img/editorial/`.

## Editorial agent harness

The file-based Korea Desk harness lives under `.claude/`; `.agents/skills/` contains thin
compatibility entries for other agent runtimes. `CLAUDE.md` is the canonical safety and
publication contract, while `PERSONA.md` separates observed, explained and sourced prose.
Scheduled automation may create and, only when every gate is green, publish one new `guide` package. It never invents or automates a family
record.

The live run is always `_workspace/current/`. Starting the next run first verifies every old
SHA-256 archive manifest and separate read-only `_workspace/archive-seals/` anchor, then moves a closed prior current run to `_workspace/archive/<run-id>/`; no populated run
is deleted. A `ready_for_review` run remains current and blocks the next scheduled start until a human resolves or explicitly archives it. Each current run has a `.run-lock.json` ownership marker; status commands must name the same run id, so a stale worker cannot mutate a newer run. The whole workspace is gitignored and excluded from Jekyll.

```sh
node tools/test-editorial-gates.mjs
node tools/validate-harness.mjs
node tools/verify-site-quality.mjs
node tools/editorial-workspace.mjs start \
  --run-id 20260831-0100-korea-desk \
  --target-date 2026-08-31
node tools/editorial-workspace.mjs verify-archives
# Inside an active run:
node tools/capture-google-trends.mjs
# After the one approved commit has been pushed:
node tools/verify-deployment.mjs
```

The active Aside cron routine `h78L2R0UJFRhjS9O` runs at 01:00 KST. It uses the official Korea Google Trends RSS feed only to discover candidates, then searches Korean institutions and operators for evidence. A run may publish zero or one validated `guide`: `publish-on-green` is authorized only when the matching `standing_publish_approval: true` key, pinned routine id, trend-value gate, G1-G11 and exact-path checks all pass. Draft-only mode and manual review remain supported fail-closed fallbacks. Every article is a derived package of new paths — one post, its two AI cover files and 4–12 licensed source images — in one commit and one push; never use `git add -A`.

## Notes for future changes

- `baseurl` is `""`, not `"/"`. A bare `"/"` makes every `| prepend: site.baseurl` produce a
  doubled slash, and `//css/main.css` is a protocol-relative URL pointing at a host named `css`.
- Use `| relative_url` rather than prepending `site.baseurl` by hand.
- An empty string is truthy in Liquid. `{% if page.title %}` is true for `title: ""`; compare
  against `""` instead.
- Escape taxonomy names on output. `Food & Dining` contains a literal ampersand, which is
  invalid unescaped in both text and attribute values.
- Per-page stylesheets go in front matter as `extra_css:`, not as a `<link>` in the body.
- Liquid parses tags inside `{% comment %}` blocks, so a literal `{% … %}` in a comment is a
  syntax error.

## License

The MIT License (MIT)

Copyright (c) 2014 Filippo Oretti, Dario Andrei

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Photographs in `gallery/` and `img/` are family photographs and are not covered by the above
licence. Please ask before reusing them.
