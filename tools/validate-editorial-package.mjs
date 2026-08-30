#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  MIN_REFERENCE_IMAGES,
  derivePackagePaths,
  validateSourceImageManifest,
  extractSourceFigures,
  bindFiguresToImages,
  inspectRasterImage
} from './lib/source-images.mjs';

const argv = process.argv.slice(2);
let repoRootValue = process.cwd();
let stage = 'final';
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--stage') {
    stage = argv[i + 1] || '';
    i += 1;
  } else if (argv[i] === '--root') {
    repoRootValue = argv[i + 1] || '';
    i += 1;
  } else if (!argv[i].startsWith('--')) repoRootValue = argv[i];
  else throw new Error(`Unknown argument: ${argv[i]}`);
}
if (!['draft', 'final'].includes(stage)) throw new Error('--stage must be draft or final');

const repoRoot = path.resolve(repoRootValue);
const current = path.join(repoRoot, '_workspace', 'current');
const failures = [];
const warnings = [];
const pass = (condition, message) => {
  if (!condition) failures.push(message);
};
const warn = (condition, message) => {
  if (!condition) warnings.push(message);
};
const nonempty = (value, minimum = 1) => typeof value === 'string' && value.trim().length >= minimum;
const isHttpUrl = (value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`Cannot read valid JSON: ${path.relative(repoRoot, file)} (${error.message})`);
    return null;
  }
}

function regularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function decodeXml(value) {
  return String(value || '')
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

function rssTrendRows(xml) {
  const readTag = (block, name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return decodeXml(block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'))?.[1] || '');
  };
  return [...String(xml || '').matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 10).map((match) => {
    const sourceTimestamp = readTag(match[1], 'pubDate');
    const parsed = Date.parse(sourceTimestamp);
    return {
      query: readTag(match[1], 'title'),
      approx_traffic: readTag(match[1], 'ht:approx_traffic'),
      source_timestamp: sourceTimestamp,
      source_timestamp_utc: Number.isFinite(parsed) ? new Date(parsed).toISOString() : ''
    };
  }).filter((row) => row.query && row.approx_traffic && row.source_timestamp_utc);
}

function walk(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) failures.push(`Package contains a forbidden symlink: ${path.relative(repoRoot, full)}`);
    else if (entry.isDirectory()) found.push(...walk(full, predicate));
    else if (entry.isFile() && predicate(full)) found.push(full);
  }
  return found;
}

function splitDocument(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  return match ? { frontMatter: match[1], body: text.slice(match[0].length) } : { frontMatter: '', body: text };
}

function scalar(frontMatter, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = frontMatter.match(new RegExp(`^${escaped}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? '';
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function arrayValue(frontMatter, key) {
  const value = scalar(frontMatter, key);
  return value.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function nestedScalar(frontMatter, parent, key) {
  const lines = frontMatter.split('\n');
  const parentIndex = lines.findIndex((line) => line.trim() === `${parent}:` && !/^\s/.test(line));
  if (parentIndex < 0) return '';
  for (let i = parentIndex + 1; i < lines.length; i += 1) {
    if (lines[i] && !/^\s/.test(lines[i])) break;
    const match = lines[i].match(new RegExp(`^\\s+${key}:\\s*(.*)$`));
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '').trim();
  }
  return '';
}

function sourceEntries(frontMatter) {
  const lines = frontMatter.split('\n');
  const start = lines.findIndex((line) => line.trim() === 'sources:' && !/^\s/.test(line));
  if (start < 0) return [];
  const entries = [];
  let currentEntry = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line && !/^\s/.test(line)) break;
    const startMatch = line.match(/^\s*-\s+label:\s*(.*)$/);
    if (startMatch) {
      if (currentEntry) entries.push(currentEntry);
      currentEntry = { label: startMatch[1].trim().replace(/^['"]|['"]$/g, '') };
      continue;
    }
    const fieldMatch = line.match(/^\s+(publisher|url):\s*(.*)$/);
    if (currentEntry && fieldMatch) currentEntry[fieldMatch[1]] = fieldMatch[2].trim().replace(/^['"]|['"]$/g, '');
  }
  if (currentEntry) entries.push(currentEntry);
  return entries;
}

function jpegInfo(file) {
  const bytes = fs.readFileSync(file);
  const result = { width: null, height: null, app1: 0, app13: 0, jpeg: false, sha256: createHash('sha256').update(bytes).digest('hex') };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return result;
  result.jpeg = true;
  let offset = 2;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (marker === 0xe1) result.app1 += 1;
    if (marker === 0xed) result.app13 += 1;
    if (sof.has(marker) && length >= 7) {
      result.height = bytes.readUInt16BE(offset + 3);
      result.width = bytes.readUInt16BE(offset + 5);
    }
    offset += length;
  }
  return result;
}

function stubValues(dir, key) {
  const values = new Set();
  for (const file of walk(dir, (candidate) => /\.(md|html)$/.test(candidate))) {
    const { frontMatter } = splitDocument(fs.readFileSync(file, 'utf8'));
    const value = scalar(frontMatter, key);
    if (value) values.add(value);
  }
  return values;
}

function htmlBalance(body) {
  const stack = [];
  const issues = [];
  const allowed = new Set(['p', 'h3', 'ul', 'ol', 'li', 'figure', 'figcaption', 'blockquote', 'a', 'strong', 'em', 'span']);
  for (const match of body.matchAll(/<\s*(\/?)\s*([a-zA-Z0-9]+)\b[^>]*>/g)) {
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (!allowed.has(tag)) continue;
    if (!closing) stack.push(tag);
    else {
      const expected = stack.pop();
      if (expected !== tag) issues.push(`Expected </${expected || 'none'}> before </${tag}>`);
    }
  }
  if (stack.length) issues.push(`Unclosed HTML tags: ${stack.join(', ')}`);
  return issues;
}

function decodeAttribute(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&(?:tab|newline);/gi, ' ');
}

function htmlSafety(body) {
  const issues = [];
  const allowedTags = new Set(['p', 'h3', 'ul', 'ol', 'li', 'figure', 'figcaption', 'blockquote', 'a', 'strong', 'em', 'span', 'br']);
  const allowedAttributes = {
    a: new Set(['href', 'hreflang', 'lang', 'rel', 'title']),
    span: new Set(['lang']),
    p: new Set(['lang']),
    h3: new Set(['lang']),
    blockquote: new Set(['lang'])
  };
  if (/{[{%:]/.test(body)) issues.push('Liquid, template, and kramdown extension expressions are forbidden in automated draft bodies');
  for (const comment of body.matchAll(/<!--[\s\S]*?-->/g)) {
    if (comment[0] !== '<!--post-ad-break-->') issues.push('Only the canonical post-ad-break HTML comment is allowed');
  }
  if (/<\s*\/?\s*(?:script|style|iframe|object|embed|form|input|button|textarea|select|option|svg|math|video|audio|img|link|meta|base)\b/i.test(body)) {
    issues.push('Executable, embedded, form, media, image, or document-level HTML is forbidden');
  }
  for (const match of body.matchAll(/<\s*(\/?)\s*([a-zA-Z0-9]+)\b([^>]*)>/g)) {
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    const rawAttributes = match[3] || '';
    if (!allowedTags.has(tag)) {
      issues.push(`HTML tag is not allowed: <${closing ? '/' : ''}${tag}>`);
      continue;
    }
    if (closing) {
      if (rawAttributes.trim()) issues.push(`Closing tag contains unexpected content: </${tag}>`);
      continue;
    }
    if (/\bon[a-z]+\s*=|\bstyle\s*=|\bsrcdoc\s*=/i.test(rawAttributes)) issues.push(`Unsafe attribute on <${tag}>`);
    let residue = rawAttributes;
    const attributes = [];
    for (const attribute of rawAttributes.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g)) {
      const name = attribute[1].toLowerCase();
      const value = attribute[2].slice(1, -1);
      attributes.push({ name, value });
      residue = residue.replace(attribute[0], ' ');
    }
    residue = residue.replace(/\//g, ' ').trim();
    if (residue) issues.push(`Malformed or unquoted attribute content on <${tag}>`);
    const allowed = allowedAttributes[tag] || new Set();
    for (const { name, value } of attributes) {
      if (!allowed.has(name)) issues.push(`Attribute ${name} is not allowed on <${tag}>`);
      if (tag === 'a' && name === 'href') {
        const normalized = decodeAttribute(value).replace(/[\u0000-\u0020]+/g, '').toLowerCase();
        if (!/^(https?:\/\/|\/|#)/.test(normalized) || /^(?:javascript|data|vbscript):/.test(normalized) || normalized.startsWith('//')) issues.push(`Unsafe link target: ${value}`);
      }
      if (name === 'rel' && !/^(?:nofollow|sponsored|noopener|noreferrer)(?:\s+(?:nofollow|sponsored|noopener|noreferrer))*$/i.test(value)) issues.push(`Unsupported rel value: ${value}`);
    }
    if (tag === 'a' && !attributes.some((attribute) => attribute.name === 'href')) issues.push('Anchor tag is missing href');
  }
  return [...new Set(issues)];
}

function tokens(text) {
  const stop = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'how', 'what', 'when', 'where', 'korea', 'korean', 'guide', 'explained']);
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((token) => token.length >= 3 && !stop.has(token)));
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

pass(fs.existsSync(current), '_workspace/current is missing');
const manifestFile = path.join(current, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? readJson(manifestFile) : null;
pass(Boolean(manifest), 'manifest.json is missing or invalid');
if (manifest) {
  for (const key of ['schema_version', 'run_id', 'started_at_kst', 'target_date', 'mode', 'status', 'topic', 'slug', 'thesis', 'content_type', 'experience_mode', 'category', 'tags', 'article_path', 'asset_paths', 'reference_image_paths', 'revision_loops', 'publication_requires_confirmation', 'gates']) {
    pass(manifest[key] !== undefined && manifest[key] !== null, `Manifest field is missing: ${key}`);
  }
  pass(manifest.schema_version === 1, `Unsupported manifest schema_version: ${manifest.schema_version}`);
  pass(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(manifest.started_at_kst), `Invalid started_at_kst: ${manifest.started_at_kst}`);
  pass(/^\d{4}-\d{2}-\d{2}$/.test(manifest.target_date), `Invalid target_date: ${manifest.target_date}`);
  pass(['draft-only', 'publish-on-green'].includes(manifest.mode), `Manifest mode must be draft-only or publish-on-green, found ${manifest.mode}`);
  pass(manifest.publication_requires_confirmation === (manifest.mode === 'draft-only'), 'Manifest confirmation flag does not match publication mode');
  if (manifest.mode === 'publish-on-green') pass(manifest.standing_publish_routine_id === 'h78L2R0UJFRhjS9O', 'publish-on-green manifest is not bound to the authorized routine');
  pass(manifest.content_type === 'guide', `Automated package must be guide, found ${manifest.content_type}`);
  pass(['sourced-only', 'anchored-observation'].includes(manifest.experience_mode), `Invalid experience_mode: ${manifest.experience_mode}`);
  pass(Number.isInteger(manifest.revision_loops) && manifest.revision_loops >= 0 && manifest.revision_loops <= 2, `Invalid revision loop count: ${manifest.revision_loops}`);
  pass(typeof manifest.gates === 'object' && !Array.isArray(manifest.gates), 'Manifest gates must be an object');
  pass(nonempty(manifest.topic, 5), 'Manifest topic is missing or too short');
  pass(nonempty(manifest.thesis, 20), 'Manifest thesis is missing or too short');
  pass(/^[a-z0-9][a-z0-9-]*$/.test(manifest.slug || ''), `Manifest slug is unsafe: ${manifest.slug}`);
  pass(Array.isArray(manifest.tags) && manifest.tags.length >= 1, 'Manifest tags are missing');
  pass(Array.isArray(manifest.asset_paths) && manifest.asset_paths.length === 2, 'Manifest must declare exactly two asset paths');
  pass(Array.isArray(manifest.reference_image_paths) && manifest.reference_image_paths.length >= MIN_REFERENCE_IMAGES, `Manifest must declare at least ${MIN_REFERENCE_IMAGES} source-derived reference image paths`);
  if (manifest.experience_mode === 'anchored-observation') {
    pass(manifest.observation_anchor && isHttpUrl(manifest.observation_anchor.source_url), 'Anchored observation requires observation_anchor.source_url');
    pass(nonempty(manifest.observation_anchor?.note, 10), 'Anchored observation requires a scoped note');
  }
  if (stage === 'draft') pass(['drafting', 'reviewing'].includes(manifest.status), `Draft validation requires drafting/reviewing status, found ${manifest.status}`);
}
const derivedPackage = manifest
  ? derivePackagePaths(manifest)
  : { errors: [], all: [], referenceImagePaths: [] };
for (const issue of derivedPackage.errors) pass(false, `Package paths: ${issue}`);

const tasksFile = path.join(current, 'tasks.json');
const tasks = fs.existsSync(tasksFile) ? readJson(tasksFile) : null;
pass(Boolean(tasks) && Array.isArray(tasks.tasks), 'tasks.json is missing, invalid, or has no tasks array');
pass(fs.existsSync(path.join(current, 'messages')), 'messages/ directory is missing');

const candidateFile = path.join(current, 'research', 'candidate-set.json');
const candidateSet = fs.existsSync(candidateFile) ? readJson(candidateFile) : null;
pass(Boolean(candidateSet), 'research/candidate-set.json is missing or invalid');
const candidates = Array.isArray(candidateSet) ? candidateSet : Array.isArray(candidateSet?.candidates) ? candidateSet.candidates : [];
pass(candidates.length >= 1 && candidates.length <= 5, `Candidate set must contain 1..5 researched candidates, found ${candidates.length}`);
pass(candidates.filter((candidate) => candidate?.selected === true).length === 1, 'Article package must have exactly one selected candidate');
const selectedCandidate = candidates.find((candidate) => candidate?.selected === true) || null;
for (const [index, candidate] of candidates.entries()) {
  const label = candidate?.candidate_id || index + 1;
  for (const key of ['candidate_id', 'entity', 'reader_intent', 'url', 'publisher', 'source_tier', 'retrieved_at', 'why_now', 'audience_fit', 'overlap_with_existing', 'originality_opportunity', 'experience_mode', 'image_concept']) {
    pass(candidate?.[key] !== undefined && candidate?.[key] !== null && candidate?.[key] !== '', `Candidate ${label} lacks ${key}`);
  }
  pass(isHttpUrl(candidate?.url), `Candidate ${label} has invalid URL`);
  pass(Number.isFinite(Date.parse(candidate?.retrieved_at)), `Candidate ${label} has invalid retrieved_at`);
  pass(typeof candidate?.selected === 'boolean', `Candidate ${label} has no boolean selected field`);
  if (candidate?.selected === false) pass(nonempty(candidate?.rejection_reason), `Rejected candidate ${label} has no rejection_reason`);
}
const trendSignalFile = path.join(current, 'research', 'trend-signal.json');
const trendSignal = fs.existsSync(trendSignalFile) ? readJson(trendSignalFile) : null;
if (manifest?.mode === 'publish-on-green') {
  pass(Boolean(trendSignal), 'publish-on-green requires research/trend-signal.json');
  if (trendSignal) {
    pass(trendSignal.schema_version === 1, `Unsupported trend signal schema: ${trendSignal.schema_version}`);
    pass(trendSignal.source_kind === 'official-google-trends-rss', 'Trend signal must identify the official Google Trends RSS source');
    pass(trendSignal.source_url === 'https://trends.google.com/trending/rss?geo=KR', 'Trend signal must use the Korea Google Trends RSS feed');
    pass(trendSignal.geography === 'KR', 'Trend signal geography must be KR');
    pass(trendSignal.window === 'past-24-hours', 'Trend signal window must be past-24-hours');
    pass(trendSignal.interpretation === 'candidate-discovery-only', 'Google Trends must remain a candidate-discovery signal');
    pass(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(trendSignal.retrieved_at || ''), 'Trend signal retrieved_at must be normalized UTC');
    pass(Number.isFinite(Date.parse(trendSignal.retrieved_at)), 'Trend signal retrieved_at is invalid');
    if (Number.isFinite(Date.parse(trendSignal.retrieved_at))) {
      pass(Date.now() - Date.parse(trendSignal.retrieved_at) <= 6 * 60 * 60 * 1000, 'Trend signal is older than 6 hours');
      pass(Date.parse(trendSignal.retrieved_at) <= Date.now() + 10 * 60 * 1000, 'Trend signal retrieved_at is implausibly in the future');
    }
    pass(trendSignal.raw_feed_path === 'research/google-trends-kr.xml', 'Trend signal raw_feed_path is missing or unsafe');
    const rawTrendFile = path.join(current, 'research', 'google-trends-kr.xml');
    pass(regularFile(rawTrendFile), 'Raw Google Trends RSS snapshot is missing or unsafe');
    pass(/^[a-f0-9]{64}$/.test(trendSignal.raw_feed_sha256 || ''), 'Trend signal lacks raw_feed_sha256');
    let rawTrendRows = [];
    if (regularFile(rawTrendFile)) {
      const rawTrendBytes = fs.readFileSync(rawTrendFile);
      pass(createHash('sha256').update(rawTrendBytes).digest('hex') === trendSignal.raw_feed_sha256, 'Raw Google Trends RSS SHA-256 does not match trend-signal.json');
      rawTrendRows = rssTrendRows(rawTrendBytes.toString('utf8'));
      pass(rawTrendRows.length >= 1, 'Raw Google Trends RSS contains no valid rows');
    }
    pass(nonempty(trendSignal.selected_query, 2), 'Trend signal lacks selected_query');
    pass(nonempty(trendSignal.selected_candidate_id, 2), 'Trend signal lacks selected_candidate_id');
    pass(selectedCandidate?.candidate_id === trendSignal.selected_candidate_id, 'Trend signal does not bind the selected researched candidate');
    pass(selectedCandidate?.trend_query === trendSignal.selected_query, 'Selected researched candidate does not preserve the selected trend query');
    const allowedPillars = new Set(['korean-food-and-dining', 'language-and-hangul', 'customs-etiquette-and-holidays', 'transport-and-city-systems', 'daily-life-and-admin']);
    pass(allowedPillars.has(selectedCandidate?.content_pillar), `Selected researched candidate has an invalid content pillar: ${selectedCandidate?.content_pillar || 'missing'}`);
    pass(selectedCandidate?.durable_value_without_spike === true, 'Selected researched candidate lacks durable value without the trend spike');
    pass(nonempty(trendSignal.audience_fit, 30), 'Trend signal lacks a concrete JellyGGumi audience-fit explanation');
    pass(trendSignal.audience_fit === selectedCandidate?.audience_fit, 'Trend signal audience fit does not match the selected researched candidate');
    pass(trendSignal.durable_value_without_spike === true, 'Selected topic must remain useful without the trend spike');
    pass(trendSignal.trend_is_not_thesis === true, 'Trend signal may not become the article thesis');
    const trendCandidates = Array.isArray(trendSignal.candidates) ? trendSignal.candidates : [];
    pass(trendCandidates.length >= 1 && trendCandidates.length <= 10, `Trend signal must retain 1..10 feed candidates, found ${trendCandidates.length}`);
    pass(trendCandidates.filter((candidate) => candidate?.selected === true).length === 1, 'Trend signal must select exactly one query');
    for (const [index, candidate] of trendCandidates.entries()) {
      pass(nonempty(candidate?.query, 2), `Trend query ${index + 1} is missing`);
      pass(nonempty(String(candidate?.approx_traffic ?? ''), 1), `Trend query ${index + 1} lacks approximate traffic`);
      pass(Number.isFinite(Date.parse(candidate?.source_timestamp)), `Trend query ${index + 1} has invalid source_timestamp`);
      pass(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(candidate?.source_timestamp_utc || ''), `Trend query ${index + 1} lacks normalized source_timestamp_utc`);
      if (Number.isFinite(Date.parse(candidate?.source_timestamp)) && Number.isFinite(Date.parse(candidate?.source_timestamp_utc))) pass(Date.parse(candidate.source_timestamp) === Date.parse(candidate.source_timestamp_utc), `Trend query ${index + 1} timestamp normalization mismatch`);
      pass(typeof candidate?.selected === 'boolean', `Trend query ${index + 1} lacks a boolean selected flag`);
    }
    const rawTrendKeys = new Set(rawTrendRows.map((candidate) => JSON.stringify(candidate)));
    for (const [index, candidate] of trendCandidates.entries()) {
      const normalized = { query: candidate?.query, approx_traffic: String(candidate?.approx_traffic ?? ''), source_timestamp: candidate?.source_timestamp, source_timestamp_utc: candidate?.source_timestamp_utc };
      pass(rawTrendKeys.has(JSON.stringify(normalized)), `Trend query ${index + 1} does not match the preserved raw RSS feed`);
    }
    const selectedTrend = trendCandidates.find((candidate) => candidate?.selected === true);
    pass(selectedTrend?.query === trendSignal.selected_query, 'Selected trend row does not match selected_query');
  }
}
const coverageFile = path.join(current, 'research', 'existing-coverage.json');
pass(fs.existsSync(coverageFile) && Boolean(readJson(coverageFile)), 'research/existing-coverage.json is missing or invalid');

const postsDir = path.join(current, 'draft', '_posts');
const drafts = walk(postsDir, (file) => file.endsWith('.md'));
pass(drafts.length === 1, `Expected exactly one draft post, found ${drafts.length}`);
let draftPath = drafts[0] || null;
let article = '';
let frontMatter = '';
let body = '';
if (draftPath) {
  article = fs.readFileSync(draftPath, 'utf8');
  ({ frontMatter, body } = splitDocument(article));
  pass(Boolean(frontMatter), 'Draft has no valid YAML front matter');
}

// Source-derived attribution figures are the only allowed <img> markup. They are
// extracted and validated separately; the stripped body (captions preserved)
// keeps the existing tight HTML allowlist, so any stray <img>, remote src or
// non-canonical source-image markup still fails closed.
const sourceFigureExtraction = extractSourceFigures(body);
const sourceFigures = sourceFigureExtraction.figures;
const safetyBody = sourceFigureExtraction.strippedBody;
for (const issue of sourceFigureExtraction.errors) failures.push(`Source figure: ${issue}`);

const title = scalar(frontMatter, 'title');
const subtitle = scalar(frontMatter, 'subtitle');
const description = scalar(frontMatter, 'description');
const dateValue = scalar(frontMatter, 'date');
const headerImage = scalar(frontMatter, 'header-img');
const cardImage = scalar(frontMatter, 'card-img');
const imageFeature = nestedScalar(frontMatter, 'image', 'feature');
const headerAlt = scalar(frontMatter, 'header_alt');
const categories = arrayValue(frontMatter, 'categories');
const tags = arrayValue(frontMatter, 'tags');
const sources = sourceEntries(frontMatter);
const requiredKeys = ['layout', 'title', 'subtitle', 'description', 'active', 'image', 'card-img', 'date', 'header-img', 'header_alt', 'header_ai', 'header_width', 'header_height', 'comments', 'tags', 'categories', 'reviewed', 'lastmod', 'ai_assisted', 'content_type', 'sources'];
const topLevelKeys = [...frontMatter.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((match) => match[1]);
const duplicateTopLevelKeys = [...new Set(topLevelKeys.filter((key, index) => topLevelKeys.indexOf(key) !== index))];
const unexpectedTopLevelKeys = [...new Set(topLevelKeys.filter((key) => !requiredKeys.includes(key)))].sort();
pass(duplicateTopLevelKeys.length === 0, `Duplicate top-level front matter keys: ${duplicateTopLevelKeys.join(', ')}`);
pass(unexpectedTopLevelKeys.length === 0, `Unexpected top-level front matter keys: ${unexpectedTopLevelKeys.join(', ')}`);
pass(JSON.stringify([...new Set(topLevelKeys)].sort()) === JSON.stringify([...requiredKeys].sort()), 'Front matter top-level key set must exactly match the automated guide contract');
for (const key of requiredKeys) pass(new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'm').test(frontMatter), `Missing front-matter key: ${key}`);
pass(/^\s+feature:/m.test(frontMatter), 'Missing image.feature front-matter key');
pass(scalar(frontMatter, 'layout') === 'post', 'layout must be post');
pass(scalar(frontMatter, 'active') === 'journal', 'active must be journal');
pass(/^header_ai:[ \t]*true[ \t]*$/m.test(frontMatter), 'Automated editorial image must set bare YAML boolean header_ai: true');
pass(scalar(frontMatter, 'header_width') === '1672' && scalar(frontMatter, 'header_height') === '941', 'Header dimensions must be 1672x941');
pass(/^comments:[ \t]*false[ \t]*$/m.test(frontMatter), 'Automated drafts must set bare YAML boolean comments: false');
pass(/^ai_assisted:[ \t]*true[ \t]*$/m.test(frontMatter), 'Automated drafts must set bare YAML boolean ai_assisted: true');
pass(scalar(frontMatter, 'content_type') === 'guide', 'Automated drafts must use content_type: guide');
pass(title.length >= 20 && title.length <= 100, `Title length must be 20-100 characters, found ${title.length}`);
pass(subtitle.length >= 20 && subtitle.length <= 140, `Subtitle length must be 20-140 characters, found ${subtitle.length}`);
pass(description.length >= 80 && description.length <= 180, `Description length must be 80-180 characters, found ${description.length}`);
pass(headerAlt.length >= 20 && headerAlt.length <= 180, `header_alt length must be 20-180 characters, found ${headerAlt.length}`);
const hype = /\b(ultimate|shocking|secret|unbelievable|must[- ]see|best ever|you won't believe)\b/i;
pass(!hype.test(`${title} ${subtitle}`), 'Title or subtitle contains sensational language');
pass(!/[?&](?:utm_[a-z]+|aff|affiliate|ref)=/i.test(article), 'Draft contains campaign or affiliate tracking parameters');
warn(Boolean(imageFeature), 'image.feature is empty; accepted because header-img and card-img are canonical for new editorial art');

const fullAsset = manifest?.slug ? `img/editorial/${manifest.slug}.jpg` : '';
const thumbAsset = manifest?.slug ? `img/editorial/${manifest.slug}.thumb.jpg` : '';
pass(headerImage === fullAsset, `header-img must be ${fullAsset}, found ${headerImage}`);
pass(cardImage === fullAsset, `card-img must be ${fullAsset}, found ${cardImage}`);
if (manifest) {
  pass(JSON.stringify([...manifest.asset_paths].sort()) === JSON.stringify([fullAsset, thumbAsset].sort()), 'Manifest asset_paths do not match front matter');
}

const parsedKstMidnight = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? Date.parse(`${dateValue}T00:00:00+09:00`) : NaN;
pass(Number.isFinite(parsedKstMidnight), `Invalid date-only front-matter date: ${dateValue || '(missing)'}`);
if (Number.isFinite(parsedKstMidnight)) pass(parsedKstMidnight <= Date.now() - 30 * 60 * 1000, `Draft date is not safely in the past in KST: ${dateValue}`);
pass(scalar(frontMatter, 'reviewed') === dateValue, 'reviewed must match the draft date');
pass(scalar(frontMatter, 'lastmod') === dateValue, 'lastmod must match the draft date');
if (draftPath && manifest) {
  const basename = path.basename(draftPath);
  pass(basename.startsWith(`${manifest.target_date}-`), 'Draft filename does not match target_date');
  pass(dateValue === manifest.target_date, 'Front-matter date does not match target_date');
  pass(manifest.article_path === `_posts/${basename}`, `Manifest article_path does not match draft: ${manifest.article_path}`);
}

const categoryStubs = stubValues(path.join(repoRoot, 'journal', 'category'), 'category');
const tagStubs = stubValues(path.join(repoRoot, 'journal', 'tag'), 'tag');
pass(categories.length === 1, `Automated guide must have exactly one category, found ${categories.length}`);
for (const category of categories) pass(categoryStubs.has(category), `Category has no existing stub: ${category}`);
pass(tags.length >= 2 && tags.length <= 4, `Automated guide must have 2-4 tags, found ${tags.length}`);
for (const tag of tags) pass(tagStubs.has(tag), `Tag has no existing stub: ${tag}`);
if (manifest) {
  pass(categories[0] === manifest.category, 'Front-matter category does not match manifest');
  pass(JSON.stringify(tags) === JSON.stringify(manifest.tags), 'Front-matter tags do not match manifest order');
}

pass(sources.length >= 1, 'At least one source entry is required');
for (const [index, source] of sources.entries()) {
  pass(nonempty(source.label, 5), `Source ${index + 1} lacks label`);
  pass(nonempty(source.publisher, 3), `Source ${index + 1} lacks publisher`);
  pass(isHttpUrl(source.url), `Source ${index + 1} has invalid URL`);
}

const markerCount = [...body.matchAll(/<!--post-ad-break-->/g)].length;
pass(markerCount === 1, `Body must contain exactly one post-ad-break marker, found ${markerCount}`);
pass(!/^#{1,6}\s+/m.test(body), 'Body must be bare HTML, not Markdown headings');
pass(!/!\[[^\]]*\][ \t]*\(|\[[^\]]*\][ \t]*\([^)]*\)|^[ \t]*\[[^\]]*\]:[ \t]*\S+|\[[^\]]*\][ \t]*\[[^\]]*\]/m.test(body), 'Body must not contain Markdown links, images, or reference links');
pass(!/^[ \t]{0,3}(?:```|~~~|[-*+][ \t]+|\d+\.[ \t]+|>[ \t]*|(?:-{3,}|\*{3,}|_{3,})[ \t]*$|(?:=+|-+)[ \t]*$)|^(?: {4}|\t)\S/m.test(body), 'Body must not contain Markdown blocks');
pass(!/<\/?(?:html|head|body)\b/i.test(body), 'Body must be an HTML fragment, not a full document');
pass((body.match(/<p\b/gi) || []).length >= 8, 'Body needs at least eight paragraphs');
pass((body.match(/<h3\b/gi) || []).length >= 4, 'Body needs at least four h3 sections');
const balanceIssues = htmlBalance(safetyBody);
for (const issue of balanceIssues) failures.push(`HTML balance: ${issue}`);
const safetyIssues = htmlSafety(safetyBody);
for (const issue of safetyIssues) failures.push(`HTML safety: ${issue}`);
const plainBody = body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-zA-Z0-9#]+;/g, ' ');
const wordCount = (plainBody.match(/\b[A-Za-z0-9][A-Za-z0-9'’-]*\b/g) || []).length;
pass(wordCount >= 700, `Draft is skeletal at ${wordCount} English words`);
warn(wordCount >= 1000, `Draft has ${wordCount} English words; do not pad, but verify it is substantial enough for the topic`);
if (manifest?.experience_mode === 'sourced-only') {
  const firstPersonTerms = new Set(['i', 'we', 'me', 'my', 'mine', 'myself', 'our', 'ours', 'ourself', 'ourselves', 'us']);
  const firstPersonHit = (plainBody.match(/\b[A-Za-z]+\b/g) || []).some((term) => term !== 'US' && firstPersonTerms.has(term.toLowerCase()));
  pass(!firstPersonHit, 'sourced-only draft contains first-person experience language');
}
if (manifest?.experience_mode === 'anchored-observation') {
  const anchor = manifest.observation_anchor?.source_url || '';
  pass(anchor && article.includes(anchor), 'anchored-observation draft does not link its observation anchor');
}

const knownRoutes = new Set(['/', '/journal/', '/journal/guides/', '/journal/family-records/', '/journal/archive/', '/journal/category/', '/journal/tag/', '/about/', '/contact/', '/privacy/', '/editorial-policy/']);
for (const file of walk(path.join(repoRoot, '_posts'), (candidate) => candidate.endsWith('.md'))) {
  const stem = path.basename(file, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  knownRoutes.add(`/journal/${stem}/`);
}
for (const file of walk(path.join(repoRoot, 'journal'), (candidate) => /\.(md|html)$/.test(candidate))) {
  const { frontMatter: fm } = splitDocument(fs.readFileSync(file, 'utf8'));
  const permalink = scalar(fm, 'permalink');
  if (permalink) knownRoutes.add(permalink.endsWith('/') ? permalink : `${permalink}/`);
}
let internalLinks = 0;
for (const match of body.matchAll(/href=["'](\/journal\/[^"'#?]+\/?)["']/g)) {
  internalLinks += 1;
  const href = match[1].endsWith('/') ? match[1] : `${match[1]}/`;
  pass(knownRoutes.has(href), `Unresolved internal link: ${match[1]}`);
}
warn(internalLinks >= 2, `Fewer than two useful internal journal links found (${internalLinks})`);

const packagedFull = path.join(current, 'draft', fullAsset);
const packagedThumb = path.join(current, 'draft', thumbAsset);
for (const [label, file, width, height] of [['hero', packagedFull, 1672, 941], ['thumbnail', packagedThumb, 700, 394]]) {
  pass(regularFile(file), `Packaged ${label} is missing or unsafe: ${path.relative(current, file)}`);
  if (regularFile(file)) {
    const info = jpegInfo(file);
    pass(info.jpeg, `${label} is not JPEG`);
    pass(info.width === width && info.height === height, `${label} must be ${width}x${height}, found ${info.width}x${info.height}`);
    pass(info.app1 === 0 && info.app13 === 0, `${label} contains EXIF/XMP/IPTC metadata`);
  }
}
const packagedImages = walk(path.join(current, 'draft', 'img', 'editorial'), (file) => /\.jpe?g$/i.test(file));
pass(packagedImages.length === 2, `Expected exactly two packaged editorial images, found ${packagedImages.length}`);
if (manifest) {
  for (const issue of derivePackagePaths(manifest).errors) failures.push(`Package paths: ${issue}`);
}

const provenanceFile = path.join(current, 'draft', 'image-provenance.json');
const provenance = fs.existsSync(provenanceFile) ? readJson(provenanceFile) : null;
pass(Boolean(provenance), 'draft/image-provenance.json is missing or invalid');
if (provenance) {
  for (const key of ['tool', 'tool_version', 'prompt', 'prompt_sha256', 'generated_at', 'reencode_method', 'disclosure', 'outputs', 'attestations']) pass(provenance[key] !== undefined && provenance[key] !== null, `Image provenance lacks ${key}`);
  if (nonempty(provenance.prompt)) pass(createHash('sha256').update(provenance.prompt).digest('hex') === provenance.prompt_sha256, 'Image provenance prompt_sha256 is wrong');
  pass(provenance.disclosure === 'AI-generated editorial still life · method', 'Image disclosure text is not canonical');
  const attestations = provenance.attestations || {};
  for (const key of ['no_people_or_faces', 'no_brands_or_logos', 'no_readable_text', 'not_documentary_evidence', 'metadata_stripped']) pass(attestations[key] === true, `Image attestation must be true: ${key}`);
  const outputs = Array.isArray(provenance.outputs) ? provenance.outputs : [];
  pass(outputs.length === 2, 'Image provenance must contain two outputs');
  for (const output of outputs) {
    const file = path.join(current, 'draft', output.path || '');
    pass(regularFile(file), `Provenance output is missing or unsafe: ${output.path}`);
    if (regularFile(file)) pass(jpegInfo(file).sha256 === output.sha256, `Provenance SHA-256 mismatch: ${output.path}`);
  }
}

const evidenceFile = path.join(current, 'evidence', 'evidence-pack.json');
const evidence = fs.existsSync(evidenceFile) ? readJson(evidenceFile) : null;
pass(Boolean(evidence), 'evidence/evidence-pack.json is missing or invalid');
const claims = Array.isArray(evidence) ? evidence : Array.isArray(evidence?.claims) ? evidence.claims : [];
pass(claims.length >= 1, 'Evidence pack contains no claims');
const evidenceById = new Map();
for (const [index, claim] of claims.entries()) {
  const label = claim?.claim_id || index + 1;
  for (const key of ['claim_id', 'claim', 'verification', 'source_url', 'publisher', 'retrieved_at', 'quote_or_coordinate', 'caveat', 'freshness_window']) pass(nonempty(String(claim?.[key] ?? '')), `Evidence claim ${label} lacks ${key}`);
  pass(['verified', 'inferred', 'unverified'].includes(claim?.verification), `Evidence claim ${label} has invalid verification`);
  pass(isHttpUrl(claim?.source_url), `Evidence claim ${label} has invalid source_url`);
  pass(Number.isFinite(Date.parse(claim?.retrieved_at)), `Evidence claim ${label} has invalid retrieved_at`);
  evidenceById.set(claim?.claim_id, claim);
}
const sourceMapFile = path.join(current, 'evidence', 'source-map.md');
pass(regularFile(sourceMapFile) && fs.readFileSync(sourceMapFile, 'utf8').trim().length >= 100, 'evidence/source-map.md is missing or too short');
const sourceUrls = new Set(claims.map((claim) => claim.source_url));
for (const source of sources) pass(sourceUrls.has(source.url), `Front-matter source is absent from evidence pack: ${source.url}`);

// Source-image licensing sidecar: fail closed on any missing or unclear right.
const referencePaths = derivedPackage.referenceImagePaths;
const sourceImageManifestFile = path.join(current, 'draft', 'source-image-manifest.json');
const sourceImageManifest = fs.existsSync(sourceImageManifestFile) ? readJson(sourceImageManifestFile) : null;
pass(Boolean(sourceImageManifest), 'draft/source-image-manifest.json is missing or invalid');
if (sourceImageManifest && manifest) {
  const sidecarResult = validateSourceImageManifest(sourceImageManifest, {
    manifest,
    evidenceSourceUrls: sourceUrls,
    referenceImagePaths: manifest.reference_image_paths,
    fileInfo: (relative) => {
      const file = path.join(current, 'draft', relative);
      if (!regularFile(file)) return null;
      const bytes = fs.readFileSync(file);
      const raster = inspectRasterImage(relative, bytes);
      return {
        regular: true,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        validRaster: raster.valid,
        width: raster.width,
        height: raster.height,
        metadataSegments: raster.metadataSegments
      };
    }
  });
  for (const issue of sidecarResult.errors) failures.push(`Source image manifest: ${issue}`);
  const declaredSourcePaths = new Set(sidecarResult.images.map((image) => String(image?.local_path || '')));
  for (const file of walk(path.join(current, 'draft', 'img', 'source'))) {
    const relative = path.relative(path.join(current, 'draft'), file).split(path.sep).join('/');
    pass(declaredSourcePaths.has(relative), `Packaged source image has no sidecar entry: ${relative}`);
  }
  for (const issue of bindFiguresToImages(sourceFigures, sidecarResult.images, sidecarResult.fileFacts)) failures.push(`Source figure: ${issue}`);
}

const claimMapFile = path.join(current, 'draft', 'claim-map.json');
const claimMap = fs.existsSync(claimMapFile) ? readJson(claimMapFile) : null;
pass(Boolean(claimMap), 'draft/claim-map.json is missing or invalid');
const mappedClaims = Array.isArray(claimMap) ? claimMap : Array.isArray(claimMap?.claims) ? claimMap.claims : [];
pass(mappedClaims.length >= 5, `Claim map must identify material claims, found ${mappedClaims.length}`);
for (const [index, mapped] of mappedClaims.entries()) {
  const evidenceClaim = evidenceById.get(mapped?.claim_id);
  pass(nonempty(mapped?.claim_id), `Mapped claim ${index + 1} lacks claim_id`);
  pass(nonempty(mapped?.sentence, 10), `Mapped claim ${mapped?.claim_id || index + 1} lacks sentence`);
  const normalizedSentence = String(mapped?.sentence || '').replace(/\s+/g, ' ').trim();
  const normalizedBody = plainBody.replace(/\s+/g, ' ').trim();
  pass(Boolean(normalizedSentence) && normalizedBody.includes(normalizedSentence), `Mapped claim sentence does not occur in the draft: ${mapped?.claim_id || index + 1}`);
  pass(Boolean(evidenceClaim), `Mapped claim has no evidence entry: ${mapped?.claim_id || index + 1}`);
  if (evidenceClaim) pass(evidenceClaim.verification !== 'unverified', `Draft maps unverified evidence: ${mapped.claim_id}`);
}
const mappedEvidence = mappedClaims.map((mapped) => evidenceById.get(mapped.claim_id)).filter(Boolean);
pass(mappedEvidence.some((claim) => claim.primary === true && claim.verification === 'verified'), 'No mapped claim uses verified primary evidence');

const existingGuideFiles = walk(path.join(repoRoot, '_posts'), (file) => file.endsWith('.md'));
const draftSignal = tokens(`${title} ${(body.match(/<h3\b[^>]*>[\s\S]*?<\/h3>/gi) || []).join(' ')}`);
let nearest = { score: 0, file: null };
for (const file of existingGuideFiles) {
  const text = fs.readFileSync(file, 'utf8');
  if (!/^content_type:\s*guide$/m.test(text)) continue;
  const doc = splitDocument(text);
  const signal = tokens(`${scalar(doc.frontMatter, 'title')} ${(doc.body.match(/<h3\b[^>]*>[\s\S]*?<\/h3>/gi) || []).join(' ')}`);
  const score = jaccard(draftSignal, signal);
  if (score > nearest.score) nearest = { score, file: path.relative(repoRoot, file) };
}
pass(nearest.score < 0.72, `Draft is too similar to ${nearest.file} (token Jaccard ${nearest.score.toFixed(3)})`);

const sensitivePatterns = [
  /\/Users\/[A-Za-z0-9._-]+\//,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/
];
for (const pattern of sensitivePatterns) pass(!pattern.test(article), `Draft matches sensitive/local pattern ${pattern}`);

const summaryFile = path.join(current, 'run-summary.md');
const summary = regularFile(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '';
pass(nonempty(summary, 100), 'run-summary.md is missing or too short');
if (stage === 'final') {
  pass(!summary.includes('Pending research.'), 'run-summary.md still contains the scaffold placeholder');
  pass(summary.includes('## Gate table'), 'run-summary.md lacks gate table');
  pass(summary.includes('NOT PUBLISHED'), 'run-summary.md must say NOT PUBLISHED before approval');
  const reviewFile = path.join(current, 'review', 'editorial-review.json');
  const review = fs.existsSync(reviewFile) ? readJson(reviewFile) : null;
  pass(Boolean(review), 'review/editorial-review.json is missing or invalid');
  if (review) {
    pass(review.verdict === 'PASS', `Independent review is not PASS: ${review.verdict || 'missing'}`);
    pass(Number(review.claim_coverage) === 1, `Independent claim coverage must be 1.0, found ${review.claim_coverage}`);
    pass(review.persona_honesty && review.originality && nonempty(review.non_commodity_finding), 'Review lacks persona, originality or non-commodity finding');
    if (manifest?.mode === 'publish-on-green') {
      pass(review.trend_relevance === true, 'Independent review did not confirm trend relevance');
      pass(review.durable_value_without_spike === true, 'Independent review did not confirm durable value without the spike');
      pass(review.trend_not_thesis === true, 'Independent review did not confirm that the trend is not the thesis');
      pass(nonempty(review.trend_rationale, 40), 'Independent review lacks a concrete trend-value rationale');
    }
    const reviewClaims = Array.isArray(review.claims) ? review.claims : [];
    const mappedIds = [...new Set(mappedClaims.map((claim) => claim.claim_id))].sort();
    const reviewIds = [...new Set(reviewClaims.map((claim) => claim.claim_id))].sort();
    pass(JSON.stringify(reviewIds) === JSON.stringify(mappedIds), 'Review claim IDs do not exactly cover the claim map');
    for (const claim of reviewClaims) pass(claim.supported === true && nonempty(claim.evidence_ref), `PASS review contains unsupported or unreferenced claim ${claim.claim_id || '(missing)'}`);
  }
  const draftValidationFile = path.join(current, 'validation', 'draft-validation.json');
  const draftValidation = fs.existsSync(draftValidationFile) ? readJson(draftValidationFile) : null;
  pass(draftValidation?.result === 'PASS', `Draft-stage validation is missing or not PASS: ${draftValidation?.result || 'missing'}`);
  const scopeFile = path.join(current, 'validation', 'path-scope.txt');
  const recordedScope = regularFile(scopeFile)
    ? fs.readFileSync(scopeFile, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).sort()
    : [];
  pass(derivedPackage.all.length > 0 && JSON.stringify(recordedScope) === JSON.stringify(derivedPackage.all), `path-scope.txt must exactly match the derived package paths. Expected ${JSON.stringify(derivedPackage.all)}, got ${JSON.stringify(recordedScope)}`);
  if (manifest) {
    pass(['reviewing', 'ready_for_review', 'approved'].includes(manifest.status), `Final validation requires reviewing/ready_for_review/approved status, found ${manifest.status}`);
    const requiredGateKeys = [...(manifest.mode === 'publish-on-green' ? ['GT'] : []), ...Array.from({ length: 11 }, (_, index) => `G${index + 1}`)];
    const badGates = requiredGateKeys.filter((key) => {
      const gate = manifest.gates?.[key];
      return (typeof gate === 'string' ? gate : gate?.verdict) !== 'PASS';
    });
    pass(badGates.length === 0, `Manifest required gates are missing or non-PASS: ${badGates.join(', ')}`);
  }
}

const packageSha256 = {};
for (const relative of derivedPackage.all) {
  const file = path.join(current, 'draft', relative);
  if (regularFile(file)) packageSha256[relative] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const report = {
  generated_at: new Date().toISOString(),
  run_id: manifest?.run_id || null,
  stage,
  draft: draftPath ? path.relative(repoRoot, draftPath).split(path.sep).join('/') : null,
  result: failures.length ? 'FIX' : 'PASS',
  package_sha256: packageSha256,
  metrics: {
    english_words: wordCount,
    paragraphs: (body.match(/<p\b/gi) || []).length,
    sections: (body.match(/<h3\b/gi) || []).length,
    internal_links: internalLinks,
    sources: sources.length,
    source_images: sourceFigures.length,
    evidence_claims: claims.length,
    mapped_claims: mappedClaims.length,
    nearest_existing: nearest
  },
  failures,
  warnings
};
fs.mkdirSync(path.join(current, 'validation'), { recursive: true });
const reportName = stage === 'draft' ? 'draft-validation.json' : 'validation.json';
fs.writeFileSync(path.join(current, 'validation', reportName), `${JSON.stringify(report, null, 2)}\n`);

if (failures.length) {
  console.error(`Editorial package validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  if (warnings.length) console.error(`Warnings: ${warnings.join('; ')}`);
  process.exit(1);
}

console.log(`Editorial package ${stage} validation passed with ${warnings.length} warning(s).`);
for (const warning of warnings) console.log(`- warning: ${warning}`);
