import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ok } from '../common/http/api-response';
import { WeatherService } from './weather.service';
import { GeocodeService } from './geocode.service';
import { KOREA_ONLY_MESSAGE, requireLatLng } from './weather-query.util';

/** 기상청 날씨와 낚시 포인트·지역 검색. 바다·민물 조황 정보는 FishingConditionsController */
@ApiTags('날씨')
@Controller('weather')
export class WeatherController {
  constructor(
    private weatherService: WeatherService,
    private geocodeService: GeocodeService,
  ) {}

  @Get('search')
  @ApiOperation({ summary: '낚시 포인트·지역 검색' })
  @ApiQuery({ name: 'q', required: false, example: '해운대' })
  async searchPlaces(@Query('q') q?: string) {
    return ok(
      q
        ? await this.geocodeService.search(q)
        : this.geocodeService.getPresets(),
    );
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
    const { lat, lng } = requireLatLng(latStr, lngStr, KOREA_ONLY_MESSAGE);
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
    const { lat, lng } = requireLatLng(latStr, lngStr, KOREA_ONLY_MESSAGE);
    return ok(await this.weatherService.getWeather(lat, lng, label));
  }
}
