import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Locale-aware Link, redirect, usePathname, useRouter.
// Import from here (not next/navigation) to get locale-prefixed navigation.
export const { Link, redirect, usePathname, useRouter } = createNavigation(routing);
