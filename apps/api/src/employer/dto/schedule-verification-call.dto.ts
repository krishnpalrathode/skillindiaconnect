import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/** Mirrors the column width on `verification_call_requests.note`. */
export const CALL_NOTE_MAX_LENGTH = 500;

export class ScheduleVerificationCallDto {
  /**
   * The proposed start, as an ISO-8601 instant.
   *
   * An INSTANT, not a local date + time string: the employer picks a moment in
   * their own timezone and the admin reads it in theirs, so the only value that
   * survives that trip unambiguously is one carrying an offset. The browser
   * sends `toISOString()`; the service range-checks it and the column stores
   * UTC like every other timestamp here.
   */
  @IsISO8601()
  slotAt!: string;

  /** Free text — a phone number, "after 6pm", a language preference. */
  @IsOptional()
  @IsString()
  @MaxLength(CALL_NOTE_MAX_LENGTH)
  note?: string;
}
