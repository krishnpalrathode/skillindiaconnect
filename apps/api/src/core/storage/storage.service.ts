import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PRESIGN_EXPIRY_SECONDS = 300;

@Injectable()
export class StorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(configService: ConfigService) {
    // R2 credentials are optional at boot (see env.schema.ts) so an environment
    // without object storage can still start. When they are absent we build NO
    // client: an S3Client with undefined credentials constructs happily and then
    // fails deep inside the AWS SDK with an opaque message, which is far harder
    // to diagnose than an explicit error at the call site.
    const endpoint = configService.get<string>('R2_ENDPOINT');
    const accessKeyId = configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = configService.get<string>('R2_SECRET_ACCESS_KEY');
    const bucket = configService.get<string>('R2_BUCKET');

    this.bucket = bucket ?? '';
    this.client =
      endpoint && accessKeyId && secretAccessKey && bucket
        ? new S3Client({
            endpoint,
            region: configService.get<string>('R2_REGION') ?? 'auto',
            forcePathStyle: true,
            credentials: { accessKeyId, secretAccessKey },
          })
        : null;
  }

  /** False when R2 is unconfigured — every storage operation will refuse. */
  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Narrows `client` to non-null for the operations below and gives operators an
   * actionable message instead of an AWS credentials stack trace.
   */
  private requireClient(): S3Client {
    if (!this.client) {
      throw new Error(
        'STORAGE_NOT_CONFIGURED: object storage is unavailable because R2_ENDPOINT, ' +
          'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are not all set. ' +
          'Document upload, resume storage and company certificates cannot work until they are.',
      );
    }
    return this.client;
  }

  /**
   * Generate a presigned PUT URL for direct client upload.
   * ContentLength enforcement on presigned PUTs is not universally supported by
   * R2 — the real size gate is in the confirm step (HEAD check), not here.
   */
  async presignPut(params: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<{ url: string; expiresInSeconds: number }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
    });
    const url = await getSignedUrl(this.requireClient(), command, {
      expiresIn: PRESIGN_EXPIRY_SECONDS,
    });
    return { url, expiresInSeconds: PRESIGN_EXPIRY_SECONDS };
  }

  /** Generate a presigned GET URL for reading an object (e.g. logo download). */
  async presignGet(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.requireClient(), command, { expiresIn });
  }

  /**
   * S7-B1: server-side upload (the PDF render pipeline — the WORKER writes the
   * rendered bytes itself; there is no client to presign for).
   */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.requireClient().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * S7-B1: server-side read (embedding the profile photo as a data URI at
   * render time — the template must never make Chromium fetch a live URL).
   */
  async getObjectBuffer(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const response = await this.requireClient().send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await response.Body?.transformToByteArray();
      if (!bytes) return null;
      return {
        body: Buffer.from(bytes),
        contentType: response.ContentType ?? 'application/octet-stream',
      };
    } catch (err: unknown) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async headObject(key: string): Promise<{ sizeBytes: number; contentType: string } | null> {
    try {
      const response = await this.requireClient().send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        sizeBytes: response.ContentLength ?? 0,
        contentType: response.ContentType ?? '',
      };
    } catch (err: unknown) {
      const e = err as { name?: string; $httpStatusCode?: number };
      if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /** Exposed for the purge worker — not called in request paths. */
  async deleteObject(key: string): Promise<void> {
    await this.requireClient().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Batch delete (S6b-B1 purge worker). Chunks at the S3 API's 1000-key limit.
   * THROWS if the provider reports any per-key failure — the caller (a BullMQ
   * job) relies on that throw to retry; a swallowed error here would leave a
   * passport scan in the bucket while the DB claims erasure. Error messages
   * carry counts, never keys.
   */
  async deleteObjects(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      const result = await this.requireClient().send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (result.Errors && result.Errors.length > 0) {
        throw new Error(`R2 batch delete failed for ${result.Errors.length} object(s)`);
      }
    }
  }
}
