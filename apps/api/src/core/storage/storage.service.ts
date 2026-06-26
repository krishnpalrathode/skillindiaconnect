import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
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
      region: 'auto',
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

  /** Exposed for the future purge worker — not called in request paths. */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
