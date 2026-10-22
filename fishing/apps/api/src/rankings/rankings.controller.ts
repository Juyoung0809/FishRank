import { Controller, Get, Query, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ok } from '../common/http/api-response';
import { RankingsService, type RankingType } from './rankings.service';
import { RegionalRankingsService } from './regional-rankings.service';
import { RankingOvertakesService } from './ranking-overtakes.service';

const parseRankingType = (value?: string): RankingType =>
  value === 'unofficial' ? 'unofficial' : 'official';
const parsePeriod = (value?: string) =>
  value === 'alltime' ? 'alltime' : 'weekly';
const parseLevel = (value?: string) => (value === 'sig' ? 'sig' : 'sido');
const parseSpeciesId = (value?: string) => (value ? Number(value) : undefined);

@ApiTags('랭킹')
@Controller('rankings')
export class RankingsController {
  constructor(
    private rankingsService: RankingsService,
    private regional: RegionalRankingsService,
    private overtakes: RankingOvertakesService,
  ) {}

  @Get('regional')
  @ApiOperation({ summary: '지역별 낚시왕 목록 (지도용)' })
  @ApiQuery({
    name: 'periodType',
    required: false,
    enum: ['weekly', 'alltime'],
  })
  @ApiQuery({ name: 'level', required: false, enum: ['sido', 'sig'] })
  @ApiQuery({ name: 'speciesId', required: false, type: Number })
  @ApiQuery({
    name: 'rankingType',
    required: false,
    enum: ['official', 'unofficial'],
  })
  async getRegionalKings(
    @Query('periodType') periodType?: string,
    @Query('level') level?: string,
    @Query('speciesId') speciesId?: string,
    @Query('rankingType') rankingType?: string,
  ) {
    const period = parsePeriod(periodType);
    const regionLevel = parseLevel(level);
    const type = parseRankingType(rankingType);
    const regions = await this.regional.getKings(
      regionLevel,
      period,
      parseSpeciesId(speciesId),
      type,
    );
    return ok({
      periodType: period,
      level: regionLevel,
      rankingType: type,
      regions,
    });
  }

  @Get('regional/detail')
  @ApiOperation({ summary: '선택 지역 랭킹 상세' })
  @ApiQuery({ name: 'regionKey', required: true, type: String })
  @ApiQuery({
    name: 'periodType',
    required: false,
    enum: ['weekly', 'alltime'],
  })
  @ApiQuery({ name: 'level', required: false, enum: ['sido', 'sig'] })
  @ApiQuery({ name: 'speciesId', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'rankingType',
    required: false,
    enum: ['official', 'unofficial'],
  })
  async getRegionalDetail(
    @Query('regionKey') regionKey: string,
    @Query('periodType') periodType?: string,
    @Query('level') level?: string,
    @Query('speciesId') speciesId?: string,
    @Query('limit') limit = 20,
    @Query('rankingType') rankingType?: string,
  ) {
    const type = parseRankingType(rankingType);
    const data = await this.regional.getRankings(
      regionKey,
      parseLevel(level),
      parsePeriod(periodType),
      parseSpeciesId(speciesId),
      Number(limit),
      type,
    );
    return ok({ ...data, rankingType: type });
  }

  @Get('overtakes')
  @ApiOperation({ summary: '상위권 추월 피드' })
  @ApiQuery({
    name: 'periodType',
    required: false,
    enum: ['weekly', 'alltime'],
  })
  @ApiQuery({ name: 'speciesId', required: false, type: Number })
  @ApiQuery({ name: 'topN', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getOvertakes(
    @Query('periodType') periodType?: string,
    @Query('speciesId') speciesId?: string,
    @Query('topN') topN = 10,
    @Query('limit') limit = 8,
  ) {
    const period = parsePeriod(periodType);
    const overtakes = await this.overtakes.getTopOvertakes(
      period,
      parseSpeciesId(speciesId),
      Number(topN),
      Number(limit),
    );
    return ok({ periodType: period, topN: Number(topN), overtakes });
  }

  @Get('brag-feed')
  @ApiOperation({ summary: '자랑 랭킹 — 새 글 평가용 피드' })
  @ApiQuery({
    name: 'periodType',
    required: false,
    enum: ['weekly', 'alltime'],
  })
  @ApiQuery({ name: 'speciesId', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getBragFeed(
    @Query('periodType') periodType?: string,
    @Query('speciesId') speciesId?: string,
    @Query('limit') limit = 50,
  ) {
    const period = parsePeriod(periodType);
    const feed = await this.rankingsService.getBragFeed(
      parseSpeciesId(speciesId),
      period,
      undefined,
      Number(limit) || 50,
    );
    return ok({ periodType: period, feed });
  }

  @Get('home-species')
  @ApiOperation({ summary: '메인 홈 — 인기 어종·1위 어종' })
  async getHomeSpecies() {
    return ok(await this.rankingsService.getWeeklySpeciesSpotlight());
  }

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: '랭킹 목록 조회' })
  @ApiQuery({
    name: 'periodType',
    required: false,
    enum: ['weekly', 'alltime'],
  })
  @ApiQuery({ name: 'speciesId', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'rankingType',
    required: false,
    enum: ['official', 'unofficial'],
  })
  async getRankings(
    @Query('periodType') periodType: string = 'weekly',
    @Query('speciesId') speciesId?: string,
    @Query('limit') limit = 10,
    @Query('rankingType') rankingType?: string,
  ) {
    const sid = parseSpeciesId(speciesId);
    const lim = Number(limit);
    const type = parseRankingType(rankingType);
    const period = parsePeriod(periodType);

    const rankings =
      period === 'alltime'
        ? await this.rankingsService.getTopRankings(sid, lim, type)
        : await this.rankingsService.getWeeklyRankings(sid, lim, type);
    const highlight =
      type === 'official'
        ? await this.rankingsService.getTodayHighlight(
            sid,
            period,
            Math.min(lim, 20),
          )
        : null;

    return ok({ periodType, rankingType: type, rankings, highlight });
  }
}
