#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
let repoRootValue = process.cwd();
let stagedMode = false;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--staged') stagedMode = true;
  else if (argv[i] === '--root') {
    repoRootValue = argv[i + 1] || '';
    i += 1;
  } else if (!argv[i].startsWith('--')) repoRootValue = argv[i];
  else throw new Error(`Unknown argument: ${argv[i]}`);
}

const repoRoot = path.resolve(repoRootValue);
const current = path.join(repoRoot, '_workspace', 'current');
const validationDir = path.join(current, 'validation');
const scopeFile = path.join(validationDir, 'path-scope.txt');
const standingPublishRoutineId = 'h78L2R0UJFRhjS9O';
const standingApprovalRef = `standing-routine:${standingPublishRoutineId}`;
const standingApprovalGrantedOn = '"2026-08-30"';
const manualApprovalRef = /^(?:aside-confirmation|human-review):[A-Za-z0-9._-]{6,}$/;
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`Cannot read valid JSON: ${path.relative(repoRoot, file)} (${error.message})`);
    return null;
  }
}

function isRegularFileWithoutSymlink(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function standingApprovalIsActive(manifest) {
  if (manifest?.mode !== 'publish-on-green' || manifest?.publication_requires_confirmation !== false || manifest?.approval_ref !== standingApprovalRef) return false;
  const policyPath = path.join(repoRoot, '.claude', 'editorial-policy.yml');
  if (!isRegularFileWithoutSymlink(policyPath)) return false;
  const policy = fs.readFileSync(policyPath, 'utf8');
  const single = (key, expected) => {
    const values = [...policy.matchAll(new RegExp(`^${key}:\\s*([^\\n#]+)`, 'gm'))].map((match) => match[1].trim());
    return values.length === 1 && values[0] === expected;
  };
  return single('publication_mode', 'publish-on-green')
    && single('standing_publish_approval', 'true')
    && single('standing_publish_routine_id', standingPublishRoutineId)
    && single('standing_publish_approval_granted_on', standingApprovalGrantedOn);
}

function manualApprovalIsActive(manifest) {
  if (!manualApprovalRef.test(manifest?.approval_ref || '') || manifest?.mode !== 'draft-only' || manifest?.publication_requires_confirmation !== true) return false;
  const policyPath = path.join(repoRoot, '.claude', 'editorial-policy.yml');
  if (!isRegularFileWithoutSymlink(policyPath)) return false;
  const policy = fs.readFileSync(policyPath, 'utf8');
  const single = (key, expected) => {
    const values = [...policy.matchAll(new RegExp(`^${key}:\\s*([^\\n#]+)`, 'gm'))].map((match) => match[1].trim());
    return values.length === 1 && values[0] === expected;
  };
  return single('publication_mode', 'draft-only') && single('standing_publish_approval', 'false');
}

function approvalRefIsValid(manifest) {
  return manualApprovalIsActive(manifest) || standingApprovalIsActive(manifest);
}

function git(args, encoding = 'utf8') {
  return spawnSync('git', args, { cwd: repoRoot, encoding });
}

function combinedPackageDigest(paths) {
  if (paths.length !== 3) return null;
  const digest = createHash('sha256');
  for (const relative of [...paths].sort()) {
    const file = path.join(current, 'draft', relative);
    if (!isRegularFileWithoutSymlink(file)) return null;
    digest.update(relative);
    digest.update('\0');
    digest.update(fs.readFileSync(file));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function renderContextDigest() {
  const files = [];
  const visit = (absolute) => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const full = path.join(absolute, entry.name);
      if (entry.isSymbolicLink()) {
        failures.push(`Render context contains a symlink: ${path.relative(repoRoot, full)}`);
        continue;
      }
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  };
  for (const relative of ['_config.yml', '.claude/editorial-policy.yml']) {
    if (isRegularFileWithoutSymlink(path.join(repoRoot, relative))) files.push(relative);
  }
  for (const relative of ['_layouts', '_includes', 'css', 'js']) {
    const absolute = path.join(repoRoot, relative);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) visit(absolute);
  }
  files.sort();
  const digest = createHash('sha256');
  for (const relative of files) {
    digest.update(relative); digest.update('\0'); digest.update(fs.readFileSync(path.join(repoRoot, relative))); digest.update('\0');
  }
  return { sha256: digest.digest('hex'), files };
}

function approvalArtifactDigest(baseSha, packageSha, renderSha) {
  return createHash('sha256').update('base\0').update(baseSha).update('\0').update('package\0').update(packageSha).update('\0').update('render\0').update(renderSha).update('\0').digest('hex');
}

function expectedPackagePaths({ checkCollisions = true } = {}) {
  const manifestPath = path.join(current, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
  check(Boolean(manifest), 'Current manifest is missing or invalid');
  if (!manifest) return [];

  check(manifest.content_type === 'guide', `Publication scope allows guide only, found ${manifest.content_type}`);
  check(typeof manifest.article_path === 'string', 'Manifest article_path is missing');
  check(Array.isArray(manifest.asset_paths), 'Manifest asset_paths must be an array');

  const articlePath = String(manifest.article_path || '');
  const assets = Array.isArray(manifest.asset_paths) ? [...manifest.asset_paths] : [];
  const articleValid = /^_posts\/\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9-]*\.md$/.test(articlePath);
  check(articleValid, `Unsafe article path: ${articlePath}`);
  check(assets.length === 2, `Expected exactly two asset paths, found ${assets.length}`);

  const slug = String(manifest.slug || '');
  const slugValid = /^[a-z0-9][a-z0-9-]*$/.test(slug);
  check(slugValid, `Unsafe manifest slug: ${slug}`);
  const expectedAssets = slugValid ? [`img/editorial/${slug}.jpg`, `img/editorial/${slug}.thumb.jpg`].sort() : [];
  const assetsValid = assets.length === 2 && JSON.stringify([...assets].sort()) === JSON.stringify(expectedAssets);
  check(assetsValid, `Asset paths must exactly match slug. Expected ${JSON.stringify(expectedAssets)}, got ${JSON.stringify(assets)}`);
  if (!articleValid || !slugValid || !assetsValid) return [];

  const publishable = [articlePath, ...assets].sort();
  for (const relative of publishable) {
    const packaged = path.join(current, 'draft', relative);
    check(isRegularFileWithoutSymlink(packaged), `Packaged publication file is missing or unsafe: ${relative}`);
    const normalized = path.relative(path.join(current, 'draft'), packaged).split(path.sep).join('/');
    check(normalized === relative && !normalized.startsWith('../'), `Package path escapes draft root: ${relative}`);
    if (checkCollisions) check(!fs.existsSync(path.join(repoRoot, relative)), `Live publication target already exists: ${relative}`);
  }
  return publishable;
}

let expected = [];
if (stagedMode) {
  check(isRegularFileWithoutSymlink(scopeFile), 'validation/path-scope.txt is missing; validate package scope before staging');
  const manifestPath = path.join(current, 'manifest.json');
  const manifest = isRegularFileWithoutSymlink(manifestPath) ? readJson(manifestPath) : null;
  check(manifest?.status === 'approved', `Staged publication requires approved manifest, found ${manifest?.status || 'missing'}`);
  check(approvalRefIsValid(manifest), 'Approved manifest lacks an active manual or standing publication authority');
  check(/^[a-f0-9]{64}$/.test(manifest?.approval_artifact_sha256 || ''), 'Approved manifest lacks approval_artifact_sha256');
  check(/^[a-f0-9]{64}$/.test(manifest?.approval_package_sha256 || ''), 'Approved manifest lacks approval_package_sha256');
  check(/^[a-f0-9]{64}$/.test(manifest?.approval_render_context_sha256 || ''), 'Approved manifest lacks approval_render_context_sha256');
  check(/^[a-f0-9]{40}$/.test(manifest?.approval_base_sha || ''), 'Approved manifest lacks approval_base_sha');

  const finalValidationPath = path.join(validationDir, 'validation.json');
  const finalValidation = isRegularFileWithoutSymlink(finalValidationPath) ? readJson(finalValidationPath) : null;
  check(finalValidation?.result === 'PASS' && finalValidation?.stage === 'final', 'Staged publication requires a PASS final validation report');
  check(finalValidation?.run_id === manifest?.run_id, 'Final validation report does not match the approved run');
  const approvedRaw = manifest?.approved_at_kst || '';
  const validatedRaw = finalValidation?.generated_at || '';
  const approvedAt = Date.parse(approvedRaw);
  const validatedAt = Date.parse(validatedRaw);
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(approvedRaw) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(validatedRaw) && Number.isFinite(approvedAt) && Number.isFinite(validatedAt) && validatedAt >= approvedAt, 'Final validation must be regenerated after approval');

  const recorded = isRegularFileWithoutSymlink(scopeFile)
    ? fs.readFileSync(scopeFile, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).sort()
    : [];
  expected = expectedPackagePaths({ checkCollisions: false });
  check(JSON.stringify(recorded) === JSON.stringify(expected), `Recorded path scope is stale or edited. Derived ${JSON.stringify(expected)}, recorded ${JSON.stringify(recorded)}`);
  const recordedHashes = finalValidation?.package_sha256 || {};
  check(JSON.stringify(Object.keys(recordedHashes).sort()) === JSON.stringify(expected), 'Final validation hash set does not exactly match publication scope');
  for (const file of expected) {
    const packaged = path.join(current, 'draft', file);
    if (isRegularFileWithoutSymlink(packaged)) {
      const actualHash = createHash('sha256').update(fs.readFileSync(packaged)).digest('hex');
      check(recordedHashes[file] === actualHash, `Packaged file changed after final validation: ${file}`);
    }
  }
  const combined = combinedPackageDigest(expected);
  const render = renderContextDigest();
  const head = git(['rev-parse', 'HEAD']);
  const artifact = head.status === 0 && combined ? approvalArtifactDigest(head.stdout.trim(), combined, render.sha256) : null;
  check(Boolean(artifact) && artifact === manifest?.approval_artifact_sha256 && combined === manifest?.approval_package_sha256 && render.sha256 === manifest?.approval_render_context_sha256 && head.stdout?.trim() === manifest?.approval_base_sha, 'Current package, base, or approval context does not match the authorized artifact digest');

  const branch = git(['branch', '--show-current']);
  check(branch.status === 0 && branch.stdout.trim() === 'gh-pages', `Publication must stage from gh-pages, found ${branch.stdout?.trim() || 'unknown'}`);
  const upstreamName = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  check(upstreamName.status === 0 && upstreamName.stdout.trim() === 'origin/gh-pages', 'gh-pages must track origin/gh-pages');
  const originUrl = git(['remote', 'get-url', 'origin']);
  check(originUrl.status === 0 && /^(?:https:\/\/github\.com\/jellyggumi\/jellyggumi\.github\.io\.git|git@github\.com:jellyggumi\/jellyggumi\.github\.io\.git)$/.test(originUrl.stdout.trim()), 'origin must be the JellyGGumi GitHub repository');
  const fetched = git(['fetch', '--quiet', 'origin', 'gh-pages']);
  check(fetched.status === 0, `Cannot fetch origin/gh-pages before staged verification: ${fetched.stderr || fetched.stdout}`);
  const upstream = git(['rev-parse', '@{upstream}']);
  check(fetched.status === 0 && head.status === 0 && upstream.status === 0 && head.stdout.trim() === upstream.stdout.trim(), 'HEAD must exactly match its fetched upstream before staging');

  const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMRD']);
  check(names.status === 0, `Cannot inspect staged paths: ${names.stderr || names.stdout}`);
  const staged = names.status === 0 ? names.stdout.split('\n').map((line) => line.trim()).filter(Boolean).sort() : [];
  check(staged.length > 0, 'No staged publication paths found');
  check(JSON.stringify(staged) === JSON.stringify(expected), `Staged paths do not exactly match validated scope. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(staged)}`);
  const completeStatus = git(['status', '--porcelain=v1', '--untracked-files=all']);
  const statusLines = completeStatus.status === 0 ? completeStatus.stdout.split('\n').filter(Boolean) : [];
  check(completeStatus.status === 0 && statusLines.length === expected.length && statusLines.every((line) => line.startsWith('A  ') && expected.includes(line.slice(3))), 'Repository contains changes outside the three staged publication paths');

  const statusesResult = git(['diff', '--cached', '--name-status', '--diff-filter=ACMRD']);
  const statuses = statusesResult.status === 0 ? statusesResult.stdout.trim().split('\n').filter(Boolean).map((line) => line.split(/\s+/)) : [];
  check(statusesResult.status === 0 && statuses.length === expected.length && statuses.every(([status, file]) => status === 'A' && expected.includes(file)), 'Every publication path must be a newly added file, never a modification or replacement');

  for (const file of expected) {
    const packaged = path.join(current, 'draft', file);
    const inHead = git(['cat-file', '-e', `HEAD:${file}`]);
    check(inHead.status !== 0, `Publication target already exists in HEAD: ${file}`);
    const stagedBlob = git(['show', `:${file}`], null);
    check(stagedBlob.status === 0, `Cannot read staged file content: ${file}`);
    if (isRegularFileWithoutSymlink(packaged) && stagedBlob.status === 0) check(stagedBlob.stdout.equals(fs.readFileSync(packaged)), `Staged file differs from validated package: ${file}`);
    const unstaged = git(['diff', '--name-only', '--', file]);
    check(unstaged.status === 0 && unstaged.stdout.trim() === '', `Publication path has unstaged changes: ${file}`);
    const indexEntry = git(['ls-files', '--stage', '--', file]);
    check(indexEntry.status === 0 && /^100644\s/.test(indexEntry.stdout), `Publication path must be a regular 100644 file: ${file}`);
  }
} else {
  expected = expectedPackagePaths();
  fs.mkdirSync(validationDir, { recursive: true });
  if (!failures.length) fs.writeFileSync(scopeFile, `${expected.join('\n')}\n`);
}

if (failures.length) {
  console.error(`Publication scope verification failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Publication scope verification passed (${stagedMode ? 'staged' : 'package'}): ${expected.length} exact path(s).`);
