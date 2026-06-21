import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';

export interface CurrentUserPayload {
  userId: string;
  role: UserRole;
  jti: string;
  exp: number; // Unix timestamp seconds — used by logout to compute blacklist TTL
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest<Request & { user: CurrentUserPayload }>();
    return request.user;
  },
);
