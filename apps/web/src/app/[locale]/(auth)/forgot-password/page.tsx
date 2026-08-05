'use client';

import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

/**
 * Standalone route, kept for deep links, bookmarks and the "Forgot password?"
 * link on screens that are NOT the main login page (e.g. employer login).
 *
 * The main login page no longer navigates here — it swaps ForgotPasswordForm
 * in place of its sign-in panel. Both render the same component.
 */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
