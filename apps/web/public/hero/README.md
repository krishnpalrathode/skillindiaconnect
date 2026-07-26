# Hero carousel images

Four photographs used by the landing-page hero carousel
(`src/components/landing/HeroCarousel.tsx`).

All four are licensed under the [Pexels License](https://www.pexels.com/license/),
which permits free commercial use and does not require attribution. Provenance
is logged below anyway, so the source of every asset is traceable.

Each file is pre-cropped to **4:3** (900×675) to match the carousel's fixed
`aspect-[4/3]` frame — so there is no client-side resize and no layout shift.

## Files and attribution

| File                      | Subject                                       | Category chip          | Photographer                    | Source                                       |
| ------------------------- | --------------------------------------------- | ---------------------- | ------------------------------- | -------------------------------------------- |
| `worker-construction.jpg` | Worker in hi-vis vest holding a hard hat, site | Construction & Civil   | Ihsan Adityawarman              | https://www.pexels.com/photo/28196526/       |
| `worker-electrical.jpg`   | Technician working on a circuit-breaker panel  | Electrical & Plumbing  | Aizat Ramlan                    | https://www.pexels.com/photo/9679179/        |
| `worker-driving.jpg`      | Truck driver in cab, safety vest               | Drivers & Logistics    | World Sikh Organization of Canada | https://www.pexels.com/photo/14797990/     |
| `worker-hospitality.jpg`  | Waiter serving, Bengaluru restaurant           | Hospitality & Catering | Anil Sharma                     | https://www.pexels.com/photo/30660322/       |

## Replacing an image

`HeroCarousel.tsx` references these filenames literally. Keep the names
identical and no code change is needed. If you switch a file to `.png`, update
the matching `src` in that component.

Requirements for any replacement:

- **Subject:** Indian / South Asian workers, confident and dignified, in real
  working environments — not staged corporate stock.
- **Licence:** must be genuinely licensed for commercial use. **Download and
  commit the file** — never hotlink a stock site. Add a row above.
- **Aspect ratio:** 4:3, pre-cropped. Off-ratio images are cropped by
  `object-cover`, not stretched, so faces can get cut — crop deliberately.
- **Total source weight:** keep all four under ~350 KB combined (currently
  ~305 KB). `next/image` re-encodes to WebP/AVIF per breakpoint, so the bytes
  actually sent to a phone are far smaller.
