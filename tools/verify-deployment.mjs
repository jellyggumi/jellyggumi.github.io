#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  MIN_REFERENCE_IMAGES,
  derivePackagePaths,
  extractSourceFigures,
  imageContentTypePattern,
  rasterSignatureMatches
} from './lib/source-images.mjs';

const argv = process.argv.slice(2);
let rootValue = process.cwd();
let waitSeconds = 900;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--root') {
    rootValue = argv[i + 1] || '';
    i += 1;
  } else if (argv[i] === '--wait-seconds') {
    waitSeconds = Number(argv[i + 1]);
    i += 1;
  } else if (!argv[i].startsWith('--')) rootValue = argv[i];
  else throw new Error(`Unknown argument: ${argv[i]}`);
}
if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 1800) throw new Error('--wait-seconds must be an integer from 0 to 1800');

const root = path.resolve(rootValue);
const current = path.join(root, '_workspace', 'current');
const manifestPath = path.join(current, 'manifest.json');
const proofPath = path.join(current, 'validation', 'deployment-proof.json');
const repoSlug = 'jellyggumi/jellyggumi.github.io';
const siteOrigin = 'https://jellyggumi.github.io';
const verifierRelative = 'tools/verify-deployment.mjs';

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

function git(args, encoding = 'utf8') {
  return spawnSync('git', args, { cwd: root, encoding });
}

function gitText(args) {
  const result = git(args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function normalizeText(value) {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitDocument(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  return match ? { frontMatter: match[1], body: text.slice(match[0].length) } : { frontMatter: '', body: text };
}

function frontMatterScalar(frontMatter, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const raw = frontMatter.match(new RegExp(`^${escaped}:\\s*(.*)$`, 'm'))?.[1]?.trim() || '';
  return raw.replace(/^['"]|['"]$/g, '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function githubRuns() {
  const endpoint = `repos/${repoSlug}/actions/runs?branch=gh-pages&per_page=50`;
  for (const binary of ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']) {
    if (!fs.existsSync(binary)) continue;
    const result = spawnSync(binary, ['api', endpoint], { cwd: root, encoding: 'utf8' });
    if (result.status === 0) return JSON.parse(result.stdout).workflow_runs || [];
    break;
  }
  const response = await fetch(`https://api.github.com/${endpoint}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'JellyGGumi-Deployment-Verifier/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`GitHub Actions API returned HTTP ${response.status}`);
  return (await response.json()).workflow_runs || [];
}

async function waitForPagesRun(headSha, deadline) {
  while (true) {
    const runs = await githubRuns();
    const matching = runs
      .filter((run) => run?.head_sha === headSha && run?.name === 'pages build and deployment' && run?.path === 'dynamic/pages/pages-build-deployment' && run?.event === 'dynamic')
      .sort((a, b) => Number(b.id) - Number(a.id));
    const run = matching[0];
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`Matching GitHub Pages run concluded ${run.conclusion || 'without a conclusion'}: ${run.html_url || run.id}`);
      if (!/^https:\/\/github\.com\/jellyggumi\/jellyggumi\.github\.io\/actions\/runs\/\d+$/.test(run.html_url || '')) throw new Error('Matching Pages run has an unexpected URL');
      return run;
    }
    if (Date.now() >= deadline) throw new Error(`No successful matching Pages run appeared for ${headSha} within ${waitSeconds} seconds`);
    await sleep(60_000);
  }
}

async function fetchFresh(url) {
  const target = new URL(url);
  target.searchParams.set('deploy_sha', headSha);
  const response = await fetch(target, {
    redirect: 'follow',
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache', 'user-agent': 'JellyGGumi-Deployment-Verifier/1.0' },
    signal: AbortSignal.timeout(30_000)
  });
  return response;
}

const manifest = readJson(manifestPath);
if (manifest.status !== 'approved') throw new Error(`Deployment verification requires approved status, found ${manifest.status}`);
if (!/^[a-f0-9]{64}$/.test(manifest.approval_artifact_sha256 || '')) throw new Error('Approved manifest lacks approval_artifact_sha256');
if (fs.existsSync(proofPath)) throw new Error('deployment-proof.json already exists; preserve it instead of overwriting');
if (gitText(['branch', '--show-current']) !== 'gh-pages') throw new Error('Deployment verification requires gh-pages');
const origin = gitText(['remote', 'get-url', 'origin']);
if (!/^(?:https:\/\/github\.com\/jellyggumi\/jellyggumi\.github\.io\.git|git@github\.com:jellyggumi\/jellyggumi\.github\.io\.git)$/.test(origin)) throw new Error('origin must be the JellyGGumi GitHub repository');
const fetched = git(['fetch', '--quiet', 'origin', 'gh-pages']);
if (fetched.status !== 0) throw new Error(`Cannot fetch origin/gh-pages: ${fetched.stderr || fetched.stdout}`);
const headSha = gitText(['rev-parse', 'HEAD']);
const upstreamSha = gitText(['rev-parse', '@{upstream}']);
const remoteSha = gitText(['ls-remote', 'origin', 'refs/heads/gh-pages']).split(/\s+/)[0] || '';
const parentSha = gitText(['rev-parse', 'HEAD^']);
const clean = gitText(['status', '--porcelain=v1', '--untracked-files=all']);
if (!/^[a-f0-9]{40}$/.test(headSha) || headSha !== upstreamSha || headSha !== remoteSha) throw new Error('Local, tracking and remote gh-pages SHAs do not match');
if (parentSha !== manifest.approval_base_sha) throw new Error('Published commit parent does not match the authorized base SHA');
if (clean !== '') throw new Error('Worktree must be clean before deployment verification');

const derivedPackage = derivePackagePaths(manifest);
if (derivedPackage.errors.length) throw new Error(`Approved manifest package paths are invalid: ${derivedPackage.errors[0]}`);
const expectedPaths = derivedPackage.all;
const diff = gitText(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', 'HEAD']).split('\n').filter(Boolean).map((line) => line.split(/\s+/)).sort((a, b) => a[1].localeCompare(b[1]));
if (diff.length !== expectedPaths.length || !diff.every(([status, relative], index) => status === 'A' && relative === expectedPaths[index])) throw new Error('HEAD must add exactly the authorized derived package paths');

const articleFile = path.join(root, manifest.article_path);
const packagedArticle = path.join(current, 'draft', manifest.article_path);
if (!regularFile(articleFile) || !regularFile(packagedArticle) || !fs.readFileSync(articleFile).equals(fs.readFileSync(packagedArticle))) throw new Error('Published article bytes do not match the authorized package');
const articleText = fs.readFileSync(packagedArticle, 'utf8');
const { frontMatter, body } = splitDocument(articleText);
const expectedTitle = frontMatterScalar(frontMatter, 'title');
const paragraphTexts = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => normalizeText(match[1])).filter((text) => text.length >= 80);
const bodyProbe = paragraphTexts[0]?.slice(0, 120) || '';
const sourceExtraction = extractSourceFigures(body);
if (sourceExtraction.errors.length) throw new Error(`Authorized article source figures are invalid: ${sourceExtraction.errors[0]}`);
const expectedSourceFigures = sourceExtraction.figures;
if (!expectedTitle || bodyProbe.length < 60) throw new Error('Authorized article lacks a stable title or body probe');
if (expectedSourceFigures.length < MIN_REFERENCE_IMAGES) throw new Error(`Authorized article lacks ${MIN_REFERENCE_IMAGES} source-image attribution figures`);
const stem = path.basename(manifest.article_path, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
const permalink = `${siteOrigin}/journal/${stem}/`;
const imageUrls = [...derivedPackage.assetPaths, ...derivedPackage.referenceImagePaths].map((relative) => `${siteOrigin}/${relative}`).sort();

const deadline = Date.now() + waitSeconds * 1000;
const pagesRun = await waitForPagesRun(headSha, deadline);
let pageEvidence = null;
let imageEvidence = null;
while (true) {
  try {
    const pageResponse = await fetchFresh(permalink);
    const finalPageUrl = new URL(pageResponse.url);
    const html = await pageResponse.text();
    const liveText = normalizeText(html);
    const titleCheck = liveText.includes(normalizeText(expectedTitle));
    const bodyCheck = liveText.includes(bodyProbe);
    const sourceCreditsCheck = expectedSourceFigures.every((figure) => html.includes(figure.src) && liveText.includes(normalizeText(figure.captionHtml)));
    if (pageResponse.status !== 200 || finalPageUrl.origin !== siteOrigin || !/^text\/html\b/i.test(pageResponse.headers.get('content-type') || '') || !titleCheck || !bodyCheck || !sourceCreditsCheck) throw new Error(`Page not ready: status=${pageResponse.status} title=${titleCheck} body=${bodyCheck} source_credits=${sourceCreditsCheck}`);
    pageEvidence = { status: pageResponse.status, content_type: pageResponse.headers.get('content-type') || '', title_check: titleCheck, body_check: bodyCheck, source_credits_check: sourceCreditsCheck, source_credit_count: expectedSourceFigures.length };

    const checkedImages = [];
    for (const url of imageUrls) {
      const response = await fetchFresh(url);
      const finalUrl = new URL(response.url);
      const bytes = Buffer.from(await response.arrayBuffer());
      const relative = url.slice(`${siteOrigin}/`.length);
      const expectedBytes = fs.readFileSync(path.join(current, 'draft', relative));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const expectedSha256 = createHash('sha256').update(expectedBytes).digest('hex');
      const typePattern = imageContentTypePattern(relative);
      if (response.status !== 200 || finalUrl.origin !== siteOrigin || !typePattern || !typePattern.test(response.headers.get('content-type') || '') || sha256 !== expectedSha256 || !rasterSignatureMatches(relative, bytes)) throw new Error(`Image not ready or mismatched: ${url}`);
      checkedImages.push({ url, status: response.status, content_type: response.headers.get('content-type') || '', sha256 });
    }
    imageEvidence = checkedImages;
    break;
  } catch (error) {
    if (Date.now() >= deadline) throw new Error(`Live deployment did not verify within ${waitSeconds} seconds: ${error.message}`);
    await sleep(15_000);
  }
}

const proof = {
  schema_version: 1,
  verifier: verifierRelative,
  verifier_sha256: createHash('sha256').update(fs.readFileSync(path.join(root, verifierRelative))).digest('hex'),
  run_id: manifest.run_id,
  approval_artifact_sha256: manifest.approval_artifact_sha256,
  pushed_sha: headSha,
  remote_sha: remoteSha,
  workflow_sha: pagesRun.head_sha,
  workflow_url: pagesRun.html_url,
  workflow_conclusion: pagesRun.conclusion,
  permalink,
  permalink_status: pageEvidence.status,
  permalink_content_type: pageEvidence.content_type,
  expected_title: expectedTitle,
  title_check: pageEvidence.title_check,
  body_probe: bodyProbe,
  body_check: pageEvidence.body_check,
  source_credits_check: pageEvidence.source_credits_check,
  source_credit_count: pageEvidence.source_credit_count,
  image_urls: imageEvidence,
  verified_at: new Date().toISOString()
};
fs.mkdirSync(path.dirname(proofPath), { recursive: true });
fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ proof_path: path.relative(root, proofPath), ...proof }, null, 2));
