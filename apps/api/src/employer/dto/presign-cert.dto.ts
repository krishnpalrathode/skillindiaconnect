import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import { MAX_UPLOAD_BYTES } from '../../core/uploads';

const ACCEPTED_CERT_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
/** Re-exported for callers that still import it; the value is the shared ceiling. */
export const CERT_MAX_BYTES = MAX_UPLOAD_BYTES;

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
