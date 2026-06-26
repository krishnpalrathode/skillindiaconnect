import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ConfirmDocumentDto {
  @IsString()
  key!: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
