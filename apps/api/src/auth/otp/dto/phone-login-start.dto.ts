import { IsPhoneNumber } from 'class-validator';

export class PhoneLoginStartDto {
  @IsPhoneNumber()
  phone!: string;
}
