'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

/**
 * The entry's `meta` JSON, pretty-printed.
 *
 * Rendered EXACTLY AS STORED — S2-B2's write-time denylist already stripped
 * everything sensitive (passport numbers, phones, emails, tokens, OTPs,
 * document keys/URLs), so what arrives here is safe by construction. Two
 * mistakes this component refuses to make:
 *  - a client-side "second redaction" pass, which would silently drift from the
 *    server's guarantee and hide fields an investigator needs, and
 *  - framing this as "raw data", which would mislead the investigator into
 *    believing they're reading the unredacted record. It isn't raw; the label
 *    says what it is.
 */
export function LogMetaViewer({ meta }: { meta: unknown }) {
  const t = useTranslations('admin.logs');

  const isEmpty =
    meta == null || (typeof meta === 'object' && Object.keys(meta as object).length === 0);

  if (isEmpty) {
    return <p className="text-xs text-neutral-600">{t('metaEmpty')}</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-neutral-600">{t('metaLabel')}</p>
      <pre className="max-h-64 overflow-auto rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-800">
        {JSON.stringify(meta, null, 2)}
      </pre>
    </div>
  );
}
