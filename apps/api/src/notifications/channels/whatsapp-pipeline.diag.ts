/**
 * ═══ TEMPORARY DIAGNOSTICS — DELETE THIS FILE AND ITS CALL SITES ═════════════
 *
 * Stage-by-stage trace of the WhatsApp DOCUMENT pipeline (resume_document), so
 * one real send says exactly which stage fails instead of only that it did.
 *
 * ⚠️ SCOPED TO THE DOCUMENT TEMPLATE ONLY. Every call site is gated on the
 * `wa.resume_doc` key, so OTP sends and `job_selected` are completely untouched
 * — they share the same `post()` method, and instrumenting that indiscriminately
 * would add noise to the login path that is currently working.
 *
 * LOGS ONLY. Nothing here returns a value anyone reads, no control flow depends
 * on it, and no business logic changed. Removing it is deleting this file plus
 * the `pipelineDiag`/`diag*` calls, all of which carry TEMP DIAG markers.
 *
 * NEVER LOGGED: the access token (it lives in request headers, which are never
 * touched here), document BYTES (only their length), and the recipient — the
 * existing `logSafe` already reduces that to a hash. Meta's `message` and
 * `error_data.details` go through redactText because they routinely echo the
 * recipient's number.
 *
 * ⚠️ SINGLE-SEND ASSUMPTION. The stage tracker is module-level state, so a
 * summary is only meaningful when ONE document send is in flight at a time.
 * That is exactly the manual smoke-test case this exists for; under concurrent
 * sends the per-stage lines stay accurate but the summary block may interleave.
 */
import { Logger } from '@nestjs/common';
import { redactText } from '../../core/observability/redaction';

/** The logical key this instrumentation is scoped to. */
export const DIAG_TEMPLATE_KEY = 'wa.resume_doc';

export type DiagStage =
  | 'generated'
  | 'pdfFetched'
  | 'mediaUploaded'
  | 'templateBuilt'
  | 'messageAccepted';

const ORDER: { key: DiagStage; label: string }[] = [
  { key: 'generated', label: 'Resume generated' },
  { key: 'pdfFetched', label: 'PDF fetched' },
  { key: 'mediaUploaded', label: 'Media uploaded' },
  { key: 'templateBuilt', label: 'Template built' },
  { key: 'messageAccepted', label: 'Message accepted' },
];

const state = new Map<DiagStage, { ok: boolean; why?: string }>();
/** Makes diagSummary idempotent per run, so it can be called from every exit
 *  path (success, send failure, and a throw before any send) without needing a
 *  `finally` — i.e. without restructuring the control flow it is observing. */
let printed = false;

/** Start of a document send — clears the previous run's marks. */
export function diagReset(): void {
  state.clear();
  printed = false;
}

export function diagMark(stage: DiagStage, ok: boolean, why?: string): void {
  state.set(stage, { ok, ...(why !== undefined && { why }) });
}

/** `[TAG] k=v k=v` — one line per stage, values redacted. */
export function diagLog(logger: Logger, tag: string, fields: Record<string, unknown>): void {
  const parts = Object.entries(fields).map(
    ([k, v]) => `${k}=${redactText(v === undefined || v === null ? 'none' : String(v))}`,
  );
  logger.log(`[TEMP DIAG] [${tag}] ${parts.join(' ')}`);
}

/**
 * The final block. A stage never reached prints as `·` rather than `✗`, because
 * "not attempted" and "attempted and failed" are different findings and only the
 * FIRST ✗ is the actual fault.
 */
export function diagSummary(logger: Logger): void {
  if (printed) return;
  printed = true;

  const lines: string[] = ['[TEMP DIAG] WHATSAPP RESUME PIPELINE'];
  let broken = false;
  let failedAt: string | null = null;

  for (const { key, label } of ORDER) {
    const s = state.get(key);
    if (s === undefined) {
      lines.push(`  ·  ${label} (not reached)`);
      broken = true;
      continue;
    }
    if (s.ok) {
      lines.push(`  ✓ ${label}`);
    } else {
      lines.push(`  ✗ ${label}${s.why ? ` — ${redactText(s.why)}` : ''}`);
      if (!broken) failedAt = label;
      broken = true;
    }
  }

  if (failedAt) lines.push(`  FAILED AT: ${failedAt}`);
  else if (broken) lines.push('  INCOMPLETE — a stage was never reached; see the · lines.');

  // One call so the block cannot be split by interleaved logging.
  logger.log(lines.join('\n'));
}
