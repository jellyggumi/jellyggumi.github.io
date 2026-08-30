---
name: editorial-image-kit
description: Generate and validate JellyGGumi's non-documentary AI editorial still lifes with god-tibo-imagen whenever an approved guide package needs a 1672×941 hero and 700×394 thumbnail, zero EXIF/IPTC/XMP, visible method disclosure and provenance. Never use for family photos, people, faces, brands, logos or readable text.
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# JellyGGumi Editorial Image Kit

Use only after the journal director approves an image concept. Output stays under `_workspace/current/draft/img/editorial/` until human publication approval.

## Preconditions

Read `CLAUDE.md`, `PERSONA.md`, the current manifest and evidence pack. Refuse if the image is intended to document a real visit, person, product result or family event.

## Prompt contract

The prompt must specify:

- editorial still life or clearly illustrative scene;
- JellyGGumi palette: warm paper, deep ink, muted rose, celadon and restrained brass;
- one culturally relevant object arrangement, not a collage of stereotypes;
- editorial negative space and a landscape composition safe for later square or portrait crops;
- no people, faces, hands, bodies, brands, logos, packaging marks or readable text;
- no official seal, implied endorsement or documentary/photojournalistic claim;
- no sensationalism.

Do not prompt for a named living artist's exact style.

## Generate with god-tibo-imagen

Locate the CLI without exposing credentials:

```bash
GTI_BIN="$(command -v gti || true)"
if [ -z "$GTI_BIN" ] && [ -x "${HOME}/.aside/runtime/node/bin/gti" ]; then
  GTI_BIN="${HOME}/.aside/runtime/node/bin/gti"
fi
[ -n "$GTI_BIN" ] || { echo "gti not found" >&2; exit 1; }
"$GTI_BIN" --help
```

Run a dry check before the paid or backend generation path when supported. Record the warning if the CLI reports an unsupported backend; do not hide it. Generate one approved candidate rather than a large batch.

## Crop and re-encode

1. Preserve the generated source in a temporary, non-publishable workspace path.
2. Crop from the center-of-interest to exact 16:9 outputs:
   - `<slug>.jpg`: 1672×941
   - `<slug>.thumb.jpg`: 700×394
3. Re-encode through a clean browser canvas or another method proven to strip metadata while preserving exact dimensions.
4. Do not use `page.screenshot({clip})` for the final asset when device-pixel-ratio changes dimensions.
5. Never enlarge a source too small to support the hero.

## Validate

Run `node tools/validate-editorial-package.mjs --stage draft` after the package exists. The JPEG parser must confirm dimensions and absence of APP1 EXIF/XMP and APP13 IPTC/Photoshop metadata.

Visually inspect the full image and thumbnail for:

- accidental faces or human forms;
- legible pseudo-text;
- brand-like marks or official emblems;
- culturally misleading or stereotyped props;
- lost subject after thumbnail crop;
- text or disclosure baked into pixels.

## Provenance

Write `draft/image-provenance.json` with tool/version, model/provider when known, prompt, prompt SHA-256, generation timestamp, source path, re-encode method, both output dimensions and SHA-256 values, disclosure text, and the required attestations.

The visible page disclosure is rendered from `header_ai: true`. Recommended label: `AI-generated editorial still life · method` linking to the editorial policy.

## Failure modes

- Person, face, brand, logo or readable text appears: reject and regenerate.
- Wrong dimensions or metadata remains: re-encode and revalidate.
- Source too small: regenerate at higher resolution.
- The image could be mistaken for evidence: redesign as an obvious still life.
- Tool unavailable or generation fails: block the article package; do not substitute a generic logo or unrelated stock image.
