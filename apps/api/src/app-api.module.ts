import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CoreModule } from './core/core.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { CandidateModule } from './candidate/candidate.module';
import { AccountModule } from './account/account.module';
import { R2Module } from './core/storage/r2.module';
import { SettingsModule } from './settings/settings.module';
import { AuditModule } from './audit/audit.module';
import { NotificationModule } from './notifications/notification.module';
import { EmployerModule } from './employer/employer.module';
import { JobsModule } from './jobs/jobs.module';
import { JobsSearchModule } from './jobs-search/jobs-search.module';
import { JwtAuthGuard } from './auth/guards/auth.guard';
import { PermissionsGuard } from './auth/rbac/permissions.guard';

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
    R2Module,
    CandidateModule,
    AccountModule,
    SettingsModule,
    AuditModule,
    NotificationModule,
    EmployerModule,
    JobsModule,
    JobsSearchModule,
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
  ],
  providers: [
    // Guard execution order: ThrottlerGuard → JwtAuthGuard → PermissionsGuard.
    // NestJS APP_GUARD providers are applied in registration order.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // PermissionsGuard runs last — req.user is already set by JwtAuthGuard.
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppApiModule {}
