import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminAuth } from '../common/decorators/auth.decorator';
import { ok } from '../common/http/api-response';
import { AdminCatchesService } from './admin-catches.service';
import { ReviewCatchDto } from './dto/review-catch.dto';
import { ReviewDayCodeDto } from './dto/review-day-code.dto';
import { UpdateCatchRankingDto } from './dto/update-catch-ranking.dto';

@ApiTags('관리자')
@Controller('admin')
@AdminAuth()
export class AdminCatchesController {
  constructor(private catches: AdminCatchesService) {}

  @Get('catches')
  @ApiOperation({ summary: '인증 기록 검수 목록' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async list(
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return ok(
      await this.catches.list(status, Number(page) || 1, Number(limit) || 20),
    );
  }

  @Patch('catches/:id/review')
  @ApiOperation({ summary: '인증 기록 승인/반려' })
  async review(@Param('id') id: string, @Body() dto: ReviewCatchDto) {
    return ok(await this.catches.review(id, dto));
  }

  @Patch('catches/:id/day-code')
  @ApiOperation({
    summary: '대회 일일 코드 수동 확인. 랭킹 상태는 바꾸지 않음',
  })
  async reviewDayCode(@Param('id') id: string, @Body() dto: ReviewDayCodeDto) {
    return ok(await this.catches.reviewDayCode(id, dto.status));
  }

  @Patch('catches/:id/ranking')
  @ApiOperation({ summary: '랭킹 점수·상태 수동 조정' })
  async updateRanking(
    @Param('id') id: string,
    @Body() dto: UpdateCatchRankingDto,
  ) {
    return ok(await this.catches.updateRanking(id, dto));
  }

  @Delete('catches/:id')
  @ApiOperation({ summary: '기록 삭제 (soft delete)' })
  async delete(@Param('id') id: string) {
    return ok(await this.catches.delete(id));
  }

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
      await this.catches.listRankings(
        periodType,
        rankingType,
        speciesId ? Number(speciesId) : undefined,
        Number(page) || 1,
        Number(limit) || 30,
      ),
    );
  }
}
