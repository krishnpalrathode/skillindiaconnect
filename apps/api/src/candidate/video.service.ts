import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { QUEUE_NAMES, JOB_NAMES, R2_DELETE_JOB_OPTS } from '../queue/queue.constants';
import { PresignVideoDto, ConfirmVideoDto } from './dto/video.dto';

/**
 * Container formats a phone actually produces.
 *
 * Deliberately short. Android records `video/mp4`, iOS records
 * `video/quicktime`, and a browser MediaRecorder produces `video/webm` — that is
 * the whole realistic set for "hold up your phone and film yourself working".
 * Accepting more formats would mean accepting files no employer's browser can
 * play back, which helps nobody.
 */
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

/** How long a playback URL stays valid. Short — it is re-issued on demand. */
export const VIDEO_URL_EXPIRY_SECONDS = 300;

export interface VideoStatus {
  hasVideo: boolean;
  uploadedAt: string | null;
  durationSec: number | null;
  sizeBytes: number | null;
}

/**
 * The candidate's working-video introduction.
 *
 * Separate from `DocumentService` on purpose. A document is a row in
 * `candidate_documents` with a verification status an admin moves through a
 * workflow; the video is four columns on the profile with no review step and
 * exactly one of them at a time. Modelling it as a document would have meant a
 * document type that is never verified, never expires and cannot be listed —
 * three exceptions inside a service whose whole job is the opposite.
 *
 * ── The duration limit, stated honestly ────────────────────────────────────
 * The size cap is enforced on the SERVER, from the real object (`headObject`),
 * so it cannot be talked around. The DURATION cap cannot be: reading the true
 * length of an arbitrary container needs a demuxer (ffprobe) that this process
 * does not have and should not grow for one field. So the length that lands in
 * `videoDurationSec` is the browser's `HTMLVideoElement.duration`, declared by
 * the client and merely range-checked here.
 *
 * That is acceptable because of what the two limits are FOR. The duration cap
 * is a product rule — employers will not watch four minutes — and the honest
 * enforcement of "not too big to store or stream" is the byte cap, which is
 * real. A crafted client could register a two-minute claim over a ten-megabyte
 * file; it still cannot store more than ten megabytes, which is the limit that
 * protects the platform. Anything stricter belongs in a transcoding step.
 */
@Injectable()
export class VideoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    @InjectQueue(QUEUE_NAMES.R2_DELETE) private readonly r2DeleteQueue: Queue,
  ) {}

  /** The admin-tunable limits, read together so the two calls cannot interleave. */
  async limits(): Promise<{ maxMb: number; maxBytes: number; maxDurationSec: number }> {
    const [maxMb, maxMinutes] = await Promise.all([
      this.settings.get(SETTING_KEYS.VIDEO_MAX_MB),
      this.settings.get(SETTING_KEYS.VIDEO_MAX_MINUTES),
    ]);
    return {
      maxMb,
      maxBytes: maxMb * 1024 * 1024,
      maxDurationSec: maxMinutes * 60,
    };
  }

  private async candidateIdFor(userId: string): Promise<string> {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException({ code: 'NOT_FOUND' });
    return profile.id;
  }

  async presign(
    userId: string,
    dto: PresignVideoDto,
  ): Promise<{ uploadUrl: string; key: string; expiresInSeconds: number }> {
    const { maxBytes, maxMb, maxDurationSec } = await this.limits();

    if (!VIDEO_MIME_TYPES.includes(dto.mimeType as (typeof VIDEO_MIME_TYPES)[number])) {
      throw new UnprocessableEntityException({ code: 'INVALID_FILE_TYPE' });
    }
    // First-line check on the DECLARED size; the real gate is the HEAD in confirm().
    // Worth doing anyway: it fails a 200 MB holiday clip before the candidate
    // spends their mobile data uploading it.
    if (dto.sizeBytes > maxBytes) {
      throw new UnprocessableEntityException({ code: 'FILE_TOO_LARGE', meta: { maxMb } });
    }
    if (dto.durationSec > maxDurationSec) {
      throw new UnprocessableEntityException({
        code: 'VIDEO_TOO_LONG',
        meta: { maxDurationSec },
      });
    }

    const candidateId = await this.candidateIdFor(userId);
    const safeFileName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `candidates/${candidateId}/video/${uuidv4()}-${safeFileName}`;
    const { url, expiresInSeconds } = await this.storage.presignPut({
      key,
      contentType: dto.mimeType,
      maxBytes,
    });
    return { uploadUrl: url, key, expiresInSeconds };
  }

  /**
   * Persist a completed upload.
   *
   * Ownership by key prefix, existence + real size by HEAD, then the columns.
   * The previously stored object is deleted through the R2 queue rather than
   * inline: a replaced video is dead weight the moment the row is updated, but
   * failing the candidate's request because a cleanup call timed out would be
   * absurd — the queue retries, the request does not care.
   */
  async confirm(userId: string, dto: ConfirmVideoDto): Promise<VideoStatus> {
    const candidateId = await this.candidateIdFor(userId);
    const expectedPrefix = `candidates/${candidateId}/video/`;
    if (!dto.key.startsWith(expectedPrefix)) {
      throw new ForbiddenException({ code: 'KEY_NOT_OWNED' });
    }

    const head = await this.storage.headObject(dto.key);
    if (!head) {
      throw new UnprocessableEntityException({ code: 'UPLOAD_NOT_FOUND' });
    }

    const { maxBytes, maxMb, maxDurationSec } = await this.limits();
    // Re-checked from the OBJECT, not from the request — this is the gate that
    // actually holds, because the client cannot influence it.
    if (head.sizeBytes > maxBytes) {
      throw new UnprocessableEntityException({ code: 'FILE_TOO_LARGE', meta: { maxMb } });
    }
    if (!VIDEO_MIME_TYPES.includes(head.contentType as (typeof VIDEO_MIME_TYPES)[number])) {
      throw new UnprocessableEntityException({ code: 'INVALID_FILE_TYPE' });
    }
    if (dto.durationSec > maxDurationSec) {
      throw new UnprocessableEntityException({
        code: 'VIDEO_TOO_LONG',
        meta: { maxDurationSec },
      });
    }

    const existing = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      select: { videoR2Key: true },
    });

    const updated = await this.prisma.candidateProfile.update({
      where: { id: candidateId },
      data: {
        videoR2Key: dto.key,
        videoDurationSec: Math.round(dto.durationSec),
        videoSizeBytes: head.sizeBytes,
        videoUploadedAt: new Date(),
      },
      select: { videoUploadedAt: true, videoDurationSec: true, videoSizeBytes: true },
    });

    if (existing?.videoR2Key && existing.videoR2Key !== dto.key) {
      await this.enqueueDelete(existing.videoR2Key);
    }

    return {
      hasVideo: true,
      uploadedAt: updated.videoUploadedAt?.toISOString() ?? null,
      durationSec: updated.videoDurationSec,
      sizeBytes: updated.videoSizeBytes,
    };
  }

  /** Current state, for the profile screen and the dashboard prompt. */
  async status(userId: string): Promise<VideoStatus> {
    const candidateId = await this.candidateIdFor(userId);
    const row = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      select: {
        videoR2Key: true,
        videoUploadedAt: true,
        videoDurationSec: true,
        videoSizeBytes: true,
      },
    });
    return {
      hasVideo: !!row?.videoR2Key,
      uploadedAt: row?.videoUploadedAt?.toISOString() ?? null,
      durationSec: row?.videoDurationSec ?? null,
      sizeBytes: row?.videoSizeBytes ?? null,
    };
  }

  /**
   * A short-lived signed URL so the candidate can watch back what they uploaded.
   *
   * Signed and short-expiry like every other object this platform serves — the
   * bucket is private, and a video of someone's face is exactly the kind of
   * thing that must not sit behind a guessable public URL.
   */
  async playbackUrl(userId: string): Promise<{ url: string; expiresInSeconds: number }> {
    const candidateId = await this.candidateIdFor(userId);
    const row = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      select: { videoR2Key: true },
    });
    if (!row?.videoR2Key) {
      throw new NotFoundException({ code: 'VIDEO_NOT_FOUND' });
    }
    const url = await this.storage.presignGet(row.videoR2Key, VIDEO_URL_EXPIRY_SECONDS);
    return { url, expiresInSeconds: VIDEO_URL_EXPIRY_SECONDS };
  }

  /** Remove the video. Idempotent — deleting nothing is a success, not a 404. */
  async remove(userId: string): Promise<VideoStatus> {
    const candidateId = await this.candidateIdFor(userId);
    const existing = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      select: { videoR2Key: true },
    });

    if (existing?.videoR2Key) {
      await this.prisma.candidateProfile.update({
        where: { id: candidateId },
        data: {
          videoR2Key: null,
          videoDurationSec: null,
          videoSizeBytes: null,
          videoUploadedAt: null,
        },
      });
      await this.enqueueDelete(existing.videoR2Key);
    }

    return { hasVideo: false, uploadedAt: null, durationSec: null, sizeBytes: null };
  }

  /**
   * Hand the object to the R2 delete queue.
   *
   * The jobId is derived from the key so a double-submit collapses to one job.
   * HYPHEN separator, never a colon — BullMQ 5 rejects a custom id containing
   * `:` at runtime (see cron-queue-dedupe.md), and R2 keys contain slashes only.
   */
  private async enqueueDelete(key: string): Promise<void> {
    await this.r2DeleteQueue.add(
      JOB_NAMES.DELETE_OBJECT,
      { key },
      { jobId: `r2del-${key}`, ...R2_DELETE_JOB_OPTS },
    );
  }
}
