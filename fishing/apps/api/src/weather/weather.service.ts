import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getFcstBaseTime,
  getNcstBaseTime,
  getVilageBaseTime,
  latLngToGrid,
} from './kma-grid';
import { getFishingCondition } from './fishing-condition';
import { extractDailyMinMax, groupFcstItems, itemsToMap } from './kma-parser';
import { fetchKmaItems, fetchKmaItemsOptional } from './kma.api';
import { buildCurrent, buildForecastSlots } from './weather-slots.builder';
import {
  bestTimesOf,
  buildExtendedDays,
  groupSlotsByDay,
} from './weather-days.builder';
import type { WeatherSummary } from './weather.types';

export type {
  WeatherCurrent,
  WeatherDay,
  WeatherSlot,
  WeatherSummary,
} from './weather.types';

/** fresh TTL */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** stale 허용 — 기상청 지연 시 즉시 응답 */
const STALE_TTL_MS = 30 * 60 * 1000;

/** 기상청 날씨 조회. 격자(nx,ny)별로 캐시하고, 만료 직후에는 이전 값을 주면서 뒤에서 갱신한다. */
@Injectable()
export class WeatherService {
  private readonly cache = new Map<
    string,
    { data: WeatherSummary; expiresAt: number; staleUntil: number }
  >();
  private readonly inflight = new Map<string, Promise<WeatherSummary>>();

  constructor(private config: ConfigService) {}

  async getWeather(
    lat: number,
    lng: number,
    label?: string,
  ): Promise<WeatherSummary> {
    const serviceKey = this.config.get<string>('KMA_SERVICE_KEY');
    if (!serviceKey) {
      throw new ServiceUnavailableException(
        'KMA_SERVICE_KEY가 설정되지 않았습니다. 기상청 API허브에서 인증키를 발급받아 apps/api/.env에 추가하세요.',
      );
    }

    const { nx, ny } = latLngToGrid(lat, lng);
    const now = Date.now();
    const entry = this.cache.get(`${nx},${ny}`);
    const withLocation = (data: WeatherSummary) => ({
      ...data,
      location: { ...data.location, lat, lng, label },
    });

    if (entry && now <= entry.expiresAt) return withLocation(entry.data);
    if (entry && now <= entry.staleUntil) {
      void this.fetchAndCache(lat, lng, label, nx, ny, serviceKey).catch(
        () => {},
      );
      return withLocation(entry.data);
    }
    return this.fetchAndCache(lat, lng, label, nx, ny, serviceKey);
  }

  /** 같은 격자를 동시에 여러 번 요청해도 기상청은 한 번만 부른다. */
  private fetchAndCache(
    lat: number,
    lng: number,
    label: string | undefined,
    nx: number,
    ny: number,
    serviceKey: string,
  ): Promise<WeatherSummary> {
    const key = `${nx},${ny}`;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = this.buildWeather(lat, lng, label, nx, ny, serviceKey)
      .then((summary) => {
        const at = Date.now();
        this.cache.set(key, {
          data: summary,
          expiresAt: at + CACHE_TTL_MS,
          staleUntil: at + STALE_TTL_MS,
        });
        return summary;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  private async buildWeather(
    lat: number,
    lng: number,
    label: string | undefined,
    nx: number,
    ny: number,
    serviceKey: string,
  ): Promise<WeatherSummary> {
    const ncstBase = getNcstBaseTime();
    const [ncstItems, ultraFcstItems, vilageItems] = await Promise.all([
      fetchKmaItems('getUltraSrtNcst', serviceKey, { ...ncstBase, nx, ny }),
      fetchKmaItemsOptional('getUltraSrtFcst', serviceKey, {
        ...getFcstBaseTime(),
        nx,
        ny,
      }),
      fetchKmaItemsOptional('getVilageFcst', serviceKey, {
        ...getVilageBaseTime(),
        nx,
        ny,
      }),
    ]);

    const ultraFcst = groupFcstItems(ultraFcstItems);
    const vilageFcst = groupFcstItems(vilageItems);
    const current = buildCurrent(
      itemsToMap(ncstItems),
      Object.values(ultraFcst)[0] ?? {},
      ncstBase,
    );
    const slots = buildForecastSlots(
      current,
      `${ncstBase.baseDate}${ncstBase.baseTime}`,
      ultraFcst,
      vilageFcst,
    );

    const days = buildExtendedDays(
      groupSlotsByDay(
        slots,
        lat,
        lng,
        extractDailyMinMax(vilageFcst),
        ncstBase.baseDate,
        current.temp,
      ),
      lat,
      lng,
      7,
    );
    const forecastAvailable =
      ultraFcstItems.length > 0 || vilageItems.length > 0;

    return {
      location: { lat, lng, nx, ny, label },
      current,
      days,
      fishingCondition: getFishingCondition(current),
      bestTimesToday: bestTimesOf(days[0]),
      source: 'kma',
      forecastAvailable,
      forecastNotice: forecastAvailable
        ? undefined
        : '초단기예보·단기예보 API 활용신청이 필요합니다. API허브에서 동네예보 서비스의 예보 API를 추가 신청해 주세요.',
    };
  }
}
