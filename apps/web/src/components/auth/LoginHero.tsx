import Image from 'next/image';
import { Users, ShieldCheck, IndianRupee } from 'lucide-react';

/**
 * Login hero panel (left side of the split layout; stacks above the form on
 * mobile). Purely presentational — no logic, no data fetching.
 *
 * Uses the single combined artwork /brand/login-hero-final.png, which already
 * contains the official logo (top-left), the blue overlay, and the bottom
 * decorative wave — so this component renders NO separate logo and NO extra
 * decoration.
 *
 * Composition: the artwork renders at its NATURAL ratio, full width and never
 * cropped — object-cover on a narrow panel would amputate either the baked-in
 * logo (left) or the worker (right). The artwork's bottom edge fades to a
 * uniform #011D45 navy (sampled from the file), so the panel uses exactly that
 * color and the image dissolves into the text/stats band with no visible seam.
 *
 * Copy is intentionally hardcoded EN (same precedent as the signup hero):
 * translation files are frozen for this UI pass.
 */

const STATS = [
  { Icon: Users, value: '10,000+', label: 'Workers Placed' },
  { Icon: ShieldCheck, value: 'Gulf', label: 'Verified Jobs' },
  { Icon: IndianRupee, value: 'Free for', label: 'Candidates' },
] as const;

export function LoginHero() {
  return (
    <div className="relative grid overflow-hidden bg-[#011D45] text-white lg:min-h-svh lg:w-1/2">
      {/* Complete artwork — natural ratio, full width; logo, overlay, and wave
          are baked in, and its bottom edge self-fades into the panel navy */}
      <Image
        src="/brand/login-hero-final.png"
        alt="SkillIndia Connect — Elevating Skills, Connecting Futures"
        width={1448}
        height={1086}
        priority
        sizes="(min-width: 1024px) 50vw, 100vw"
        className="col-start-1 row-start-1 h-auto w-full self-start"
      />

      {/* Content — bottom-anchored over the artwork's dark zone and wave band.
          pt keeps the column clear of the baked-in logo when space is tight. */}
      <div className="relative z-10 col-start-1 row-start-1 flex flex-col justify-end gap-7 p-6 pt-44 sm:p-10 sm:pt-52">
        <div className="max-w-xl">
          <p className="text-4xl font-bold leading-tight sm:text-5xl [text-shadow:0_2px_14px_rgba(1,20,48,0.7)]">
            Welcome <span className="text-[#F57C20]">Back</span>
          </p>

          <div className="mt-6 h-1 w-14 rounded-full bg-[#F57C20]" aria-hidden="true" />

          <p className="mt-6 max-w-md text-lg text-white/90 sm:text-xl [text-shadow:0_1px_8px_rgba(1,20,48,0.7)]">
            Continue your journey towards better opportunities across{' '}
            <span className="font-semibold text-[#F57C20]">India</span> and the{' '}
            <span className="font-semibold text-[#F57C20]">Gulf</span>.
          </p>
        </div>

        {/* Bottom statistics — orange outline icons per the approved design */}
        <ul className="flex flex-wrap items-center gap-x-8 gap-y-4 pb-2">
          {STATS.map(({ Icon, value, label }) => (
            <li key={label} className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-[#F57C20]/90 bg-[#011D45]/40">
                <Icon className="size-5 text-[#F57C20]" aria-hidden="true" />
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
