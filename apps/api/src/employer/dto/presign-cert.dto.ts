import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

const ACCEPTED_CERT_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const CERT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export class PresignCertDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsIn(ACCEPTED_CERT_MIMES)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(CERT_MAX_BYTES)
  sizeBytes!: number;
}
