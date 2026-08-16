import { IsInt, IsString, Max, Min } from 'class-validator';
import { MAX_UPLOAD_BYTES } from '../../core/uploads';

export class PresignDocumentDto {
  @IsString()
  type!: string;

  @IsString()
  fileName!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  @Min(1)
  // Outer bound only; DOC_LIMITS is the per-type gate. Both are the same
  // ceiling now, so an oversized request fails at the DTO with a 400.
  @Max(MAX_UPLOAD_BYTES)
  sizeBytes!: number;
}
