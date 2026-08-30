// Pure helpers for the source-derived reference image contract.
//
// Every NEW automated package keeps its AI-generated 1672x941 hero and 700x394
// thumbnail pair (with image-provenance.json) and additionally carries at least
// 4–12 distinct rights-clear raster images downloaded from inspected reference
// materials under img/source/<slug>/, described by the internal sidecar
// _workspace/current/draft/source-image-manifest.json and embedded one-per-image
// in a tightly scoped attribution <figure>. These helpers are pure: filesystem
// access is injected through a fileInfo callback so callers and tests share the
// exact same fail-closed rules.

export const ALLOWED_LICENSE_BASES = Object.freeze([
  'public-domain',
  'cc0',
  'cc-by',
  'cc-by-sa',
  'kogl-type-1',
  'repo-license-covers-assets',
  'official-press-kit'
]);

export const SOURCE_IMAGE_CONTRACT_EFFECTIVE_DATE = '2026-08-31';
export const MIN_REFERENCE_IMAGES = 4;
export const MAX_REFERENCE_IMAGES = 12;
export const MIN_LICENSE_QUOTE_CHARS = 40;
export const MIN_SOURCE_IMAGE_BYTES = 1;
export const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;
export const MIN_SOURCE_IMAGE_PIXELS = 16_384;
export const MIN_SOURCE_IMAGE_SHORT_SIDE = 32;

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const ARTICLE_RE = /^_posts\/\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9-]*\.md$/;
const EDITORIAL_ASSET_RE = /^img\/editorial\/[a-z0-9][a-z0-9.-]*\.jpg$/;
const SOURCE_IMAGE_ANY_RE = /^img\/source\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/;
const SOURCE_FIGURE_SRC_RE = /^\/img\/source\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function nonempty(value, minimum = 1) {
  return typeof value === 'string' && value.trim().length >= minimum;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function sourceImagePathPattern(slug) {
  if (!SLUG_RE.test(String(slug || ''))) return null;
  return new RegExp(`^img/source/${escapeRegExp(slug)}/[A-Za-z0-9][A-Za-z0-9._-]*\\.(?:png|jpe?g|webp)$`);
}

export const sourceImageContractAppliesToArticlePath = (articlePath) => {
  const date = String(articlePath || '').match(/^_posts\/(\d{4}-\d{2}-\d{2})-/)?.[1];
  return Boolean(date && date >= SOURCE_IMAGE_CONTRACT_EFFECTIVE_DATE);
};

export function sourceImageSlugFromEditorialCover(headerImage, cardImage = '') {
  for (const candidate of [headerImage, cardImage]) {
    const match = String(candidate || '').match(/^\/?img\/editorial\/([a-z0-9][a-z0-9-]*)(?:\.thumb)?\.jpg$/);
    if (match) return match[1];
  }
  return '';
}

// One publication-path allowlist for the derived package:
// one post, two AI cover files under img/editorial, and source-derived
// reference images under img/source/<slug>/.
export function isSafePackagePath(relative) {
  const value = String(relative || '');
  return ARTICLE_RE.test(value) || EDITORIAL_ASSET_RE.test(value) || SOURCE_IMAGE_ANY_RE.test(value);
}

export function imageContentTypePattern(relativeOrUrl) {
  const value = String(relativeOrUrl || '');
  if (/\.png$/i.test(value)) return /^image\/png\b/i;
  if (/\.webp$/i.test(value)) return /^image\/webp\b/i;
  if (/\.jpe?g$/i.test(value)) return /^image\/jpeg\b/i;
  return null;
}

const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));
const be16 = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];
const be32 = (bytes, offset) => ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
const le24 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
const le32 = (bytes, offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] * 0x1000000)) >>> 0;

export function inspectRasterImage(relativeOrUrl, data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array();
  const value = String(relativeOrUrl || '');
  let format = null;
  let width = 0;
  let height = 0;
  let metadataSegments = 0;

  if (/\.png$/i.test(value)) {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length >= 45 && signature.every((byte, index) => bytes[index] === byte) && be32(bytes, 8) === 13 && ascii(bytes, 12, 16) === 'IHDR') {
      width = be32(bytes, 16);
      height = be32(bytes, 20);
      let offset = 8;
      let chunksValid = true;
      let sawIend = false;
      while (offset + 12 <= bytes.length) {
        const length = be32(bytes, offset);
        const type = ascii(bytes, offset + 4, offset + 8);
        if (['eXIf', 'iTXt', 'tEXt', 'zTXt'].includes(type)) metadataSegments += 1;
        const next = offset + 12 + length;
        if (next <= offset || next > bytes.length) { chunksValid = false; break; }
        offset = next;
        if (type === 'IEND') { sawIend = length === 0; break; }
      }
      if (chunksValid && sawIend) format = 'png';
    }
  } else if (/\.jpe?g$/i.test(value)) {
    if (bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
      let offset = 2;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        const marker = bytes[offset];
        offset += 1;
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > bytes.length) break;
        const length = be16(bytes, offset);
        if (length < 2 || offset + length > bytes.length) break;
        if (marker === 0xe1 || marker === 0xed || marker === 0xfe) metadataSegments += 1;
        if (sof.has(marker) && length >= 7) {
          format = 'jpeg';
          height = be16(bytes, offset + 3);
          width = be16(bytes, offset + 5);
        }
        offset += length;
      }
    }
  } else if (/\.webp$/i.test(value) && bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === 'VP8X') {
      format = 'webp';
      width = le24(bytes, 24) + 1;
      height = le24(bytes, 27) + 1;
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      format = 'webp';
      width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
      height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10));
    } else if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      format = 'webp';
      width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    }
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = ascii(bytes, offset, offset + 4);
      const length = le32(bytes, offset + 4);
      if (type === 'EXIF' || type === 'XMP ' || type === 'XMP_') metadataSegments += 1;
      const next = offset + 8 + length + (length % 2);
      if (next <= offset || next > bytes.length) break;
      offset = next;
    }
  }

  const valid = Boolean(format)
    && Number.isInteger(width)
    && Number.isInteger(height)
    && Math.min(width, height) >= MIN_SOURCE_IMAGE_SHORT_SIDE
    && width * height >= MIN_SOURCE_IMAGE_PIXELS
    && metadataSegments === 0;
  return { valid, format, width, height, metadataSegments };
}

export const rasterSignatureMatches = (relativeOrUrl, data) => inspectRasterImage(relativeOrUrl, data).valid;

// Derives the exact publishable path set from the manifest:
// article_path + exactly two slug-bound AI cover asset_paths + at least four
// unique slug-bound reference_image_paths. Fails closed on any deviation.
export function derivePackagePaths(manifest) {
  const errors = [];
  const articlePath = String(manifest?.article_path || '');
  const slug = String(manifest?.slug || '');
  const assets = Array.isArray(manifest?.asset_paths) ? manifest.asset_paths.map(String) : [];
  const references = Array.isArray(manifest?.reference_image_paths) ? manifest.reference_image_paths.map(String) : [];

  if (!ARTICLE_RE.test(articlePath)) errors.push(`Unsafe article path: ${articlePath || '(missing)'}`);
  if (!SLUG_RE.test(slug)) errors.push(`Unsafe manifest slug: ${slug || '(missing)'}`);

  const expectedAssets = SLUG_RE.test(slug) ? [`img/editorial/${slug}.jpg`, `img/editorial/${slug}.thumb.jpg`].sort() : [];
  if (assets.length !== 2 || JSON.stringify([...assets].sort()) !== JSON.stringify(expectedAssets)) {
    errors.push(`Asset paths must be exactly the two AI cover files for the slug. Expected ${JSON.stringify(expectedAssets)}, got ${JSON.stringify(assets)}`);
  }

  if (!Array.isArray(manifest?.reference_image_paths)) errors.push('Manifest reference_image_paths must be an array');
  if (references.length < MIN_REFERENCE_IMAGES) {
    errors.push(`Manifest must declare at least ${MIN_REFERENCE_IMAGES} source-derived reference image paths, found ${references.length}`);
  }
  if (references.length > MAX_REFERENCE_IMAGES) {
    errors.push(`Manifest may declare at most ${MAX_REFERENCE_IMAGES} source-derived reference image paths, found ${references.length}`);
  }
  const pattern = sourceImagePathPattern(slug);
  for (const reference of references) {
    if (!pattern || !pattern.test(reference)) errors.push(`Unsafe reference image path: ${reference}`);
  }
  if (new Set(references).size !== references.length) errors.push('Reference image paths must be unique');

  const all = [articlePath, ...assets, ...references].filter(Boolean).sort();
  if (new Set(all).size !== all.length) errors.push('Derived package paths must be unique');

  const valid = errors.length === 0;
  return {
    errors,
    articlePath,
    slug,
    assetPaths: valid ? [...assets].sort() : [],
    referenceImagePaths: valid ? [...references].sort() : [],
    all: valid ? all : []
  };
}

// Validates _workspace/current/draft/source-image-manifest.json.
// context:
//   manifest             current run manifest (binds run_id, slug, reference_image_paths)
//   evidenceSourceUrls   Set of evidence-pack source_url values (source_page_url must be one)
//   referenceImagePaths  manifest.reference_image_paths for exact set matching
//   fileInfo(local_path) -> { regular, bytes, sha256, validRaster, width, height, metadataSegments } | null
//                              (injected filesystem probe)
export function validateSourceImageManifest(sidecar, context = {}) {
  const errors = [];
  const { manifest = null, evidenceSourceUrls = null, referenceImagePaths = null, fileInfo = null } = context;

  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) {
    errors.push('source-image-manifest.json must be a JSON object');
    return { errors, images: [], metrics: { total_source_image_bytes: 0 }, fileFacts: {} };
  }
  if (sidecar.schema_version !== 1) errors.push(`Unsupported source image manifest schema_version: ${sidecar.schema_version}`);
  if (!nonempty(sidecar.run_id, 6)) errors.push('Source image manifest lacks a run_id');
  if (manifest && sidecar.run_id !== manifest.run_id) errors.push(`Source image manifest run_id does not match the current run: ${sidecar.run_id}`);

  const images = Array.isArray(sidecar.images) ? sidecar.images : [];
  if (!Array.isArray(sidecar.images)) errors.push('Source image manifest images must be an array');
  if (images.length < MIN_REFERENCE_IMAGES) {
    errors.push(`At least ${MIN_REFERENCE_IMAGES} rights-clear source images are required, found ${images.length}; block the package`);
  }
  if (images.length > MAX_REFERENCE_IMAGES) {
    errors.push(`At most ${MAX_REFERENCE_IMAGES} rights-clear source images are allowed, found ${images.length}; block the package`);
  }

  const slug = String(manifest?.slug || '');
  const pathPattern = sourceImagePathPattern(slug);
  if (!pathPattern) errors.push(`Source image manifest cannot bind to unsafe or missing slug: ${slug || '(missing)'}`);
  const seenPaths = new Set();
  const seenHashes = new Set();
  const seenDownloads = new Set();
  const fileFacts = {};
  let totalBytes = 0;

  images.forEach((image, index) => {
    const label = typeof image?.local_path === 'string' && image.local_path ? image.local_path : `image ${index + 1}`;
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      errors.push(`Source image entry ${index + 1} must be an object`);
      return;
    }
    for (const key of ['local_path', 'source_page_url', 'download_url', 'publisher_or_creator', 'license_basis', 'license_url', 'license_quote', 'retrieved_at', 'sha256', 'transformation', 'transformation_note', 'alt', 'attribution_text']) {
      if (!nonempty(String(image[key] ?? ''))) errors.push(`Source image ${label} lacks ${key}`);
    }

    const localPath = String(image.local_path || '');
    const safeLocalPath = Boolean(pathPattern?.test(localPath));
    if (!safeLocalPath) errors.push(`Source image ${label} local_path must be img/source/<slug>/<file>.png|.jpg|.jpeg|.webp bound to the run slug`);
    if (seenPaths.has(localPath)) errors.push(`Duplicate source image local_path: ${localPath}`);
    seenPaths.add(localPath);

    if (!isHttpUrl(image.source_page_url)) errors.push(`Source image ${label} has an invalid source_page_url`);
    if (evidenceSourceUrls && !evidenceSourceUrls.has(image.source_page_url)) {
      errors.push(`Source image ${label} source_page_url is not an evidence-pack source_url: ${image.source_page_url}`);
    }
    if (!isHttpUrl(image.download_url)) errors.push(`Source image ${label} has an invalid download_url`);
    if (seenDownloads.has(image.download_url)) errors.push(`Duplicate source image download_url: ${image.download_url}`);
    seenDownloads.add(image.download_url);

    if (!ALLOWED_LICENSE_BASES.includes(image.license_basis)) {
      errors.push(`Source image ${label} license_basis is not in the fail-closed allowlist: ${image.license_basis}`);
    }
    if (image.license_basis === 'repo-license-covers-assets' && !nonempty(String(image.pinned_ref ?? ''), 4)) {
      errors.push(`Source image ${label} uses repo-license-covers-assets without a pinned_ref`);
    }
    if (!isHttpUrl(image.license_url)) errors.push(`Source image ${label} has an invalid license_url`);
    if (!nonempty(String(image.license_quote ?? ''), MIN_LICENSE_QUOTE_CHARS)) {
      errors.push(`Source image ${label} license_quote must be at least ${MIN_LICENSE_QUOTE_CHARS} characters`);
    }
    const retrievedAt = Date.parse(image.retrieved_at);
    const runStartedAt = Date.parse(manifest?.started_at_kst);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(String(image.retrieved_at || '')) || !Number.isFinite(retrievedAt)) {
      errors.push(`Source image ${label} has an invalid retrieved_at`);
    } else {
      if (Number.isFinite(runStartedAt) && retrievedAt < runStartedAt) errors.push(`Source image ${label} retrieved_at predates the current run`);
      if (retrievedAt > Date.now() + 10 * 60 * 1000) errors.push(`Source image ${label} retrieved_at is implausibly in the future`);
    }
    if (!/^[a-f0-9]{64}$/.test(String(image.sha256 || ''))) errors.push(`Source image ${label} lacks a lowercase hex sha256`);
    if (seenHashes.has(image.sha256)) errors.push(`Duplicate source image sha256: ${image.sha256}`);
    seenHashes.add(image.sha256);
    if (!nonempty(String(image.alt ?? ''), 5)) errors.push(`Source image ${label} alt text is missing or too short`);
    if (!nonempty(String(image.attribution_text ?? ''), 5)) errors.push(`Source image ${label} attribution_text is missing or too short`);
    if (image.commercial_use_allowed !== true) errors.push(`Source image ${label} must record commercial_use_allowed: true`);
    if (image.redistribution_allowed !== true) errors.push(`Source image ${label} must record redistribution_allowed: true`);

    if (fileInfo && safeLocalPath) {
      const info = fileInfo(localPath);
      if (!info || info.regular !== true) errors.push(`Source image ${label} is not a packaged regular file`);
      else {
        fileFacts[localPath] = info;
        if (Number.isFinite(info.bytes) && info.bytes > 0) totalBytes += info.bytes;
        if (!(info.bytes >= MIN_SOURCE_IMAGE_BYTES && info.bytes <= MAX_SOURCE_IMAGE_BYTES)) {
          errors.push(`Source image ${label} must be between ${MIN_SOURCE_IMAGE_BYTES} and ${MAX_SOURCE_IMAGE_BYTES} bytes, found ${info.bytes}`);
        }
        if (info.metadataSegments > 0) errors.push(`Source image ${label} must have EXIF/XMP/text metadata stripped`);
        else if (info.validRaster !== true) errors.push(`Source image ${label} bytes do not match a plausible raster structure for its extension`);
        if (info.sha256 !== image.sha256) errors.push(`Source image ${label} sha256 does not match the packaged bytes`);
      }
    }
  });

  if (totalBytes > MAX_SOURCE_IMAGE_TOTAL_BYTES) {
    errors.push(`Source images exceed the ${MAX_SOURCE_IMAGE_TOTAL_BYTES}-byte aggregate limit: ${totalBytes}`);
  }

  if (Array.isArray(referenceImagePaths)) {
    const declared = images.map((image) => String(image?.local_path || '')).sort();
    const referenced = referenceImagePaths.map(String).sort();
    if (JSON.stringify(declared) !== JSON.stringify(referenced)) {
      errors.push(`Sidecar images and manifest reference_image_paths must match exactly. Sidecar ${JSON.stringify(declared)}, manifest ${JSON.stringify(referenced)}`);
    }
  }

  return { errors, images, metrics: { total_source_image_bytes: totalBytes }, fileFacts };
}

// Extracts the tightly scoped attribution figures:
//   <figure class="post-photo source-image"><img src="/img/source/<slug>/..."
//     alt="..." width="..." height="..." loading="lazy" decoding="async">
//   <figcaption>...</figcaption></figure>
// Returns { figures, strippedBody, errors }. strippedBody replaces each valid
// block with a bare <figure><figcaption>...</figcaption></figure> so the caller's
// existing HTML safety allowlist keeps validating caption content while any
// stray <img> or non-canonical source-image markup keeps failing closed.
const SOURCE_FIGURE_BLOCK_RE = /<figure\s+class="post-photo source-image"\s*>\s*<img\b([^>]*?)\/?>\s*<figcaption\s*>([\s\S]*?)<\/figcaption>\s*<\/figure>/g;

const fencedCodeBlocks = (value) => {
  const blocks = [];
  let fence = null;
  let current = [];
  for (const line of String(value || '').split('\n')) {
    if (!fence) {
      const opener = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if (opener) {
        fence = { char: opener[1][0], length: opener[1].length };
        current = [line];
      }
      continue;
    }
    current.push(line);
    const closing = line.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/);
    if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
      blocks.push(current.join('\n'));
      fence = null;
      current = [];
    }
  }
  if (fence) blocks.push(current.join('\n'));
  return blocks;
};

const sourceFigureHasAncestor = (source, figureIndex) => {
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack = [];
  const tokens = /<(\/?)\s*([a-z][\w:-]*)\b([^>]*)>|\{%-?\s*(end)?(capture|case|for|if|tablerow|unless|while)\b[^%]*-?%\}/gi;
  for (const match of String(source || '').slice(0, figureIndex).matchAll(tokens)) {
    if (match[2]) {
      const tag = match[2].toLowerCase();
      if (voidElements.has(tag) || /^\s*(?::\/\/|@)/.test(match[3])) continue;
      if (match[1]) {
        const index = stack.map((item) => item.key).lastIndexOf(`html:${tag}`);
        if (index >= 0) stack.splice(index, 1);
      } else {
        const outsideQuotes = match[3].replace(/"[^"]*"|'[^']*'/g, '');
        if (!outsideQuotes.trimEnd().endsWith('/')) stack.push({ key: `html:${tag}` });
      }
    } else {
      const key = `liquid:${match[5].toLowerCase()}`;
      if (match[4]) {
        const index = stack.map((item) => item.key).lastIndexOf(key);
        if (index >= 0) stack.splice(index, 1);
      } else stack.push({ key });
    }
  }
  return stack.length > 0;
};

export function extractSourceFigures(body) {
  const errors = [];
  const figures = [];
  const originalBody = String(body || '');
  const hiddenBlocks = [
    ...[...originalBody.matchAll(/<!--[\s\S]*?-->/g)].map((match) => match[0]),
    ...[...originalBody.matchAll(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/gi)].map((match) => match[0]),
    ...[...originalBody.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/gi)].map((match) => match[0]),
    ...[...originalBody.matchAll(/<(div|section|aside)\b[^>]*(?:\shidden(?:\s|=|>)|aria-hidden\s*=\s*["']?true|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden))[^>]*>[\s\S]*?<\/\1>/gi)].map((match) => match[0]),
    ...[...originalBody.matchAll(/<(div|section|aside)\b[^>]*style\s*=\s*[^\s>]*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^>]*>[\s\S]*?<\/\1>/gi)].map((match) => match[0]),
    ...fencedCodeBlocks(originalBody)
  ];
  if (hiddenBlocks.some((block) => /<img\b|<figure\b[^>]*\bsource-image\b/i.test(block))) {
    errors.push('Source-image markup may not be hidden in comments, Liquid comments, collapsed containers or fenced code');
  }
  const strippedBody = originalBody.replace(SOURCE_FIGURE_BLOCK_RE, (whole, rawAttributes, caption, offset) => {
    const attributes = new Map();
    let residue = rawAttributes;
    for (const match of rawAttributes.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g)) {
      const name = match[1].toLowerCase();
      if (attributes.has(name)) errors.push(`Source figure <img> repeats attribute ${name}`);
      attributes.set(name, match[2].slice(1, -1));
      residue = residue.replace(match[0], ' ');
    }
    if (residue.replace(/\//g, ' ').trim()) errors.push('Source figure <img> has malformed or unquoted attribute content');
    const names = [...attributes.keys()].sort();
    const requiredNames = ['alt', 'decoding', 'height', 'loading', 'src', 'width'];
    if (JSON.stringify(names) !== JSON.stringify(requiredNames)) {
      errors.push(`Source figure <img> must carry exactly src, alt, width, height, loading and decoding; found ${names.join(', ') || 'none'}`);
    }
    const src = attributes.get('src') || '';
    if (!SOURCE_FIGURE_SRC_RE.test(src)) errors.push(`Source figure src must be a local /img/source/<slug>/ raster path: ${src || '(missing)'}`);
    if (!nonempty(attributes.get('alt') || '', 5)) errors.push(`Source figure alt text is missing or too short: ${src || '(missing src)'}`);
    for (const side of ['width', 'height']) {
      if (!/^[1-9][0-9]{0,4}$/.test(attributes.get(side) || '')) errors.push(`Source figure ${side} must be a positive integer: ${src || '(missing src)'}`);
    }
    if (attributes.get('loading') !== 'lazy') errors.push(`Source figure must set loading="lazy": ${src || '(missing src)'}`);
    if (attributes.get('decoding') !== 'async') errors.push(`Source figure must set decoding="async": ${src || '(missing src)'}`);
    const captionText = normalizeText(caption.replace(/<[^>]+>/g, ' '));
    if (!captionText) errors.push(`Source figure caption is empty: ${src || '(missing src)'}`);
    if (sourceFigureHasAncestor(originalBody, offset)) errors.push(`Source figure must be a top-level visibly rendered block: ${src || '(missing src)'}`);
    figures.push({
      src,
      alt: normalizeText(attributes.get('alt') || ''),
      width: attributes.get('width') || '',
      height: attributes.get('height') || '',
      captionHtml: caption,
      captionText
    });
    return `<figure><figcaption>${caption}</figcaption></figure>`;
  });
  SOURCE_FIGURE_BLOCK_RE.lastIndex = 0;
  const residueBody = originalBody.replace(SOURCE_FIGURE_BLOCK_RE, '');
  if (/<figure\b[^>]*\bclass\s*=\s*(["'])[^"']*\bsource-image\b[^"']*\1[^>]*>/i.test(residueBody)) {
    errors.push('Malformed or non-canonical source-image figure markup remains in the body');
  }
  return { figures, strippedBody, errors };
}

// Checks that every sidecar image is embedded in exactly one source figure and
// that the caption carries the exact rights coordinates. Pure: figures come from
// extractSourceFigures, images from validateSourceImageManifest.
export function bindFiguresToImages(figures, images, fileFacts = {}) {
  const errors = [];
  const figureBySrc = new Map();
  for (const figure of figures) {
    if (figureBySrc.has(figure.src)) errors.push(`Source image appears in more than one figure: ${figure.src}`);
    figureBySrc.set(figure.src, figure);
  }
  if (figures.length !== images.length) {
    errors.push(`Expected exactly one source figure per source image, found ${figures.length} figures for ${images.length} images`);
  }
  for (const image of images) {
    const localPath = String(image?.local_path || '');
    if (!localPath) continue;
    const figure = figureBySrc.get(`/${localPath}`);
    if (!figure) {
      errors.push(`Source image is not embedded in a source figure: ${localPath}`);
      continue;
    }
    if (figure.alt !== normalizeText(String(image.alt || ''))) errors.push(`Source figure alt must match the sidecar alt: ${localPath}`);
    const observed = fileFacts[localPath];
    if (observed && (String(observed.width) !== figure.width || String(observed.height) !== figure.height)) {
      errors.push(`Source figure width/height must match the raster dimensions: ${localPath}`);
    }
    for (const [key, value] of [
      ['source_page_url', image.source_page_url],
      ['license_url', image.license_url],
      ['publisher_or_creator', image.publisher_or_creator],
      ['attribution_text', image.attribution_text]
    ]) {
      const needle = normalizeText(String(value || ''));
      if (!needle || !figure.captionText.includes(needle)) {
        errors.push(`Source figure caption must contain the exact ${key}: ${localPath}`);
      }
    }
  }
  return errors;
}
