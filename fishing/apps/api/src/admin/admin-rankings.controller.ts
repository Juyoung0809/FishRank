import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminAuth } from '../common/decorators/auth.decorator';
import { ok } from '../common/http/api-response';
import { AdminRankingsService } from './admin-rankings.service';
import { UpdateCatchRankingDto } from './dto/update-catch-ranking.dto';

@ApiTags('관리자')
@Controller('admin')
@AdminAuth()
export class AdminRankingsController {
  constructor(private rankings: AdminRankingsService) {}

  @Get('rankings')
  @ApiOperation({ summary: '랭킹 운영 목록' })
  @ApiQuery({
    name: 'periodType',
    required: false,
    enum: ['weekly', 'alltime'],
  })
  @ApiQuery({
    name: 'rankingType',
    required: false,
    enum: ['official', 'unofficial'],
  })
  @ApiQuery({ name: 'speciesId', required: false })
  async listRankings(
    @Query('periodType') periodType = 'alltime',
    @Query('rankingType') rankingType: 'official' | 'unofficial' = 'official',
    @Query('speciesId') speciesId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '30',
  ) {
    return ok(
      await this.rankings.listRankings(
        periodType,
        rankingType,
        speciesId ? Number(speciesId) : undefined,
        Number(page) || 1,
        Number(limit) || 30,
      ),
    );
  }

  @Patch('catches/:id/ranking')
  @ApiOperation({ summary: '랭킹 점수·상태 수동 조정' })
  async updateRanking(
    @Param('id') id: string,
    @Body() dto: UpdateCatchRankingDto,
  ) {
    return ok(await this.rankings.updateRanking(id, dto));
  }
}
