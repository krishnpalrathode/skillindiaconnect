import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
// TEMPORARY DIAGNOSTICS — remove with logMetaFailure().
import { redactText } from '../../core/observability/redaction';
// TEMPORARY DIAGNOSTICS — remove with whatsapp-pipeline.diag.ts.
import { DIAG_TEMPLATE_KEY, diagLog, diagMark } from './whatsapp-pipeline.diag';
import type {
  WhatsappChannel,
  WhatsappDocument,
  WhatsappSendResult,
  WhatsappTemplateSend,
} from './whatsapp.channel';
import {
  DEFAULT_TEMPLATE_LANGUAGE,
  META_OTP_TEMPLATE,
  assertTemplateMappingComplete,
  resolveMetaTemplate,
  type MetaTemplate,
} from './meta-templates';

interface MetaConfig {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  timeoutMs: string | number;
  /** Locale templates are requested in — see DEFAULT_TEMPLATE_LANGUAGE. */
  templateLanguage: string;
}

/** Meta's error code for "this number is not on WhatsApp". */
const NOT_ON_WHATSAPP_CODES = new Set([131026, 131_026]);

/**
 * The Meta WhatsApp Cloud API adapter (CR-WA W1).
 *
 * ⚠️ THIS RUNS IN BOTH PROCESSES. `WHATSAPP_CHANNEL` is bound in
 * whatsapp.module.ts (API — OtpService sends the login code INLINE, the
 * documented exception in worker-and-external-sends.md) and in
 * channels.module.ts (worker — notification sends). Both go through the same
 * factory so the two can never diverge.
 *
 * HONESTY: `ok:true` means Meta ACCEPTED the message, never that it was
 * delivered — real delivery arrives asynchronously via the status webhook (W2),
 * which is what advances whatsapp_messages past SENT.
 *
 * ⚠️ NEVER THROWS FROM A SEND. Every failure returns `ok:false` with a coarse
 * code. This matters doubly under the OTP exception: sendOtp is called on a
 * synchronous auth request, so a thrown error would surface as a 500 on login
 * instead of the email/SMS fallback that OtpService is written to perform. The
 * ONLY throws are at CONSTRUCTION (bad config, incomplete template mapping) —
 * boot-time, and intended.
 */
@Injectable()
export class MetaWhatsappChannel implements WhatsappChannel {
  private readonly logger = new Logger(MetaWhatsappChannel.name);
  private readonly config: MetaConfig;

  constructor(config: ConfigService) {
    // Fail LOUDLY at construction — a process that cannot send must not boot
    // into a silent black hole. Both of these are boot-time throws by design.
    this.config = this.readConfig(config);
    assertTemplateMappingComplete();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async sendOtp(
    phone: string,
    code: string,
    purpose: 'PHONE_VERIFY' | 'LOGIN',
  ): Promise<WhatsappSendResult> {
    // Authentication templates take the code as their single body parameter AND
    // repeat it as the button's URL/copy parameter — Meta rejects an auth
    // template send that omits the button component.
    return this.post(phone, `otp:${purpose}`, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: META_OTP_TEMPLATE.name,
        language: { code: this.languageFor(META_OTP_TEMPLATE) },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    });
  }

  async sendTemplate(
    phone: string,
    templateKey: string,
    send: WhatsappTemplateSend,
  ): Promise<WhatsappSendResult> {
    let template: MetaTemplate;
    try {
      template = resolveMetaTemplate(templateKey);
    } catch (err) {
      // An unmapped key is a programming error, but it must not become a throw
      // on a send path. Log it loudly and fail the send honestly.
      this.logger.error(err instanceof Error ? err.message : String(err));
      return { ok: false, errorCode: 'TEMPLATE_NOT_MAPPED' };
    }

    // Meta's mismatch error (132000) is opaque; refuse here where we can name
    // the template and both counts.
    if (send.bodyParams.length !== template.params) {
      this.logger.error(
        `template '${template.name}' expects ${template.params} parameter(s), ` +
          `got ${send.bodyParams.length} — refusing to send`,
      );
      return { ok: false, errorCode: 'TEMPLATE_PARAM_MISMATCH' };
    }

    let headerComponent: Record<string, unknown> | null = null;
    if (template.document) {
      if (!send.document) {
        this.logger.error(`template '${template.name}' requires a document; none supplied`);
        return { ok: false, errorCode: 'DOCUMENT_MISSING' };
      }
      const uploaded = await this.uploadMedia(send.document);
      if (!uploaded.ok) return uploaded.result;
      headerComponent = {
        type: 'header',
        parameters: [
          { type: 'document', document: { id: uploaded.mediaId, filename: send.document.filename } },
        ],
      };
    }

    // ═══ TEMP DIAG — the assembled request, before it goes to Meta ═════════
    if (templateKey === DIAG_TEMPLATE_KEY) {
      const headerParam = headerComponent
        ? (headerComponent['parameters'] as { type: string; document?: { id?: string } }[])[0]
        : null;
      diagLog(this.logger, 'TEMPLATE BUILD', {
        templateName: template.name,
        language: this.languageFor(template),
        bodyParamCount: send.bodyParams.length,
        headerType: headerParam?.type ?? 'none',
        filename: send.document?.filename,
        mediaIdPresent: Boolean(headerParam?.document?.id),
      });
      diagMark('templateBuilt', true);
    }
    // ═══════════════════════════════════════════════════════════════════════

    return this.post(phone, templateKey, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: template.name,
        language: { code: this.languageFor(template) },
        components: [
          ...(headerComponent ? [headerComponent] : []),
          {
            type: 'body',
            parameters: send.bodyParams.map((text) => ({ type: 'text', text })),
          },
        ],
      },
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Upload the document and return its media id.
   *
   * A SECOND network call, with its own failure modes — deliberately given its
   * own try/catch rather than living inside the send's. Bytes rather than a
   * URL: every document url this platform mints is a short-expiry signed R2 url
   * and would routinely be dead by the time Meta fetched it.
   */
  private async uploadMedia(
    doc: WhatsappDocument,
  ): Promise<{ ok: true; mediaId: string } | { ok: false; result: WhatsappSendResult }> {
    // ═══ TEMP DIAG ═════════════════════════════════════════════════════════
    // Byte LENGTH only — never the bytes.
    diagLog(this.logger, 'MEDIA UPLOAD REQUEST', {
      filename: doc.filename,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.bytes.length,
    });
    // ═══════════════════════════════════════════════════════════════════════
    try {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', doc.mimeType);
      form.append(
        'file',
        new Blob([new Uint8Array(doc.bytes)], { type: doc.mimeType }),
        doc.filename,
      );

      const res = await fetch(
        `https://graph.facebook.com/${this.config.graphVersion}/${this.config.phoneNumberId}/media`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.config.accessToken}` },
          body: form,
          signal: AbortSignal.timeout(this.timeoutMs()),
        },
      );

      const body = await safeJson(res);
      const mediaId = typeof body?.['id'] === 'string' ? (body['id'] as string) : null;

      // ═══ TEMP DIAG ═══════════════════════════════════════════════════════
      const uploadErr = (body?.['error'] ?? null) as Record<string, unknown> | null;
      diagLog(this.logger, 'MEDIA UPLOAD RESPONSE', {
        httpStatus: res.status,
        media_id: mediaId,
        graphError: uploadErr
          ? `code=${String(uploadErr['code'])} subcode=${String(uploadErr['error_subcode'] ?? 'none')} ` +
            `message=${String(uploadErr['message'])}`
          : 'none',
      });
      diagMark('mediaUploaded', Boolean(res.ok && mediaId), res.ok && mediaId ? undefined : `HTTP ${res.status}`);
      // ═════════════════════════════════════════════════════════════════════

      if (!res.ok || !mediaId) {
        this.logger.error(`media upload FAILED status=${res.status}`);
        // ═══ TEMPORARY DIAGNOSTICS ═══════════════════════════════════════════
        // The other way a send dies. A 2xx with no `id` is indistinguishable
        // from a rejection in the line above, so the body is what separates them.
        logMetaFailure(this.logger, 'media-upload', res.status, body);
        // ═════════════════════════════════════════════════════════════════════
        return { ok: false, result: { ok: false, errorCode: classifyStatus(res.status) } };
      }
      return { ok: true, mediaId };
    } catch (err) {
      this.logger.error(`media upload FAILED ${classifyError(err)}`);
      // ═══ TEMP DIAG — the upload never completed; no HTTP response exists ══
      diagLog(this.logger, 'MEDIA UPLOAD RESPONSE', {
        httpStatus: 'none (transport failure)',
        media_id: null,
        graphError: classifyError(err),
      });
      diagMark('mediaUploaded', false, classifyError(err));
      // ═════════════════════════════════════════════════════════════════════
      return { ok: false, result: { ok: false, errorCode: classifyError(err) } };
    }
  }

  /** The single message POST. Returns honestly; never throws. */
  private async post(
    phone: string,
    label: string,
    payload: Record<string, unknown>,
  ): Promise<WhatsappSendResult> {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${this.config.graphVersion}/${this.config.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs()),
        },
      );

      const body = await safeJson(res);

      // ═══ TEMP DIAG — gated on the document key so OTP is untouched ════════
      // The Meta REJECTION detail (code/subcode/type/message/details/
      // fbtrace_id) is already emitted by logMetaFailure() below on any
      // non-2xx; it is not duplicated here.
      if (label === DIAG_TEMPLATE_KEY) {
        const wamid =
          Array.isArray(body?.['messages']) && typeof (body['messages'] as { id?: unknown }[])[0]?.id === 'string'
            ? ((body['messages'] as { id: string }[])[0]!.id)
            : null;
        diagLog(this.logger, 'SEND MESSAGE', {
          httpStatus: res.status,
          metaResponse: JSON.stringify(body ?? null).slice(0, 400),
          wamid,
        });
        diagMark('messageAccepted', Boolean(res.ok && wamid), res.ok ? undefined : `HTTP ${res.status}`);
      }
      // ═══════════════════════════════════════════════════════════════════════

      if (res.ok) {
        // W2's delivery webhook joins its callbacks on THIS id. Reading it from
        // the wrong field would leave every status update an unknown-message
        // no-op, with rows stuck at SENT forever.
        const messages = body?.['messages'];
        const providerMessageId =
          Array.isArray(messages) && typeof messages[0]?.id === 'string'
            ? (messages[0].id as string)
            : undefined;
        this.logSafe(phone, label, 'SENT', providerMessageId);
        return { ok: true, providerMessageId };
      }

      // ═══ TEMPORARY DIAGNOSTICS — REMOVE ONCE THE PROVIDER ERROR IS UNDERSTOOD
      logMetaFailure(this.logger, label, res.status, body);
      // ═══════════════════════════════════════════════════════════════════════

      // Meta signals an unreachable number through an error CODE, not a status.
      const code = readErrorCode(body);
      if (code !== null && NOT_ON_WHATSAPP_CODES.has(code)) {
        this.logSafe(phone, label, 'FAILED');
        return { ok: false, notOnWhatsapp: true, errorCode: 'NOT_ON_WHATSAPP' };
      }

      this.logSafe(phone, label, 'FAILED');
      return { ok: false, errorCode: code !== null ? `META_${code}` : classifyStatus(res.status) };
    } catch (err) {
      // ═══ TEMPORARY DIAGNOSTICS ═════════════════════════════════════════════
      // No HTTP response exists on this path — the request never completed — so
      // the only new fact available is which failure it was. Name and message
      // only; a fetch/undici message carries no PII but is redacted anyway.
      this.logger.error(
        `[TEMP DIAG] whatsapp transport FAILED template=${label} ` +
          `name=${String((err as { name?: unknown })?.name ?? 'unknown')} ` +
          `msg=${redactText(err instanceof Error ? err.message : String(err))} ` +
          `cause=${redactText(String((err as { cause?: unknown })?.cause ?? 'none'))} ` +
          `timeoutMs=${this.timeoutMs()}`,
      );
      // ═══════════════════════════════════════════════════════════════════════

      // Network, timeout, abort. Honest FAILED — the caller retries (worker) or
      // falls back (OTP). NEVER rethrown: on the auth path that would be a 500.
      this.logSafe(phone, label, 'FAILED');
      return { ok: false, errorCode: classifyError(err) };
    }
  }

  /**
   * The locale to request a template in — per-template override, else the
   * configured default. See DEFAULT_TEMPLATE_LANGUAGE: this is part of the
   * template's identity to Meta, and getting it wrong 404s with code 132001
   * saying the template "does not exist", which it does.
   */
  private languageFor(template: MetaTemplate): string {
    return template.language ?? this.config.templateLanguage;
  }

  private timeoutMs(): number {
    const n = Number(this.config.timeoutMs);
    return Number.isFinite(n) && n > 0 ? n : 10_000;
  }

  /**
   * Redaction-safe send log (no-PII rule): the recipient is reduced to a
   * SHA-256 prefix — enough to correlate a delivery incident, never the number.
   * The OTP CODE and the access token are never logged in any form.
   */
  private logSafe(
    phone: string,
    label: string,
    status: 'SENT' | 'FAILED',
    messageId?: string,
  ): void {
    const hash = createHash('sha256').update(phone).digest('hex').slice(0, 12);
    this.logger.log(
      `whatsapp ${status} template=${label} to=${hash}${messageId ? ` msgId=${messageId}` : ''}`,
    );
  }

  private readConfig(config: ConfigService): MetaConfig {
    const accessToken = config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    if (!accessToken || !phoneNumberId) {
      throw new Error(
        'Meta WhatsApp is not configured — WHATSAPP_ACCESS_TOKEN and ' +
          'WHATSAPP_PHONE_NUMBER_ID are both required when WHATSAPP_PROVIDER=meta.',
      );
    }
    return {
      accessToken,
      phoneNumberId,
      graphVersion: config.get<string>('WHATSAPP_GRAPH_VERSION') ?? 'v21.0',
      timeoutMs: config.get<string | number>('WHATSAPP_TIMEOUT_MS') ?? 10_000,
      templateLanguage:
        config.get<string>('WHATSAPP_TEMPLATE_LANGUAGE') ?? DEFAULT_TEMPLATE_LANGUAGE,
    };
  }
}

/**
 * ═══ TEMPORARY DIAGNOSTICS — DELETE THIS FUNCTION AND ITS THREE CALL SITES ═══
 *
 * The full Meta error document for a failed send. `logSafe` deliberately emits
 * only `whatsapp FAILED template=…`, which is correct for steady-state (it is
 * the no-PII line that runs on every send) but tells you nothing about WHY when
 * you are bringing the integration up. Meta's `code`/`error_subcode` pair is the
 * only thing that distinguishes an expired token from an unapproved template
 * from a number outside the allow-list.
 *
 * BEHAVIOUR IS UNCHANGED: this returns void, is called after the outcome is
 * already decided, and nothing reads it. `errorCode` on the returned result is
 * still derived exactly as before.
 *
 * ⚠️ EVERYTHING IS PUT THROUGH redactText, AND THAT IS NOT OPTIONAL.
 * `error.message` and `error_data.details` ROUTINELY ECHO THE RECIPIENT'S
 * NUMBER — e.g. "Message failed to send to +919876543210" — which is why W2
 * stores the CODE only in `whatsapp_messages.errorCode`. redactText masks
 * E.164 numbers and emails while leaving codes, subcodes and the actual
 * failure text intact, so the whole diagnostic survives and the PII does not.
 * Applied HERE rather than relying on the logger, because the structured
 * logger's redaction only runs when LOG_FORMAT=json — local and any
 * non-JSON-logging environment would otherwise print the number raw.
 *
 * The access token is never touched: it lives in the request headers, and
 * nothing from the request is logged.
 */
function logMetaFailure(
  logger: Logger,
  label: string,
  status: number,
  body: Record<string, unknown> | null,
): void {
  const error = (body?.['error'] ?? null) as Record<string, unknown> | null;

  if (error === null) {
    // A non-JSON body is itself the finding: an edge proxy or WAF answered, not
    // Meta. Truncated — an HTML error page can be large.
    const raw = body === null ? '<unparseable/non-JSON body>' : JSON.stringify(body);
    logger.error(
      `[TEMP DIAG] whatsapp send FAILED template=${label} httpStatus=${status} ` +
        `noMetaErrorObject body=${redactText(raw).slice(0, 500)}`,
    );
    return;
  }

  const errorData = (error['error_data'] ?? null) as Record<string, unknown> | null;
  const parts = [
    `httpStatus=${status}`,
    `code=${String(error['code'] ?? 'none')}`,
    `subcode=${String(error['error_subcode'] ?? 'none')}`,
    `type=${String(error['type'] ?? 'none')}`,
    `message=${redactText(String(error['message'] ?? 'none'))}`,
    `details=${redactText(String(errorData?.['details'] ?? 'none'))}`,
    // The id Meta support asks for first.
    `fbtrace_id=${String(error['fbtrace_id'] ?? 'none')}`,
  ];

  logger.error(`[TEMP DIAG] whatsapp send FAILED template=${label} ${parts.join(' ')}`);
}
// ═══ END TEMPORARY DIAGNOSTICS ═══════════════════════════════════════════════

/**
 * `res.json()` that cannot throw.
 *
 * A non-2xx from Meta may carry a JSON error document — or HTML from an edge
 * proxy on a 5xx. Letting the parse reject would turn a cleanly-classified
 * failure into an exception, and on the OTP path that exception is a 500 on
 * login. Returns null rather than throwing; the status is classified regardless.
 */
async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Meta nests its code at error.code; absent on a non-JSON body. */
function readErrorCode(body: Record<string, unknown> | null): number | null {
  const error = body?.['error'];
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' ? code : null;
}

/** A coarse, redaction-safe code from the HTTP status. */
function classifyStatus(status: number): string {
  if (status === 401 || status === 403) return 'EAUTH';
  if (status === 400 || status === 422) return 'INVALID_REQUEST';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_ERROR';
  return `HTTP_${status}`;
}

/** A coarse, redaction-safe code — never the raw message (may hold PII). */
function classifyError(err: unknown): string {
  const name = (err as { name?: unknown })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'ETIMEDOUT';
  return 'ENETWORK';
}
