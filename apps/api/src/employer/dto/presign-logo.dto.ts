import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';

export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
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
