import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectCompanyDto {
  @IsString()
  @IsNotEmpty({ message: 'Rejection reason is required' })
  @MaxLength(1000)
  reason!: string;
}
