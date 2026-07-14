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
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(configService: ConfigService) {
    this.client = new S3Client({
      endpoint: configService.get<string>('R2_ENDPOINT')!,
      region: configService.get<string>('R2_REGION') ?? 'auto',
      forcePathStyle: true,
      credentials: {
        accessKeyId: configService.get<string>('R2_ACCESS_KEY_ID')!,
        secretAccessKey: configService.get<string>('R2_SECRET_ACCESS_KEY')!,
      },
    });
    this.bucket = configService.get<string>('R2_BUCKET')!;
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
    const url = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGN_EXPIRY_SECONDS,
    });
    return { url, expiresInSeconds: PRESIGN_EXPIRY_SECONDS };
  }

  /** Generate a presigned GET URL for reading an object (e.g. logo download). */
  async presignGet(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async headObject(key: string): Promise<{ sizeBytes: number; contentType: string } | null> {
    try {
      const response = await this.client.send(
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
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
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
      const result = await this.client.send(
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
