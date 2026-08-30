#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  MAX_SOURCE_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_TOTAL_BYTES,
  MAX_REFERENCE_IMAGES,
  MIN_SOURCE_IMAGE_BYTES,
  derivePackagePaths,
  validateSourceImageManifest,
  extractSourceFigures,
  bindFiguresToImages,
  isSafePackagePath,
  imageContentTypePattern,
  rasterSignatureMatches,
  sourceImageContractAppliesToArticlePath,
  sourceImageSlugFromEditorialCover
} from './lib/source-images.mjs';

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
  fs.mkdirSync(path.join(root, 'tools', 'lib'), { recursive: true });
  for (const file of ['editorial-workspace.mjs', 'capture-google-trends.mjs', 'verify-deployment.mjs', 'lib/source-images.mjs']) fs.copyFileSync(path.join(sourceRoot, 'tools', file), path.join(root, 'tools', file));
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
  tests.push('approval context and exact-scope guards stay synchronized');

  // --- Source-derived reference image contract (pure helper) ---

  const slug = 'sample-guide';
  const goodManifest = {
    run_id: '20260830-source-test',
    started_at_kst: '2026-08-30T01:00:00+09:00',
    slug,
    article_path: '_posts/2026-08-30-Sample-Guide.md',
    asset_paths: [`img/editorial/${slug}.jpg`, `img/editorial/${slug}.thumb.jpg`],
    reference_image_paths: [1, 2, 3, 4].map((n) => `img/source/${slug}/photo-${n}.jpg`)
  };
  const derivedOk = derivePackagePaths(goodManifest);
  assert.deepEqual(derivedOk.errors, []);
  assert.equal(derivedOk.all.length, 7);
  assert.ok(derivedOk.all.every((p) => isSafePackagePath(p)));
  tests.push('derived package accepts one post, two AI covers and four source images');

  const derivedShort = derivePackagePaths({ ...goodManifest, reference_image_paths: goodManifest.reference_image_paths.slice(0, 3) });
  assert.ok(derivedShort.errors.some((issue) => issue.includes('at least 4 source-derived reference image paths')));
  const derivedEscape = derivePackagePaths({ ...goodManifest, reference_image_paths: [...goodManifest.reference_image_paths.slice(0, 3), 'img/editorial/sneaky.jpg'] });
  assert.ok(derivedEscape.errors.some((issue) => issue.includes('Unsafe reference image path')));
  const derivedForeignSlug = derivePackagePaths({ ...goodManifest, reference_image_paths: [...goodManifest.reference_image_paths.slice(0, 3), 'img/source/other-slug/photo.jpg'] });
  assert.ok(derivedForeignSlug.errors.some((issue) => issue.includes('Unsafe reference image path')));
  const derivedTooMany = derivePackagePaths({ ...goodManifest, reference_image_paths: Array.from({ length: MAX_REFERENCE_IMAGES + 1 }, (_, index) => `img/source/${slug}/photo-${index + 1}.jpg`) });
  assert.ok(derivedTooMany.errors.some((issue) => issue.includes('at most 12 source-derived reference image paths')));
  tests.push('derived package fails closed on missing, escaping or foreign-slug source images');

  const goodImage = (n) => ({
    local_path: `img/source/${slug}/photo-${n}.jpg`,
    source_page_url: `https://example.gov/page-${n}`,
    download_url: `https://example.gov/files/photo-${n}.jpg`,
    publisher_or_creator: 'Example Agency',
    license_basis: 'kogl-type-1',
    license_url: 'https://www.kogl.or.kr/info/license.do',
    license_quote: 'KOGL Type 1: free use permitted including commercial use with attribution to the source.',
    retrieved_at: '2026-08-30T01:10:00Z',
    sha256: `${String(n).repeat(4)}${'a'.repeat(60)}`.slice(0, 64),
    transformation: 'resized',
    transformation_note: 'Downscaled to article width, no content edits.',
    alt: `Documentary reference photo number ${n}`,
    attribution_text: `Photo: Example Agency (KOGL Type 1), item ${n}`,
    commercial_use_allowed: true,
    redistribution_allowed: true
  });
  const goodSidecar = { schema_version: 1, run_id: goodManifest.run_id, images: [1, 2, 3, 4].map(goodImage) };
  const evidenceSourceUrls = new Set([1, 2, 3, 4].map((n) => `https://example.gov/page-${n}`));
  const okFileInfo = () => ({ regular: true, bytes: 2 * 1024 * 1024, sha256: null, validRaster: true, width: 1200, height: 800, metadataSegments: 0 });
  const sidecarContext = {
    manifest: goodManifest,
    evidenceSourceUrls,
    referenceImagePaths: goodManifest.reference_image_paths,
    fileInfo: (localPath) => {
      const image = goodSidecar.images.find((item) => item.local_path === localPath);
      return { ...okFileInfo(), sha256: image?.sha256 };
    }
  };
  const validSidecarResult = validateSourceImageManifest(goodSidecar, sidecarContext);
  assert.deepEqual(validSidecarResult.errors, []);
  assert.equal(validSidecarResult.fileFacts[goodSidecar.images[0].local_path].width, 1200);
  tests.push('rights-clear source image sidecar passes');

  const failsWith = (mutate, phrase) => {
    const sidecar = JSON.parse(JSON.stringify(goodSidecar));
    mutate(sidecar);
    const { errors } = validateSourceImageManifest(sidecar, sidecarContext);
    assert.ok(errors.some((issue) => issue.includes(phrase)), `Expected sidecar failure containing: ${phrase}\nGot: ${errors.join('\n')}`);
  };
  failsWith((sidecar) => { sidecar.images[0].license_basis = 'all-rights-reserved'; }, 'not in the fail-closed allowlist');
  failsWith((sidecar) => { sidecar.images[0].license_quote = 'too short'; }, 'license_quote must be at least 40 characters');
  failsWith((sidecar) => { sidecar.images[0].license_basis = 'repo-license-covers-assets'; }, 'without a pinned_ref');
  failsWith((sidecar) => { sidecar.images[1].sha256 = sidecar.images[0].sha256; }, 'Duplicate source image sha256');
  failsWith((sidecar) => { sidecar.images[1].download_url = sidecar.images[0].download_url; }, 'Duplicate source image download_url');
  failsWith((sidecar) => { sidecar.images[0].source_page_url = 'https://unrelated.example/none'; }, 'not an evidence-pack source_url');
  failsWith((sidecar) => { sidecar.images.pop(); }, 'At least 4 rights-clear source images are required');
  failsWith((sidecar) => { sidecar.images.push(...Array.from({ length: MAX_REFERENCE_IMAGES - 3 }, (_, index) => goodImage(index + 5))); }, 'At most 12 rights-clear source images are allowed');
  failsWith((sidecar) => { sidecar.images[0].commercial_use_allowed = false; }, 'commercial_use_allowed: true');
  failsWith((sidecar) => { sidecar.images[0].retrieved_at = '2026'; }, 'invalid retrieved_at');
  failsWith((sidecar) => { sidecar.images[0].retrieved_at = '2026-08-29T00:00:00Z'; }, 'predates the current run');
  failsWith((sidecar) => { sidecar.images[0].retrieved_at = '2999-01-01T00:00:00Z'; }, 'implausibly in the future');
  tests.push('sidecar fails closed on license, quote, pinned ref, duplicates, evidence binding, bounded timestamp and count');

  const repoLicensed = JSON.parse(JSON.stringify(goodSidecar));
  repoLicensed.images[0].license_basis = 'repo-license-covers-assets';
  repoLicensed.images[0].pinned_ref = 'v1.2.3';
  assert.deepEqual(validateSourceImageManifest(repoLicensed, sidecarContext).errors, []);
  tests.push('repo-license-covers-assets passes only with a pinned ref');

  assert.equal(MIN_SOURCE_IMAGE_BYTES, 1);
  const tinyContext = { ...sidecarContext, fileInfo: () => ({ regular: true, bytes: 0, sha256: goodSidecar.images[0].sha256, validRaster: true }) };
  assert.ok(validateSourceImageManifest(goodSidecar, tinyContext).errors.some((issue) => issue.includes('must be between')));
  const oversizedContext = { ...sidecarContext, fileInfo: () => ({ regular: true, bytes: MAX_SOURCE_IMAGE_BYTES + 1, sha256: goodSidecar.images[0].sha256, validRaster: true }) };
  assert.ok(validateSourceImageManifest(goodSidecar, oversizedContext).errors.some((issue) => issue.includes('must be between')));
  const invalidRasterContext = { ...sidecarContext, fileInfo: () => ({ regular: true, bytes: 1024, sha256: goodSidecar.images[0].sha256, validRaster: false }) };
  assert.ok(validateSourceImageManifest(goodSidecar, invalidRasterContext).errors.some((issue) => issue.includes('bytes do not match')));
  const aggregateContext = { ...sidecarContext, fileInfo: (localPath) => {
    const image = goodSidecar.images.find((item) => item.local_path === localPath);
    return { regular: true, bytes: Math.floor(MAX_SOURCE_IMAGE_TOTAL_BYTES / 4) + 1, sha256: image?.sha256, validRaster: true };
  } };
  assert.ok(validateSourceImageManifest(goodSidecar, aggregateContext).errors.some((issue) => issue.includes('aggregate limit')));
  tests.push('source image byte, raster-signature and aggregate limits fail closed');

  const figureFor = (image) => `<figure class="post-photo source-image"><img src="/${image.local_path}" alt="${image.alt}" width="1200" height="800" loading="lazy" decoding="async"><figcaption>${image.attribution_text} · Source: ${image.source_page_url} · License: ${image.license_url} · ${image.publisher_or_creator}</figcaption></figure>`;
  const goodBody = `<p>Intro paragraph.</p>${goodSidecar.images.map(figureFor).join('\n')}<p>Outro paragraph.</p>`;
  const extraction = extractSourceFigures(goodBody);
  assert.deepEqual(extraction.errors, []);
  assert.deepEqual(extractSourceFigures(`<https://example.com/reference>${goodBody}`).errors, []);
  assert.equal(extraction.figures.length, 4);
  assert.ok(!/<img\b/i.test(extraction.strippedBody), 'stripped body must contain no img tags');
  assert.ok(extraction.strippedBody.includes('<figcaption>'), 'captions must remain for the HTML allowlist');
  assert.deepEqual(bindFiguresToImages(extraction.figures, goodSidecar.images, validSidecarResult.fileFacts), []);
  const wrongDimensions = { ...validSidecarResult.fileFacts, [goodSidecar.images[0].local_path]: { ...validSidecarResult.fileFacts[goodSidecar.images[0].local_path], width: 640 } };
  assert.ok(bindFiguresToImages(extraction.figures, goodSidecar.images, wrongDimensions).some((issue) => issue.includes('width/height')));
  tests.push('canonical source figures extract, strip and bind one-to-one with raster dimensions');

  const remote = extractSourceFigures('<figure class="post-photo source-image"><img src="https://cdn.example.com/x.jpg" alt="A remote image" width="10" height="10" loading="lazy" decoding="async"><figcaption>caption https://a https://b</figcaption></figure>');
  assert.ok(remote.errors.some((issue) => issue.includes('local /img/source/')));
  const eager = extractSourceFigures(figureFor(goodSidecar.images[0]).replace('loading="lazy"', 'loading="eager"'));
  assert.ok(eager.errors.some((issue) => issue.includes('loading="lazy"')));
  const styled = extractSourceFigures(figureFor(goodSidecar.images[0]).replace('decoding="async"', 'decoding="async" style="width:100%"'));
  assert.ok(styled.errors.some((issue) => issue.includes('exactly src, alt, width, height, loading and decoding')));
  const malformed = extractSourceFigures('<figure class="post-photo source-image"><img src="/img/source/sample-guide/photo-1.jpg"></figure>');
  assert.ok(malformed.errors.some((issue) => issue.includes('Malformed or non-canonical source-image figure markup')));
  const reordered = extractSourceFigures(figureFor(goodSidecar.images[0]).replace('class="post-photo source-image"', 'class="source-image post-photo"'));
  assert.ok(reordered.errors.some((issue) => issue.includes('Malformed or non-canonical')));
  const hidden = extractSourceFigures(`<!-- ${figureFor(goodSidecar.images[0])} -->`);
  assert.ok(hidden.errors.some((issue) => issue.includes('may not be hidden')));
  const liquidHidden = extractSourceFigures(`{% comment %}${figureFor(goodSidecar.images[0])}{% endcomment %}`);
  assert.ok(liquidHidden.errors.some((issue) => issue.includes('may not be hidden')));
  const detailsHidden = extractSourceFigures(`<details open>${figureFor(goodSidecar.images[0])}</details>`);
  assert.ok(detailsHidden.errors.some((issue) => issue.includes('may not be hidden')));
  const parentHidden = extractSourceFigures(`<div style="display:none">${figureFor(goodSidecar.images[0])}</div>`);
  assert.ok(parentHidden.errors.some((issue) => issue.includes('may not be hidden')));
  for (const [open, close] of [
    ['<div style="display:none"><div></div>', '</div>'],
    ['<template>', '</template>'],
    ['<noscript>', '</noscript>'],
    ['<td hidden>', '</td>'],
    ['<dialog>', '</dialog>'],
    ['<dd hidden>', '</dd>'],
    ['<button hidden>', '</button>'],
    ['<div data-src="a/">', '</div>'],
    ['{% if false %}', '{% endif %}']
  ]) {
    const inert = extractSourceFigures(`${open}${figureFor(goodSidecar.images[0])}${close}`);
    assert.ok(inert.errors.some((issue) => issue.includes('top-level visibly rendered')), `Expected inert wrapper ${open} to fail`);
  }
  const fencedHidden = extractSourceFigures(`\`\`\`html\n${figureFor(goodSidecar.images[0])}\n\`\`\`\``);
  assert.ok(fencedHidden.errors.some((issue) => issue.includes('may not be hidden')));
  const captionPhrase = extractSourceFigures(figureFor(goodSidecar.images[0]).replace('</figcaption>', ' · phrase post-photo source-image</figcaption>'));
  assert.ok(!captionPhrase.errors.some((issue) => issue.includes('Malformed or non-canonical')));
  tests.push('remote src, eager loading, style, hidden, reordered and malformed figures fail closed');

  const missingFigure = bindFiguresToImages(extraction.figures.slice(0, 3), goodSidecar.images);
  assert.ok(missingFigure.some((issue) => issue.includes('exactly one source figure per source image')));
  const badCaption = extractSourceFigures(figureFor(goodSidecar.images[0]).replace('License:', 'Licence-omitted:').replace(goodSidecar.images[0].license_url, ''));
  assert.ok(bindFiguresToImages(badCaption.figures, [goodSidecar.images[0]]).some((issue) => issue.includes('exact license_url')));
  tests.push('figure binding fails closed on missing figures and incomplete captions');

  assert.ok(imageContentTypePattern('img/source/x/a.png').test('image/png'));
  assert.ok(imageContentTypePattern('img/source/x/a.webp').test('image/webp'));
  assert.ok(imageContentTypePattern('img/editorial/a.jpg').test('image/jpeg'));
  assert.ok(!imageContentTypePattern('img/source/x/a.png').test('image/jpeg'));
  assert.equal(imageContentTypePattern('img/source/x/a.svg'), null);
  const makePng = (metadata = false) => {
    const bytes = Buffer.alloc(metadata ? 57 : 45);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
    bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12, 'ascii'); bytes.writeUInt32BE(256, 16); bytes.writeUInt32BE(256, 20);
    if (metadata) bytes.write('eXIf', 37, 'ascii');
    bytes.write('IEND', (metadata ? 45 : 33) + 4, 'ascii');
    return bytes;
  };
  const makeJpg = (metadata = false) => {
    const sof = Buffer.alloc(13);
    Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08]).copy(sof, 0); sof.writeUInt16BE(256, 5); sof.writeUInt16BE(256, 7);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), ...(metadata ? [Buffer.from([0xff, 0xe1, 0x00, 0x04, 0x45, 0x58])] : []), sof]);
  };
  const makeWebp = (metadata = false) => {
    const bytes = Buffer.alloc(metadata ? 38 : 30);
    bytes.write('RIFF', 0, 'ascii'); bytes.write('WEBP', 8, 'ascii'); bytes.write('VP8X', 12, 'ascii'); bytes.writeUInt32LE(10, 16);
    bytes[24] = 0xff; bytes[27] = 0xff;
    if (metadata) bytes.write('EXIF', 30, 'ascii');
    return bytes;
  };
  assert.equal(rasterSignatureMatches('img/source/x/a.png', makePng()), true);
  assert.equal(rasterSignatureMatches('img/source/x/a.jpg', makeJpg()), true);
  assert.equal(rasterSignatureMatches('img/source/x/a.webp', makeWebp()), true);
  assert.equal(rasterSignatureMatches('img/source/x/a.png', makePng(true)), false);
  assert.equal(rasterSignatureMatches('img/source/x/a.jpg', makeJpg(true)), false);
  assert.equal(rasterSignatureMatches('img/source/x/a.webp', makeWebp(true)), false);
  const malformedPng = makePng(); malformedPng.writeUInt32BE(999, 33);
  assert.equal(rasterSignatureMatches('img/source/x/a.png', malformedPng), false);
  const tinyPng = makePng(); tinyPng.writeUInt32BE(1, 16); tinyPng.writeUInt32BE(1, 20);
  assert.equal(rasterSignatureMatches('img/source/x/a.png', tinyPng), false);
  assert.equal(rasterSignatureMatches('img/source/x/a.png', Buffer.from('<html>')), false);
  tests.push('deployment image content types and metadata-free raster structures are extension-exact');

  const unsafeSlugManifest = { ...goodManifest, slug: '../escape' };
  const unsafeSlugResult = validateSourceImageManifest(goodSidecar, { ...sidecarContext, manifest: unsafeSlugManifest });
  assert.ok(unsafeSlugResult.errors.some((issue) => issue.includes('cannot bind to unsafe or missing slug')));
  let arbitraryReadCalled = false;
  validateSourceImageManifest({ ...goodSidecar, images: [{ ...goodSidecar.images[0], local_path: '../../../../etc/hosts' }, ...goodSidecar.images.slice(1)] }, {
    ...sidecarContext,
    fileInfo: () => { arbitraryReadCalled = true; return null; }
  });
  assert.equal(arbitraryReadCalled, true, 'safe entries should still be inspected');
  let escapedReadCalled = false;
  validateSourceImageManifest({ ...goodSidecar, images: [{ ...goodSidecar.images[0], local_path: '../../../../etc/hosts' }] }, {
    ...sidecarContext,
    referenceImagePaths: ['../../../../etc/hosts'],
    fileInfo: () => { escapedReadCalled = true; return null; }
  });
  assert.equal(escapedReadCalled, false, 'unsafe paths must never reach the filesystem adapter');
  tests.push('unsafe slugs and traversal paths fail before filesystem access');

  assert.equal(sourceImageContractAppliesToArticlePath('_posts/2026-08-30-legacy.md'), false);
  assert.equal(sourceImageContractAppliesToArticlePath('_posts/2026-08-31-covered.md'), true);
  assert.equal(sourceImageContractAppliesToArticlePath('_posts/2027-01-01-covered.md'), true);
  assert.equal(sourceImageSlugFromEditorialCover('img/editorial/korean-weather-alerts.jpg'), 'korean-weather-alerts');
  assert.equal(sourceImageSlugFromEditorialCover('', 'img/editorial/transit-card.thumb.jpg'), 'transit-card');
  assert.equal(sourceImageSlugFromEditorialCover('img/family/Not-A-Slug.jpg'), '');
  const siteTool = fs.readFileSync(path.join(sourceRoot, 'tools/verify-site-quality.mjs'), 'utf8');
  assert.match(siteTool, /sourceImageSlugFromEditorialCover\(header, card\)/);
  assert.match(siteTool, /sourceImageContractAppliesToArticlePath\(relative\) && type === 'guide' && usesEditorialImage/);
  assert.match(siteTool, /every guide body img must be a canonical local source-image figure/);
  assert.match(siteTool, /source image must appear in exactly one credited figure/);
  const scopeTool = fs.readFileSync(path.join(sourceRoot, 'tools/verify-publication-scope.mjs'), 'utf8');
  assert.match(scopeTool, /JSON\.stringify\(recorded\) === JSON\.stringify\(expected\)/);
  tests.push('site and scope integration guards are pinned');

  console.log(`Editorial gate regression tests passed: ${tests.length}`);
  for (const test of tests) console.log(`- ${test}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
