'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface AvatarProps {
  /** Full name (or email) — the initials fallback is derived from this. */
  name: string;
  /** Short-expiry signed R2 url, or null/undefined when none is uploaded. */
  photoUrl?: string | null;
  /** Size + text-size utilities, e.g. "size-20 text-xl". */
  className?: string;
}

function initialsFor(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/**
 * Profile photo with an initials fallback — one implementation so every screen
 * shows the SAME face. The dashboard used to derive initials locally and never
 * looked at `photoUrl`, so a candidate who had uploaded a photo still saw their
 * initials everywhere except the profile page.
 *
 * `photoUrl` is a SHORT-EXPIRY signed url. If it has expired (or R2 is
 * unreachable) the image 403s, which would otherwise render as a broken-image
 * glyph — so a load error falls back to the initials instead.
 */
export function Avatar({ name, photoUrl, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  // A newly-confirmed upload replaces the url; clear the previous failure so
  // the fresh (unexpired) url gets its own chance to load.
  useEffect(() => setFailed(false), [photoUrl]);

  const showPhoto = Boolean(photoUrl) && !failed;

  if (showPhoto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed R2 url, not a static asset; next/image cannot optimize a short-lived presigned url.
      <img
        src={photoUrl!}
        alt={name}
        onError={() => setFailed(true)}
        className={cn('rounded-full bg-neutral-100 object-cover', className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex select-none items-center justify-center rounded-full bg-gradient-to-br from-[#0F3D91] to-[#2E67B1] font-bold text-white',
        className,
      )}
      aria-hidden="true"
    >
      {initialsFor(name)}
    </div>
  );
}
