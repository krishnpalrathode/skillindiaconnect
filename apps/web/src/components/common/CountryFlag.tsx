import { cn } from '@/lib/utils';

/**
 * A country flag, as a real image.
 *
 * ── Why not the flag emoji ──────────────────────────────────────────────────
 * `flagEmoji()` builds a Unicode regional-indicator pair, which macOS, iOS and
 * Android render as a flag — and Windows does not, because it ships no flag
 * glyphs at all. Chrome on Windows falls back to drawing the two letters, so an
 * employer on a desktop saw "IN +91" where a phone showed "🇮🇳 +91". These SVGs
 * render identically everywhere, which is the whole point.
 *
 * ── Why <img> and not an inlined SVG component ──────────────────────────────
 * There are 265 of these. Importing them as React components pulls every flag
 * into the JS bundle whether or not it is shown; as images the browser fetches
 * only the handful actually painted, and `loading="lazy"` means a 200-row list
 * costs one request per visible row. They average 672 bytes and are served from
 * `/public/flags`, so there is no CDN and nothing external to block.
 *
 * `alt=""` on purpose: the flag always sits beside the country name or dial
 * code, so announcing it again would just make a screen reader say the country
 * twice.
 */
export interface CountryFlagProps {
  /** ISO 3166-1 alpha-2, any case. */
  iso: string;
  className?: string;
}

export function CountryFlag({ iso, className }: CountryFlagProps) {
  const code = iso.toLowerCase();
  return (
    <img
      src={`/flags/${code}.svg`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      width={21}
      height={14}
      /*
        The hairline matters: Japan's flag is a red disc on white and Nepal's is
        a white-bordered pennant — without a border they bleed into a white
        dropdown and read as a floating shape.
      */
      className={cn(
        'inline-block h-[14px] w-[21px] shrink-0 rounded-[2px] object-cover ring-1 ring-black/10',
        className,
      )}
    />
  );
}
