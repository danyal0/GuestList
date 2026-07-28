import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { AuthService, AuthResult, PublicUser } from './auth.service';
import {
  AppleOAuthDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  GoogleOAuthDto,
  LoginDto,
  RefreshDto,
  ResetPasswordDto,
  SignupDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user';
import { ACCESS_COOKIE } from '../common/guards/jwt-auth.guard';
import { CSRF_COOKIE } from '../common/guards/csrf.guard';

const REFRESH_COOKIE = 'mkeplays_refresh';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

interface AuthResponse {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signup')
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.signup(dto.email, dto.password, dto.name, this.meta(req));
    return this.respondWithAuth(res, result);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.login(dto.email, dto.password, this.meta(req));
    return this.respondWithAuth(res, result);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('oauth/google')
  async googleOAuth(
    @Body() dto: GoogleOAuthDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.loginWithGoogle(dto.idToken, this.meta(req));
    return this.respondWithAuth(res, result);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('oauth/apple')
  async appleOAuth(
    @Body() dto: AppleOAuthDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.loginWithApple(dto.identityToken, dto.name, this.meta(req));
    return this.respondWithAuth(res, result);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const token = dto.refreshToken ?? (req.cookies ?? {})[REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const result = await this.authService.refresh(token, this.meta(req));
    return this.respondWithAuth(res, result);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user?: AuthUser,
  ): Promise<{ success: boolean }> {
    const token = dto.refreshToken ?? (req.cookies ?? {})[REFRESH_COOKIE];
    await this.authService.logout(token, user?.id);
    this.clearAuthCookies(res);
    return { success: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ success: boolean }> {
    await this.authService.forgotPassword(dto.email);
    return { success: true };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ success: boolean }> {
    await this.authService.resetPassword(dto.token, dto.password);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ success: boolean }> {
    await this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
    return { success: true };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ success: boolean }> {
    await this.authService.verifyEmail(dto.token);
    return { success: true };
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  async resendVerification(@CurrentUser() user: AuthUser): Promise<{ success: boolean }> {
    await this.authService.resendVerification(user.id);
    return { success: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.authService.getMe(user.id);
  }

  private respondWithAuth(res: Response, result: AuthResult): AuthResponse {
    const secure = this.config.get<boolean>('cookies.secure') ?? false;
    const domain = this.config.get<string | undefined>('cookies.domain');
    const csrfToken = randomBytes(24).toString('base64url');

    res.cookie(ACCESS_COOKIE, result.tokens.accessToken, {
      httpOnly: true,
      secure,
      domain,
      sameSite: 'lax',
      maxAge: result.tokens.accessExpiresIn * 1000,
      path: '/',
    });
    res.cookie(REFRESH_COOKIE, result.tokens.refreshToken, {
      httpOnly: true,
      secure,
      domain,
      sameSite: 'lax',
      maxAge: result.tokens.refreshExpiresIn * 1000,
      path: REFRESH_COOKIE_PATH,
    });
    // Readable by JS on purpose — double-submit CSRF pattern.
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      secure,
      domain,
      sameSite: 'lax',
      maxAge: result.tokens.refreshExpiresIn * 1000,
      path: '/',
    });

    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresIn: result.tokens.accessExpiresIn,
    };
  }

  private clearAuthCookies(res: Response): void {
    const domain = this.config.get<string | undefined>('cookies.domain');
    res.clearCookie(ACCESS_COOKIE, { path: '/', domain });
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, domain });
    res.clearCookie(CSRF_COOKIE, { path: '/', domain });
  }

  private meta(req: Request): { userAgent?: string; ip?: string } {
    return { userAgent: req.headers['user-agent'], ip: req.ip };
  }
}
