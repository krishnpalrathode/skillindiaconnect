import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** Cap on one outreach batch — each entry is a paid WhatsApp conversation. */
export const NOTIFY_INTEREST_MAX_BATCH = 50;

export class NotifyInterestDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(NOTIFY_INTEREST_MAX_BATCH)
  @IsUUID('4', { each: true })
  candidateIds!: string[];
}
