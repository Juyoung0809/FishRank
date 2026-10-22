import { Injectable } from '@nestjs/common';
import { withPublicDataAuth } from '../common/public-data-request.util';
import { withTimeout } from '../common/geo.util';
import { GeocodeService } from './geocode.service';
import {
  mergeKakaoNearby,
  rankCandidates,
  stubRow,
  type ReservoirAreaRow,
} from './reservoir-rows.util';
import {
  ReservoirPublicClient,
  type ReservoirCode,
} from './reservoir-public.client';

type ReservoirSearch = {
  spotLabel: string;
  query: string;
  nameHint?: string;
  regionHint: string;
};

const SOURCE = 'KRC 농촌용수 저수지 (data.go.kr 15099919)';
const RESERVOIR_LIST_LIMIT = 50;
/** 지도 마커용 지오코딩 대상 수 — 너무 크면 공공API 한도에 걸림 */
const RESERVOIR_MAP_ENRICH_LIMIT = 20;
const RESERVOIR_AREA_DEADLINE_MS = 9000;
const GEOCODE_CONCURRENCY = 4;

export type { ReservoirAreaRow } from './reservoir-rows.util';

/** 민물 저수지 검색·수위 (KRC 공공데이터 + 카카오 지도 보강) */
@Injectable()
export class ReservoirConditionsService {
  constructor(
    private reservoir: ReservoirPublicClient,
    private geocode: GeocodeService,
  ) {}

  async search(query: string) {
    return withPublicDataAuth(async () => ({
      source: SOURCE,
      rows: await this.reservoir.searchReservoirs(query),
    }));
  }

  async getLevels(facCode: string, dateStart?: string, dateEnd?: string) {
    return withPublicDataAuth(async () => {
      const rows = await this.reservoir.getWaterLevels({
        facCode,
        dateStart,
        dateEnd,
      });
      return { source: SOURCE, facCode, latest: rows.at(-1) ?? null, rows };
    });
  }

  /** 좌표 주변 저수지 중 수위가 있는 첫 곳 (없으면 첫 후보만) */
  async getNearby(lat: number, lng: number, queryOverride?: string) {
    const search = await this.resolveSearch(lat, lng, queryOverride);

    return withPublicDataAuth(async () => {
      const candidates = rankCandidates(
        await this.searchCandidates(search),
        search.nameHint,
        search.regionHint,
      );
      for (const candidate of candidates.slice(0, 6)) {
        const latest = (
          await this.reservoir.getWaterLevels({ facCode: candidate.facCode })
        ).at(-1);
        if (latest)
          return { source: SOURCE, spot: search.spotLabel, reservoir: latest };
      }

      const fallback = candidates[0];
      return {
        source: SOURCE,
        spot: search.spotLabel,
        reservoir: fallback
          ? {
              facCode: fallback.facCode,
              facName: fallback.facName,
              county: fallback.county,
              checkDate: '',
              waterLevelM: null,
              ratePercent: null,
            }
          : null,
      };
    });
  }

  /** 지도·표용 주변 저수지 목록. 정해진 시간 안에 채운 만큼만 좌표·수위를 붙인다. */
  async getInArea(lat: number, lng: number, queryOverride?: string) {
    const search = await this.resolveSearch(lat, lng, queryOverride);

    return withPublicDataAuth(async () => {
      const deadline = Date.now() + RESERVOIR_AREA_DEADLINE_MS;

      // KRC 목록 + 카카오 주변 저수지 POI를 병렬로 (지도에 물이 보이는데 마커가 비는 경우 보강)
      const [codes, kakaoNearby] = await Promise.all([
        withTimeout(this.searchCandidates(search), 2500, []),
        withTimeout(
          this.geocode.searchNearbyReservoirs(lat, lng, 15000),
          3500,
          [],
        ),
      ]);

      const candidates = rankCandidates(
        codes,
        search.nameHint,
        search.regionHint,
      ).slice(0, RESERVOIR_LIST_LIMIT);
      const enriched = await this.buildAreaRows(
        candidates.slice(0, RESERVOIR_MAP_ENRICH_LIMIT),
        deadline,
        {
          lat,
          lng,
        },
      );
      const enrichedMap = new Map(enriched.map((row) => [row.facCode, row]));
      const rows = candidates.map(
        (code) => enrichedMap.get(code.facCode) ?? stubRow(code),
      );

      mergeKakaoNearby(rows, kakaoNearby, candidates);
      rows.sort((a, b) => Number(b.geocoded) - Number(a.geocoded));

      return {
        source: 'KRC 농촌용수 저수지 + 카카오 주변 저수지',
        spot: search.spotLabel,
        searchQuery: search.query,
        center: { lat, lng },
        totalCount: rows.length,
        geocodedCount: rows.filter((r) => r.geocoded).length,
        rows,
      };
    });
  }

  /** 검색어가 없으면 좌표를 시·군·구로 바꿔 검색어로 쓴다. */
  private async resolveSearch(
    lat: number,
    lng: number,
    queryOverride?: string,
  ): Promise<ReservoirSearch> {
    const trimmed = queryOverride?.trim();
    if (trimmed)
      return {
        spotLabel: trimmed,
        query: trimmed,
        nameHint: trimmed,
        regionHint: trimmed,
      };

    const region = await this.geocode.reverseRegion(lat, lng);
    const district = region.district?.replace(/(시|군|구)$/, '') || '';
    const query =
      district ||
      region.province.replace(/(특별자치도|특별시|광역시|도)$/, '').slice(0, 2);
    return {
      spotLabel: region.label,
      query,
      nameHint: district || undefined,
      regionHint: district || region.province,
    };
  }

  private async searchCandidates(
    search: ReservoirSearch,
  ): Promise<ReservoirCode[]> {
    const rows = await this.reservoir.searchReservoirs(search.query);
    if (rows.length || search.regionHint === search.query) return rows;
    return this.reservoir.searchReservoirs(search.regionHint);
  }

  /** 동시 요청을 제한해 카카오·공공데이터 한도(코드 16) 폭주를 줄인다. 시간이 다 되면 나머지는 빈 행. */
  private async buildAreaRows(
    candidates: ReservoirCode[],
    deadline: number,
    bias: { lat: number; lng: number },
  ): Promise<ReservoirAreaRow[]> {
    const remainingMs = () => Math.max(0, deadline - Date.now());
    if (remainingMs() <= 0) return candidates.map(stubRow);

    const results: ReservoirAreaRow[] = [];
    for (let i = 0; i < candidates.length; i += GEOCODE_CONCURRENCY) {
      if (remainingMs() <= 200) {
        results.push(...candidates.slice(i).map(stubRow));
        break;
      }
      const chunk = candidates.slice(i, i + GEOCODE_CONCURRENCY);
      const timeoutMs = Math.min(2500, Math.max(1200, remainingMs()));
      results.push(
        ...(await Promise.all(
          chunk.map((candidate) =>
            withTimeout(
              this.buildAreaRow(candidate, bias),
              timeoutMs,
              stubRow(candidate),
            ),
          ),
        )),
      );
    }
    return results;
  }

  /** 지도 표시는 좌표가 핵심 — 수위는 실패해도 마커는 유지 */
  private async buildAreaRow(
    candidate: ReservoirCode,
    bias: { lat: number; lng: number },
  ): Promise<ReservoirAreaRow> {
    const coord = await withTimeout(
      this.geocode.geocodeReservoir(candidate.facName, candidate.county, bias),
      2000,
      null,
    );
    const levels = await withTimeout(
      this.reservoir.getWaterLevels({
        facCode: candidate.facCode,
        latestOnly: true,
      }),
      900,
      [],
    );
    const latest = levels.at(-1);

    return {
      facCode: candidate.facCode,
      facName: candidate.facName,
      county: candidate.county,
      ratePercent: latest?.ratePercent ?? null,
      waterLevelM: latest?.waterLevelM ?? null,
      checkDate: latest?.checkDate ?? null,
      lat: coord?.lat ?? 0,
      lng: coord?.lng ?? 0,
      geocoded: coord != null,
    };
  }
}
