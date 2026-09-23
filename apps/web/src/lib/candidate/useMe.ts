'use client';

import { useEffect, useState } from 'react';
import { getCandidateProfile } from '@/lib/api/candidate';
import { candidateDisplayName } from '@/lib/format/display-name';

export interface MeSummary {
  /** Display name (or email fallback); '' until loaded. Drives the avatar initials. */
  name: string;
  /** Signed photo url, or null. */
  photoUrl: string | null;
  /** Availability toggle — shown as the green presence dot. */
  isAvailable: boolean;
  loaded: boolean;
}

const EMPTY: MeSummary = { name: '', photoUrl: null, isAvailable: false, loaded: false };

/**
 * The signed-in candidate's display name / photo / availability — for the app
 * header avatar. Fetched ONCE per mount (unlike the unread badge, these barely
 * change mid-session) from the SAME `/candidates/me` the profile page reads, so
 * the header face matches the profile face.
 *
 * Failure is silent by design (a guest on a public /jobs page, or a transient
 * blip): the avatar simply falls back to its initials placeholder rather than
 * interrupting with an error over a decoration.
 */
export function useMe(): MeSummary {
  const [me, setMe] = useState<MeSummary>(EMPTY);

  useEffect(() => {
    let alive = true;
    getCandidateProfile()
      .then((p) => {
        if (!alive) return;
        setMe({
          name: candidateDisplayName(p),
          photoUrl: p.photoUrl ?? null,
          isAvailable: !!p.isAvailable,
          loaded: true,
        });
      })
      .catch(() => {
        if (alive) setMe((m) => ({ ...m, loaded: true }));
      });
    return () => {
      alive = false;
    };
  }, []);

  return me;
}
