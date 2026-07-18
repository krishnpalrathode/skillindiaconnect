'use client';

/**
 * Razorpay Checkout.js loader + open() (S5-F1).
 *
 * The script loads ONLY when a real publishable key is present. Under MSW /
 * dev there is no real gateway, so the CheckoutLauncher takes its own mock path
 * (a "Simulate payment" affordance) and never calls into here — guarding the
 * script load keeps a mock run from reaching out to checkout.razorpay.com.
 *
 * CRITICAL (webhook-truth): the success handler here does NOT mark anything
 * paid. It only signals "the gateway flow returned" so the UI advances to the
 * PaymentConfirming polling state. Activation is decided by the PAID poll.
 */

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayOptions {
  key: string;
  order_id: string;
  handler: () => void;
  modal?: { ondismiss?: () => void };
  [key: string]: unknown;
}

interface RazorpayInstance {
  open: () => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let scriptPromise: Promise<boolean> | null = null;

/**
 * Lazy-load Checkout.js exactly once. Resolves true when `window.Razorpay` is
 * available, false if the script failed to load (offline / blocked) — the
 * caller then surfaces the retry state rather than hanging.
 */
export function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      scriptPromise = null; // allow a later retry to re-attempt the load
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}

export interface OpenRazorpayArgs {
  keyId: string;
  gatewayOrderId: string;
  /** Gateway flow returned successfully — advance to CONFIRMING (never SUCCESS). */
  onFlowComplete: () => void;
  /** User dismissed the modal or the flow failed — back to the retry state. */
  onDismiss: () => void;
}

/**
 * Load Checkout.js and open the modal. Returns false when the script could not
 * load (the caller shows retry). The handler advances the UI to CONFIRMING;
 * the poll — not this callback — is what confirms payment.
 */
export async function openRazorpayCheckout(args: OpenRazorpayArgs): Promise<boolean> {
  const ok = await loadRazorpayScript();
  if (!ok || !window.Razorpay) return false;

  const rzp = new window.Razorpay({
    key: args.keyId,
    order_id: args.gatewayOrderId,
    handler: () => args.onFlowComplete(),
    modal: { ondismiss: () => args.onDismiss() },
  });
  rzp.open();
  return true;
}
