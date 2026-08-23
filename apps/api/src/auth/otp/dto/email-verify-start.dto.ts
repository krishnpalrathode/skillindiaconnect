import { IsEmail, MaxLength } from 'class-validator';

/**
 * Start email verification for the SIGNED-IN candidate.
 *
 * The address is supplied here rather than read from the account because the
 * account may not have one yet — that is the whole point of the phone-signup
 * path. It is only written to `users.email` once the code comes back verified.
 */
export class EmailVerifyStartDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
