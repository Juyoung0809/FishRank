import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ok } from '../common/http/api-response';
import { MarineConditionsService } from './marine-conditions.service';
import { ReservoirConditionsService } from './reservoir-conditions.service';
import { FishingBanService } from './fishing-ban.service';
import { optionalNumber, requireLatLng } from './weather-query.util';

/** 바다낚시지수·조석, 민물 저수지 수위, 낚시 금지구역 (경로는 /weather/* 그대로) */
@ApiTags('날씨')
@Controller('weather')
export class FishingConditionsController {
  constructor(
    private marineConditions: MarineConditionsService,
    private reservoirs: ReservoirConditionsService,
    private fishingBan: FishingBanService,
  ) {}

  @Get('fishing-index')
  @Header('Cache-Control', 'public, max-age=900')
  @ApiOperation({ summary: 'KHOA 바다낚시지수 (15142486)' })
  @ApiQuery({
    name: 'gubun',
    required: false,
    example: '갯바위',
    description: '갯바위 | 선상',
  })
  @ApiQuery({ name: 'placeName', required: false, example: '해운대' })
  @ApiQuery({ name: 'lat', required: false })
  @ApiQuery({ name: 'lng', required: false })
  async getFishingIndex(
    @Query('gubun') gubun?: string,
    @Query('placeName') placeName?: string,
    @Query('lat') latStr?: string,
    @Query('lng') lngStr?: string,
  ) {
    return ok(
      await this.marineConditions.getFishingIndex({
        gubun: gubun === '선상' ? '선상' : '갯바위',
        placeName,
        lat: optionalNumber(latStr),
        lng: optionalNumber(lngStr),
      }),
    );
  }

  @Get('tide-forecast')
  @Header('Cache-Control', 'public, max-age=900')
  @ApiOperation({ summary: 'KHOA 조석예보 시계열 (15156022)' })
  @ApiQuery({ name: 'lat', required: false, example: 35.1588 })
  @ApiQuery({ name: 'lng', required: false, example: 129.1603 })
  @ApiQuery({ name: 'obsCode', required: false, example: 'DT_0018' })
  async getTideForecast(
    @Query('lat') latStr?: string,
    @Query('lng') lngStr?: string,
    @Query('obsCode') obsCode?: string,
  ) {
    return ok(
      await this.marineConditions.getTideForecast({
        lat: optionalNumber(latStr),
        lng: optionalNumber(lngStr),
        obsCode,
      }),
    );
  }

  @Get('reservoirs/search')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: '저수지 검색 (15099919)' })
  @ApiQuery({ name: 'q', required: true, example: '충주' })
  async searchReservoirs(@Query('q') q: string) {
    if (!q?.trim()) throw new BadRequestException('q 파라미터가 필요합니다');
    return ok(await this.reservoirs.search(q.trim()));
  }

  @Get('reservoirs/near')
  @Header('Cache-Control', 'public, max-age=1800')
  @ApiOperation({ summary: '좌표 기준 근처 민물 저수지 수위' })
  @ApiQuery({ name: 'lat', required: true, example: 36.971 })
  @ApiQuery({ name: 'lng', required: true, example: 127.933 })
  async getReservoirNearby(
    @Query('lat') latStr: string,
    @Query('lng') lngStr: string,
  ) {
    const { lat, lng } = requireLatLng(latStr, lngStr);
    return ok(await this.reservoirs.getNearby(lat, lng));
  }

  @Get('reservoirs/area')
  @Header('Cache-Control', 'public, max-age=1800')
  @ApiOperation({ summary: '좌표 기준 근처 저수지 목록 (지도·표용)' })
  @ApiQuery({ name: 'lat', required: true, example: 36.971 })
  @ApiQuery({ name: 'lng', required: true, example: 127.933 })
  @ApiQuery({
    name: 'q',
    required: false,
    example: '구미',
    description: '시·군·구 검색어 (미입력 시 좌표 역지오코딩)',
  })
  async getReservoirsInArea(
    @Query('lat') latStr: string,
    @Query('lng') lngStr: string,
    @Query('q') q?: string,
  ) {
    const { lat, lng } = requireLatLng(latStr, lngStr);
    return ok(await this.reservoirs.getInArea(lat, lng, q));
  }

  @Get('reservoirs/:facCode/levels')
  @Header('Cache-Control', 'public, max-age=1800')
  @ApiOperation({ summary: '저수지 수위·저수율 (15099919)' })
  @ApiQuery({ name: 'dateStart', required: false, example: '20260701' })
  @ApiQuery({ name: 'dateEnd', required: false, example: '20260709' })
  async getReservoirLevels(
    @Param('facCode') facCode: string,
    @Query('dateStart') dateStart?: string,
    @Query('dateEnd') dateEnd?: string,
  ) {
    return ok(await this.reservoirs.getLevels(facCode, dateStart, dateEnd));
  }

  @Get('fishing-bans')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: '인근 낚시금지·제한·보호구역 (공개 지정구역)' })
  @ApiQuery({ name: 'lat', required: true, example: 37.5 })
  @ApiQuery({ name: 'lng', required: true, example: 127.3 })
  @ApiQuery({ name: 'radiusKm', required: false, example: 80 })
  async getFishingBans(
    @Query('lat') latStr: string,
    @Query('lng') lngStr: string,
    @Query('radiusKm') radiusKmStr?: string,
  ) {
    const { lat, lng } = requireLatLng(
      latStr,
      lngStr,
      '한국 지역 좌표만 지원합니다',
    );
    const radiusKm = radiusKmStr != null ? Number(radiusKmStr) : 80;
    const clampedKm = Number.isFinite(radiusKm)
      ? Math.min(Math.max(radiusKm, 10), 200)
      : 80;
    return ok(await this.fishingBan.getNearby(lat, lng, clampedKm));
  }
}
