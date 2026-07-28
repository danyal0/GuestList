import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

const PASSWORD_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter, a lowercase letter and a number';
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

export class SignupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(({ value }) => String(value).trim())
  name!: string;

  /** Digits or formatted phone — normalized server-side. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Transform(({ value }) => String(value).trim())
  phone!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  password!: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @Transform(({ value }) =>
    value == null || String(value).trim() === ''
      ? undefined
      : String(value).toLowerCase().trim(),
  )
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

export class LoginDto {
  /**
   * Phone (preferred) or email for existing accounts.
   * Accepts either; resolved server-side.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @Transform(({ value }) => String(value).trim())
  identifier!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class RefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @Transform(({ value }) => String(value).toLowerCase().trim())
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  password!: string;
}

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class GoogleOAuthDto {
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}

export class AppleOAuthDto {
  @IsString()
  @IsNotEmpty()
  identityToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  newPassword!: string;
}

export class ClaimNamedProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Transform(({ value }) => String(value).trim())
  placeholderUserId!: string;
}
