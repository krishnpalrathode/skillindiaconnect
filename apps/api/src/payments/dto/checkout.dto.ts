import { IsString, Length } from 'class-validator';

/**
 * The checkout request — `{ planCode }` and NOTHING else. The ABSENCE of
 * gateway/amount/currency fields is the design: money is server-derived and
 * routing is sealed server-side. The controller applies a route-level
 * ValidationPipe with `forbidNonWhitelisted: true`, so a smuggled `gateway`
 * or `amount` field is actively REJECTED (400), not silently stripped —
 * the DTO whitelist is a security control here.
 */
export class CheckoutDto {
  @IsString()
  @Length(1, 50)
  planCode!: string;
}
