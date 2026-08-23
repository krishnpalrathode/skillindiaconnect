import { IsPhoneNumber } from 'class-validator';

/**
 * Begin creating an account whose credential is a phone number.
 *
 * Terms are NOT accepted here — only at the verify step, which is the request
 * that actually creates the account. Recording acceptance against a code send
 * would date the agreement to a moment that may never become an account.
 */
export class PhoneSignupStartDto {
  @IsPhoneNumber()
  phone!: string;
}
