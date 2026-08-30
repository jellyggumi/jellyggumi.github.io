#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
let rootValue = process.cwd();
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--root') {
    rootValue = argv[i + 1] || '';
    i += 1;
  } else if (!argv[i].startsWith('--')) rootValue = argv[i];
  else throw new Error(`Unknown argument: ${argv[i]}`);
}

const root = path.resolve(rootValue);
const current = path.join(root, '_workspace', 'current');
const manifestPath = path.join(current, 'manifest.json');
const validationPath = path.join(current, 'validation', 'validation.json');
const scopePath = path.join(current, 'validation', 'path-scope.txt');
const standingPublishRoutineId = 'h78L2R0UJFRhjS9O';
const standingApprovalRef = `standing-routine:${standingPublishRoutineId}`;
const standingApprovalGrantedOn = '"2026-08-30"';
const manualApprovalRef = /^(?:aside-confirmation|human-review):[A-Za-z0-9._-]{6,}$/;

function regularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function readJson(file) {
  if (!regularFile(file)) throw new Error(`Missing or unsafe file: ${path.relative(root, file)}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function standingApprovalIsActive(manifest) {
  if (manifest.mode !== 'publish-on-green' || manifest.publication_requires_confirmation !== false || manifest.approval_ref !== standingApprovalRef) return false;
  const policyPath = path.join(root, '.claude', 'editorial-policy.yml');
  if (!regularFile(policyPath)) return false;
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
  if (!manualApprovalRef.test(manifest.approval_ref || '') || manifest.mode !== 'draft-only' || manifest.publication_requires_confirmation !== true) return false;
  const policyPath = path.join(root, '.claude', 'editorial-policy.yml');
  if (!regularFile(policyPath)) return false;
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

function git(args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

function combinedDigest(paths) {
  const digest = createHash('sha256');
  for (const relative of [...paths].sort()) {
    const source = path.join(current, 'draft', relative);
    if (!regularFile(source)) throw new Error(`Package file is missing or unsafe: ${relative}`);
    digest.update(relative);
    digest.update('\0');
    digest.update(fs.readFileSync(source));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function renderContextDigest() {
  const files = [];
  const visit = (absolute) => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const full = path.join(absolute, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Render context contains a symlink: ${path.relative(root, full)}`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  for (const relative of ['_config.yml', '.claude/editorial-policy.yml']) {
    if (regularFile(path.join(root, relative))) files.push(relative);
  }
  for (const relative of ['_layouts', '_includes', 'css', 'js']) {
    const absolute = path.join(root, relative);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) visit(absolute);
  }
  files.sort();
  const digest = createHash('sha256');
  for (const relative of files) {
    digest.update(relative); digest.update('\0'); digest.update(fs.readFileSync(path.join(root, relative))); digest.update('\0');
  }
  return { sha256: digest.digest('hex'), files };
}

function approvalDigest(baseSha, packageSha, renderSha) {
  return createHash('sha256').update('base\0').update(baseSha).update('\0').update('package\0').update(packageSha).update('\0').update('render\0').update(renderSha).update('\0').digest('hex');
}

const manifest = readJson(manifestPath);
const validation = readJson(validationPath);
if (manifest.status !== 'approved') throw new Error(`Package application requires approved status, found ${manifest.status}`);
if (!approvalRefIsValid(manifest)) throw new Error('Approved manifest lacks an active manual or standing publication authority');
if (!/^[a-f0-9]{64}$/.test(manifest.approval_artifact_sha256 || '')) throw new Error('Approved manifest lacks approval_artifact_sha256');
if (validation.result !== 'PASS' || validation.stage !== 'final' || validation.run_id !== manifest.run_id) throw new Error('A matching PASS final validation report is required');
const approvedRaw = manifest.approved_at_kst || '';
const validatedRaw = validation.generated_at || '';
const approvedAt = Date.parse(approvedRaw);
const validatedAt = Date.parse(validatedRaw);
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(approvedRaw) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(validatedRaw) || !Number.isFinite(approvedAt) || !Number.isFinite(validatedAt) || validatedAt < approvedAt) throw new Error('Final validation must be regenerated after approval');

const paths = regularFile(scopePath) ? fs.readFileSync(scopePath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).sort() : [];
const expected = [manifest.article_path, ...(Array.isArray(manifest.asset_paths) ? manifest.asset_paths : [])].filter(Boolean).sort();
if (paths.length !== 3 || JSON.stringify(paths) !== JSON.stringify(expected)) throw new Error('Publication scope is missing, stale or not exactly three paths');
const packageSha = combinedDigest(paths);
const render = renderContextDigest();
const currentHead = git(['rev-parse', 'HEAD']);
if (currentHead.status !== 0) throw new Error('Cannot read current git HEAD');
const artifactSha = approvalDigest(currentHead.stdout.trim(), packageSha, render.sha256);
if (artifactSha !== manifest.approval_artifact_sha256 || packageSha !== manifest.approval_package_sha256 || render.sha256 !== manifest.approval_render_context_sha256 || currentHead.stdout.trim() !== manifest.approval_base_sha) throw new Error('Current package, base, or approval context does not match the authorized artifact digest');
if (JSON.stringify(Object.keys(validation.package_sha256 || {}).sort()) !== JSON.stringify(paths)) throw new Error('Final validation hash set does not match publication scope');
for (const relative of paths) {
  const source = path.join(current, 'draft', relative);
  const actual = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  if (validation.package_sha256[relative] !== actual) throw new Error(`Package changed after final validation: ${relative}`);
}

const branch = git(['branch', '--show-current']);
if (branch.status !== 0 || branch.stdout.trim() !== 'gh-pages') throw new Error(`Package application requires gh-pages, found ${branch.stdout.trim() || 'unknown'}`);
const upstreamName = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
if (upstreamName.status !== 0 || upstreamName.stdout.trim() !== 'origin/gh-pages') throw new Error('gh-pages must track origin/gh-pages');
const originUrl = git(['remote', 'get-url', 'origin']);
if (originUrl.status !== 0 || !/^(?:https:\/\/github\.com\/jellyggumi\/jellyggumi\.github\.io\.git|git@github\.com:jellyggumi\/jellyggumi\.github\.io\.git)$/.test(originUrl.stdout.trim())) throw new Error('origin must be the JellyGGumi GitHub repository');
const fetched = git(['fetch', '--quiet', 'origin', 'gh-pages']);
if (fetched.status !== 0) throw new Error(`Cannot fetch origin/gh-pages before package application: ${fetched.stderr || fetched.stdout}`);
const head = git(['rev-parse', 'HEAD']);
const upstream = git(['rev-parse', '@{upstream}']);
if (head.status !== 0 || upstream.status !== 0 || head.stdout.trim() !== upstream.stdout.trim()) throw new Error('HEAD must exactly match its fetched upstream before package application');
const staged = git(['diff', '--cached', '--name-only']);
if (staged.status !== 0 || staged.stdout.trim() !== '') throw new Error('Index must be empty before package application');
const worktreeDirty = git(['status', '--porcelain=v1', '--untracked-files=all']);
if (worktreeDirty.status !== 0 || worktreeDirty.stdout.trim() !== '') throw new Error('The repository worktree and index must be fully clean before package application');

for (const relative of paths) {
  if (!/^(_posts\/\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9-]*\.md|img\/editorial\/[a-z0-9][a-z0-9.-]*\.jpg)$/.test(relative)) throw new Error(`Unsafe publication path: ${relative}`);
  if (fs.existsSync(path.join(root, relative))) throw new Error(`Publication target already exists on disk: ${relative}`);
  if (git(['cat-file', '-e', `HEAD:${relative}`]).status === 0) throw new Error(`Publication target already exists in HEAD: ${relative}`);
}

const created = [];
try {
  for (const relative of paths) {
    const source = path.join(current, 'draft', relative);
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o644);
    created.push(destination);
  }
} catch (error) {
  for (const file of created.reverse()) {
    try { fs.unlinkSync(file); } catch {}
  }
  throw error;
}

for (const relative of paths) {
  const source = path.join(current, 'draft', relative);
  const destination = path.join(root, relative);
  if (!fs.readFileSync(source).equals(fs.readFileSync(destination))) throw new Error(`Copied file differs from package: ${relative}`);
}

console.log(JSON.stringify({
  run_id: manifest.run_id,
  copied: paths,
  staged: false,
  next_command: `git add -- ${paths.map((item) => JSON.stringify(item)).join(' ')}`
}, null, 2));
