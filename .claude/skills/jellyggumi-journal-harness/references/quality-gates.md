# Quality Gates

| Gate | PASS | Failure response |
|---|---|---|
| GT Trend value | Raw KR Trends snapshot is no more than six hours old and hash-bound; selected row, researched candidate and allowed pillar match; independent reviewer confirms relevance, durable value and trend-not-thesis | reject without drafting/publishing |
| G1 Novelty | Distinct entity and reader intent; no high-overlap title/section set | update an existing article or reject |
| G2 Primary evidence | At least one direct authority/operator source | reject |
| G3 Claim coverage | Every material claim mapped; no unverified assertion in prose | fix, max two loops |
| G4 Persona honesty | Experience mode obeyed; every first-person observation has an owner anchor | reject fabricated experience |
| G5 Non-commodity value | At least one useful distinction, contradiction or decision beyond paraphrase | fix or reject |
| G6 Assets | 1672×941 hero, 700×394 thumbnail, JPEG, no EXIF/IPTC/XMP, visible AI method disclosure; plus 4–12 rights-clear source images validated against `source-image-manifest.json` and embedded in attribution figures | fix or block |
| G7 Date safety | KST date-only midnight is safely in the past | block |
| G8 Taxonomy | Exact category and tags have existing stub pages | fix |
| G9 Package | Complete front matter, bare balanced HTML, one ad marker, sources, local assets and links resolve | fix or block |
| G10 Independent review | Evidence editor PASS and deterministic package validation PASS | fix or reject |
| G11 Diff scope | Exactly the derived package — one post, two matching AI covers and 4–12 validated source images; approved manifest for staging | block |
| G12 Deployment | Remote SHA, Pages success, anonymous article returns 200 and every cover and source image returns 200 with the correct content type and exact bytes | not published |

## Trend qualification

Google Trends supplies candidates, not claims. Preserve the raw feed hash and normalized timestamps, then reject off-audience clusters, celebrity/sports-only interest, accidents/crime, partisan topics, medical or financial advice, rumours and query variants. A selected topic must still deserve a guide if its search spike disappears tomorrow, and every factual sentence must come from the normal evidence hierarchy.

## Novelty

Machine similarity is a warning boundary, not semantic truth. The validator compares normalized title and `<h3>` vocabulary against existing guides. The editor still decides whether the entity, reader task and thesis are genuinely distinct.

Do not create query variants or substantially similar doorway pages. When current evidence improves an existing guide, recommend an update outside the scheduled publication scope.

## Evidence and freshness

- T0: Korean public authority or institutional primary source.
- T1: operator of record.
- T2: credible press used for context after upstream verification.
- T3: blogs, social and forums as leads only.

Policy and institutional statistics should normally be checked within 24 months. Operator rules, fares, prices and hours must be rechecked at draft time and described with the checked date. A more recent operator page overrides an older summary.

## Persona honesty

`experience_mode: sourced-only` forbids first-person experience claims. `anchored-observation` requires an exact published JellyGGumi URL or owner record in the evidence pack and may not expand beyond it.

An unsupported `I`, `we`, `my` or `our` claim is a hard trust failure. It does not become acceptable through softer wording.

## Image gate

The hero is 1672×941, wider than 1200 pixels, 16:9 and large enough for Discover. The thumbnail is 700×394. Both must be real JPEGs and have no EXIF, IPTC or XMP segments. The prompt excludes people, faces, brands, logos and readable text. The art is a non-documentary still life.

The site-level validator also checks that post heroes are real `<img>` elements, `og:image` derives from `header-img`, and `max-image-preview:large` remains enabled.

## Source image licensing gate

Every new automated package embeds 4–12 distinct source-derived raster images downloaded from inspected reference materials into `img/source/<slug>/`; the AI cover pair does not count. Rights are verified fail-closed in `draft/source-image-manifest.json`: only `public-domain`, `cc0`, `cc-by`, `cc-by-sa`, `kogl-type-1`, `repo-license-covers-assets` (with a pinned ref) and `official-press-kit` are accepted, each with a license URL, a ≥ 40 character license quote, an evidence-pack source page, unique paths/hashes/download URLs, `commercial_use_allowed: true`, `redistribution_allowed: true` and a non-empty `.png`/`.jpg`/`.jpeg`/`.webp` regular file no larger than 5 MiB with valid raster structure, EXIF/XMP/text metadata stripped, a ≥32 px short side and ≥16,384 pixels; all source images combined stay no larger than 20 MiB. Each image appears in exactly one top-level, visibly rendered `<figure class="post-photo source-image">` whose caption carries the exact source page URL, license URL, publisher/creator and attribution text. Fewer than four or more than twelve rights-clear images blocks the package. Pre-cutover automated packages without source figures remain migration-exempt. A `content_type: guide` post with a disclosed `img/editorial/<slug>` cover dated 2026-08-31 or later must ship the complete slug-bound source directory and 4–12 credited figures; any source package also triggers the full figure/file bijection.

## Package gate

The body is a bare HTML fragment. It must contain paragraphs and section headings, no Markdown headings, links, images, reference links, lists, blockquotes or code fences, and exactly one `<!--post-ad-break-->` between complete sections. The allowlist is `p`, `h3`, `ul`, `ol`, `li`, `figure`, `figcaption`, `blockquote`, `a`, `strong`, `em`, `span` and `br`; only conservative language/link attributes are allowed. The single exception is the scoped source-image figure: a local `/img/source/<slug>/` `<img>` with exactly `src`, `alt`, `width`, `height`, `loading="lazy"` and `decoding="async"` inside `<figure class="post-photo source-image">`. All other `img` markup, remote sources, Markdown images and style/event attributes remain forbidden. Liquid, kramdown extension/IAL syntax, Markdown constructs, event/style attributes, executable/embed/form/media/document tags and non-HTTP(S)/root/fragment link targets are blocked. Supported structural tags must balance and nest.

Front matter must identify the AI method, current review date, exact dimensions, source list and `content_type: guide`. The category and tags must match existing stubs. Every local image and internal `/journal/` link must resolve.

## Search-quality language

Reject sensational or manipulative title patterns such as `ultimate`, `shocking`, `secret`, `unbelievable`, `must-see`, `best ever`, or promises that the body cannot support. No fake freshness, arbitrary content quotas, machine translation or stitched summaries.

There is no Google-preferred word count. The validator catches skeletal packages but the editor must reject padding and repetitive prose.

## Publication gate

A ready draft is not yet authorized. The review includes a combined SHA-256 over the exact post, both AI cover files and every validated source-image byte, plus the current git base and approval context, including the machine policy. Authority is either an exact manual confirmation reference or the active `standing-routine:h78L2R0UJFRhjS9O` reference under the matching two-key policy. After authority is bound, validation must be regenerated; any byte, base or render-context change invalidates the artifact digest. The no-overwrite apply tool refuses existing targets. Staged verification requires local `gh-pages` to equal its fetched upstream, every derived package path to be a newly added `100644` file, and staged blobs to byte-match the authority-bound package. A push remains unproven until `tools/verify-deployment.mjs` independently confirms the matching Pages run, anonymous title/body and exact image bytes and writes its hash-bound no-overwrite proof.
