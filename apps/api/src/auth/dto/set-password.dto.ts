import { IsString, MinLength, Matches } from 'class-validator';

/**
 * Set the first password on an account that has none.
 *
 * The rules are copied from SignupDto deliberately rather than shared: a
 * password created here is used at the same login endpoint as one created at
 * signup, so the two must never drift apart in strength.
 *
 * There is no `currentPassword` field. This endpoint only ever runs on an
 * account with `passwordHash: null`, so there is nothing to confirm — the
 * caller's access token is the proof. Changing an EXISTING password is a
 * different operation and goes through reset-password.
 */
export class SetPasswordDto {
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'password must contain uppercase, lowercase, and a digit',
  })
  password!: string;
}
