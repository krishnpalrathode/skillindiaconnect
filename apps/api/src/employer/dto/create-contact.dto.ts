import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * DTO for creating a contact person.
 *
 * Contact persons are DISPLAY-ONLY records — NOT login accounts.
 * Creating a contact does not create a User record. These are human contacts
 * listed on the company profile (e.g., HR Manager, Recruitment Lead) so
 * candidates and admins know who to reach.
 */
export class CreateContactDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  /** Job title / role label — stored as `designation` in the DB. */
  @IsString()
  @MaxLength(100)
  role!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsBoolean()
  isPrimary!: boolean;
}
