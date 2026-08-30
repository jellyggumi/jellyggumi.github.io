#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { MIN_REFERENCE_IMAGES, derivePackagePaths, imageContentTypePattern } from './lib/source-images.mjs';

const args = process.argv.slice(2);
const command = args.shift() || 'status';
const options = new Map();
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
  const key = arg.slice(2);
  const next = args[i + 1];
  if (!next || next.startsWith('--')) options.set(key, true);
  else {
    options.set(key, next);
    i += 1;
  }
}

const repoRoot = path.resolve(String(options.get('root') || process.cwd()));
const workspaceRoot = path.join(repoRoot, '_workspace');
const currentDir = path.join(workspaceRoot, 'current');
const archiveDir = path.join(workspaceRoot, 'archive');
const archiveSealDir = path.join(workspaceRoot, 'archive-seals');
const manifestPath = path.join(currentDir, 'manifest.json');
const lanes = ['research', 'evidence', 'draft', 'review', 'validation', 'messages'];
const standingPublishRoutineId = 'h78L2R0UJFRhjS9O';
const standingApprovalRef = `standing-routine:${standingPublishRoutineId}`;
const standingApprovalGrantedOn = '2026-08-30';
const manualApprovalRef = /^(?:aside-confirmation|human-review):[A-Za-z0-9._-]{6,}$/;

function kstParts(date = new Date()) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  return {
    year: shifted.getUTCFullYear(),
    month: pad(shifted.getUTCMonth() + 1),
    day: pad(shifted.getUTCDate()),
    hour: pad(shifted.getUTCHours()),
    minute: pad(shifted.getUTCMinutes()),
    second: pad(shifted.getUTCSeconds())
  };
}

function kstIso(date = new Date()) {
  const p = kstParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
}

function safePostDate(minutes = 60) {
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
    throw new Error(`Safety margin must be 1..1440 minutes, received ${minutes}`);
  }
  const p = kstParts(new Date(Date.now() - minutes * 60 * 1000));
  return `${p.year}-${p.month}-${p.day}`;
}

function ensureBase() {
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.mkdirSync(archiveSealDir, { recursive: true });
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function writeManifest(manifest) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const runLockPath = path.join(currentDir, '.run-lock.json');
function readRunLock() {
  if (!regularFile(runLockPath)) return null;
  return readJson(runLockPath);
}

function assertRunOwnership(manifest) {
  const requestedRunId = String(options.get('run-id') || '');
  if (requestedRunId !== manifest.run_id) throw new Error(`Mutation requires --run-id ${manifest.run_id}`);
  const lock = readRunLock();
  if (!lock || lock.run_id !== manifest.run_id || lock.lock_id !== manifest.run_lock_id) {
    throw new Error('Current run ownership marker is missing or does not match the manifest');
  }
  return lock;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function regularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function normalizedHtmlText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/\s+/g, ' ').trim();
}

function git(args, encoding = 'utf8') {
  return spawnSync('git', args, { cwd: repoRoot, encoding });
}

function packageDigest(manifest) {
  // The approval digest always covers the derived package: one post, the two
  // AI cover files and every validated source-derived reference image.
  const derived = derivePackagePaths(manifest);
  if (derived.errors.length) throw new Error(`Approval digest package is invalid: ${derived.errors[0]}`);
  const paths = derived.all;
  const digest = createHash('sha256');
  for (const relative of paths) {
    const file = path.join(currentDir, 'draft', relative);
    if (!regularFile(file)) throw new Error(`Approval package file is missing or unsafe: ${relative}`);
    digest.update(relative);
    digest.update('\0');
    digest.update(fs.readFileSync(file));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function renderContextDigest() {
  const roots = ['_layouts', '_includes', 'css', 'js'];
  const files = [];
  const visit = (absolute) => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const full = path.join(absolute, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Render context contains a symlink: ${path.relative(repoRoot, full)}`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  };
  for (const relative of ['_config.yml', '.claude/editorial-policy.yml']) {
    if (regularFile(path.join(repoRoot, relative))) files.push(relative);
  }
  for (const relative of roots) {
    const absolute = path.join(repoRoot, relative);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) visit(absolute);
  }
  files.sort();
  const digest = createHash('sha256');
  for (const relative of files) {
    digest.update(relative);
    digest.update('\0');
    digest.update(fs.readFileSync(path.join(repoRoot, relative)));
    digest.update('\0');
  }
  return { sha256: digest.digest('hex'), files };
}

function approvalArtifacts(manifest) {
  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0 || !/^[a-f0-9]{40}$/.test(head.stdout.trim())) throw new Error('Approval requires a valid git HEAD');
  const packageSha256 = packageDigest(manifest);
  const render = renderContextDigest();
  const digest = createHash('sha256')
    .update('base\0').update(head.stdout.trim()).update('\0')
    .update('package\0').update(packageSha256).update('\0')
    .update('render\0').update(render.sha256).update('\0')
    .digest('hex');
  return { digest, baseSha: head.stdout.trim(), packageSha256, renderSha256: render.sha256, renderFiles: render.files };
}

function requiredGateVerdicts(manifest) {
  const required = [...(manifest?.mode === 'publish-on-green' ? ['GT'] : []), ...Array.from({ length: 11 }, (_, index) => `G${index + 1}`)];
  const missing = required.filter((key) => {
    const gate = manifest?.gates?.[key];
    const verdict = typeof gate === 'string' ? gate : gate?.verdict;
    return verdict !== 'PASS';
  });
  if (missing.length) throw new Error(`Required gates are not PASS: ${missing.join(', ')}`);
}

function assertReadyEvidence(manifest) {
  requiredGateVerdicts(manifest);
  const validationPath = path.join(currentDir, 'validation', 'validation.json');
  const reviewPath = path.join(currentDir, 'review', 'editorial-review.json');
  if (!regularFile(validationPath)) throw new Error('Ready status requires validation/validation.json');
  if (!regularFile(reviewPath)) throw new Error('Ready status requires review/editorial-review.json');
  const validation = readJson(validationPath);
  const review = readJson(reviewPath);
  if (validation.result !== 'PASS' || validation.stage !== 'final' || validation.run_id !== manifest.run_id || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(validation.generated_at || '') || !Number.isFinite(Date.parse(validation.generated_at || ''))) {
    throw new Error('Ready status requires a matching, timestamped PASS final validation report');
  }
  if (review.verdict !== 'PASS' || Number(review.claim_coverage) !== 1) {
    throw new Error('Ready status requires a PASS independent review with claim_coverage 1.0');
  }
  const artifacts = approvalArtifacts(manifest);
  const derived = derivePackagePaths(manifest);
  if (derived.errors.length) throw new Error(`Ready package paths are invalid: ${derived.errors[0]}`);
  const expectedPaths = derived.all;
  if (JSON.stringify(Object.keys(validation.package_sha256 || {}).sort()) !== JSON.stringify(expectedPaths)) {
    throw new Error('Final validation hash set does not exactly match the package');
  }
  for (const relative of expectedPaths) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(currentDir, 'draft', relative))).digest('hex');
    if (validation.package_sha256[relative] !== actual) throw new Error(`Package changed after final validation: ${relative}`);
  }
  return { artifacts, validation };
}

const lifecycleLockPath = path.join(workspaceRoot, '.lifecycle.lock');
function withLifecycleLock(action, callback) {
  ensureBase();
  let handle;
  try {
    handle = fs.openSync(lifecycleLockPath, 'wx');
    fs.writeFileSync(handle, `${JSON.stringify({ action, pid: process.pid, created_at_kst: kstIso() })}\n`);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Editorial lifecycle is locked: ${lifecycleLockPath}`);
    throw error;
  }
  try {
    return callback();
  } finally {
    try { fs.closeSync(handle); } catch {}
    try { fs.unlinkSync(lifecycleLockPath); } catch {}
  }
}

function uniqueArchivePath(runId) {
  let candidate = path.join(archiveDir, runId);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(archiveDir, `${runId}-${suffix}`);
    suffix += 1;
  }
  return candidate;
}

function archiveInventory(dir) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'archive-manifest.json') continue;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Archive contains a forbidden symlink: ${full}`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(full);
        files.push({
          path: path.relative(dir, full).split(path.sep).join('/'),
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex')
        });
      }
    }
  };
  visit(dir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function makeArchiveReadOnly(dir) {
  const directories = [];
  const visit = (current) => {
    directories.push(current);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) fs.chmodSync(full, 0o444);
    }
  };
  visit(dir);
  directories.sort((a, b) => b.length - a.length);
  for (const directory of directories) fs.chmodSync(directory, 0o555);
}

function sealArchive(dir, runId) {
  const seal = {
    schema_version: 2,
    archive_dir: path.basename(dir),
    run_id: runId,
    sealed_at_kst: kstIso(),
    algorithm: 'sha256',
    read_only: true,
    files: archiveInventory(dir)
  };
  const sealPath = path.join(dir, 'archive-manifest.json');
  fs.writeFileSync(sealPath, `${JSON.stringify(seal, null, 2)}\n`);
  const sealHash = createHash('sha256').update(fs.readFileSync(sealPath)).digest('hex');
  const anchorPath = path.join(archiveSealDir, `${path.basename(dir)}.sha256`);
  fs.chmodSync(archiveSealDir, 0o755);
  try {
    fs.writeFileSync(anchorPath, `${sealHash}  ${path.basename(dir)}/archive-manifest.json\n`, { flag: 'wx', mode: 0o444 });
    fs.chmodSync(anchorPath, 0o444);
  } finally {
    fs.chmodSync(archiveSealDir, 0o555);
  }
  makeArchiveReadOnly(dir);
  return seal;
}

function verifyArchives() {
  ensureBase();
  const results = [];
  for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(archiveDir, entry.name);
    const sealPath = path.join(dir, 'archive-manifest.json');
    if (!regularFile(sealPath)) throw new Error(`Archive is not sealed: ${entry.name}`);
    const seal = readJson(sealPath);
    if (seal.algorithm !== 'sha256') throw new Error(`Archive uses an unsupported algorithm: ${entry.name}`);
    if (!nonemptyRunId(seal.run_id)) throw new Error(`Archive seal has an invalid run id: ${entry.name}`);
    if (seal.schema_version === 2) {
      if (seal.archive_dir !== entry.name) throw new Error(`Archive directory does not match its seal: ${entry.name}`);
      if (entry.name !== seal.run_id && !entry.name.startsWith(`${seal.run_id}-`)) throw new Error(`Archive run id does not match its directory: ${entry.name}`);
      if (seal.read_only !== true) throw new Error(`Archive seal is not marked read-only: ${entry.name}`);
      const anchorPath = path.join(archiveSealDir, `${entry.name}.sha256`);
      if (!regularFile(anchorPath)) throw new Error(`Archive seal anchor is missing: ${entry.name}`);
      const anchoredHash = fs.readFileSync(anchorPath, 'utf8').trim().split(/\s+/)[0];
      const actualSealHash = createHash('sha256').update(fs.readFileSync(sealPath)).digest('hex');
      if (!/^[a-f0-9]{64}$/.test(anchoredHash) || anchoredHash !== actualSealHash) throw new Error(`Archive seal anchor mismatch: ${entry.name}`);
      if ((fs.statSync(anchorPath).mode & 0o222) !== 0) throw new Error(`Archive seal anchor is writable: ${entry.name}`);
    } else if (seal.schema_version === 1) {
      throw new Error(`Legacy schema-1 archive is unanchored and cannot be trusted automatically: ${entry.name}`);
    } else {
      throw new Error(`Unsupported archive schema: ${seal.schema_version}`);
    }
    const actual = archiveInventory(dir);
    if (JSON.stringify(actual) !== JSON.stringify(seal.files)) throw new Error(`Archive integrity check failed: ${entry.name}`);
    if (seal.schema_version === 2) {
      for (const file of [sealPath, ...actual.map((item) => path.join(dir, item.path))]) {
        if ((fs.statSync(file).mode & 0o222) !== 0) throw new Error(`Archive file is writable: ${path.relative(archiveDir, file)}`);
      }
    }
    results.push({ run_id: entry.name, sealed_run_id: seal.run_id, schema_version: seal.schema_version, files: actual.length, verified: true });
  }
  for (const anchor of fs.readdirSync(archiveSealDir, { withFileTypes: true })) {
    if (!anchor.isFile() || !anchor.name.endsWith('.sha256')) continue;
    const archiveName = anchor.name.slice(0, -'.sha256'.length);
    if (!fs.existsSync(path.join(archiveDir, archiveName))) throw new Error(`Archive seal anchor has no archive: ${archiveName}`);
  }
  return results;
}

function nonemptyRunId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{5,100}$/.test(value);
}

function archiveCurrent(reason = 'superseded', { allowReadyForReview = false } = {}) {
  ensureBase();
  if (!fs.existsSync(currentDir)) return null;
  const entries = fs.readdirSync(currentDir);
  if (entries.length === 0) return null;

  const manifest = readManifest();
  if (!manifest) throw new Error('Current workspace contains files but no manifest; refusing to archive it');
  const runLock = readRunLock();
  if (!runLock || runLock.run_id !== manifest.run_id || runLock.lock_id !== manifest.run_lock_id) {
    throw new Error('Current workspace ownership marker is missing or does not match the manifest');
  }
  const activeStatuses = ['researching', 'drafting', 'reviewing', 'approved'];
  if (activeStatuses.includes(manifest.status)) {
    throw new Error(`Current run ${manifest.run_id} is still ${manifest.status}; mark it blocked/rejected or finish it before starting another run`);
  }
  if (manifest.status === 'ready_for_review' && !allowReadyForReview) throw new Error(`Current run ${manifest.run_id} is awaiting human review; start cannot archive it`);
  const archivableStatuses = ['published', 'ready_for_review', 'rejected', 'blocked'];
  if (!archivableStatuses.includes(manifest.status)) throw new Error(`Current run has an unarchivable status: ${manifest.status}`);
  if (manifest.status !== 'ready_for_review' && runLock.state !== 'closed') throw new Error(`Terminal run lock is not closed: ${manifest.run_id}`);

  const runId = String(manifest.run_id).replace(/[^a-zA-Z0-9._-]+/g, '-');
  const destination = uniqueArchivePath(runId);

  fs.renameSync(currentDir, destination);
  fs.writeFileSync(
    path.join(destination, 'ARCHIVED.md'),
    `# Archived editorial run\n\n- Run: \`${runId}\`\n- Archived: ${kstIso()}\n- Final status: \`${manifest.status || 'unknown'}\`\n- Reason: ${reason}\n\nThis directory is immutable by project rule. Start a new run in \`_workspace/current/\`; never edit or delete this archive.\n`
  );
  sealArchive(destination, runId);
  return destination;
}

function scaffoldCurrent(manifest) {
  fs.mkdirSync(currentDir, { recursive: true });
  for (const lane of lanes) fs.mkdirSync(path.join(currentDir, lane), { recursive: true });
  fs.mkdirSync(path.join(currentDir, 'draft', '_posts'), { recursive: true });
  fs.mkdirSync(path.join(currentDir, 'draft', 'img', 'editorial'), { recursive: true });
  fs.mkdirSync(path.join(currentDir, 'draft', 'img', 'source'), { recursive: true });
  writeManifest(manifest);
  fs.writeFileSync(runLockPath, `${JSON.stringify({ schema_version: 1, run_id: manifest.run_id, lock_id: manifest.run_lock_id, state: 'active', created_at_kst: manifest.started_at_kst }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(
    path.join(currentDir, 'tasks.json'),
    `${JSON.stringify({ run_id: manifest.run_id, tasks: [] }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(currentDir, 'run-summary.md'),
    `# Editorial run ${manifest.run_id}\n\n- Status: ${manifest.status}\n- Target date: ${manifest.target_date}\n- Mode: ${manifest.mode}\n- Publication: NOT PUBLISHED\n\n## Trend signal\n\nPending research.\n\n## Topic decision\n\nPending research.\n\n## Gate table\n\n| Gate | Verdict | Evidence |\n|---|---|---|\n`
  );
}

function publicationPolicy() {
  const policyPath = path.join(repoRoot, '.claude', 'editorial-policy.yml');
  if (!regularFile(policyPath)) throw new Error('Missing or unsafe .claude/editorial-policy.yml');
  const policy = fs.readFileSync(policyPath, 'utf8');
  const values = (key) => [...policy.matchAll(new RegExp(`^${key}:\\s*([^\\n#]+)`, 'gm'))].map((match) => match[1].trim());
  const single = (key) => {
    const matches = values(key);
    if (matches.length !== 1) throw new Error(`Scheduled workspace requires exactly one ${key}`);
    return matches[0];
  };
  const mode = single('publication_mode');
  const standing = single('standing_publish_approval');
  if (!((mode === 'draft-only' && standing === 'false') || (mode === 'publish-on-green' && standing === 'true'))) {
    throw new Error('Publication policy must be draft-only/false or publish-on-green/true');
  }
  if (mode === 'publish-on-green') {
    if (single('standing_publish_routine_id') !== standingPublishRoutineId) throw new Error(`publish-on-green is authorized only for routine ${standingPublishRoutineId}`);
    const grantedOn = single('standing_publish_approval_granted_on').replace(/^['"]|['"]$/g, '');
    if (grantedOn !== standingApprovalGrantedOn) throw new Error(`Standing publication approval must remain pinned to ${standingApprovalGrantedOn}`);
  }
  if (single('max_articles_per_run') !== '1') throw new Error('Scheduled workspace permits at most one article per run');
  if (single('max_revision_loops') !== '2') throw new Error('Scheduled workspace permits at most two revision loops');
  const typeHeaders = [...policy.matchAll(/^allowed_content_types:\s*$/gm)];
  const typeBlock = policy.match(/^allowed_content_types:\s*\n((?:\s+-\s*[^\n]+\n?)*)/m)?.[1] || '';
  const types = typeBlock.split('\n').map((line) => line.match(/^\s+-\s*(.+)$/)?.[1]?.trim()).filter(Boolean);
  if (typeHeaders.length !== 1 || JSON.stringify(types) !== JSON.stringify(['guide'])) throw new Error('Scheduled workspace allows only content_type: guide');
  return { mode, publicationRequiresConfirmation: mode !== 'publish-on-green' };
}

function approvalRefIsValid(manifest, approvalRef) {
  if (manualApprovalRef.test(approvalRef)) return manifest.mode === 'draft-only' && manifest.publication_requires_confirmation === true && publicationPolicy().mode === 'draft-only';
  if (approvalRef !== standingApprovalRef || manifest.mode !== 'publish-on-green' || manifest.publication_requires_confirmation !== false) return false;
  return publicationPolicy().mode === 'publish-on-green';
}

function start() {
  const runId = String(options.get('run-id') || '');
  const targetDate = String(options.get('target-date') || '');
  if (!nonemptyRunId(runId)) throw new Error('start requires --run-id with 6-101 safe characters');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new Error('start requires --target-date YYYY-MM-DD');

  return withLifecycleLock('start', () => {
    const publication = publicationPolicy();
    verifyArchives();
    const archived = archiveCurrent('superseded');
    const manifest = {
      schema_version: 1,
      run_id: runId,
      started_at_kst: kstIso(),
      target_date: targetDate,
      mode: publication.mode,
      status: 'researching',
      topic: null,
      slug: null,
      thesis: null,
      content_type: null,
      experience_mode: null,
      observation_anchor: null,
      category: null,
      tags: [],
      article_path: null,
      asset_paths: [],
      reference_image_paths: [],
      revision_loops: 0,
      publication_requires_confirmation: publication.publicationRequiresConfirmation,
      standing_publish_routine_id: publication.mode === 'publish-on-green' ? standingPublishRoutineId : null,
      approval_ref: null,
      approval_artifact_sha256: null,
      approval_package_sha256: null,
      approval_render_context_sha256: null,
      approval_base_sha: null,
      run_lock_id: randomBytes(16).toString('hex'),
      gates: {}
    };
    scaffoldCurrent(manifest);
    console.log(JSON.stringify({ current: currentDir, archived, manifest }, null, 2));
  });
}

function setStatus() {
  const nextStatus = String(options.get('status') || '');
  const allowed = ['researching', 'drafting', 'reviewing', 'ready_for_review', 'approved', 'published', 'rejected', 'blocked'];
  if (!allowed.includes(nextStatus)) throw new Error(`--status must be one of ${allowed.join(', ')}`);
  const manifest = readManifest();
  if (!manifest) throw new Error('No current manifest found');
  const runLock = assertRunOwnership(manifest);

  const transitions = {
    researching: ['drafting', 'rejected', 'blocked'],
    drafting: ['reviewing', 'rejected', 'blocked'],
    reviewing: ['ready_for_review', 'rejected', 'blocked'],
    ready_for_review: ['approved', 'rejected', 'blocked'],
    approved: ['published', 'blocked'],
    published: [],
    rejected: [],
    blocked: []
  };
  if (!transitions[manifest.status]?.includes(nextStatus)) {
    throw new Error(`Invalid status transition: ${manifest.status} -> ${nextStatus}`);
  }

  if (nextStatus === 'ready_for_review') {
    const { artifacts, validation } = assertReadyEvidence(manifest);
    manifest.ready_artifact_sha256 = artifacts.digest;
    manifest.ready_package_sha256 = artifacts.packageSha256;
    manifest.ready_render_context_sha256 = artifacts.renderSha256;
    manifest.ready_base_sha = artifacts.baseSha;
    manifest.ready_render_context_files = artifacts.renderFiles;
    manifest.ready_validation_generated_at = validation.generated_at;
    manifest.ready_at_kst = kstIso();
  }

  if (nextStatus === 'approved') {
    const approvalRef = String(options.get('approval-ref') || '').trim();
    const artifactDigest = String(options.get('artifact-digest') || '').trim().toLowerCase();
    if (!approvalRefIsValid(manifest, approvalRef)) {
      throw new Error(`Approval requires a manual review reference or active ${standingApprovalRef} authority`);
    }
    if (!/^[a-f0-9]{64}$/.test(artifactDigest)) throw new Error('Approval requires --artifact-digest with 64 lowercase hex characters');
    const { artifacts } = assertReadyEvidence(manifest);
    if (artifactDigest !== artifacts.digest || artifactDigest !== manifest.ready_artifact_sha256 || artifacts.packageSha256 !== manifest.ready_package_sha256 || artifacts.renderSha256 !== manifest.ready_render_context_sha256 || artifacts.baseSha !== manifest.ready_base_sha) {
      throw new Error('Authorized artifact digest does not match the exact ready package and approval context');
    }
    manifest.approval_ref = approvalRef;
    manifest.approval_artifact_sha256 = artifactDigest;
    manifest.approval_package_sha256 = artifacts.packageSha256;
    manifest.approval_render_context_sha256 = artifacts.renderSha256;
    manifest.approval_base_sha = artifacts.baseSha;
    manifest.approved_at_kst = kstIso();
    for (const relative of ['validation/validation.json', 'validation/path-scope.txt']) {
      try { fs.unlinkSync(path.join(currentDir, relative)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  if (nextStatus === 'published') {
    if (!approvalRefIsValid(manifest, manifest.approval_ref || '') || !manifest.approval_artifact_sha256 || packageDigest(manifest) !== manifest.approval_package_sha256 || renderContextDigest().sha256 !== manifest.approval_render_context_sha256) {
      throw new Error('Published status requires the unchanged authorized package and approval context');
    }
    const proofPath = path.join(currentDir, 'validation', 'deployment-proof.json');
    if (!regularFile(proofPath)) throw new Error('Published status requires validation/deployment-proof.json');
    const proof = readJson(proofPath);
    const articleTitle = path.basename(manifest.article_path, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    const expectedPermalink = `https://jellyggumi.github.io/journal/${articleTitle}/`;
    const derived = derivePackagePaths(manifest);
    if (derived.errors.length) throw new Error(`Published package paths are invalid: ${derived.errors[0]}`);
    const expectedImagePaths = [...derived.assetPaths, ...derived.referenceImagePaths];
    const expectedImageUrls = expectedImagePaths.map((item) => `https://jellyggumi.github.io/${item}`).sort();
    const expectedImageDigests = new Map(expectedImagePaths.map((item) => [`https://jellyggumi.github.io/${item}`, createHash('sha256').update(fs.readFileSync(path.join(currentDir, 'draft', item))).digest('hex')]));
    const actualImageUrls = Array.isArray(proof.image_urls) ? proof.image_urls.map((item) => item?.url).sort() : [];
    const validImages = Array.isArray(proof.image_urls) && proof.image_urls.length === expectedImagePaths.length && proof.image_urls.every((item) => item?.status === 200 && Boolean(imageContentTypePattern(item?.url)?.test(item?.content_type || '')) && item?.sha256 === expectedImageDigests.get(item?.url)) && JSON.stringify(actualImageUrls) === JSON.stringify(expectedImageUrls);
    const proofTime = Date.parse(proof.verified_at || '');
    const normalizedProofTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(proof.verified_at || '') && Number.isFinite(proofTime) && proofTime <= Date.now() + 10 * 60 * 1000 && Date.now() - proofTime <= 30 * 60 * 1000;
    const validShaBinding = /^[a-f0-9]{40}$/.test(proof.remote_sha || '') && proof.pushed_sha === proof.remote_sha && proof.workflow_sha === proof.remote_sha;
    const verifierPath = path.join(repoRoot, 'tools', 'verify-deployment.mjs');
    const validVerifier = proof.verifier === 'tools/verify-deployment.mjs' && regularFile(verifierPath) && proof.verifier_sha256 === createHash('sha256').update(fs.readFileSync(verifierPath)).digest('hex');
    const articleSource = fs.readFileSync(path.join(currentDir, 'draft', manifest.article_path), 'utf8');
    const frontMatter = articleSource.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || '';
    const expectedTitle = (frontMatter.match(/^title:\s*(.*)$/m)?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
    const validContentProof = proof.expected_title === expectedTitle
      && proof.title_check === true
      && proof.body_check === true
      && proof.source_credits_check === true
      && Number.isInteger(proof.source_credit_count)
      && proof.source_credit_count >= MIN_REFERENCE_IMAGES
      && typeof proof.body_probe === 'string'
      && proof.body_probe.length >= 60
      && normalizedHtmlText(articleSource).includes(proof.body_probe);
    if (proof.schema_version !== 1 || !validVerifier || proof.run_id !== manifest.run_id || proof.approval_artifact_sha256 !== manifest.approval_artifact_sha256 || !validShaBinding || !/^https:\/\/github\.com\/jellyggumi\/jellyggumi\.github\.io\/actions\/runs\/\d+$/.test(proof.workflow_url || '') || proof.workflow_conclusion !== 'success' || proof.permalink !== expectedPermalink || proof.permalink_status !== 200 || !/^text\/html\b/i.test(proof.permalink_content_type || '') || !validContentProof || !validImages || !normalizedProofTime) {
      throw new Error('deployment-proof.json is incomplete, invalid, or does not match the authorized package');
    }
    const branch = git(['branch', '--show-current']);
    const origin = git(['remote', 'get-url', 'origin']);
    const fetched = git(['fetch', '--quiet', 'origin', 'gh-pages']);
    const head = git(['rev-parse', 'HEAD']);
    const upstream = git(['rev-parse', '@{upstream}']);
    const parent = git(['rev-parse', 'HEAD^']);
    const clean = git(['status', '--porcelain=v1', '--untracked-files=all']);
    if (fetched.status !== 0 || branch.status !== 0 || branch.stdout.trim() !== 'gh-pages' || origin.status !== 0 || !/^(?:https:\/\/github\.com\/jellyggumi\/jellyggumi\.github\.io\.git|git@github\.com:jellyggumi\/jellyggumi\.github\.io\.git)$/.test(origin.stdout.trim()) || head.status !== 0 || head.stdout.trim() !== proof.remote_sha || upstream.status !== 0 || upstream.stdout.trim() !== proof.remote_sha || parent.status !== 0 || parent.stdout.trim() !== manifest.approval_base_sha || clean.status !== 0 || clean.stdout.trim() !== '') {
      throw new Error('Deployment proof does not match clean local/upstream gh-pages HEAD, authorized parent, and origin');
    }
    const expectedPaths = derived.all;
    const commitDiff = git(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', 'HEAD']);
    const committed = commitDiff.status === 0 ? commitDiff.stdout.trim().split('\n').filter(Boolean).map((line) => line.split(/\s+/)).sort((a, b) => a[1].localeCompare(b[1])) : [];
    if (committed.length !== expectedPaths.length || !committed.every(([status, relative], index) => status === 'A' && relative === expectedPaths[index])) {
      throw new Error('Published commit must add exactly the approved derived package paths');
    }
    for (const relative of expectedPaths) {
      const liveFile = path.join(repoRoot, relative);
      const packagedFile = path.join(currentDir, 'draft', relative);
      if (!regularFile(liveFile) || !fs.readFileSync(liveFile).equals(fs.readFileSync(packagedFile))) throw new Error(`Published file does not match approved package: ${relative}`);
    }
    manifest.deployment_proof_sha256 = createHash('sha256').update(fs.readFileSync(proofPath)).digest('hex');
  }

  manifest.status = nextStatus;
  manifest.updated_at_kst = kstIso();
  if (['published', 'rejected', 'blocked'].includes(nextStatus)) manifest.closed_at_kst = kstIso();
  writeManifest(manifest);
  if (['published', 'rejected', 'blocked'].includes(nextStatus)) {
    runLock.state = 'closed';
    runLock.closed_at_kst = manifest.closed_at_kst || manifest.updated_at_kst;
    fs.writeFileSync(runLockPath, `${JSON.stringify(runLock, null, 2)}\n`, { mode: 0o600 });
  }
  console.log(JSON.stringify(manifest, null, 2));
}

function approvalDigest() {
  const manifest = readManifest();
  if (!manifest || manifest.status !== 'ready_for_review') throw new Error('Approval digest requires a ready_for_review current run');
  assertRunOwnership(manifest);
  const { artifacts, validation } = assertReadyEvidence(manifest);
  const derived = derivePackagePaths(manifest);
  if (derived.errors.length) throw new Error(`Approval package paths are invalid: ${derived.errors[0]}`);
  console.log(JSON.stringify({ run_id: manifest.run_id, artifact_sha256: artifacts.digest, package_sha256: artifacts.packageSha256, render_context_sha256: artifacts.renderSha256, base_sha: artifacts.baseSha, render_context_files: artifacts.renderFiles.length, validation_generated_at: validation.generated_at, paths: derived.all }, null, 2));
}

function status() {
  const manifest = readManifest();
  const archives = fs.existsSync(archiveDir)
    ? fs.readdirSync(archiveDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  console.log(JSON.stringify({ workspaceRoot, current: manifest, archives }, null, 2));
}

switch (command) {
  case 'start':
    start();
    break;
  case 'archive':
    withLifecycleLock('archive', () => {
      verifyArchives();
      const archived = archiveCurrent(String(options.get('reason') || 'manual-close'), { allowReadyForReview: true });
      fs.mkdirSync(currentDir, { recursive: true });
      console.log(JSON.stringify({ archived, current: currentDir }, null, 2));
    });
    break;
  case 'set-status':
    withLifecycleLock('set-status', () => setStatus());
    break;
  case 'approval-digest':
    approvalDigest();
    break;
  case 'safe-date':
    console.log(safePostDate(Number(options.get('minutes') || 60)));
    break;
  case 'verify-archives':
    console.log(JSON.stringify({ archives: verifyArchives() }, null, 2));
    break;
  case 'status':
    status();
    break;
  default:
    throw new Error(`Unknown command: ${command}`);
}
