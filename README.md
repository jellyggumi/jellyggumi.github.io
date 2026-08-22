# JellyGGumi Growth Diary

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
_posts/             the 21 guides and diary entries
_layouts/           default, page, post, home, journal_by_category, journal_by_tag
_includes/          head, nav, footer, breadcrumbs, share, signoff, subgallery, …
journal/            index, archive, and the category/ and tag/ stub pages
gallery/            album index plus one page per album
games/              games index; games/castle-war/ is a standalone canvas app
img/postcover/      post cover images (pc*.jpg) and their .thumb.webp thumbnails
css/site.css        additions and corrections layered over the theme's main.css
tools/make_covers.py  regenerates the generated post covers
```

## Local build

There is no Gemfile; the site is built by GitHub Pages from the default branch. To preview
locally you need `jekyll` and `jekyll-paginate`:

```sh
gem install jekyll jekyll-paginate jekyll-sitemap
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
  feature: "pc101.jpg"
date: "2026-06-06"
header-img: "img/postcover/pc101.jpg"
comments: false
tags: [Food, Seoul]
categories: [Food & Dining]
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

Post covers live in `img/postcover/` as `pcNNN.jpg` at 1375×675, each with a generated
`pcNNN.thumb.webp` used by the journal card grid. Gallery photographs are capped at 2048px on
the long edge with a 700px `.thumb.webp` beside each one; grids load the thumbnail and the
lightbox loads the full file.

`tools/make_covers.py` regenerates the generated covers. It is deterministic — seeded per
filename — and asserts two things per cover: the headline region stays dark enough for white
text (≥4.5:1) and the motif region stays bright enough to be visible.

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
