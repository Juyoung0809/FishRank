import { Body, Controller, Post, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ok } from '../common/http/api-response';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
@ApiTags('인증')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: '이메일 회원가입' })
  async register(@Body() dto: RegisterDto) {
    return ok(await this.authService.register(dto));
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '이메일 로그인' })
  async login(@Body() dto: LoginDto) {
    return ok(await this.authService.login(dto));
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: '액세스 토큰 갱신' })
  async refresh(@Body() dto: RefreshDto) {
    return ok(await this.authService.refresh(dto.refreshToken));
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: '리프레시 토큰 폐기' })
  async logout(@Body() dto: RefreshDto) {
    await this.authService.logout(dto.refreshToken);
    return { success: true };
  }
}
