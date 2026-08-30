#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
const researchDir = path.join(current, 'research');
const manifestPath = path.join(current, 'manifest.json');
const lockPath = path.join(current, '.run-lock.json');
const rawPath = path.join(researchDir, 'google-trends-kr.xml');
const signalPath = path.join(researchDir, 'trend-signal.json');
const sourceUrl = 'https://trends.google.com/trending/rss?geo=KR';

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

function decodeXml(value) {
  return String(value || '')
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return decodeXml(block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'))?.[1] || '');
}

const manifest = readJson(manifestPath);
const lock = readJson(lockPath);
if (!['researching', 'drafting'].includes(manifest.status)) throw new Error(`Trend capture requires researching/drafting status, found ${manifest.status}`);
if (manifest.mode !== 'publish-on-green' || manifest.standing_publish_routine_id !== 'h78L2R0UJFRhjS9O') throw new Error('Trend capture is reserved for the pinned publish-on-green routine');
if (lock.run_id !== manifest.run_id || lock.lock_id !== manifest.run_lock_id || lock.state !== 'active') throw new Error('Current run ownership marker does not match an active manifest');
if (fs.existsSync(rawPath) || fs.existsSync(signalPath)) throw new Error('Trend evidence already exists; preserve it and start a new run instead of overwriting');

const response = await fetch(sourceUrl, {
  redirect: 'follow',
  headers: {
    accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
    'user-agent': 'JellyGGumi-Korea-Desk/1.0 (+https://jellyggumi.github.io/editorial-policy/)'
  },
  signal: AbortSignal.timeout(30_000)
});
if (!response.ok) throw new Error(`Google Trends RSS returned HTTP ${response.status}`);
const contentType = response.headers.get('content-type') || '';
if (!/(?:xml|rss)/i.test(contentType)) throw new Error(`Google Trends RSS returned an unexpected content type: ${contentType || '(missing)'}`);
const raw = Buffer.from(await response.arrayBuffer());
if (raw.length < 200 || raw.length > 2_000_000) throw new Error(`Google Trends RSS size is outside the safe range: ${raw.length} bytes`);
const xml = raw.toString('utf8');
if (!/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) throw new Error('Google Trends response is not an RSS channel');

const candidates = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 10).map((match, index) => {
  const block = match[1];
  const query = tag(block, 'title');
  const approxTraffic = tag(block, 'ht:approx_traffic');
  const sourceTimestamp = tag(block, 'pubDate');
  const timestamp = Date.parse(sourceTimestamp);
  if (!query || !approxTraffic || !Number.isFinite(timestamp)) throw new Error(`Malformed Google Trends item ${index + 1}`);
  return {
    query,
    approx_traffic: approxTraffic,
    source_timestamp: sourceTimestamp,
    source_timestamp_utc: new Date(timestamp).toISOString(),
    selected: false
  };
});
if (!candidates.length) throw new Error('Google Trends RSS contained no usable items');

const retrievedAt = new Date().toISOString();
const signal = {
  schema_version: 1,
  source_kind: 'official-google-trends-rss',
  source_url: sourceUrl,
  geography: 'KR',
  window: 'past-24-hours',
  interpretation: 'candidate-discovery-only',
  retrieved_at: retrievedAt,
  response_content_type: contentType,
  raw_feed_path: 'research/google-trends-kr.xml',
  raw_feed_sha256: createHash('sha256').update(raw).digest('hex'),
  selected_query: null,
  selected_candidate_id: null,
  audience_fit: null,
  durable_value_without_spike: false,
  trend_is_not_thesis: true,
  candidates
};

fs.mkdirSync(researchDir, { recursive: true });
fs.writeFileSync(rawPath, raw, { flag: 'wx', mode: 0o600 });
fs.writeFileSync(signalPath, `${JSON.stringify(signal, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({
  run_id: manifest.run_id,
  source_url: sourceUrl,
  retrieved_at: retrievedAt,
  raw_feed_sha256: signal.raw_feed_sha256,
  candidates: candidates.length,
  raw_feed_path: path.relative(root, rawPath),
  signal_path: path.relative(root, signalPath)
}, null, 2));
