# Authority Brief Schema

`_workspace/current/research/authority-brief.json` is written only by the
journal director after candidate selection and before drafting. It is
validated by `tools/lib/authority-brief.mjs` (invoked from
`tools/validate-editorial-package.mjs`) and fails closed when missing,
malformed, or unsupported. Unknown top-level keys are rejected.

## Top-level fields

| Field | Requirement |
|---|---|
| `schema_version` | exactly `1` |
| `run_id` | equals `manifest.run_id` |
| `selected_candidate_id` | equals the selected researched candidate's `candidate_id` |
| `site_mode` | exactly `evergreen-korea-guide` |
| `operating_mode` | exactly `acquisition-content` |
| `primary_lane` | exactly `seo-and-content` |
| `audience_segment` | concrete audience, ≥ 20 characters |
| `reader_job` | concrete reader task, ≥ 20 characters |
| `content_pillar` | one of the five policy pillars; must equal the selected candidate's `content_pillar` when present |
| `authority_basis` | object, below |
| `original_contribution` | object, below |
| `ai_role` | object, below |
| `revenue_model` | exactly `ads-supported-guide` |
| `next_action` | object, below |
| `measurement` | object, below |

## `authority_basis`

- `type`: `official-source-translation` or `anchored-observation`.
  `anchored-observation` is allowed only when the manifest declares
  `experience_mode: anchored-observation` with an `observation_anchor` object.
- `summary`: ≥ 40 characters explaining why this journal can speak with
  authority on the topic.
- `evidence_claim_ids`: non-empty unique array; every id exists in
  `evidence/evidence-pack.json` and is not `unverified`.

## `original_contribution`

- `kind`: one of `practical-translation`, `decision-guide`,
  `system-explainer`, `cultural-context`.
- `summary`: ≥ 40 characters naming what the guide adds beyond restating
  sources.
- `evidence_claim_ids`: same rules as above.

## `ai_role`

- `research_assistance: true` and `draft_assistance: true`.
- `editorial_judgment_owner`: exactly `evidence-gated-editorial-harness`.
- `human_review_status`: `standing-policy-approved` for a `publish-on-green`
  manifest, otherwise `manual-review-pending`.
- `first_hand_experience_claimed`: boolean; must equal whether the manifest
  experience mode is `anchored-observation`.
- `disclosure`: one safe line, ≥ 40 characters; the exact text must appear in
  a visible `<p><strong>Editorial method:</strong> ...</p>`, not a comment, code
  fence or inert container.

## `next_action`

- `type`: exactly `related-guide`.
- `path`: matches `^/journal/[A-Za-z0-9][A-Za-z0-9-]*/$` with no query or
  fragment, and appears as a visible HTML link in the article body.
- `reader_value`: ≥ 20 characters explaining the reader benefit.

## `measurement`

Pinned no-speculation plan:

- `primary_kpi: engaged-organic-sessions`
- `leading_signal: organic-search-clicks`
- `baseline_status: unmeasured` and `baseline_value: null`
- `success_threshold_status: pending-baseline` and `success_threshold: null`
- `readout_after_days: 28`
- `result_status: not-measured`

Real numbers enter routine memory only after an actual readout; they never
retroactively edit a published package.

## Independent review additions

`review/editorial-review.json` must additionally record, for every article
package: `authority_fit: true`, `reader_value: true`,
`monetization_honesty: true`, `ai_role_honesty: true`,
`next_action_verified: true`, `scaled_content_risk: false` and
`authority_rationale` (≥ 40 characters). Final validation refuses a PASS
without them.
