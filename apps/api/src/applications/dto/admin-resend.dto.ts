import { IsString, Length } from 'class-validator';

export class ResendWhatsappDto {
  /**
   * MANDATORY — consistent with every other admin corrective action (reject,
   * suspend, override, purge). A worker's phone is not a debugging tool; the
   * reason goes to the audit row (never the phone number).
   */
  @IsString()
  @Length(1, 500)
  reason!: string;
}
