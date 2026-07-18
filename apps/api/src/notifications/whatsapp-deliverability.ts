/**
 * THE single definition of "will WhatsApp actually be attempted for this user".
 *
 * It exists because two places need the SAME answer and must never drift:
 *  - the WORKER's processor, which decides whether to send or downgrade, and
 *  - the API (S7-B2 resume send), which must tell the candidate UP FRONT which
 *    channel their resume is really going to. A response saying "WHATSAPP"
 *    while the worker quietly downgrades to email is exactly the dishonesty
 *    the S2-B3 downgrade rules exist to prevent.
 *
 * Keep this predicate pure — callers supply the profile row they already read.
 */
export interface WhatsappDeliverabilityInput {
  phone: string | null;
  whatsappCapable: boolean;
  /** Candidate opt-out of WhatsApp notifications (null/undefined = opted in). */
  waNotifications: boolean | null;
}

export function isWhatsappDeliverable<T extends WhatsappDeliverabilityInput>(
  profile: T | null | undefined,
): profile is T & { phone: string } {
  if (!profile) return false;
  return Boolean(profile.phone) && profile.whatsappCapable && profile.waNotifications !== false;
}
