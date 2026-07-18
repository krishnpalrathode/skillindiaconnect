import { IsString } from 'class-validator';

export class ConfirmLogoDto {
  @IsString()
  key!: string;
}
