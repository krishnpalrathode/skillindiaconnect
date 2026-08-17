/**
 * The working-video limits.
 *
 * What matters here is WHICH limit is enforced WHERE. The size cap has to hold
 * against the stored object, because that is the only check a crafted client
 * cannot influence; the duration cap is a declared value and is range-checked.
 * A test suite that only exercised the request path would prove the weaker half
 * and miss the point of the design.
 */
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { VideoService } from './video.service';

const CANDIDATE_ID = 'cand-1';
const USER_ID = 'user-1';
const KEY = `candidates/${CANDIDATE_ID}/video/abc-clip.mp4`;

const MAX_MB = 10;
const MAX_MINUTES = 2;

describe('VideoService', () => {
  let service: VideoService;
  let prisma: {
    candidateProfile: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let storage: { presignPut: jest.Mock; headObject: jest.Mock; presignGet: jest.Mock };
  let queueAdd: jest.Mock;

  beforeEach(async () => {
    prisma = {
      candidateProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: CANDIDATE_ID }),
        update: jest.fn().mockResolvedValue({
          videoUploadedAt: new Date('2026-08-17T00:00:00Z'),
          videoDurationSec: 92,
          videoSizeBytes: 4_000_000,
        }),
      },
    };
    storage = {
      presignPut: jest.fn().mockResolvedValue({ url: 'https://r2/put', expiresInSeconds: 300 }),
      headObject: jest.fn().mockResolvedValue({ sizeBytes: 4_000_000, contentType: 'video/mp4' }),
      presignGet: jest.fn().mockResolvedValue('https://r2/get'),
    };
    queueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        {
          provide: SettingsService,
          useValue: {
            get: jest.fn((def: { key: string }) =>
              Promise.resolve(def.key === SETTING_KEYS.VIDEO_MAX_MB.key ? MAX_MB : MAX_MINUTES),
            ),
          },
        },
        { provide: `BullQueue_${QUEUE_NAMES.R2_DELETE}`, useValue: { add: queueAdd } },
      ],
    }).compile();

    service = moduleRef.get(VideoService);
  });

  const presignDto = {
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 4_000_000,
    durationSec: 92,
  };

  describe('limits come from Settings, not from constants', () => {
    it('reports the configured ceilings', async () => {
      // The UI renders these numbers, so if they came from a hardcoded copy the
      // screen would keep advertising 5 minutes after an admin changed it.
      await expect(service.limits()).resolves.toEqual({
        maxMb: MAX_MB,
        maxBytes: MAX_MB * 1024 * 1024,
        maxDurationSec: MAX_MINUTES * 60,
      });
    });
  });

  describe('presign — fails BEFORE the candidate spends their data', () => {
    it('accepts a clip within both limits', async () => {
      const out = await service.presign(USER_ID, presignDto);
      expect(out.key.startsWith(`candidates/${CANDIDATE_ID}/video/`)).toBe(true);
      expect(storage.presignPut).toHaveBeenCalledWith(
        expect.objectContaining({ maxBytes: MAX_MB * 1024 * 1024 }),
      );
    });

    it('rejects a file over the size ceiling', async () => {
      await expect(
        service.presign(USER_ID, { ...presignDto, sizeBytes: 11 * 1024 * 1024 }),
      ).rejects.toThrow(UnprocessableEntityException);
      // Nothing was signed — the upload never starts.
      expect(storage.presignPut).not.toHaveBeenCalled();
    });

    it('rejects a clip longer than the limit', async () => {
      await expect(service.presign(USER_ID, { ...presignDto, durationSec: 121 })).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(storage.presignPut).not.toHaveBeenCalled();
    });

    it('rejects a format no employer could play', async () => {
      await expect(
        service.presign(USER_ID, { ...presignDto, mimeType: 'application/zip' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('sanitises the filename so it cannot escape the candidate prefix', async () => {
      const out = await service.presign(USER_ID, { ...presignDto, fileName: '../../etc/pa ss.mp4' });

      /*
        The guarantee is about SEPARATORS, not about dots. Dots survive (a file
        needs an extension), but every slash and space becomes an underscore, so
        the supplied name contributes exactly one path segment. `..` with no
        slash after it is inert in an object key, and the prefix the confirm
        step checks ownership against therefore still holds.
      */
      const suffix = out.key.slice(`candidates/${CANDIDATE_ID}/video/`.length);
      expect(suffix).not.toContain('/');
      expect(suffix).not.toContain(' ');
      expect(out.key.startsWith(`candidates/${CANDIDATE_ID}/video/`)).toBe(true);
      // Exactly four segments — nothing nested itself deeper.
      expect(out.key.split('/')).toHaveLength(4);
    });
  });

  describe('confirm — the checks that actually hold', () => {
    it('re-reads the REAL size from the object and rejects an oversized upload', async () => {
      // The declared size passed at presign; the stored object is what counts.
      storage.headObject.mockResolvedValue({
        sizeBytes: 40 * 1024 * 1024,
        contentType: 'video/mp4',
      });
      await expect(service.confirm(USER_ID, { key: KEY, durationSec: 92 })).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(prisma.candidateProfile.update).not.toHaveBeenCalled();
    });

    it('refuses a key belonging to another candidate', async () => {
      await expect(
        service.confirm(USER_ID, { key: 'candidates/someone-else/video/x.mp4', durationSec: 10 }),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.headObject).not.toHaveBeenCalled();
    });

    it('refuses when the PUT never landed', async () => {
      storage.headObject.mockResolvedValue(null);
      await expect(service.confirm(USER_ID, { key: KEY, durationSec: 92 })).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('stores the object size, not the declared one, and rounds the duration', async () => {
      await service.confirm(USER_ID, { key: KEY, durationSec: 92.7 });
      expect(prisma.candidateProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            videoR2Key: KEY,
            videoDurationSec: 93,
            videoSizeBytes: 4_000_000,
          }),
        }),
      );
    });

    it('queues the REPLACED object for deletion, with a colon-free jobId', async () => {
      const old = `candidates/${CANDIDATE_ID}/video/old.mp4`;
      prisma.candidateProfile.findUnique
        .mockResolvedValueOnce({ id: CANDIDATE_ID }) // candidateIdFor
        .mockResolvedValueOnce({ videoR2Key: old }); // existing

      await service.confirm(USER_ID, { key: KEY, durationSec: 92 });

      expect(queueAdd).toHaveBeenCalledTimes(1);
      const jobId = queueAdd.mock.calls[0]![2].jobId as string;
      // BullMQ 5 rejects a custom id containing ':' at runtime, and a stubbed
      // queue would happily accept one — so assert it here.
      expect(jobId).not.toContain(':');
      expect(jobId).toContain(old);
    });

    it('does NOT queue a delete when the key is unchanged', async () => {
      prisma.candidateProfile.findUnique
        .mockResolvedValueOnce({ id: CANDIDATE_ID })
        .mockResolvedValueOnce({ videoR2Key: KEY });

      await service.confirm(USER_ID, { key: KEY, durationSec: 92 });
      expect(queueAdd).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('clears every column and queues the object for deletion', async () => {
      prisma.candidateProfile.findUnique
        .mockResolvedValueOnce({ id: CANDIDATE_ID })
        .mockResolvedValueOnce({ videoR2Key: KEY });

      await expect(service.remove(USER_ID)).resolves.toEqual({
        hasVideo: false,
        uploadedAt: null,
        durationSec: null,
        sizeBytes: null,
      });
      expect(prisma.candidateProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            videoR2Key: null,
            videoDurationSec: null,
            videoSizeBytes: null,
            videoUploadedAt: null,
          },
        }),
      );
      expect(queueAdd).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — removing nothing succeeds and touches nothing', async () => {
      prisma.candidateProfile.findUnique
        .mockResolvedValueOnce({ id: CANDIDATE_ID })
        .mockResolvedValueOnce({ videoR2Key: null });

      await expect(service.remove(USER_ID)).resolves.toMatchObject({ hasVideo: false });
      expect(prisma.candidateProfile.update).not.toHaveBeenCalled();
      expect(queueAdd).not.toHaveBeenCalled();
    });
  });

  describe('playbackUrl', () => {
    it('signs the stored key with a short expiry', async () => {
      prisma.candidateProfile.findUnique
        .mockResolvedValueOnce({ id: CANDIDATE_ID })
        .mockResolvedValueOnce({ videoR2Key: KEY });

      const out = await service.playbackUrl(USER_ID);
      expect(out.url).toBe('https://r2/get');
      // A video of someone's face must never sit behind a long-lived url.
      expect(out.expiresInSeconds).toBeLessThanOrEqual(600);
      expect(storage.presignGet).toHaveBeenCalledWith(KEY, out.expiresInSeconds);
    });

    it('404s when there is no video rather than signing nothing', async () => {
      prisma.candidateProfile.findUnique
        .mockResolvedValueOnce({ id: CANDIDATE_ID })
        .mockResolvedValueOnce({ videoR2Key: null });

      await expect(service.playbackUrl(USER_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
