import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmCertDto {
  @IsString()
  @IsNotEmpty()
  key!: string;
}
