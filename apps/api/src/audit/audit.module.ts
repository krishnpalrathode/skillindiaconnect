import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditSubscriber } from './audit.subscriber';

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
