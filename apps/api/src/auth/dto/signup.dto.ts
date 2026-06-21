import { IsEmail, IsString, MinLength, Matches, IsEnum, IsBoolean, Equals } from 'class-validator';
import { Transform } from 'class-transformer';

export class SignupDto {
  @IsEmail()
  @Transform(({ value }: { value: string }) => value.toLowerCase().trim())
  email!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'password must contain uppercase, lowercase, and a digit',
  })
  password!: string;

  // Admins are never self-signup — allow-list is CANDIDATE and EMPLOYER only.
  @IsEnum(['CANDIDATE', 'EMPLOYER'], { message: 'role must be CANDIDATE or EMPLOYER' })
  role!: 'CANDIDATE' | 'EMPLOYER';

  @IsBoolean()
  @Equals(true, { message: 'acceptedTerms must be true' })
  acceptedTerms!: boolean;
}
