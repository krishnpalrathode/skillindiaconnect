import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyDto {
  /** Optional cover letter, capped at 500 chars (frozen S4-0 contract). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverLetter?: string;
}
