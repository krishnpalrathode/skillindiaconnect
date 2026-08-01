import { IsString, MinLength, Matches } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  // Identical rules to SignupDto — a reset must not be a way to install a
  // weaker password than signup would have accepted.
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'password must contain uppercase, lowercase, and a digit',
  })
  password!: string;
}
