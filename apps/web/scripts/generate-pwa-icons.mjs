/**
 * Generates the PWA icon set from the existing brand art.
 *
 * Run:  pnpm dlx sharp-cli --version >/dev/null   # sanity: network reachable
 *       node apps/web/scripts/generate-pwa-icons.mjs
 *
 * `sharp` is deliberately NOT a repo dependency — this script runs by hand when
 * the brand art changes (roughly never), and a native image library in the
 * Docker build for a once-a-year task is a poor trade. Install it in a scratch
 * directory and point NODE_PATH at it:
 *
 *   mkdir /tmp/icongen && cd /tmp/icongen && npm init -y && npm i sharp
 *   NODE_PATH=/tmp/icongen/node_modules node apps/web/scripts/generate-pwa-icons.mjs
 *
 * The OUTPUT is committed, so a normal build and a normal checkout never need
 * sharp at all.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BRAND = path.resolve(here, '../public/brand');
const OUT = path.resolve(here, '../public/icons');

/**
 * Two sizes, two purposes — not the legacy eight-size ladder.
 *
 * Chrome's install criteria need 192 and 512, and Android derives every other
 * density from those. The 48/72/96/128/144/384 set is pre-adaptive-icon advice;
 * shipping it now just puts six more files in the repo for the platform to
 * ignore.
 */
const SIZES = [192, 512];

/**
 * Fraction of the canvas the mark occupies on a MASKABLE icon.
 *
 * The maskable spec guarantees only a centred circle of 80% diameter survives —
 * everything outside it may be cropped by whichever mask the launcher applies.
 * The brand mark is a disc with a star breaking out of its top-right, so the
 * star is the part at risk. 0.72 keeps that star inside the guaranteed circle;
 * verified by rendering under a circle mask, not by arithmetic alone.
 */
const MASKABLE_SCALE = 0.72;

/**
 * White, from `--background: 255 255 255` in src/styles/tokens.css.
 *
 * NOT the brand navy: the mark's disc is #3b4554, so navy-on-navy would read as
 * a dark smudge. The existing SIC_favicon_2.png already sets the mark on white —
 * this follows that treatment rather than inventing a new one.
 */
const MASKABLE_BG = { r: 255, g: 255, b: 255, alpha: 1 };

await mkdir(OUT, { recursive: true });

for (const size of SIZES) {
  // `any` — transparent, mark fills the tile. The launcher draws it as-is.
  await sharp(path.join(BRAND, 'SIC_favicon.png'))
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, `icon-${size}.png`));

  // `maskable` — mark shrunk into the safe zone, opaque ground to the edges.
  const inner = Math.round(size * MASKABLE_SCALE);
  const mark = await sharp(path.join(BRAND, 'SIC_favicon.png'))
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: MASKABLE_BG },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .flatten({ background: MASKABLE_BG }) // maskable must have NO transparency
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, `icon-maskable-${size}.png`));

  console.log(`icon-${size}.png  icon-maskable-${size}.png`);
}
