import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUserPayload } from './current-user.decorator';

/**
 * Marks a @Public() route as "optional auth": the JwtAuthGuard will still make a
 * best-effort attempt to read + validate a Bearer token and attach request.user
 * if present, but NEVER rejects when the token is missing or invalid. Used by the
 * public job search/detail so an authenticated candidate's saved-state can be
 * reflected without turning the routes into auth-required ones.
 */
export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);

/** Returns the attached user or null (for optional-auth public routes). */
export const CurrentUserOptional = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload | null => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: CurrentUserPayload }>();
    return request.user ?? null;
  },
);
