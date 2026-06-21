import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { CurrentUserPayload } from '../decorators/current-user.decorator';
import { TokenService } from '../token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearer(request);
    if (!token) throw new UnauthorizedException();

    let payload: ReturnType<TokenService['verifyAccess']>;
    try {
      payload = this.tokenService.verifyAccess(token);
    } catch {
      throw new UnauthorizedException();
    }

    if (payload.type !== 'access') throw new UnauthorizedException();

    if (await this.tokenService.isAccessJtiBlacklisted(payload.jti)) {
      throw new UnauthorizedException();
    }

    const user: CurrentUserPayload = {
      userId: payload.sub,
      role: payload.role,
      jti: payload.jti,
      exp: payload.exp,
    };
    (request as Request & { user: CurrentUserPayload }).user = user;
    return true;
  }

  private extractBearer(request: Request): string | null {
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    return auth.slice(7);
  }
}
