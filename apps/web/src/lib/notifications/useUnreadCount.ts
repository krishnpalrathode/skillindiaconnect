'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { listNotifications } from '@/lib/api/notifications';

/**
 * The real unread-notification count, for the app header's bell.
 *
 * ── Why it asks for a page of one ────────────────────────────────────────────
 * There is no count endpoint, and this unit adds no API. The existing
 * notifications list already accepts `unread=true` and returns the offset
 * envelope, so `meta.total` IS the unread count — `pageSize: 1` makes that a
 * count query rather than a payload we throw away. A badge showing anything
 * other than the number the notifications page will show is worse than no
 * badge, so it must come from the same source, not a guess.
 *
 * ── Why it re-reads on navigation ────────────────────────────────────────────
 * The header is persistent, so without this the badge would freeze at its
 * mount-time value for the whole session — still showing "3" after the
 * candidate has just read all three. Route changes are the cheap, honest
 * refresh point: they are when the number can actually have changed, and the
 * one that matters most (leaving /notifications) is a navigation.
 *
 * Failure is silent BY DESIGN. A bell with no badge is the correct rendering of
 * "we do not know"; an error toast for a decoration would interrupt someone
 * mid-task over something they cannot act on.
 */
export function useUnreadCount(): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await listNotifications({ unread: true, pageSize: 1 });
      if (signal?.aborted) return;
      setCount(result.meta.total);
    } catch {
      // Leave the previous value alone rather than zeroing it: a transient
      // network blip should not silently tell someone their inbox is empty.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, pathname]);

  return { count, refresh: () => void load() };
}
