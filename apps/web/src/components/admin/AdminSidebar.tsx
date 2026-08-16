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
      {/* Admin-context brand mark. The shell is now the employer shell's light
          surface, so THIS is what tells you which console you are standing in —
          the shield and the console name, not the chrome colour. */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-neutral-100 px-4">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0F3D91] to-[#2E67B1] text-white"
          aria-hidden="true"
        >
          <ShieldCheck className="size-5" />
        </span>
        <Link
          href={`/${locale}/admin/dashboard`}
          onClick={onNavClick}
          className="rounded text-sm font-bold tracking-tight text-neutral-900 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {t('brand')}
        </Link>
      </div>

      <nav
        aria-label={t('nav.ariaLabel')}
        className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-5"
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
                'group flex min-h-[44px] items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
                active
                  ? // Same gradient pill as the employer nav. `font-semibold` is
                    // kept from the old dark styling ON PURPOSE: it carries the
                    // active state for anyone who cannot distinguish the colour,
                    // which the gradient alone would not.
                    'bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] font-semibold text-white shadow-lg shadow-[#0F3D91]/25'
                  : 'text-neutral-600 hover:bg-white hover:text-[#0F3D91] hover:shadow-sm',
              )}
            >
              <Icon
                className={cn(
                  'size-5 shrink-0 transition-transform duration-200',
                  !active && 'group-hover:scale-110',
                )}
                aria-hidden="true"
              />
              <span>{t(`nav.${item.key}`)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
