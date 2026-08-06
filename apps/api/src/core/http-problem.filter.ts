import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  ValidationError,
} from '@nestjs/common';
import { Response } from 'express';
import { captureError } from './observability/error-tracking';

/**
 * The RFC-7807-style error envelope mandated by api-conventions.md and the
 * OpenAPI contract's `Error` schema:
 *
 *   { type, title, status, detail, code, meta? }
 *
 * `code` is the machine-readable contract field (e.g. PROFILE_INCOMPLETE,
 * ILLEGAL_TRANSITION); `title`/`detail` are human, localizable copy.
 */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  meta?: Record<string, unknown>;
}

/** Human titles per status (RFC 9110 reason phrases). */
const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  423: 'Locked',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

/**
 * Fallback machine codes for exceptions thrown WITHOUT an explicit `code`
 * (Nest guards, pipes, the throttler). Domain throws always carry their own
 * code and are never touched by this map.
 */
const DEFAULT_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  423: 'LOCKED',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * THE single place API error bodies are shaped (global, via APP_FILTER).
 *
 * Every controller/service keeps throwing exactly what it throws today —
 * `new UnprocessableEntityException({ code, meta })` etc. — and this filter
 * wraps it into the full envelope. `code`/`meta` pass through UNCHANGED (they
 * are the wire contract clients already switch on); the filter only ADDS the
 * missing `type`/`title`/`status`/`detail`. It also normalizes Nest's ad-hoc
 * `{ statusCode, message }` bodies (JwtAuthGuard 401s, ThrottlerException
 * 429s, pipe 400s) into the same shape.
 *
 * Unexpected non-HTTP exceptions become a generic 500: the real error is
 * logged server-side (message + stack only — never the request body, per the
 * no-PII rule) and the client gets NO internal detail.
 */
/**
 * An express-layer error carrying an HTTP status (SEC-003). `body-parser`
 * throws these for oversized, malformed, or wrongly-encoded bodies:
 * `PayloadTooLargeError` (413), `EntityParseError` (400), `UnsupportedMediaType`
 * (415). They are plain Errors with a `status`/`statusCode`, not HttpExceptions.
 */
function isHttpishError(e: unknown): e is Error & { status?: number; statusCode?: number } {
  if (e === null || typeof e !== 'object') return false;
  const o = e as { status?: unknown; statusCode?: unknown };
  const s = typeof o.status === 'number' ? o.status : typeof o.statusCode === 'number' ? o.statusCode : null;
  // Only trust a plausible HTTP status — never let an arbitrary numeric field
  // on some unrelated error object choose the response code.
  return s !== null && s >= 400 && s <= 599;
}

@Catch()
export class HttpProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string | undefined;
    let detail: string | undefined;
    let meta: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        detail = body;
      } else if (body && typeof body === 'object') {
        const o = body as Record<string, unknown>;
        if (typeof o['code'] === 'string') code = o['code'];
        if (o['meta'] && typeof o['meta'] === 'object') {
          meta = o['meta'] as Record<string, unknown>;
        }
        // Prefer an explicit `detail`; fall back to Nest's `message` (string
        // or the ValidationPipe's string[]).
        if (typeof o['detail'] === 'string') {
          detail = o['detail'];
        } else if (typeof o['message'] === 'string') {
          detail = o['message'];
        } else if (Array.isArray(o['message'])) {
          detail = (o['message'] as string[]).join('; ');
        }
      }
    } else if (isHttpishError(exception)) {
      // SEC-003 (S8-H2): body-parser and other express-layer errors are NOT
      // HttpExceptions, but they DO carry the correct HTTP status. Without this
      // branch they fell through to the generic 500 below — so an over-limit
      // body answered `500 INTERNAL_ERROR` instead of `413 PAYLOAD_TOO_LARGE`,
      // misreporting a client mistake as a server fault (and logging it at
      // ERROR, which lets an unauthenticated caller flood the logs by POSTing
      // oversized bodies).
      //
      // Only the STATUS is taken from the error. The message is deliberately
      // NOT used as `detail` — express error text can carry request specifics —
      // so the client still receives the generic per-status envelope.
      status = exception.status ?? exception.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
      if (status >= 500) {
        const msg = exception instanceof Error ? exception.message : String(exception);
        this.logger.error(`Unhandled exception: ${msg}`, exception instanceof Error ? exception.stack : undefined);
      } else {
        // A 4xx here is a malformed client request, not an incident. Log it at
        // warn without a stack so real errors stay visible in the noise.
        this.logger.warn(`Client request rejected (${status}): ${(exception as Error).message}`);
      }
    } else {
      // Programming error / infrastructure failure. Log the truth server-side;
      // the client gets a generic envelope with zero internal detail.
      const msg = exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(`Unhandled exception: ${msg}`, stack);
      // S8-H3: report to the error tracker with correlation context. Only
      // genuinely unexpected failures are sent — HttpExceptions above are
      // deliberate domain outcomes (a 404, a 403) and would be pure noise.
      captureError(exception);
    }

    const title = TITLES[status] ?? 'Error';
    const problem: ProblemDetail = {
      type: 'about:blank',
      title,
      status,
      detail: detail ?? title,
      code: code ?? DEFAULT_CODES[status] ?? 'ERROR',
      ...(meta && { meta }),
    };

    /**
     * SET THE CONTENT TYPE EXPLICITLY.
     *
     * `res.json()` only DEFAULTS the header — it will not override one already
     * on the response. A handler decorated with `@Header('content-type', ...)`
     * (the WhatsApp webhook GET declares `text/plain`, because Meta compares the
     * challenge body verbatim) has that header applied BEFORE the handler runs,
     * so it survives into the error path and every rejection from that route
     * went out as a JSON body labelled `text/plain; charset=utf-8`.
     *
     * Verified against production before this fix:
     *   HTTP/1.1 403 Forbidden
     *   Content-Type: text/plain; charset=utf-8
     *   {"type":"about:blank","title":"Forbidden",...,"code":"INVALID_VERIFY_TOKEN"}
     *
     * A mislabelled body is a client's problem to parse and, with
     * `X-Content-Type-Options: nosniff` set by helmet, one a browser will not
     * rescue. This restores exactly what every other route already got by
     * default, so no existing response shape changes.
     */
    res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
    res.json(problem);
  }
}

// ─── ValidationPipe exceptionFactory ─────────────────────────────────────────

interface FieldError {
  field: string;
  code: string;
  message: string;
}

/** Depth-first flatten of class-validator errors into per-field entries. */
function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  const out: FieldError[] = [];
  for (const err of errors) {
    const field = parent ? `${parent}.${err.property}` : err.property;
    for (const [constraint, message] of Object.entries(err.constraints ?? {})) {
      out.push({ field, code: constraint, message });
    }
    if (err.children?.length) {
      out.push(...flattenValidationErrors(err.children, field));
    }
  }
  return out;
}

/**
 * ValidationPipe `exceptionFactory` producing the contract's validation shape:
 * `code: VALIDATION_ERROR` + `meta.errors[]` with per-field machine codes
 * (the class-validator constraint keys, e.g. `isEnum`, `maxLength`), instead
 * of Nest's default flat `message: string[]`. The filter above then wraps it
 * into the full envelope.
 */
export function validationProblemFactory(errors: ValidationError[]): BadRequestException {
  const fieldErrors = flattenValidationErrors(errors);
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    detail: fieldErrors.map((e) => e.message).join('; ') || 'Request validation failed.',
    meta: { errors: fieldErrors.map(({ field, code }) => ({ field, code })) },
  });
}
