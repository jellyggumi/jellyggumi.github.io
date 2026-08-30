#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const sourceRoot = path.resolve(process.cwd());
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jellyggumi-editorial-gates-'));
const tests = [];

function run(binary, args, cwd, expected = 0) {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== expected) throw new Error(`${binary} ${args.join(' ')} exited ${result.status}, expected ${expected}\n${output}`);
  return output;
}

function fixture(name, transformPolicy = (value) => value) {
  const root = path.join(tempRoot, name);
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  const policy = transformPolicy(fs.readFileSync(path.join(sourceRoot, '.claude', 'editorial-policy.yml'), 'utf8'));
  fs.writeFileSync(path.join(root, '.claude', 'editorial-policy.yml'), policy);
  for (const file of ['editorial-workspace.mjs', 'capture-google-trends.mjs', 'verify-deployment.mjs']) fs.copyFileSync(path.join(sourceRoot, 'tools', file), path.join(root, 'tools', file));
  run('git', ['init', '-q', '-b', 'gh-pages'], root);
  run('git', ['config', 'user.name', 'JellyGGumi Gate Fixture'], root);
  run('git', ['config', 'user.email', 'fixture@example.invalid'], root);
  run('git', ['add', '-A'], root);
  run('git', ['commit', '-qm', 'fixture'], root);
  return root;
}

function expectFailure(binary, args, cwd, phrase) {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.notEqual(result.status, 0, `Expected failure: ${binary} ${args.join(' ')}`);
  assert.match(output, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

function start(root, runId) {
  run('node', ['tools/editorial-workspace.mjs', 'start', '--root', root, '--run-id', runId, '--target-date', '2026-08-30'], root);
  return JSON.parse(fs.readFileSync(path.join(root, '_workspace/current/manifest.json'), 'utf8'));
}

try {
  const positive = fixture('positive');
  const manifest = start(positive, '20260830-gate-positive');
  assert.equal(manifest.mode, 'publish-on-green');
  assert.equal(manifest.publication_requires_confirmation, false);
  assert.equal(manifest.standing_publish_routine_id, 'h78L2R0UJFRhjS9O');
  tests.push('publish-on-green start uses pinned standing authority');

  const pairMismatch = fixture('pair-mismatch', (policy) => policy.replace('standing_publish_approval: true', 'standing_publish_approval: false'));
  expectFailure('node', ['tools/editorial-workspace.mjs', 'start', '--root', pairMismatch, '--run-id', '20260830-pair-mismatch', '--target-date', '2026-08-30'], pairMismatch, 'Publication policy must be draft-only/false or publish-on-green/true');
  tests.push('mismatched dual keys fail closed');

  const wrongRoutine = fixture('wrong-routine', (policy) => policy.replace('standing_publish_routine_id: h78L2R0UJFRhjS9O', 'standing_publish_routine_id: wrongRoutine999'));
  expectFailure('node', ['tools/editorial-workspace.mjs', 'start', '--root', wrongRoutine, '--run-id', '20260830-wrong-routine', '--target-date', '2026-08-30'], wrongRoutine, 'publish-on-green is authorized only for routine h78L2R0UJFRhjS9O');
  tests.push('wrong standing routine id fails closed');

  const wrongGrant = fixture('wrong-grant', (policy) => policy.replace('standing_publish_approval_granted_on: "2026-08-30"', 'standing_publish_approval_granted_on: "2026-08-29"'));
  expectFailure('node', ['tools/editorial-workspace.mjs', 'start', '--root', wrongGrant, '--run-id', '20260830-wrong-grant', '--target-date', '2026-08-30'], wrongGrant, 'Standing publication approval must remain pinned to 2026-08-30');
  tests.push('standing authority grant date is pinned');

  const positiveManifestPath = path.join(positive, '_workspace/current/manifest.json');
  const ready = JSON.parse(fs.readFileSync(positiveManifestPath, 'utf8'));
  ready.status = 'ready_for_review';
  fs.writeFileSync(positiveManifestPath, `${JSON.stringify(ready, null, 2)}\n`);
  expectFailure('node', ['tools/editorial-workspace.mjs', 'set-status', '--root', positive, '--run-id', ready.run_id, '--status', 'approved', '--approval-ref', 'human-review:forged123', '--artifact-digest', 'a'.repeat(64)], positive, 'Approval requires a manual review reference or active standing-routine:h78L2R0UJFRhjS9O authority');
  tests.push('manual-looking reference cannot bypass publish-on-green authority');

  const draft = fixture('draft-fallback', (policy) => policy.replace('publication_mode: publish-on-green', 'publication_mode: draft-only').replace('standing_publish_approval: true', 'standing_publish_approval: false'));
  const draftManifest = start(draft, '20260830-draft-fallback');
  assert.equal(draftManifest.mode, 'draft-only');
  assert.equal(draftManifest.publication_requires_confirmation, true);
  const draftManifestPath = path.join(draft, '_workspace/current/manifest.json');
  draftManifest.status = 'ready_for_review';
  fs.writeFileSync(draftManifestPath, `${JSON.stringify(draftManifest, null, 2)}\n`);
  expectFailure('node', ['tools/editorial-workspace.mjs', 'set-status', '--root', draft, '--run-id', draftManifest.run_id, '--status', 'approved', '--approval-ref', 'human-review:manual123', '--artifact-digest', 'a'.repeat(64)], draft, 'Required gates are not PASS');
  tests.push('draft-only manual reference reaches evidence gates');

  fs.mkdirSync(path.join(positive, '_workspace/current/research'), { recursive: true });
  fs.writeFileSync(path.join(positive, '_workspace/current/research/google-trends-kr.xml'), '<rss><channel/></rss>');
  fs.writeFileSync(path.join(positive, '_workspace/current/research/trend-signal.json'), '{}\n');
  ready.status = 'researching';
  fs.writeFileSync(positiveManifestPath, `${JSON.stringify(ready, null, 2)}\n`);
  expectFailure('node', ['tools/capture-google-trends.mjs', '--root', positive], positive, 'Trend evidence already exists');
  tests.push('trend capture never overwrites preserved evidence');

  expectFailure('node', ['tools/verify-deployment.mjs', '--root', positive, '--wait-seconds', '0'], positive, 'Deployment verification requires approved status');
  tests.push('deployment verifier refuses non-approved runs before network access');

  for (const file of ['editorial-workspace.mjs', 'apply-editorial-package.mjs', 'verify-publication-scope.mjs']) {
    const text = fs.readFileSync(path.join(sourceRoot, 'tools', file), 'utf8');
    assert.match(text, /\.claude\/editorial-policy\.yml/);
    assert.match(text, /standing_publish_approval_granted_on/);
    if (file !== 'editorial-workspace.mjs') assert.match(text, /manualApprovalIsActive/);
  }
  assert.match(fs.readFileSync(path.join(sourceRoot, 'tools/apply-editorial-package.mjs'), 'utf8'), /worktree and index must be fully clean/);
  assert.match(fs.readFileSync(path.join(sourceRoot, 'tools/verify-publication-scope.mjs'), 'utf8'), /changes outside the three staged publication paths/);
  tests.push('approval context and exact-scope guards stay synchronized');

  console.log(`Editorial gate regression tests passed: ${tests.length}`);
  for (const test of tests) console.log(`- ${test}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
