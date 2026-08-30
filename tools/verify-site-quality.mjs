#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_SOURCE_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_TOTAL_BYTES,
  MAX_REFERENCE_IMAGES,
  MIN_REFERENCE_IMAGES,
  extractSourceFigures,
  inspectRasterImage,
  sourceImageContractAppliesToArticlePath,
  sourceImageSlugFromEditorialCover
} from './lib/source-images.mjs';

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
const failures = [];
const warnings = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

function walk(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === '.git' || entry.name === '_site' || entry.name === '_workspace') continue;
    if (entry.isSymbolicLink()) failures.push(`Repository contains a forbidden symlink: ${path.relative(root, full)}`);
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
  const value = frontMatter.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function arrayValue(frontMatter, key) {
  const value = scalar(frontMatter, key);
  return value.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function countOccurrences(text, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function jpegInfo(file) {
  const bytes = fs.readFileSync(file);
  const result = { width: null, height: null, app1: 0, app13: 0, jpeg: false };
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

function frontMatterValues(dir, key) {
  const values = new Set();
  for (const file of walk(dir, (candidate) => /\.(md|html)$/.test(candidate))) {
    const { frontMatter } = splitDocument(fs.readFileSync(file, 'utf8'));
    const value = scalar(frontMatter, key);
    if (value) values.add(value);
  }
  return values;
}

const categoryValues = frontMatterValues(path.join(root, 'journal', 'category'), 'category');
const tagValues = frontMatterValues(path.join(root, 'journal', 'tag'), 'tag');
check(categoryValues.size === 5, `Expected 5 category stubs, found ${categoryValues.size}`);
check(tagValues.size === 12, `Expected 12 tag stubs, found ${tagValues.size}`);

const posts = walk(path.join(root, '_posts'), (file) => file.endsWith('.md')).sort();
check(posts.length > 0, 'No posts found');
const postRoutes = new Set();
for (const file of posts) {
  const stem = path.basename(file, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  postRoutes.add(`/journal/${stem}/`);
}
const knownRoutes = new Set([
  '/', '/journal/', '/journal/guides/', '/journal/family-records/', '/journal/archive/', '/journal/category/', '/journal/tag/',
  '/about/', '/contact/', '/privacy/', '/editorial-policy/', '/gallery/', '/games/', '/naver/'
]);
for (const file of walk(root, (candidate) => /\.(md|html)$/.test(candidate))) {
  if (file.includes(`${path.sep}_posts${path.sep}`)) continue;
  const { frontMatter } = splitDocument(fs.readFileSync(file, 'utf8'));
  const permalink = scalar(frontMatter, 'permalink');
  if (permalink) knownRoutes.add(permalink.endsWith('/') ? permalink : `${permalink}/`);
}
for (const route of postRoutes) knownRoutes.add(route);

let guideCount = 0;
let personalCount = 0;
let aiHeaderCount = 0;
let sourceFigureCount = 0;
const referencedSourceImages = new Map();
for (const file of posts) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const text = fs.readFileSync(file, 'utf8');
  const { frontMatter, body } = splitDocument(text);
  check(Boolean(frontMatter), `${relative}: missing front matter`);
  const topLevelKeys = [...frontMatter.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((match) => match[1]);
  const duplicateKeys = [...new Set(topLevelKeys.filter((key, index) => topLevelKeys.indexOf(key) !== index))];
  check(duplicateKeys.length === 0, `${relative}: duplicate top-level front matter keys: ${duplicateKeys.join(', ')}`);
  const type = scalar(frontMatter, 'content_type');
  check(['guide', 'personal'].includes(type), `${relative}: invalid content_type ${type || '(missing)'}`);
  if (type === 'guide') guideCount += 1;
  if (type === 'personal') personalCount += 1;
  check(countOccurrences(body, '<!--post-ad-break-->') === 1, `${relative}: expected exactly one post-ad-break marker`);

  const categories = arrayValue(frontMatter, 'categories');
  check(categories.length >= 1, `${relative}: no category`);
  for (const category of categories) check(categoryValues.has(category), `${relative}: category has no stub: ${category}`);
  const tags = arrayValue(frontMatter, 'tags');
  check(tags.length >= 1, `${relative}: no tags`);
  for (const tag of tags) check(tagValues.has(tag), `${relative}: tag has no stub: ${tag}`);

  const header = scalar(frontMatter, 'header-img');
  const card = scalar(frontMatter, 'card-img');
  check(Boolean(header), `${relative}: missing header-img`);
  for (const [label, asset] of [['header-img', header], ['card-img', card]]) {
    if (!asset) continue;
    const full = path.join(root, asset.replace(/^\//, ''));
    check(fs.existsSync(full) && fs.statSync(full).isFile(), `${relative}: ${label} does not exist: ${asset}`);
  }

  const headerAi = /^header_ai:[ \t]*true[ \t]*$/m.test(frontMatter);
  const hasHeaderAiKey = /^header_ai:/m.test(frontMatter);
  if (hasHeaderAiKey) check(/^header_ai:[ \t]*(?:true|false)[ \t]*$/m.test(frontMatter), `${relative}: header_ai must be a bare YAML boolean`);
  check(/^ai_assisted:[ \t]*(?:true|false)[ \t]*$/m.test(frontMatter), `${relative}: ai_assisted must be a bare YAML boolean`);
  check(/^comments:[ \t]*(?:true|false)[ \t]*$/m.test(frontMatter), `${relative}: comments must be a bare YAML boolean`);
  const usesEditorialImage = header.startsWith('img/editorial/') || card.startsWith('img/editorial/');
  check(!usesEditorialImage || headerAi, `${relative}: img/editorial asset requires header_ai: true disclosure`);
  check(!headerAi || usesEditorialImage, `${relative}: header_ai: true requires an img/editorial asset`);
  if (usesEditorialImage) {
    check(Boolean(card), `${relative}: AI editorial header requires card-img`);
    check(header === card, `${relative}: AI header-img and card-img must be the same disclosed editorial asset`);
    aiHeaderCount += 1;
    check(header.startsWith('img/editorial/'), `${relative}: AI header must be under img/editorial`);
    check(scalar(frontMatter, 'header_width') === '1672', `${relative}: AI header_width must be 1672`);
    check(scalar(frontMatter, 'header_height') === '941', `${relative}: AI header_height must be 941`);
    const full = path.join(root, header);
    if (fs.existsSync(full)) {
      const info = jpegInfo(full);
      check(info.jpeg && info.width === 1672 && info.height === 941, `${relative}: AI header actual dimensions must be 1672x941`);
      check(info.app1 === 0 && info.app13 === 0, `${relative}: AI header contains EXIF/XMP/IPTC metadata`);
      const thumb = header.replace(/\.jpg$/i, '.thumb.jpg');
      const thumbFull = path.join(root, thumb);
      check(fs.existsSync(thumbFull), `${relative}: missing AI thumbnail ${thumb}`);
      if (fs.existsSync(thumbFull)) {
        const thumbInfo = jpegInfo(thumbFull);
        check(thumbInfo.jpeg && thumbInfo.width === 700 && thumbInfo.height === 394, `${relative}: AI thumbnail actual dimensions must be 700x394`);
        check(thumbInfo.app1 === 0 && thumbInfo.app13 === 0, `${relative}: AI thumbnail contains EXIF/XMP/IPTC metadata`);
      }
    }
  }

  for (const match of body.matchAll(/href=["'](\/journal\/[^"'#?]+\/?)["']/g)) {
    const href = match[1].endsWith('/') ? match[1] : `${match[1]}/`;
    check(knownRoutes.has(href), `${relative}: unresolved internal journal link ${match[1]}`);
  }

  // Legacy guides have no body images. Once a guide has an img/source/<slug>/
  // directory or a source figure, the complete >=4 canonical attribution
  // contract applies. Every <img> in a guide must be one of those figures.
  const sourceExtraction = extractSourceFigures(body);
  for (const issue of sourceExtraction.errors) check(false, `${relative}: ${issue}`);
  const bodyImageCount = (body.match(/<img\b/gi) || []).length;
  if (type === 'guide') check(bodyImageCount === sourceExtraction.figures.length, `${relative}: every guide body img must be a canonical local source-image figure`);
  else check(sourceExtraction.figures.length === 0, `${relative}: personal posts may not use automated source-image figures`);
  const sourceSlug = sourceImageSlugFromEditorialCover(header, card);
  const sourceDir = sourceSlug ? path.join(root, 'img', 'source', sourceSlug) : null;
  const sourceDirExists = Boolean(sourceDir && fs.existsSync(sourceDir));
  const sourceContractRequired = sourceImageContractAppliesToArticlePath(relative) && type === 'guide' && usesEditorialImage;
  if (sourceContractRequired || sourceDirExists || sourceExtraction.figures.length > 0) {
    check(type === 'guide', `${relative}: source-image packages are guide-only`);
    check(Boolean(sourceSlug), `${relative}: source-image package must derive one lowercase slug from its editorial cover`);
    if (sourceContractRequired) check(sourceDirExists, `${relative}: posts under the source-image contract must ship their slug-bound source directory`);
    check(sourceExtraction.figures.length >= MIN_REFERENCE_IMAGES, `${relative}: source-image package must contain at least ${MIN_REFERENCE_IMAGES} credited figures`);
    check(sourceExtraction.figures.length <= MAX_REFERENCE_IMAGES, `${relative}: source-image package may contain at most ${MAX_REFERENCE_IMAGES} credited figures`);
  }
  for (const figure of sourceExtraction.figures) {
    const safeFigurePath = Boolean(sourceSlug) && figure.src.startsWith(`/img/source/${sourceSlug}/`) && /^\/img\/source\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/i.test(figure.src);
    check(safeFigurePath, `${relative}: source figure must stay in its own slug directory: ${figure.src}`);
    if (!safeFigurePath) continue;
    const asset = figure.src.replace(/^\//, '');
    const full = path.join(root, asset);
    let regular = false;
    try {
      const stat = fs.lstatSync(full);
      regular = stat.isFile() && !stat.isSymbolicLink();
    } catch {}
    check(regular, `${relative}: source figure image does not exist or is unsafe: ${figure.src}`);
    if (regular) {
      const raster = inspectRasterImage(asset, fs.readFileSync(full));
      check(raster.metadataSegments === 0, `${relative}: source figure image must have EXIF/XMP/text metadata stripped: ${figure.src}`);
      check(raster.valid, `${relative}: source figure is not a metadata-free plausible raster image: ${figure.src}`);
      check(String(raster.width) === figure.width && String(raster.height) === figure.height, `${relative}: source figure width/height do not match the raster: ${figure.src}`);
    }
    const captionUrls = figure.captionText.match(/https?:\/\/\S+/g) || [];
    check(captionUrls.length >= 2, `${relative}: source figure caption must cite its source page and license URLs: ${figure.src}`);
    referencedSourceImages.set(figure.src, (referencedSourceImages.get(figure.src) || 0) + 1);
  }
  sourceFigureCount += sourceExtraction.figures.length;
}

const editorialDir = path.join(root, 'img', 'editorial');
const editorialImages = walk(editorialDir, (file) => /\.jpe?g$/i.test(file));
for (const file of editorialImages) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const info = jpegInfo(file);
  const isThumb = /\.thumb\.jpg$/i.test(file);
  const expected = isThumb ? [700, 394] : [1672, 941];
  check(info.jpeg, `${relative}: not a valid JPEG`);
  check(info.width === expected[0] && info.height === expected[1], `${relative}: expected ${expected[0]}x${expected[1]}, found ${info.width}x${info.height}`);
  check(info.app1 === 0 && info.app13 === 0, `${relative}: contains EXIF/XMP/IPTC metadata`);
}

const sourceImageFiles = walk(path.join(root, 'img', 'source'));
const sourceBytesBySlug = new Map();
const sourceCountBySlug = new Map();
for (const file of sourceImageFiles) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const match = relative.match(/^img\/source\/([a-z0-9][a-z0-9-]*)\/[^/]+$/);
  const bytes = fs.readFileSync(file);
  check(Boolean(match), `${relative}: source image must be directly under img/source/<slug>/`);
  check(/\.(?:png|jpe?g|webp)$/i.test(file), `${relative}: source images must be png/jpg/jpeg/webp`);
  check(bytes.length > 0 && bytes.length <= MAX_SOURCE_IMAGE_BYTES, `${relative}: source image must be non-empty and no larger than ${MAX_SOURCE_IMAGE_BYTES} bytes`);
  const raster = inspectRasterImage(relative, bytes);
  check(raster.metadataSegments === 0, `${relative}: source image must have EXIF/XMP/text metadata stripped`);
  check(raster.valid, `${relative}: bytes do not match a metadata-free plausible raster structure for the declared extension`);
  const publicPath = `/${relative}`;
  check(referencedSourceImages.get(publicPath) === 1, `${relative}: source image must appear in exactly one credited figure`);
  if (match) {
    sourceBytesBySlug.set(match[1], (sourceBytesBySlug.get(match[1]) || 0) + bytes.length);
    sourceCountBySlug.set(match[1], (sourceCountBySlug.get(match[1]) || 0) + 1);
  }
}
for (const publicPath of referencedSourceImages.keys()) {
  check(sourceImageFiles.some((file) => `/${path.relative(root, file).split(path.sep).join('/')}` === publicPath), `Source figure has no matching img/source file: ${publicPath}`);
}
for (const [slug, bytes] of sourceBytesBySlug) {
  check(bytes <= MAX_SOURCE_IMAGE_TOTAL_BYTES, `img/source/${slug}/ exceeds the ${MAX_SOURCE_IMAGE_TOTAL_BYTES}-byte aggregate limit`);
  check(sourceCountBySlug.get(slug) <= MAX_REFERENCE_IMAGES, `img/source/${slug}/ exceeds the ${MAX_REFERENCE_IMAGES}-image count limit`);
}

const postLayout = fs.existsSync(path.join(root, '_layouts', 'post.html')) ? fs.readFileSync(path.join(root, '_layouts', 'post.html'), 'utf8') : '';
check(postLayout.includes('<img') && postLayout.includes('page.header-img'), 'Post layout must render header-img as a real img element');
check(postLayout.includes('page.header_ai'), 'Post layout lacks visible AI image disclosure gate');
const head = fs.existsSync(path.join(root, '_includes', 'head.html')) ? fs.readFileSync(path.join(root, '_includes', 'head.html'), 'utf8') : '';
check(head.includes('max-image-preview:large'), 'Head must preserve max-image-preview:large');
check(head.includes('<meta property="og:image"') && head.includes('page.header-img'), 'Head must derive og:image from the rendered header image');
const postContent = fs.existsSync(path.join(root, '_includes', 'post-content.html')) ? fs.readFileSync(path.join(root, '_includes', 'post-content.html'), 'utf8') : '';
check(postContent.includes("assign AD_BREAK = '<!--post-ad-break-->'") && postContent.includes('split: AD_BREAK') && postContent.includes('ad_parts.size == 2'), 'Post content include lacks exact one-marker rendering contract');

const config = fs.readFileSync(path.join(root, '_config.yml'), 'utf8');
check(/^authenticated_reader_context:\s*false\s*$/m.test(config), 'Anonymous reader context must remain explicitly unauthenticated');
check(/^share:\s*false\s*$/m.test(config), 'Anonymous SNS share icons must remain closed');
check(postLayout.includes('site.share and site.authenticated_reader_context'), 'Post layout must gate SNS share icons on authenticated reader context');
check(config.includes('google_ad_client: ca-pub-6960738425944933'), 'JellyGGumi AdSense publisher is missing or changed');
check(config.includes('id: "G-LZGE8E8VHZ"'), 'JellyGGumi Analytics ID is missing or changed');
const adsText = fs.readFileSync(path.join(root, 'ads.txt'), 'utf8');
check(adsText.includes('pub-6960738425944933'), 'ads.txt publisher does not match JellyGGumi');

if (failures.length) {
  console.error(`Site quality verification failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  if (warnings.length) console.error(`Warnings: ${warnings.join('; ')}`);
  process.exit(1);
}

console.log(`Site quality verification passed: posts=${posts.length}, guides=${guideCount}, personal=${personalCount}, categories=${categoryValues.size}, tags=${tagValues.size}, ai_headers=${aiHeaderCount}, editorial_images=${editorialImages.length}, source_figures=${sourceFigureCount}, source_images=${sourceImageFiles.length}.`);
