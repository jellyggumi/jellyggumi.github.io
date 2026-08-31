# Artifact Contract

## Current run

`_workspace/current/` is the only writable run and must contain:

```text
manifest.json
tasks.json
research/google-trends-kr.xml
research/trend-signal.json
research/candidate-set.json
research/existing-coverage.json
research/authority-brief.json
evidence/evidence-pack.json
evidence/source-map.md
draft/_posts/YYYY-MM-DD-Title-In-Kebab-Case.md
draft/img/editorial/<slug>.jpg
draft/img/editorial/<slug>.thumb.jpg
draft/img/source/<slug>/<reference-image>.(png|jpg|jpeg|webp)   # 4–12
draft/claim-map.json
draft/image-provenance.json
draft/source-image-manifest.json
review/editorial-review.json
validation/draft-validation.json
validation/validation.json
validation/path-scope.txt
messages/
run-summary.md
```

A no-draft run may omit draft, review and package-validation files, but must preserve its candidate search, rejection reason and run summary.

## Archive integrity

Each populated prior run is moved, never deleted, and receives `ARCHIVED.md` plus `archive-manifest.json`. The manifest lists every archived file with byte length and SHA-256. A separate read-only `_workspace/archive-seals/<archive>.sha256` anchors the manifest itself. Archived files/directories and anchors are write-protected. Future starts verify content, manifest anchors and orphan anchors before moving another run.

## Manifest schema

Required fields:

- `schema_version`: `1`
- `run_id`
- `started_at_kst`
- `target_date`
- `mode`: `draft-only | publish-on-green`
- `status`: `researching | drafting | reviewing | ready_for_review | approved | published | rejected | blocked`
- `topic`, `slug`, `thesis`
- `content_type`: `guide`
- `experience_mode`: `sourced-only | anchored-observation`
- `observation_anchor`: nullable in sourced-only mode, required object in anchored-observation mode
- `category`
- `tags`
- `article_path`
- `asset_paths`: exact AI full and thumbnail cover paths (always two elements)
- `reference_image_paths`: 4–12 unique `img/source/<slug>/` raster paths, separate from `asset_paths`
- `revision_loops`: integer 0..2
- `publication_requires_confirmation`: `true` only in `draft-only`; `false` only in the pinned `publish-on-green` mode
- `standing_publish_routine_id`: `h78L2R0UJFRhjS9O` in `publish-on-green`, otherwise null
- `approval_ref`: `aside-confirmation:<id>` or `human-review:<id>` only for `draft-only`; the exact `standing-routine:h78L2R0UJFRhjS9O` only for `publish-on-green`
- `ready_artifact_sha256`: combined digest of the exact package bytes, git base and render context at ready state
- `ready_package_sha256`, `ready_render_context_sha256`, `ready_base_sha`: component hashes/commit behind that digest
- `approval_artifact_sha256`: the same combined digest bound to exact manual or pinned standing authority
- `approval_package_sha256`, `approval_render_context_sha256`, `approval_base_sha`: approval-bound components
- `run_lock_id`: random id mirrored in `_workspace/current/.run-lock.json`; every mutation also supplies the current `--run-id`
- `gates`: exact `G1` through `G11` PASS verdict objects before ready state, plus `GT` PASS for `publish-on-green`

## Google Trends signal

`research/trend-signal.json` is required for `publish-on-green` and records:

- `schema_version: 1`;
- `source_kind: official-google-trends-rss`;
- exact Korea feed URL and `geography: KR`;
- `window: past-24-hours` and `interpretation: candidate-discovery-only`;
- UTC `retrieved_at` no more than six hours old, `raw_feed_path: research/google-trends-kr.xml` and a SHA-256 that matches that preserved raw snapshot;
- one to ten retained rows with query, approximate-traffic label, raw source timestamp, normalized UTC timestamp and exactly one selection boolean;
- selected query and selected researched candidate id;
- concrete audience-fit explanation;
- `durable_value_without_spike: true` and `trend_is_not_thesis: true`.

The feed is discovery data, not primary evidence. Approximate traffic is relative interest, not absolute demand.

## Candidate set

Each candidate records id, exact trend query, allowed content pillar, entity, reader intent, source URL and tier, retrieval time, why now, audience fit, durable-value-without-spike boolean, existing overlap, originality opportunity, experience mode, image concept, risk notes, selection boolean and rejection reason when not selected.

Exactly one selected candidate is required only when an article package exists.

## Authority-led monetization brief

`research/authority-brief.json` is an internal, never-published artifact written by the journal director before drafting. It follows `.claude/skills/authority-led-monetization/references/authority-brief-schema.md`: current run and selected candidate binding; one allowed pillar; `official-source-translation` or a manifest-backed `anchored-observation`; evidence-bound original contribution; honest AI role with an exact visible Editorial method paragraph; one clean related `/journal/` next action present as a visible link; and a publish-time `not-measured` plan. `tools/lib/authority-brief.mjs` validates it fail-closed in both package stages.

## Evidence pack

Every claim records:

- stable `claim_id`;
- exact claim text;
- `verified | inferred | unverified`;
- primary-source boolean;
- source URL and publisher;
- version or published date;
- retrieval timestamp;
- quote or coordinate;
- caveat and freshness window.

The article claim map may not reference unverified evidence.

## Draft front matter

Required keys:

`layout`, `title`, `subtitle`, `description`, `active`, `image.feature`, `card-img`, `date`, `header-img`, `header_alt`, `header_ai`, `header_width`, `header_height`, `comments`, `tags`, `categories`, `reviewed`, `lastmod`, `ai_assisted`, `content_type`, `sources[].label`, `sources[].publisher`, `sources[].url`.

Scheduled drafts must use `layout: post`, `active: journal`, `header_ai: true`, `comments: false`, `ai_assisted: true`, and `content_type: guide`.

## Source image sidecar

`draft/source-image-manifest.json` records `schema_version: 1`, the `run_id` and an `images[]` array with 4–12 entries. Every entry requires `local_path` (slug-bound `img/source/<slug>/` path), `source_page_url` (must be an evidence-pack `source_url`), `download_url`, `publisher_or_creator`, `license_basis`, `license_url`, `license_quote` (≥ 40 characters), `retrieved_at`, `sha256`, `transformation`, `transformation_note`, `alt`, `attribution_text`, `commercial_use_allowed: true` and `redistribution_allowed: true`.

Allowed `license_basis` values fail closed: `public-domain`, `cc0`, `cc-by`, `cc-by-sa`, `kogl-type-1`, `repo-license-covers-assets` (requires `pinned_ref`) and `official-press-kit`. Local paths, hashes and download URLs are unique; files are non-empty regular `.png`/`.jpg`/`.jpeg`/`.webp` no larger than 5 MiB with valid raster structure, EXIF/XMP/text metadata stripped, a ≥32 px short side, ≥16,384 pixels and no more than 20 MiB combined; sidecar entries and `reference_image_paths` match exactly and the packaged source directory has no orphans. Each image appears in exactly one `<figure class="post-photo source-image">` whose caption contains the exact source page URL, license URL, publisher/creator and attribution text.

## Image provenance

`draft/image-provenance.json` records:

- tool and version;
- model/provider when known;
- prompt hash and full prompt;
- generation time;
- source output path;
- crop/re-encode method;
- full and thumbnail paths, pixel dimensions and SHA-256;
- disclosure text;
- attestations: no people/faces, no brands/logos, no readable text, no documentary claim, no EXIF/IPTC/XMP.

## Review

`review/editorial-review.json` requires verdict, full claim coverage, claim-level findings, persona honesty, originality, non-commodity finding, disclosure finding, source freshness and blocking reasons. In publish-on-green it also requires independent `trend_relevance`, `durable_value_without_spike`, `trend_not_thesis` booleans plus a concrete `trend_rationale`. Every article package also requires `authority_fit`, `reader_value`, `monetization_honesty`, `ai_role_honesty`, and `next_action_verified` as `true`, `scaled_content_risk: false`, and an `authority_rationale` of at least 40 characters.

## Publication scope

`validation/path-scope.txt` is derived by code from the manifest and lists the full derived package: one post, one 1672×941 hero, one 700×394 thumbnail and every validated source image (4–12). It is never hand-authored.

`validation/validation.json` records a SHA-256 for each of those files. Approval binds the package paths/bytes plus the current git base and approval context (`.claude/editorial-policy.yml`, `_config.yml`, `_layouts/`, `_includes/`, `css/`, `js/`). Approval deletes the pre-approval final report and scope so both must be regenerated; render-context files must be clean/committed; `apply-editorial-package.mjs` refuses existing live targets; and staged verification requires every derived package path to be a newly added `100644` file on an upstream-synchronised `gh-pages` branch.

After deployment, only `tools/verify-deployment.mjs` creates `validation/deployment-proof.json` with no overwrite. It records the verifier path/hash, run id, approved artifact SHA-256, 40-character pushed/remote/workflow SHA, exact JellyGGumi GitHub Pages workflow URL and success conclusion, anonymous expected permalink URL/status/content type, expected title and body probe checks, every exact anonymous cover and source image URL/status/content type/byte hash and UTC verification timestamp. The `published` transition also requires local `gh-pages` HEAD to equal that SHA, the HEAD commit to add exactly the approved derived package paths, and live working-tree bytes to equal the package.
