'use client';

/**
 * Moved to components/ui/dialog-shell.tsx so non-admin screens (e.g. the logout
 * confirmation) can use the same focus-trapped base. Re-exported under the old
 * name so the 12 admin dialogs importing it keep working unchanged.
 */
export { DialogShell as ActionDialogShell } from '@/components/ui/dialog-shell';
