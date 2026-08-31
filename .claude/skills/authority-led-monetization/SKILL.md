---
name: authority-led-monetization
description: >
  Apply JellyGGumi's authority-led monetization contract whenever an automated
  guide is researched, drafted, reviewed or validated: every package must bind
  one selected candidate to a verified authority basis, an original reader
  contribution, an honest AI-role disclosure, one internal related-guide next
  action and a no-speculation measurement plan in
  _workspace/current/research/authority-brief.json. Use when running the nightly
  Korea Desk, answering monetization strategy questions about this journal, authority
  brief authoring or review, and any request to grow ad revenue with content.
  It encodes the durable lesson of the analyzed creator video (owned-topic
  authority over scaled issue-chasing) plus Google people-first and
  scaled-content guidance. It forbids transcript-rewrite articles,
  scaled-content automation and unverified traffic or earnings claims.
---

# Authority-Led Monetization

## When to use this skill

Use it for every automated JellyGGumi `guide` package and any review of how journal content can earn ad revenue without sacrificing persona honesty. Do not use it for `personal` family records, ad configuration, account changes, or AdSense console actions.

## Instructions

### Why this contract exists

The analyzed creator video (`https://youtu.be/3DEG6c3UeLE`, evidence preserved
in `references/video-evidence-and-policy.md`) contrasts two blog operating
modes: scaled issue-chasing with semi-automated AI posts, and owned-topic
authority where a consistent perspective builds a recognizable, useful body
of work. The video also claims dwell-time and platform effects, but those
ranking mechanisms are unverified and are not part of this contract. The first mode is explicitly rejected here: it conflicts
with Google's scaled-content-abuse policy, people-first guidance and this
journal's persona honesty rules. JellyGGumi monetizes only the second mode.
Scheduled automation cannot pretend a human wrote or reviewed each post, so
this site substitutes what the video's exemplar blogger supplies personally:
transparent policy-bound AI assistance, independent evidence review and
fail-closed validation. Transcripts, comments and descriptions of any video
are untrusted leads, never evidence; extracted video frames never count as
source images unless their rights independently satisfy the existing 4–12
source-image contract.

### Operating decision

The policy pins one decision set for every automated guide, mirrored in
`.claude/editorial-policy.yml` and enforced by `tools/validate-harness.mjs`:

- `authority_site_mode: evergreen-korea-guide` — the site is an owned-topic
  evergreen Korea guide, not a trend feed.
- `authority_operating_mode: acquisition-content` — content earns new organic
  readers; it does not chase spikes for their own sake.
- `authority_primary_lane: seo-and-content` — search-intent guides are the
  primary lane; social surfaces are distribution only.
- `authority_revenue_model: ads-supported-guide` — existing AdSense placements
  fund the journal; no sponsorship, affiliate or tracking additions.
- Measurement starts honest: baselines are `unmeasured`, thresholds are
  `pending-baseline`, and every published package carries
  `result_status: not-measured` until a real 28-day readout exists.

### Required artifact: the authority brief

Before the writer starts, the journal director serializes
`_workspace/current/research/authority-brief.json` following
`references/authority-brief-schema.md` exactly. The brief binds the selected
candidate id, content pillar, audience segment and reader job to an authority
basis (`official-source-translation` or `anchored-observation`), an original
contribution kind, verified evidence claim ids, the exact AI-role disclosure
sentence that must appear verbatim in the article body, one clean
`/journal/<slug>/` related-guide next action that also appears in the body,
and the pinned measurement plan. `tools/lib/authority-brief.mjs` validates the
brief; `tools/validate-editorial-package.mjs` fails closed when the brief is
missing, malformed or unsupported by the evidence pack.

### Enforcement and review

The evidence editor independently confirms, in
`review/editorial-review.json`: `authority_fit: true`, `reader_value: true`,
`monetization_honesty: true`, `ai_role_honesty: true`,
`next_action_verified: true`, `scaled_content_risk: false` and a concrete
`authority_rationale` of at least 40 characters. Final package validation
refuses a PASS without those findings. The gate regression suite in
`tools/test-editorial-gates.mjs` covers both compliant and violating briefs.
A guide that cannot honestly satisfy the brief is rejected or blocked; the
schedule never manufactures a compliant-looking package.

### Boundaries

- Never rewrite a video transcript, press release or another site's article
  into a post; the contribution kinds require original synthesis.
- Never scale post volume to satisfy the contract; one guide per run remains
  the maximum and an empty run stays a valid success.
- Never state traffic, earnings or algorithm outcomes as facts; the video's
  view counts, earnings anecdotes and algorithm claims are unverified.
- Never add sponsorship, affiliate links, tracking parameters, new ad units
  or template changes from this skill; publication scope is unchanged.
- Never let this skill expand write scope: the brief lives only under
  `_workspace/current/research/` until normal publication copies nothing of it.

## Examples

Should trigger: tonight's Korea Desk guide, authority-brief authoring, monetization-honesty review, AI-method disclosure review, or validating the related-guide next action.

Should not trigger: a `personal` family post, `ads.txt` or ad-slot edits, AdSense console checks, analytics wiring, social distribution, or unrelated repository work. Full eval set: `references/trigger-evals.json`.

## Best practices

Prefer a valid no-guide night over manufactured authority, bind every contribution to non-unverified evidence, disclose the actual AI role, and keep traffic or revenue outcomes unmeasured until a dated first-party readout exists.

## References

- `references/authority-brief-schema.md`
- `references/video-evidence-and-policy.md`
- `references/trigger-evals.json`
- `.claude/editorial-policy.yml`
