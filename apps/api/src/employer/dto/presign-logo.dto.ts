import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import { MAX_UPLOAD_BYTES } from '../../core/uploads';

export const LOGO_MAX_BYTES = MAX_UPLOAD_BYTES;
export const LOGO_ALLOWED_MIMES = ['image/jpeg', 'image/png'] as const;

export class PresignLogoDto {
  @IsString()
  fileName!: string;

  @IsIn(LOGO_ALLOWED_MIMES)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(LOGO_MAX_BYTES)
  sizeBytes!: number;
}
