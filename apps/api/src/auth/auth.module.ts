import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { OAuthService } from './oauth.service';

@Module({
  imports: [
    // Registered globally so the app-wide JwtAuthGuard can inject JwtService.
    JwtModule.register({ global: true }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, OAuthService],
  exports: [TokenService],
})
export class AuthModule {}
