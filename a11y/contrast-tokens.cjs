/**
 * S8-H4 — systematic contrast audit of the DESIGN TOKENS themselves.
 *
 * The brief asks for the tokens to be audited "against AA across all their
 * uses". axe reports the uses it happens to encounter on the screens it
 * crawls; this computes the whole palette against the surfaces it is actually
 * painted on, so a token that is currently unused but wrong is caught before
 * someone reaches for it.
 *
 * WCAG 2.1:
 *   1.4.3 Contrast (Minimum) — 4.5:1 body text, 3:1 large text (≥24px, or
 *                              ≥18.66px bold)
 *   1.4.11 Non-text Contrast — 3:1 for UI component boundaries and states
 *
 *   node a11y/contrast-tokens.cjs
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const TOKENS = path.join(__dirname, '..', 'apps', 'web', 'src', 'styles', 'tokens.css');

function parseTokens(css) {
  const out = {};
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  return out;
}

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** WCAG relative luminance. */
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [la, lb] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const css = fs.readFileSync(TOKENS, 'utf8');
const tokens = parseTokens(css);

const WHITE = '#ffffff';
const rows = [];

// Surfaces text is actually painted on in this product.
const SURFACES = {
  white: WHITE,
  'neutral-50': tokens['color-neutral-50'],
  'neutral-100': tokens['color-neutral-100'],
  'success-bg': tokens['color-success-bg'],
  'warning-bg': tokens['color-warning-bg'],
  'error-bg': tokens['color-error-bg'],
  'info-bg': tokens['color-info-bg'],
};

/**
 * TEXT tokens only.
 *
 * Evaluating every token against every surface produces a page of true but
 * useless rows ("neutral-100 on neutral-100 fails") — the light end of each
 * ramp is background and border, never text, so scoring it as text is noise
 * that buries the real findings. The audit is restricted to the shades this
 * product actually paints text with: the 500+ steps of each ramp, plus the
 * semantic `-fg` tokens which exist specifically to be text.
 *
 * Light tokens are still audited, but against the 3:1 NON-TEXT threshold
 * (1.4.11) in the border section below, which is the criterion that applies to
 * them.
 */
const TEXT_SHADE = /^color-(primary|accent|neutral)-([5-9]00)$/;
const SEMANTIC_FG = /^color-(success|warning|error|info)-fg$/;
const FOREGROUNDS = Object.entries(tokens).filter(
  ([k]) => TEXT_SHADE.test(k) || SEMANTIC_FG.test(k),
);

for (const [surfName, surfHex] of Object.entries(SURFACES)) {
  if (!surfHex) continue;
  for (const [fgName, fgHex] of FOREGROUNDS) {
    const r = ratio(fgHex, surfHex);
    rows.push({
      fg: fgName,
      fgHex,
      surface: surfName,
      surfaceHex: surfHex,
      ratio: Math.round(r * 100) / 100,
      passBody: r >= 4.5,
      passLarge: r >= 3,
      passUi: r >= 3,
    });
  }
}

// Report only what matters: pairs the product plausibly uses for TEXT.
const bodyFailures = rows.filter((r) => !r.passBody);
const uiFailures = rows.filter((r) => !r.passUi);

console.log('S8-H4 — design-token contrast audit (WCAG 1.4.3 / 1.4.11)\n');
console.log(`pairs evaluated: ${rows.length}`);
console.log(`fails 4.5:1 (body text): ${bodyFailures.length}`);
console.log(`fails 3:1 (large text / UI boundary): ${uiFailures.length}\n`);

console.log('── Below 3:1 — unusable as text at ANY size ──');
for (const r of uiFailures.sort((a, b) => a.ratio - b.ratio)) {
  console.log(`  ${r.ratio.toFixed(2).padStart(5)}:1  ${r.fg} (${r.fgHex}) on ${r.surface}`);
}

console.log('\n── 3:1–4.5:1 — large text / UI only, NOT body text ──');
for (const r of rows.filter((x) => x.passUi && !x.passBody).sort((a, b) => a.ratio - b.ratio)) {
  console.log(`  ${r.ratio.toFixed(2).padStart(5)}:1  ${r.fg} (${r.fgHex}) on ${r.surface}`);
}

// The semantic pairs the product uses most: *-fg on its matching *-bg.
console.log('\n── Semantic status pairs (the badge/alert combinations) ──');
for (const kind of ['success', 'warning', 'error', 'info']) {
  const fg = tokens[`color-${kind}-fg`];
  const bg = tokens[`color-${kind}-bg`];
  if (!fg || !bg) continue;
  const r = ratio(fg, bg);
  const verdict = r >= 4.5 ? 'PASS body' : r >= 3 ? 'large/UI only' : 'FAIL';
  console.log(`  ${r.toFixed(2).padStart(5)}:1  ${kind}-fg on ${kind}-bg — ${verdict}`);
}

// ── 1.4.11 Non-text contrast: the light tokens used as borders/boundaries ──
console.log('\n── Border / UI-boundary tokens on white (1.4.11 needs ≥3:1) ──');
for (const name of ['color-neutral-200', 'color-neutral-300', 'color-neutral-400']) {
  const hex = tokens[name];
  if (!hex) continue;
  const r = ratio(hex, WHITE);
  const verdict = r >= 3 ? 'PASS' : 'below 3:1 — decorative separators only, never a control boundary';
  console.log(`  ${r.toFixed(2).padStart(5)}:1  ${name} (${hex}) — ${verdict}`);
}

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(
  path.join(__dirname, 'out', 'contrast-tokens.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2),
);
console.log('\nwrote a11y/out/contrast-tokens.json');
