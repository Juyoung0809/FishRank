import {
  Controller,
  Get,
  Query,
  BadRequestException,
  Header,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ok } from '../common/http/api-response';
import { WeatherService } from './weather.service';
import { GeocodeService } from './geocode.service';
import { MarineConditionsService } from './marine-conditions.service';
import { FishingBanService } from './fishing-ban.service';

@ApiTags('날씨')
@Controller('weather')
export class WeatherController {
  constructor(
    private weatherService: WeatherService,
    private geocodeService: GeocodeService,
    private marineConditions: MarineConditionsService,
    private fishingBan: FishingBanService,
  ) {}

  @Get('search')
  @ApiOperation({ summary: '낚시 포인트·지역 검색' })
  @ApiQuery({ name: 'q', required: false, example: '해운대' })
  async searchPlaces(@Query('q') q?: string) {
    const results = q
      ? await this.geocodeService.search(q)
      : this.geocodeService.getPresets();
    return ok(results);
  }

  @Get('presets')
  @ApiOperation({ summary: '추천 낚시 포인트 목록' })
  getPresets() {
    return ok(this.geocodeService.getPresets());
  }

  @Get('reverse')
  @ApiOperation({ summary: '좌표 → 행정구역 (GPS 지역 추정)' })
  @ApiQuery({ name: 'lat', required: true, example: 37.5665 })
  @ApiQuery({ name: 'lng', required: true, example: 126.978 })
  async reverseRegion(
    @Query('lat') latStr: string,
    @Query('lng') lngStr: string,
  ) {
    const lat = Number(latStr);
    const lng = Number(lngStr);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('lat, lng는 숫자여야 합니다');
    }
    if (lat < 33 || lat > 39 || lng < 124 || lng > 132) {
      throw new BadRequestException(
        '한국 지역 좌표만 지원합니다 (lat 33~39, lng 124~132)',
      );
    }

    return ok(await this.geocodeService.reverseRegion(lat, lng));
  }

  @Get()
  @Header('Cache-Control', 'public, max-age=180')
  @ApiOperation({ summary: '기상청 날씨 조회 (위·경도)' })
  @ApiQuery({ name: 'lat', required: true, example: 37.5665 })
  @ApiQuery({ name: 'lng', required: true, example: 126.978 })
  @ApiQuery({ name: 'label', required: false, example: '서울' })
  async getWeather(
    @Query('lat') latStr: string,
    @Query('lng') lngStr: string,
    @Query('label') label?: string,
  ) {
    const lat = Number(latStr);
    const lng = Number(lngStr);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('lat, lng는 숫자여야 합니다');
    }
    if (lat < 33 || lat > 39 || lng < 124 || lng > 132) {
      throw new BadRequestException(
        '한국 지역 좌표만 지원합니다 (lat 33~39, lng 124~132)',
      );
    }

    return ok(await this.weatherService.getWeather(lat, lng, label));
  }

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
    const lat = latStr != null ? Number(latStr) : undefined;
    const lng = lngStr != null ? Number(lngStr) : undefined;
    return ok(
      await this.marineConditions.getFishingIndex({
        gubun: gubun === '선상' ? '선상' : '갯바위',
        placeName,
        lat: Number.isFinite(lat) ? lat : undefined,
        lng: Number.isFinite(lng) ? lng : undefined,
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
    const lat = latStr != null ? Number(latStr) : undefined;
    const lng = lngStr != null ? Number(lngStr) : undefined;
    return ok(
      await this.marineConditions.getTideForecast({
        lat: Number.isFinite(lat) ? lat : undefined,
        lng: Number.isFinite(lng) ? lng : undefined,
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
    return ok(await this.marineConditions.searchReservoirs(q.trim()));
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
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('lat, lng는 숫자여야 합니다');
    }
    return ok(await this.marineConditions.getReservoirNearby(lat, lng));
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
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('lat, lng는 숫자여야 합니다');
    }
    return ok(await this.marineConditions.getReservoirsInArea(lat, lng, q));
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
    return ok(
      await this.marineConditions.getReservoirLevels(
        facCode,
        dateStart,
        dateEnd,
      ),
    );
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
    const lat = Number(latStr);
    const lng = Number(lngStr);
    const radiusKm = radiusKmStr != null ? Number(radiusKmStr) : 80;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('lat, lng는 숫자여야 합니다');
    }
    if (lat < 33 || lat > 39 || lng < 124 || lng > 132) {
      throw new BadRequestException('한국 지역 좌표만 지원합니다');
    }
    return ok(
      await this.fishingBan.getNearby(
        lat,
        lng,
        Number.isFinite(radiusKm) ? Math.min(Math.max(radiusKm, 10), 200) : 80,
      ),
    );
  }
}
