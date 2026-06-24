import { IsPhoneNumber, IsString, Matches } from 'class-validator';

export class PhoneLoginVerifyDto {
  @IsPhoneNumber()
  phone!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp!: string;
}
