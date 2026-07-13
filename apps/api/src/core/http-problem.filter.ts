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
    } else {
      // Programming error / infrastructure failure. Log the truth server-side;
      // the client gets a generic envelope with zero internal detail.
      const msg = exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(`Unhandled exception: ${msg}`, stack);
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

    res.status(status).json(problem);
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
