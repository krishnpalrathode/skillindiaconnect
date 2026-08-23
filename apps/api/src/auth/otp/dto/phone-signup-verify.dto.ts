import { IsPhoneNumber, IsString, Length, IsBoolean, Equals } from 'class-validator';

/**
 * Complete phone signup. This is the request that creates the account, so it
 * is where terms acceptance is captured — `termsAcceptedAt` then dates the
 * agreement to the moment the account came into existence, exactly as it does
 * on the email signup path.
 *
 * Role is not a field. Phone signup is candidates only: employers sign up with
 * a work email, and admins are never self-signup.
 */
export class PhoneSignupVerifyDto {
  @IsPhoneNumber()
  phone!: string;

  @IsString()
  @Length(6, 6, { message: 'otp must be exactly 6 digits' })
  otp!: string;

  @IsBoolean()
  @Equals(true, { message: 'acceptedTerms must be true' })
  acceptedTerms!: boolean;
}
