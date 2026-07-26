import Image from 'next/image';
import { Users, ShieldCheck, IndianRupee } from 'lucide-react';

/**
 * Sign-up hero panel (left side of the split layout; stacks above the form on
 * mobile). Purely presentational — no logic, no data fetching.
 *
 * Uses the single combined brand artwork /brand/signup-hero-image.png (the
 * official logo is baked into the image's top-left). Because the logo is part
 * of the bitmap, the image is rendered at its NATURAL ratio, full width and
 * never cropped — object-cover would slice the logo or the subject on narrow
 * panels.
 *
 * Seamless blend: the fade gradient lives INSIDE the image wrapper, anchored
 * to the image's own bottom edge and ending fully opaque in the same navy as
 * the panel background — so the photo melts into the navy band with no hard
 * line at any viewport size. The headline overlaps the faded zone; the stats
 * sit on the navy band below.
 *
 * Copy is intentionally hardcoded EN (same precedent as the previous auth-hero
 * quote): the task forbids translation-file changes in this pass.
 */

// Product facts only — no placement/employer counts. We have not launched, so
// any such number would be invented, and an invented metric on a public page is
// a verification risk as well as a lie.
const STATS = [
  { Icon: Users, value: 'Verified', label: 'Employers' },
  { Icon: ShieldCheck, value: 'India &', label: 'Gulf Jobs' },
  { Icon: IndianRupee, value: 'Free for', label: 'Candidates' },
] as const;

export function SignupHero() {
  return (
    <div className="relative grid overflow-hidden bg-[#08234f] text-white lg:min-h-svh lg:w-1/2">
      {/* Combined artwork — natural ratio, full width, logo always intact.
          The fade is anchored to the image bottom so the photo dissolves into
          the panel navy with no flat seam. */}
      <div className="relative col-start-1 row-start-1 w-full self-start">
        <Image
          src="/brand/signup-hero-image.png"
          alt="SkillIndia Connect — Elevating Skills, Connecting Futures"
          width={1402}
          height={1122}
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="block h-auto w-full"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-[#08234f] from-8% via-[#08234f]/60 via-40% to-transparent"
        />
      </div>

      {/* Content — bottom-anchored: the headline rises into the faded photo
          zone, the stats rest on the navy band. pt keeps the column clear of
          the baked-in logo when space is tight. */}
      <div className="relative z-10 col-start-1 row-start-1 flex flex-col justify-end gap-7 p-6 pt-44 sm:p-10 sm:pt-52">
        <div className="max-w-xl">
          <p className="text-3xl font-bold leading-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.15] [text-shadow:0_2px_14px_rgba(4,18,45,0.65)]">
            Find Your Next
            <br />
            Opportunity
            <br />
            <span className="text-[#F57C20]">Abroad</span> or Locally
          </p>

          <div className="mt-5 h-1 w-14 rounded-full bg-[#F57C20]" aria-hidden="true" />

          <p className="mt-5 max-w-md text-base text-white/90 sm:text-lg [text-shadow:0_1px_8px_rgba(4,18,45,0.6)]">
            Connecting skilled workers with trusted employers across India and the Gulf.
          </p>
        </div>

        {/* Bottom statistics */}
        <ul className="flex flex-wrap items-center gap-x-8 gap-y-4 pb-1">
          {STATS.map(({ Icon, value, label }) => (
            <li key={label} className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-white/50 bg-[#071c40]/30">
                <Icon className="size-5 text-white" aria-hidden="true" />
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-bold sm:text-base">{value}</span>
                <span className="block text-xs text-white/80 sm:text-sm">{label}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
