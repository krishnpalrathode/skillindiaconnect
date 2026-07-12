import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditSubscriber } from './audit.subscriber';
import { AuditQueryController } from './audit-query.controller';
import { AuditQueryService } from './audit-query.service';

/**
 * @Global so AuditService is injectable throughout the api and worker processes
 * without each feature module importing AuditModule explicitly.
 *
 * AuditService is the only public seam — the only export from this module.
 * No other module imports AuditSubscriber or accesses audit_logs directly.
 *
 * Imported by both AppApiModule and AppWorkerModule:
 * - API process: catches settings changes, document events, and any direct log() calls.
 * - Worker process: audits delivery outcomes (notification.delivered/failed — S2-B3).
 */
@Global()
@Module({
  providers: [AuditService, AuditSubscriber],
  exports: [AuditService],
})
export class AuditModule {}

/**
 * The READ side of the audit trail (S6a-B1, Screen 29) — a SEPARATE module from
 * the @Global AuditModule above, and imported ONLY by AppApiModule.
 *
 * Why split: AuditModule is imported by BOTH roots, and the worker root must
 * never load controllers (a controller in a process with no HTTP server is dead
 * weight at best and a boundary violation at worst — see CLAUDE.md). The write
 * side is needed in both processes; the query controller is needed in neither
 * but the API. So the query surface gets its own module.
 *
 * It still lives in the audit folder because audit_logs is the audit module's
 * table (module-boundaries Rule 4) — the admin console is only the caller.
 */
@Module({
  controllers: [AuditQueryController],
  providers: [AuditQueryService],
})
export class AuditQueryModule {}
