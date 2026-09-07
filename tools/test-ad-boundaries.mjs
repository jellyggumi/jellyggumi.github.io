#!/usr/bin/env node
// Render the shipped Liquid includes, not a second implementation of their guards.
// This is not a replacement for GitHub Pages' native Jekyll build or a content-value review.
// Run from repo root: deps=$(mktemp -d); cp tools/template-test-deps/package*.json "$deps/"
// npm ci --prefix "$deps" --ignore-scripts --no-audit --no-fund
// TEST_NODE_MODULES="$deps/node_modules" node tools/test-ad-boundaries.mjs
// Keep node_modules out of the source tree: the site-quality scan rejects symlinks.
// Dependencies are version- and integrity-pinned in template-test-deps/package-lock.json.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const dependency = name => require(process.env.TEST_NODE_MODULES ? path.join(process.env.TEST_NODE_MODULES, name) : name);
const { Liquid } = dependency('liquidjs');
const YAML = dependency('yaml');
const root = process.cwd();
const engine = new Liquid({ root: path.join(root, '_includes'), jekyllInclude: true });
const config = YAML.parse(fs.readFileSync(path.join(root, '_config.yml'), 'utf8'));
const fixtureSite = { google_ad_client: 'test-publisher', google_ad_slots: { post_bottom: 'bottom', post_in_article: 'middle' } };
let cases = 0;
const count = (value, re) => [...value.matchAll(re)].length;
async function render(file, page, site = fixtureSite, environment = 'production', content = '<p>Before</p><!--post-ad-break--><p>After</p>') {
  return engine.renderFile(file, { page, site, jekyll: { environment }, include: { content } });
}
async function checkCase(name, page, expected, site = fixtureSite, environment = 'production') {
  const head = await render('adsense.html', page, site, environment);
  assert.equal(count(head, /<meta name="google-adsense-account"/g), expected.meta, `${name}: ownership`);
  assert.equal(count(head, /<script[^>]+adsbygoogle\.js/g), expected.loader, `${name}: loader`);
  for (const [file, slot] of [['adsense-post.html', 'bottom'], ['adsense-in-article.html', 'middle'], ['post-content.html', 'middle']]) {
    const html = await render(file, page, site, environment);
    assert.equal(count(html, /<ins\s/g), expected[slot], `${name}: ${file}`);
  }
  cases += 1;
}
const closed = { meta: 1, loader: 0, bottom: 0, middle: 0 };
const open = { meta: 1, loader: 1, bottom: 1, middle: 1 };
await checkCase('editorial post', { layout: 'post' }, open);
await checkCase('explicit article opt-out', { layout: 'post', ads: false }, closed);
await checkCase('noindex article', { layout: 'post', robots: 'noindex, follow', adsense: true }, closed);
for (const layout of ['default', 'page', 'home', 'gallery', undefined]) {
  await checkCase(`navigation ${layout}`, { layout }, closed);
  await checkCase(`navigation cannot force ads ${layout}`, { layout, adsense: true }, closed);
}
await checkCase('development post', { layout: 'post' }, { meta: 0, loader: 0, bottom: 0, middle: 0 }, fixtureSite, 'development');
for (const client of ['', undefined]) {
  await checkCase('missing publisher', { layout: 'post' }, { meta: 0, loader: 0, bottom: 0, middle: 0 }, { ...fixtureSite, google_ad_client: client });
}
await checkCase('missing slots', { layout: 'post' }, { meta: 1, loader: 1, bottom: 0, middle: 0 }, { ...fixtureSite, google_ad_slots: {} });
await checkCase('empty slots', { layout: 'post' }, { meta: 1, loader: 1, bottom: 0, middle: 0 }, { ...fixtureSite, google_ad_slots: { post_bottom: '', post_in_article: '' } });
for (const content of ['<p>No marker</p>', '<p>A</p><!--post-ad-break--><p>B</p><!--post-ad-break--><p>C</p>']) {
  assert.equal(count(await render('post-content.html', { layout: 'post' }, fixtureSite, 'production', content), /<ins\s/g), 0, 'invalid marker count must not insert ad');
  cases += 1;
}
// A syntactically valid template can still regress on the real page front matter.
const excluded = new Set(['.git', 'node_modules', 'tools', ...(config.exclude || [])]);
let documents = 0;
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || excluded.has(entry.name) || (entry.name.startsWith('_') && entry.name !== '_posts')) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.(?:html|md)$/.test(entry.name) ? [full] : [];
  });
}
for (const file of walk(root)) {
  const raw = fs.readFileSync(file, 'utf8');
  const front = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!front) continue;
  const page = YAML.parse(front[1]) || {};
  const article = file.includes(`${path.sep}_posts${path.sep}`);
  if (!article) assert.notEqual(page.layout, 'post', `${path.relative(root, file)}: nonarticle must not adopt article layout`);
  const eligible = article && page.ads !== false && !String(page.robots || '').includes('noindex');
  await checkCase(path.relative(root, file), page, eligible ? open : closed, config);
  documents += 1;
  if (page.correction_date || page.correction_note) {
    assert.match(String(page.correction_date || ''), /^\d{4}-\d{2}-\d{2}$/, 'correction date required');
    assert.equal(new Date(`${page.correction_date}T00:00:00Z`).toISOString().slice(0, 10), page.correction_date, 'real correction date');
    assert.ok(typeof page.correction_note === 'string' && page.correction_note.trim(), 'correction scope required');
    assert.ok(String(page.lastmod) >= page.correction_date, 'lastmod must include correction');
  }
}
assert.ok(documents >= 46, 'real article set must be exercised');
console.log(`PASS: ${cases} rendered ad-boundary cases, including ${documents} real documents; correction metadata checked.`);

// Exercise the real post layout: validating metadata alone cannot prove a notice is visible.
engine.registerFilter('relative_url', value => String(value || ''));
engine.registerFilter('date_to_xmlschema', value => new Date(value).toISOString());
engine.registerFilter('number_of_words', value => String(value || '').split(/\s+/).length);
engine.registerFilter('slugify', value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
const layout = fs.readFileSync(path.join(root, '_layouts/post.html'), 'utf8').replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
const correctionPage = { layout: 'post', date: '2026-08-01', correction_date: '2026-09-07', correction_note: 'A scoped correction <not an HTML element>' };
for (const [page, expected] of [[correctionPage, 1], [{ ...correctionPage, correction_date: undefined }, 0], [{ ...correctionPage, correction_note: undefined }, 0], [{ layout: 'post', date: '2026-08-01' }, 0]]) {
  const html = await engine.parseAndRender(layout, { page, site: { ...config, posts: [] }, content: '<p>Article body</p>', jekyll: { environment: 'development' } });
  assert.equal(count(html, /<aside[^>]+aria-label="Article correction"/g), expected, 'correction visibility');
  if (expected) {
    assert.ok(html.includes('datetime="2026-09-07"'), 'machine-readable correction date');
    assert.ok(html.includes('A scoped correction &lt;not an HTML element&gt;'), 'scope note escaped and visible');
  }
}
console.log('PASS: 4 actual post-layout correction states, including escaped scope text.');
