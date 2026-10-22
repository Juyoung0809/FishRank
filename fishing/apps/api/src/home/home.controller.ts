import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../common/http/api-response';
import { HomeService } from './home.service';

@ApiTags('홈')
@Controller('home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  @ApiOperation({ summary: '메인 홈 — 랭킹·대회·게시글·공지 일괄 조회' })
  async getHome() {
    return ok(await this.home.getHomePayload());
  }
}
