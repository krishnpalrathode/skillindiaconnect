import { IsInt, IsString, Max, Min } from 'class-validator';

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
  @Max(5 * 1024 * 1024) // 5 MB hard ceiling
  sizeBytes!: number;
}
