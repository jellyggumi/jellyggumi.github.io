#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
let rootValue = process.cwd();
let runtimeMode = false;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--runtime') runtimeMode = true;
  else if (argv[i] === '--root') {
    rootValue = argv[i + 1] || '';
    i += 1;
  } else if (!argv[i].startsWith('--')) rootValue = argv[i];
  else throw new Error(`Unknown argument: ${argv[i]}`);
}

const root = path.resolve(rootValue);
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const exists = (relative) => fs.existsSync(path.join(root, relative));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const required = [
  'CLAUDE.md',
  'AGENTS.md',
  'PERSONA.md',
  '.claude/editorial-policy.yml',
  '.claude/agents/journal-director.md',
  '.claude/agents/korea-desk-researcher.md',
  '.claude/agents/primary-source-auditor.md',
  '.claude/agents/journal-writer.md',
  '.claude/agents/evidence-editor.md',
  '.claude/agents/package-validator.md',
  '.claude/skills/jellyggumi-journal-harness/SKILL.md',
  '.claude/skills/jellyggumi-journal-harness/references/artifact-contract.md',
  '.claude/skills/jellyggumi-journal-harness/references/quality-gates.md',
  '.claude/skills/jellyggumi-journal-harness/references/scheduled-runbook.md',
  '.claude/skills/jellyggumi-journal-harness/references/influencer-strategy-2026.md',
  '.claude/skills/jellyggumi-journal-harness/references/injection-defense.md',
  '.claude/skills/jellyggumi-journal-harness/references/trigger-evals.json',
  '.claude/skills/editorial-image-kit/SKILL.md',
  '.agents/skills/jellyggumi-journal-harness/SKILL.md',
  '.agents/skills/editorial-image-kit/SKILL.md',
  '.github/workflows/editorial-quality-guard.yml',
  '.github/workflows/third-party-tags-guard.yml',
  'tools/editorial-workspace.mjs',
  'tools/capture-google-trends.mjs',
  'tools/apply-editorial-package.mjs',
  'tools/verify-publication-scope.mjs',
  'tools/verify-deployment.mjs',
  'tools/test-editorial-gates.mjs',
  'tools/validate-editorial-package.mjs',
  'tools/validate-harness.mjs',
  'tools/verify-site-quality.mjs'
];
for (const file of required) check(exists(file), `Required harness file is missing: ${file}`);

if (exists('AGENTS.md')) {
  const text = read('AGENTS.md');
  check(text.includes('CLAUDE.md'), 'AGENTS.md does not point to CLAUDE.md');
  check(text.length < 1800, 'AGENTS.md should remain a short pointer');
}

if (exists('CLAUDE.md')) {
  const text = read('CLAUDE.md');
  for (const phrase of [
    '_workspace/current/',
    '_workspace/archive/<run-id>/',
    'draft-only',
    'publish-on-green',
    'standing-routine:h78L2R0UJFRhjS9O',
    'Google Trends',
    'ready_for_review',
    'approved',
    'git add -A',
    'NOT PUBLISHED',
    'content_type: personal',
    '01:00 KST',
    'bright Naver-derived voice contract',
    'banggujin',
    '2 December 2024',
    '24–25 August 2026'
  ]) check(text.includes(phrase), `CLAUDE.md is missing contract phrase: ${phrase}`);
}

if (exists('PERSONA.md')) {
  const text = read('PERSONA.md');
  for (const phrase of [
    '## Three evidence registers',
    '### Observed',
    '### Explained',
    '### Sourced',
    '## Trust and influencer posture',
    'sourced-only',
    'anchored-observation',
    '## Naver-derived voice anchor',
    'banggujin',
    '2 December 2024',
    '24–25 August 2026',
    'without imitating Korean typos'
  ]) check(text.includes(phrase), `PERSONA.md is missing: ${phrase}`);
}

if (exists('.claude/editorial-policy.yml')) {
  const policy = read('.claude/editorial-policy.yml');
  check(/^timezone:\s*Asia\/Seoul$/m.test(policy), 'Policy timezone must be Asia/Seoul');
  check(/^schedule_local:\s*"01:00"$/m.test(policy), 'Policy schedule must be 01:00');
  check(/^scheduler:\s*Aside cron$/m.test(policy), 'Policy scheduler must be Aside cron');
  check(/^routine_name:\s*JellyGGumi Korea Desk$/m.test(policy), 'Policy routine name is missing');
  check(/^routine_id:\s*h78L2R0UJFRhjS9O$/m.test(policy), 'Active Aside cron routine id is missing or changed');
  const exactPolicyValue = (key, expected, message) => {
    const matches = [...policy.matchAll(new RegExp(`^${key}:\\s*([^\\n#]+)`, 'gm'))].map((match) => match[1].trim());
    check(matches.length === 1 && matches[0] === expected, `${message}; found ${JSON.stringify(matches)}`);
  };
  const publicationModes = [...policy.matchAll(/^publication_mode:\s*([^\n#]+)/gm)].map((match) => match[1].trim());
  const standingApprovals = [...policy.matchAll(/^standing_publish_approval:\s*([^\n#]+)/gm)].map((match) => match[1].trim());
  check(publicationModes.length === 1 && standingApprovals.length === 1, 'Publication policy keys must each occur exactly once');
  const publicationPair = `${publicationModes[0] || ''}/${standingApprovals[0] || ''}`;
  check(['draft-only/false', 'publish-on-green/true'].includes(publicationPair), `Publication policy keys are not a safe pair: ${publicationPair}`);
  if (publicationPair === 'publish-on-green/true') {
    exactPolicyValue('standing_publish_routine_id', 'h78L2R0UJFRhjS9O', 'Standing publication authority is not pinned to the JellyGGumi routine');
    const grantDates = [...policy.matchAll(/^standing_publish_approval_granted_on:\s*"(\d{4}-\d{2}-\d{2})"$/gm)].map((match) => match[1]);
    check(JSON.stringify(grantDates) === JSON.stringify(['2026-08-30']), `Standing publication approval must stay pinned to its grant date; found ${JSON.stringify(grantDates)}`);
  }
  exactPolicyValue('max_articles_per_run', '1', 'At most one article per run is allowed');
  exactPolicyValue('max_revision_loops', '2', 'Revision limit must be two');
  const exactNestedPolicyValue = (key, expected, message) => {
    const matches = [...policy.matchAll(new RegExp(`^\\s+${key}:\\s*([^\\n#]+)`, 'gm'))].map((match) => match[1].trim());
    check(matches.length === 1 && matches[0] === expected, `${message}; found ${JSON.stringify(matches)}`);
  };
  exactNestedPolicyValue('name', 'bright-naver-derived-field-journal', 'Naver-derived voice profile name is missing or changed');
  exactNestedPolicyValue('source_blog', 'https://blog.naver.com/banggujin', 'Naver-derived voice source is missing or changed');
  exactNestedPolicyValue('source_cutoff', '"2024-12-02"', 'Naver-derived voice cutoff is missing or changed');
  exactNestedPolicyValue('role', 'candidate-discovery-only', 'Google Trends must remain candidate discovery only');
  exactNestedPolicyValue('primary_feed', 'https://trends.google.com/trending/rss?geo=KR', 'Official Korea Google Trends RSS source is missing or changed');
  exactNestedPolicyValue('verification_ui', 'https://trends.google.com/trending?geo=KR', 'Google Trends verification UI is missing or changed');
  exactNestedPolicyValue('geography', 'KR', 'Google Trends geography must remain KR');
  exactNestedPolicyValue('intake_window', 'past-24-hours', 'Google Trends intake window must remain past 24 hours');
  exactNestedPolicyValue('context_window', 'past-7-days', 'Google Trends context window must remain past 7 days');
  exactNestedPolicyValue('max_signal_age_hours', '6', 'Google Trends signal freshness must remain six hours');
  for (const key of ['require_audience_fit', 'require_primary_source', 'require_durable_value_without_spike', 'forbid_keyword_stuffing']) exactNestedPolicyValue(key, 'true', `Trend policy flag must remain true: ${key}`);
  const excludedVoiceDates = (policy.match(/^  exclude_as_persona_evidence:\s*\n((?:    -\s*[^\n]+\n?)*)/m)?.[1] || '')
    .split('\n').map((line) => line.match(/^\s+-\s*"?([^"\n]+)"?$/)?.[1]?.trim()).filter(Boolean);
  check(JSON.stringify(excludedVoiceDates) === JSON.stringify(['2026-08-24', '2026-08-25']), `Voice evidence exclusions must remain the two SEO-track dates, found ${JSON.stringify(excludedVoiceDates)}`);
  for (const phrase of ['copied-korean-misspellings', 'stacked-punctuation', 'emoji-dense-prose', 'generic-engagement-cta', 'invented-family-detail']) {
    check(policy.includes(`    - ${phrase}`), `Voice policy is missing forbidden translation habit: ${phrase}`);
  }
  const allowedTypeHeaders = [...policy.matchAll(/^allowed_content_types:\s*$/gm)];
  const allowedTypeBlock = policy.match(/^allowed_content_types:\s*\n((?:\s+-\s*[^\n]+\n?)*)/m)?.[1] || '';
  const allowedTypes = allowedTypeBlock.split('\n').map((line) => line.match(/^\s+-\s*(.+)$/)?.[1]?.trim()).filter(Boolean);
  check(allowedTypeHeaders.length === 1 && JSON.stringify(allowedTypes) === JSON.stringify(['guide']), `Only one guide-only content list may be automated, found headers=${allowedTypeHeaders.length} values=${JSON.stringify(allowedTypes)}`);
  for (const phrase of ['no-automated-family-records', 'no-publish-outside-standing-or-explicit-authority', 'ads.txt', '_layouts/**']) {
    check(policy.includes(phrase), `Policy is missing boundary: ${phrase}`);
  }
}

const agentFiles = required.filter((file) => file.startsWith('.claude/agents/'));
for (const file of agentFiles) {
  if (!exists(file)) continue;
  const text = read(file);
  const frontMatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] || '';
  for (const key of ['name:', 'description:', 'model:', 'allowed-tools:', 'write-scope:']) {
    check(frontMatter.includes(key), `${file} front matter lacks ${key}`);
  }
  for (const section of ['## Core Responsibilities', '## Operational Principles', '## Input Protocol', '## Output Protocol', '## Error Handling', '## Team Communication']) {
    check(text.includes(section), `${file} lacks ${section}`);
  }
}

const expectedWriteScopes = {
  'journal-director': '_workspace/current/**',
  'journal-writer': '_workspace/current/draft/**',
  'package-validator': '_workspace/current/validation/**',
  'evidence-editor': 'none',
  'korea-desk-researcher': 'none',
  'primary-source-auditor': 'none'
};
for (const [name, expectedScope] of Object.entries(expectedWriteScopes)) {
  const file = `.claude/agents/${name}.md`;
  if (!exists(file)) continue;
  const scope = read(file).match(/^write-scope:\s*(.+)$/m)?.[1]?.trim();
  check(scope === expectedScope, `${file} write-scope must be ${expectedScope}, found ${scope || 'missing'}`);
}

for (const file of [
  '.claude/agents/korea-desk-researcher.md',
  '.claude/agents/primary-source-auditor.md',
  '.claude/agents/evidence-editor.md'
]) {
  if (!exists(file)) continue;
  const tools = (read(file).match(/^allowed-tools:\s*(.+)$/m)?.[1] || '').split(',').map((item) => item.trim());
  for (const forbidden of ['Bash', 'Write', 'Edit']) check(!tools.includes(forbidden), `${file} must remain read-only; remove ${forbidden}`);
}

if (exists('.claude/agents/journal-writer.md')) {
  const tools = (read('.claude/agents/journal-writer.md').match(/^allowed-tools:\s*(.+)$/m)?.[1] || '').split(',').map((item) => item.trim());
  for (const forbidden of ['WebFetch', 'WebSearch', 'Agent']) check(!tools.includes(forbidden), `journal-writer must not use ${forbidden}`);
}

if (exists('tools/capture-google-trends.mjs')) {
  const capture = read('tools/capture-google-trends.mjs');
  for (const phrase of ['https://trends.google.com/trending/rss?geo=KR', "flag: 'wx'", 'raw_feed_sha256', 'candidate-discovery-only', 'h78L2R0UJFRhjS9O']) check(capture.includes(phrase), `Google Trends capture tool is missing fail-closed marker: ${phrase}`);
}

if (exists('tools/verify-deployment.mjs')) {
  const verifier = read('tools/verify-deployment.mjs');
  for (const phrase of ['pages build and deployment', 'dynamic/pages/pages-build-deployment', 'permalink_status', 'title_check', 'body_check', 'image_urls', "flag: 'wx'"]) check(verifier.includes(phrase), `Deployment verifier is missing evidence marker: ${phrase}`);
}

if (exists('.claude/skills/jellyggumi-journal-harness/SKILL.md')) {
  const skill = read('.claude/skills/jellyggumi-journal-harness/SKILL.md');
  check(skill.split('\n').length <= 500, 'Harness SKILL.md exceeds 500 lines');
  check(/^name:\s*jellyggumi-journal-harness$/m.test(skill), 'Harness skill name is incorrect');
  check(skill.includes('producer-reviewer'), 'Harness must describe producer-reviewer architecture');
  check(skill.includes('Maximum two'), 'Harness must enforce two revision loops');
  check(skill.includes('Never use `git add -A`'), 'Harness lacks exact-staging rule');
}

let triggerEvalCount = 0;
if (exists('.claude/skills/jellyggumi-journal-harness/references/trigger-evals.json')) {
  try {
    const evals = JSON.parse(read('.claude/skills/jellyggumi-journal-harness/references/trigger-evals.json'));
    triggerEvalCount = (Array.isArray(evals.should_trigger) ? evals.should_trigger.length : 0) + (Array.isArray(evals.should_not_trigger) ? evals.should_not_trigger.length : 0);
    check(Array.isArray(evals.should_trigger) && evals.should_trigger.length >= 10, 'Trigger eval needs at least 10 positive queries');
    check(Array.isArray(evals.should_not_trigger) && evals.should_not_trigger.length >= 10, 'Trigger eval needs at least 10 negative queries');
  } catch (error) {
    failures.push(`Trigger eval JSON is invalid: ${error.message}`);
  }
}

for (const workflow of ['.github/workflows/editorial-quality-guard.yml', '.github/workflows/third-party-tags-guard.yml']) {
  if (!exists(workflow)) continue;
  const text = read(workflow);
  check(/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(text), `${workflow} must grant only contents: read`);
  check(!/^\s*-?\s*uses:\s*[^\s]+@v\d+/m.test(text), `${workflow} contains a mutable action tag`);
  check(text.includes('actions/checkout@11d5960a326750d5838078e36cf38b85af677262'), `${workflow} checkout action is not pinned to the approved SHA`);
}

if (exists('.gitignore')) check(/^_workspace\/$/m.test(read('.gitignore')), '.gitignore does not ignore _workspace/');
if (exists('_config.yml')) {
  const config = read('_config.yml');
  for (const entry of ['- _workspace', '- .claude', '- .agents', '- CLAUDE.md', '- AGENTS.md', '- PERSONA.md']) {
    check(config.includes(entry), `_config.yml exclude is missing ${entry}`);
  }
}

if (runtimeMode) {
  check(exists('_workspace/current/manifest.json'), '_workspace/current/manifest.json has not been scaffolded');
  check(exists('_workspace/current/.run-lock.json'), '_workspace/current/.run-lock.json ownership marker is missing');
  check(exists('_workspace/archive'), '_workspace/archive has not been scaffolded');
  check(exists('_workspace/archive-seals'), '_workspace/archive-seals has not been scaffolded');
  if (exists('_workspace/current/manifest.json') && exists('_workspace/current/.run-lock.json')) {
    try {
      const manifest = JSON.parse(read('_workspace/current/manifest.json'));
      const lock = JSON.parse(read('_workspace/current/.run-lock.json'));
      check(lock.run_id === manifest.run_id && lock.lock_id === manifest.run_lock_id, 'Current run ownership marker does not match manifest');
    } catch (error) {
      failures.push(`Runtime ownership marker is invalid: ${error.message}`);
    }
  }
}

if (failures.length) {
  console.error(`JellyGGumi harness validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`JellyGGumi harness validation passed: ${required.length} files, ${agentFiles.length} agents, ${triggerEvalCount} trigger evals${runtimeMode ? ', runtime workspace present' : ''}.`);
