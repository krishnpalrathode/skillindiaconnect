/**
 * S8-H3 — records latency, status and error rate for every HTTP request.
 *
 * Routes are recorded by their PATH TEMPLATE (`/api/v1/jobs/:id`), never the
 * concrete URL. The raw path would create one time series per job id —
 * unbounded cardinality that melts a metrics backend — and would push
 * identifiers into the metrics store, which is not where they belong.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';
import { setRequestPrincipal } from './request-context';

interface MaybeHttpError {
  status?: number;
  statusCode?: number;
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<
      Request & { user?: { userId: string; role: string }; route?: { path?: string } }
    >();
    const res = http.getResponse<Response>();
    const started = Date.now();

    // Guards have already run by the time an interceptor executes, so the
    // principal is known here — attach it to the correlation context so every
    // subsequent log line for this request carries it.
    if (req.user?.userId) setRequestPrincipal(req.user.userId, req.user.role);

    const record = (status: number): void => {
      const template = req.route?.path ?? 'unmatched';
      this.metrics.recordHttpRequest(req.method, template, status, Date.now() - started);
      if (status === 401 || status === 403) this.metrics.recordAuthFailure(String(status));
      if (status === 429) this.metrics.recordRateLimitHit(template);
    };

    return next.handle().pipe(
      tap(() => record(res.statusCode)),
      catchError((err: MaybeHttpError) => {
        // On the error path the response status is not yet final (the exception
        // filter sets it), so take it from the exception. Errors must be
        // counted — they are the entire point of an error-rate metric.
        record(err?.status ?? err?.statusCode ?? 500);
        return throwError(() => err);
      }),
    );
  }
}
