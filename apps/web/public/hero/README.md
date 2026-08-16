# Hero carousel images

Photographs used by the landing-page hero carousel
(`src/components/landing/HeroCarousel.tsx`).

All are licensed under the [Pexels License](https://www.pexels.com/license/),
which permits free commercial use and does not require attribution. Provenance
is logged below anyway, so the source of every asset is traceable.

**Seven are in the rotation** — the group shot, then electrical, welding,
technician, healthcare, driving, construction. `worker-hospitality.jpg` is
retained but no longer rotated (see the note in `HeroCarousel.tsx`).

`worker-team.jpg` is the one image here that is NOT from Pexels: it is
commissioned/generated brand artwork supplied by the product owner, downscaled
to 900x675 from a 1448x1086 original (already 4:3, so no crop was applied).

Each file is pre-cropped to **4:3** (900×675) to match the carousel's fixed
`aspect-[4/3]` frame — so there is no client-side resize and no layout shift.

## Files and attribution

| File                      | Subject                                       | Category chip          | Photographer                    | Source                                       |
| ------------------------- | --------------------------------------------- | ---------------------- | ------------------------------- | -------------------------------------------- |
| `worker-construction.jpg` | Worker in hi-vis vest holding a hard hat, site | Construction & Civil   | Ihsan Adityawarman              | https://www.pexels.com/photo/28196526/       |
| `worker-electrical.jpg`   | Technician working on a circuit-breaker panel  | Electrical & Plumbing  | Aizat Ramlan                    | https://www.pexels.com/photo/9679179/        |
| `worker-driving.jpg`      | Truck driver in cab, safety vest               | Drivers & Logistics    | World Sikh Organization of Canada | https://www.pexels.com/photo/14797990/     |
| `worker-hospitality.jpg`  | Waiter serving, Bengaluru restaurant           | Hospitality & Catering | Anil Sharma                     | https://www.pexels.com/photo/30660322/       |
| `worker-welding.jpg`      | Welder in full mask, gloves and leather apron  | Welding & Fabrication  | Felipe Silva                    | https://www.pexels.com/photo/26864250/       |
| `worker-technician.jpg`   | Workshop mechanic with a strut assembly        | Technicians & Mechanics | Nishant Aneja                  | https://www.pexels.com/photo/4305364/        |
| `worker-healthcare.jpg`   | Two nurses conferring in a hospital corridor   | Healthcare & Nursing   | Adarsh Mp                       | https://www.pexels.com/photo/31499386/       |
| `worker-team.jpg`         | Five trades together on site (lead slide)      | Every Skilled Trade    | supplied by the product owner   | not Pexels — see the note above              |

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
- **Total source weight:** keep the whole folder under ~700 KB combined
  (currently ~600 KB). `next/image` re-encodes to WebP/AVIF per breakpoint, so
  the bytes actually sent to a phone are far smaller. Only the FIRST slide is
  `priority`; the rest lazy-load, so slides 2-6 cost nothing until shown.

## Known weak spot

`worker-healthcare.jpg` is the one image whose subjects sit small in the frame —
its source is a tall portrait and the 4:3 window leaves a lot of empty corridor
above them. It is authentic (a real Indian hospital, real nurses at work) and
correctly licensed, so it ships; but it is the first file to replace if a
tighter healthcare shot turns up. Everything else in the rotation fills the
frame with the worker.
