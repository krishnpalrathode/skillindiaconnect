import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CoreModule } from './core/core.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/auth.guard';

// WARNING: ThrottlerModule is using in-memory storage.
// Throttle limits are per-process replica, NOT global.
// Before running more than one API replica, replace the default storage with a
// Redis-backed adapter (e.g. @nest-lab/throttler-storage-redis) to enforce limits
// across all replicas.
@Module({
  imports: [
    CoreModule,
    HealthModule,
    AuthModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
  ],
  providers: [
    // ThrottlerGuard runs first (rate-limit before auth to protect unauthenticated endpoints).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // JwtAuthGuard is global + deny-by-default; routes opt out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppApiModule {}
