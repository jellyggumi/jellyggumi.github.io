// Authority-led monetization brief validation for JellyGGumi automated guides.
// The brief is a fail-closed research artifact written by the journal director
// before drafting. It binds one selected candidate to an explicit authority
// basis, an original contribution, an honest AI-role disclosure, one internal
// next action and a no-speculation measurement plan. Constants here are pinned
// by tools/validate-harness.mjs against .claude/editorial-policy.yml.

export const AUTHORITY_BRIEF_SCHEMA_VERSION = 1;
export const AUTHORITY_SITE_MODE = 'evergreen-korea-guide';
export const AUTHORITY_OPERATING_MODE = 'acquisition-content';
export const AUTHORITY_PRIMARY_LANE = 'seo-and-content';
export const AUTHORITY_REVENUE_MODEL = 'ads-supported-guide';
export const AUTHORITY_PRIMARY_KPI = 'engaged-organic-sessions';
export const AUTHORITY_LEADING_SIGNAL = 'organic-search-clicks';
export const AUTHORITY_READOUT_AFTER_DAYS = 28;
export const AUTHORITY_RESULT_STATUS_AT_PUBLISH = 'not-measured';
export const AUTHORITY_EDITORIAL_JUDGMENT_OWNER = 'evidence-gated-editorial-harness';

export const ALLOWED_CONTENT_PILLARS = Object.freeze([
  'korean-food-and-dining',
  'language-and-hangul',
  'customs-etiquette-and-holidays',
  'transport-and-city-systems',
  'daily-life-and-admin'
]);

export const ALLOWED_AUTHORITY_BASIS_TYPES = Object.freeze([
  'official-source-translation',
  'anchored-observation'
]);

export const ALLOWED_CONTRIBUTION_KINDS = Object.freeze([
  'practical-translation',
  'decision-guide',
  'system-explainer',
  'cultural-context'
]);

const ALLOWED_TOP_LEVEL_KEYS = Object.freeze([
  'schema_version',
  'run_id',
  'selected_candidate_id',
  'site_mode',
  'operating_mode',
  'primary_lane',
  'audience_segment',
  'reader_job',
  'content_pillar',
  'authority_basis',
  'original_contribution',
  'ai_role',
  'revenue_model',
  'next_action',
  'measurement'
]);

export const NEXT_ACTION_PATH_PATTERN = /^\/journal\/[A-Za-z0-9][A-Za-z0-9-]*\/$/;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value, minimum = 1) => typeof value === 'string' && value.trim().length >= minimum;
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function checkUnknownKeys(label, object, allowed, errors) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) errors.push(`${label} contains unknown field: ${key}`);
  }
}

function visibleArticleBody(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\{%\s*comment\s*%\}[\s\S]*?\{%\s*endcomment\s*%\}/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(template|noscript|script|style|details)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<([a-z][a-z0-9:-]*)\b(?=[^>]*(?:\s(?:hidden|inert)(?:\s|=|>)|\saria-hidden\s*=\s*["']?true|\sstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)))[^>]*>[\s\S]*?<\/\1>/gi, '');
}

function checkEvidenceClaimIds(label, ids, evidenceById, errors) {
  if (!Array.isArray(ids) || ids.length === 0) {
    errors.push(`${label}.evidence_claim_ids must be a non-empty array`);
    return 0;
  }
  const seen = new Set();
  for (const id of ids) {
    if (!nonempty(String(id ?? ''))) {
      errors.push(`${label}.evidence_claim_ids contains an empty id`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${label}.evidence_claim_ids contains duplicate id: ${id}`);
      continue;
    }
    seen.add(id);
    const claim = evidenceById.get(id);
    if (!claim) errors.push(`${label}.evidence_claim_ids references unknown evidence claim: ${id}`);
    else if (claim.verification === 'unverified') errors.push(`${label}.evidence_claim_ids references unverified evidence claim: ${id}`);
  }
  return seen.size;
}

export function validateAuthorityBrief({ brief, manifest, selectedCandidate, evidenceClaims, articleBody } = {}) {
  const errors = [];
  const metrics = {
    authority_evidence_claims: 0,
    contribution_evidence_claims: 0,
    disclosure_in_body: false,
    next_action_in_body: false,
    next_action_path: null
  };
  if (!isPlainObject(brief)) {
    errors.push('authority brief is missing or not an object; the authority-led monetization contract fails closed');
    return { errors, metrics };
  }
  if (!isPlainObject(manifest)) {
    errors.push('authority brief validation requires the run manifest');
    return { errors, metrics };
  }
  const body = typeof articleBody === 'string' ? articleBody : '';
  const visibleBody = visibleArticleBody(body);
  const evidenceById = new Map();
  for (const claim of Array.isArray(evidenceClaims) ? evidenceClaims : []) {
    if (isPlainObject(claim) && nonempty(String(claim.claim_id ?? ''))) evidenceById.set(claim.claim_id, claim);
  }

  const unknownKeys = Object.keys(brief).filter((key) => !ALLOWED_TOP_LEVEL_KEYS.includes(key)).sort();
  if (unknownKeys.length) errors.push(`authority brief contains unknown top-level keys: ${unknownKeys.join(', ')}`);
  for (const key of ALLOWED_TOP_LEVEL_KEYS) {
    if (brief[key] === undefined || brief[key] === null) errors.push(`authority brief field is missing: ${key}`);
  }

  if (brief.schema_version !== AUTHORITY_BRIEF_SCHEMA_VERSION) errors.push(`schema_version must be ${AUTHORITY_BRIEF_SCHEMA_VERSION}`);
  if (!nonempty(String(brief.run_id ?? '')) || brief.run_id !== manifest.run_id) errors.push(`run_id must match the current run manifest (${manifest.run_id})`);
  const candidateId = isPlainObject(selectedCandidate) ? selectedCandidate.candidate_id : undefined;
  if (!nonempty(String(brief.selected_candidate_id ?? '')) || brief.selected_candidate_id !== candidateId) {
    errors.push(`selected_candidate_id must match the selected researched candidate (${candidateId ?? 'missing'})`);
  }
  if (brief.site_mode !== AUTHORITY_SITE_MODE) errors.push(`site_mode must be ${AUTHORITY_SITE_MODE}`);
  if (brief.operating_mode !== AUTHORITY_OPERATING_MODE) errors.push(`operating_mode must be ${AUTHORITY_OPERATING_MODE}`);
  if (brief.primary_lane !== AUTHORITY_PRIMARY_LANE) errors.push(`primary_lane must be ${AUTHORITY_PRIMARY_LANE}`);
  if (!nonempty(brief.audience_segment, 20)) errors.push('audience_segment must name a concrete audience (>= 20 characters)');
  if (!nonempty(brief.reader_job, 20)) errors.push('reader_job must describe a concrete reader task (>= 20 characters)');
  if (!ALLOWED_CONTENT_PILLARS.includes(brief.content_pillar)) errors.push(`content_pillar is not an allowed policy pillar: ${brief.content_pillar}`);
  if (isPlainObject(selectedCandidate) && nonempty(String(selectedCandidate.content_pillar ?? '')) && brief.content_pillar !== selectedCandidate.content_pillar) {
    errors.push(`content_pillar must match the selected candidate pillar (${selectedCandidate.content_pillar})`);
  }

  const basis = brief.authority_basis;
  if (!isPlainObject(basis)) errors.push('authority_basis must be an object');
  else {
    checkUnknownKeys('authority_basis', basis, ['type', 'summary', 'evidence_claim_ids'], errors);
    if (!ALLOWED_AUTHORITY_BASIS_TYPES.includes(basis.type)) errors.push(`authority_basis.type must be one of ${ALLOWED_AUTHORITY_BASIS_TYPES.join(', ')}`);
    if (basis.type === 'anchored-observation' && !(manifest.experience_mode === 'anchored-observation' && isPlainObject(manifest.observation_anchor))) {
      errors.push('authority_basis.type anchored-observation requires manifest experience_mode anchored-observation with an observation_anchor object');
    }
    if (!nonempty(basis.summary, 40)) errors.push('authority_basis.summary must be at least 40 characters');
    metrics.authority_evidence_claims = checkEvidenceClaimIds('authority_basis', basis.evidence_claim_ids, evidenceById, errors);
  }

  const contribution = brief.original_contribution;
  if (!isPlainObject(contribution)) errors.push('original_contribution must be an object');
  else {
    checkUnknownKeys('original_contribution', contribution, ['kind', 'summary', 'evidence_claim_ids'], errors);
    if (!ALLOWED_CONTRIBUTION_KINDS.includes(contribution.kind)) errors.push(`original_contribution.kind must be one of ${ALLOWED_CONTRIBUTION_KINDS.join(', ')}`);
    if (!nonempty(contribution.summary, 40)) errors.push('original_contribution.summary must be at least 40 characters');
    metrics.contribution_evidence_claims = checkEvidenceClaimIds('original_contribution', contribution.evidence_claim_ids, evidenceById, errors);
  }

  const aiRole = brief.ai_role;
  if (!isPlainObject(aiRole)) errors.push('ai_role must be an object');
  else {
    checkUnknownKeys('ai_role', aiRole, ['research_assistance', 'draft_assistance', 'editorial_judgment_owner', 'human_review_status', 'first_hand_experience_claimed', 'disclosure'], errors);
    if (aiRole.research_assistance !== true) errors.push('ai_role.research_assistance must be true');
    if (aiRole.draft_assistance !== true) errors.push('ai_role.draft_assistance must be true');
    if (aiRole.editorial_judgment_owner !== AUTHORITY_EDITORIAL_JUDGMENT_OWNER) errors.push(`ai_role.editorial_judgment_owner must be ${AUTHORITY_EDITORIAL_JUDGMENT_OWNER}`);
    const expectedReviewStatus = manifest.mode === 'publish-on-green' ? 'standing-policy-approved' : 'manual-review-pending';
    if (aiRole.human_review_status !== expectedReviewStatus) errors.push(`ai_role.human_review_status must be ${expectedReviewStatus} for mode ${manifest.mode}`);
    const anchored = manifest.experience_mode === 'anchored-observation';
    if (typeof aiRole.first_hand_experience_claimed !== 'boolean' || aiRole.first_hand_experience_claimed !== anchored) {
      errors.push(`ai_role.first_hand_experience_claimed must be the boolean ${anchored} for experience_mode ${manifest.experience_mode}`);
    }
    if (!nonempty(aiRole.disclosure, 40) || /[<>\n]/.test(String(aiRole.disclosure || ''))) errors.push('ai_role.disclosure must be one safe line of at least 40 characters');
    else {
      metrics.disclosure_in_body = visibleBody.includes(`<p><strong>Editorial method:</strong> ${aiRole.disclosure.trim()}</p>`);
      if (!metrics.disclosure_in_body) errors.push('ai_role.disclosure text must appear in a visible Editorial method paragraph');
    }
  }

  if (brief.revenue_model !== AUTHORITY_REVENUE_MODEL) errors.push(`revenue_model must be ${AUTHORITY_REVENUE_MODEL}`);

  const nextAction = brief.next_action;
  if (!isPlainObject(nextAction)) errors.push('next_action must be an object');
  else {
    checkUnknownKeys('next_action', nextAction, ['type', 'path', 'reader_value'], errors);
    if (nextAction.type !== 'related-guide') errors.push('next_action.type must be related-guide');
    const nextPath = String(nextAction.path ?? '');
    if (!NEXT_ACTION_PATH_PATTERN.test(nextPath) || nextPath.includes('?') || nextPath.includes('#')) {
      errors.push(`next_action.path must be a clean /journal/<slug>/ path with no query or fragment: ${nextPath || '(missing)'}`);
    } else {
      metrics.next_action_path = nextPath;
      metrics.next_action_in_body = new RegExp(`<a\\s+[^>]*href=["']${escapeRegex(nextPath)}["']`, 'i').test(visibleBody);
      if (!metrics.next_action_in_body) errors.push(`next_action.path must appear as a visible HTML link: ${nextPath}`);
    }
    if (!nonempty(nextAction.reader_value, 20)) errors.push('next_action.reader_value must explain the reader benefit (>= 20 characters)');
  }

  const measurement = brief.measurement;
  if (!isPlainObject(measurement)) errors.push('measurement must be an object');
  else {
    checkUnknownKeys('measurement', measurement, ['primary_kpi', 'leading_signal', 'baseline_status', 'baseline_value', 'success_threshold_status', 'success_threshold', 'readout_after_days', 'result_status'], errors);
    if (measurement.primary_kpi !== AUTHORITY_PRIMARY_KPI) errors.push(`measurement.primary_kpi must be ${AUTHORITY_PRIMARY_KPI}`);
    if (measurement.leading_signal !== AUTHORITY_LEADING_SIGNAL) errors.push(`measurement.leading_signal must be ${AUTHORITY_LEADING_SIGNAL}`);
    if (measurement.baseline_status !== 'unmeasured') errors.push('measurement.baseline_status must be unmeasured');
    if (measurement.baseline_value !== null) errors.push('measurement.baseline_value must be null until a real baseline is measured');
    if (measurement.success_threshold_status !== 'pending-baseline') errors.push('measurement.success_threshold_status must be pending-baseline');
    if (measurement.success_threshold !== null) errors.push('measurement.success_threshold must be null until a baseline exists');
    if (measurement.readout_after_days !== AUTHORITY_READOUT_AFTER_DAYS) errors.push(`measurement.readout_after_days must be ${AUTHORITY_READOUT_AFTER_DAYS}`);
    if (measurement.result_status !== AUTHORITY_RESULT_STATUS_AT_PUBLISH) errors.push(`measurement.result_status must be ${AUTHORITY_RESULT_STATUS_AT_PUBLISH} at publish time`);
  }

  return { errors, metrics };
}
