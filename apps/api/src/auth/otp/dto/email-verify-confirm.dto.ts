import { IsEmail, Length, MaxLength } from 'class-validator';

export class EmailVerifyConfirmDto {
  /**
   * Repeated from the start call, not held in a server session: the challenge is
   * keyed by address, and a mismatch simply fails to find a live challenge.
   */
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Length(6, 6)
  otp!: string;
}
