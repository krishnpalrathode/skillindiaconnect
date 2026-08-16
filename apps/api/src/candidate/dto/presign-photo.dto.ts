import { IsInt, IsString, Max, Min } from 'class-validator';
import { MAX_UPLOAD_BYTES } from '../../core/uploads';

/**
 * Profile-photo presign request. Mirrors PresignDocumentDto but for the single
 * avatar image. The declared mime/size are a first-line check; the real gate is
 * the HEAD re-validation in confirm() (a client can lie about both).
 */
export class PresignPhotoDto {
  @IsString()
  fileName!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_BYTES)
  sizeBytes!: number;
}
