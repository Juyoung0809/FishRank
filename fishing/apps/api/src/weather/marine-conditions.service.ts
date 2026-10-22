import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { withPublicDataAuth } from '../common/public-data-request.util';
import {
  KhoaPublicClient,
  TIDE_FORECAST_POINTS,
  type TideForecastPoint,
} from './khoa-public.client';

type SeaFishingRow = Awaited<
  ReturnType<KhoaPublicClient['getSeaFishingIndex']>
>[number];
type TideRow = Awaited<ReturnType<KhoaPublicClient['getTideForecast']>>[number];

/** 바다낚시지수·조석예보 (KHOA) */
@Injectable()
export class MarineConditionsService {
  constructor(private khoa: KhoaPublicClient) {}

  /** 장소 이름으로 먼저 찾고 없으면 전체에서, 좌표가 있으면 가까운 순으로 어종별 1건씩 */
  async getFishingIndex(options: {
    gubun?: '갯바위' | '선상';
    placeName?: string;
    lat?: number;
    lng?: number;
    reqDate?: string;
  }) {
    const gubun = options.gubun ?? '갯바위';
    const reqDate = options.reqDate;

    return withPublicDataAuth(async () => {
      let rows = options.placeName
        ? await this.khoa.getSeaFishingIndex({
            gubun,
            placeName: options.placeName,
            reqDate,
          })
        : [];
      if (!rows.length)
        rows = await this.khoa.getSeaFishingIndex({ gubun, reqDate });

      if (options.lat != null && options.lng != null && rows.length > 1) {
        rows = sortByDistance(rows, options.lat, options.lng).slice(0, 30);
      }
      rows = dedupeByFish(rows);

      return {
        source: 'KHOA 바다낚시지수 (data.go.kr 15142486)',
        gubun,
        placeName: rows[0]?.placeName ?? options.placeName ?? null,
        rows,
      };
    });
  }

  /** 지점 코드 → 좌표에서 가장 가까운 지점 → 부산 순으로 조석 예보 지점을 고른다. */
  async getTideForecast(options: {
    lat?: number;
    lng?: number;
    obsCode?: string;
    reqDate?: string;
  }) {
    const point =
      options.obsCode != null
        ? (TIDE_FORECAST_POINTS.find((p) => p.obsCode === options.obsCode) ??
          null)
        : options.lat != null && options.lng != null
          ? this.khoa.resolveNearestTidePoint(options.lat, options.lng)
          : TIDE_FORECAST_POINTS[1];

    if (!point)
      throw new ServiceUnavailableException(
        '조석 예보지점을 찾을 수 없습니다.',
      );

    return withPublicDataAuth(async () => {
      const rows = await this.khoa.getTideForecast({
        obsCode: point.obsCode,
        reqDate: options.reqDate,
      });
      return {
        source: 'KHOA 조석예보 시계열 (data.go.kr 15156022)',
        point,
        rows: rowsNearPoint(rows, point),
      };
    });
  }
}

/** 어종별 첫 행만 남기고 '기타어종'은 뺀다. */
function dedupeByFish(rows: SeaFishingRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!row.fishName || row.fishName === '기타어종') return false;
    if (seen.has(row.fishName)) return false;
    seen.add(row.fishName);
    return true;
  });
}

/** 좌표가 없는 행은 남기고, 지점에서 0.35도 넘게 떨어진 행은 뺀다. */
function rowsNearPoint(rows: TideRow[], point: TideForecastPoint) {
  return rows.filter((row) => {
    if (row.lat == null || row.lng == null) return true;
    return (
      Math.abs(row.lat - point.lat) < 0.35 &&
      Math.abs(row.lng - point.lng) < 0.35
    );
  });
}

function sortByDistance(rows: SeaFishingRow[], lat: number, lng: number) {
  const distance = (row: SeaFishingRow) => {
    const rLat = Number(row.raw.lat);
    const rLng = Number(row.raw.lot ?? row.raw.lng);
    if (!Number.isFinite(rLat) || !Number.isFinite(rLng))
      return Number.POSITIVE_INFINITY;
    return (rLat - lat) ** 2 + (rLng - lng) ** 2;
  };
  return [...rows].sort((a, b) => distance(a) - distance(b));
}
