'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams, usePathname } from 'next/navigation';
import {
  Briefcase,
  Building2,
  FileText,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAdmin } from '@/lib/admin/admin-context';
import { ADMIN_NAV } from '@/lib/admin/nav-permissions';
import { cn } from '@/lib/utils';

/** Icon-name → component. Keeps nav-permissions.ts data-only (no JSX in the map). */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Building2,
  Users,
  Briefcase,
  FileText,
  ScrollText,
  ShieldCheck,
  Settings,
};

/**
 * The permission-driven nav.
 *
 * Note what is absent: any mention of a ROLE. The list is ADMIN_NAV (data),
 * filtered by `has()` (the server's answer). A MODERATOR sees fewer items than an
 * ADMIN not because of a `role === 'MODERATOR'` branch, but because the server
 * says they hold fewer keys — and if a Super Admin grants them one in Screen 27,
 * the item appears on their next load with no code change.
 *
 * That is the entire design. A single hardcoded role check here would break it,
 * and would break it SILENTLY: the RBAC editor would keep accepting changes that
 * the nav ignored.
 */
export function AdminSidebar({ onNavClick }: { onNavClick?: () => void }) {
  const t = useTranslations('admin');
  const pathname = usePathname();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';
  const { has } = useAdmin();

  const items = ADMIN_NAV.filter((item) => item.permission === null || has(item.permission));

  return (
    <div className="flex h-full flex-col">
      {/* Admin-context brand mark — deliberately distinct from the employer shell:
          you should never be unsure which console you are standing in. */}
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-neutral-800 px-4">
        <ShieldCheck className="size-5 text-primary-300" aria-hidden="true" />
        <Link
          href={`/${locale}/admin/dashboard`}
          onClick={onNavClick}
          className="rounded text-sm font-bold tracking-tight text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {t('brand')}
        </Link>
      </div>

      <nav
        aria-label={t('nav.ariaLabel')}
        className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-4"
      >
        {items.map((item) => {
          const href = `/${locale}/admin/${item.key}`;
          const Icon = ICONS[item.icon] ?? LayoutDashboard;
          const active = pathname.startsWith(href);

          return (
            <Link
              key={item.key}
              href={href}
              onClick={onNavClick}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                active
                  ? // Active state is not colour alone — the start-border and the
                    // bolder weight carry it for anyone who cannot distinguish it.
                    'border-s-2 border-primary-400 bg-neutral-800 font-semibold text-white'
                  : 'border-s-2 border-transparent text-neutral-300 hover:bg-neutral-800 hover:text-white',
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              <span>{t(`nav.${item.key}`)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
