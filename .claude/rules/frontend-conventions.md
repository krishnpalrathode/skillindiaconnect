# Frontend conventions (apps/web)

## Logical properties (ENFORCED in code review)

Use logical CSS utilities — NOT physical left/right equivalents:

| Physical (BANNED in kit)   | Logical (USE THIS)        |
| -------------------------- | ------------------------- |
| `pl-*` / `pr-*`            | `ps-*` / `pe-*`           |
| `ml-*` / `mr-*`            | `ms-*` / `me-*`           |
| `left-*` / `right-*`       | `start-*` / `end-*`       |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `border-l` / `border-r`    | `border-s` / `border-e`   |

Tailwind v3 supports all logical utilities. This makes RTL work without per-component overrides — just set `dir="rtl"` on `<html>` and everything flips.

## No API/Prisma/Redis imports

`apps/web` is HTTP-only. See module-boundaries.md Rule 1.

## MSW dev guard

`NEXT_PUBLIC_API_MOCKING=enabled` activates MSW. Never bundle the service worker in production. The mock worker must NOT run in a production bundle.

## Tailwind v3

Use `tailwind.config.ts` `theme.extend` for tokens. Do NOT use v4 CSS-first `@theme` directive.
