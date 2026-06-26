import { IsInt, IsString, Max, Min } from 'class-validator';

export class PresignDocumentDto {
  @IsString()
  type!: string;

  @IsString()
  fileName!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(500 * 1024 * 1024)
  sizeBytes!: number;
}
