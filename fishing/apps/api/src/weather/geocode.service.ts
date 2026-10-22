import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PRESET_FISHING_SPOTS, type FishingSpot } from './fishing-spots';
import {
  kakaoCoordToRegion,
  searchKakaoKeyword,
  type KakaoKeywordOptions,
} from './kakao-local.api';
import {
  normalizeReservoirName,
  REJECT_PLACE_RE,
  scoreReservoirMatch,
  WATER_PLACE_RE,
} from './reservoir-name-match.util';
import {
  defaultRegionAnchor,
  toRegionAnchor,
  type RegionAnchorResult,
} from './region-anchor.util';

export type { RegionAnchorResult } from './region-anchor.util';

export type PlaceResult = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  source: 'preset' | 'kakao';
  spotType?: 'sea' | 'fresh' | 'mixed';
};

export type NearbyWaterPlace = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

const NEARBY_CACHE_MS = 20 * 60 * 1000;

function presetToResult(spot: FishingSpot): PlaceResult {
  return {
    id: spot.id,
    name: spot.name,
    address: spot.region,
    lat: spot.lat,
    lng: spot.lng,
    source: 'preset',
    spotType: spot.type,
  };
}

/** 낚시 포인트 검색, 좌표 ↔ 행정구역, 저수지 좌표 찾기 (카카오 로컬) */
@Injectable()
export class GeocodeService {
  private readonly geocodeCache = new Map<
    string,
    { lat: number; lng: number } | null
  >();
  private readonly reverseCache = new Map<string, RegionAnchorResult>();
  private readonly nearbyReservoirCache = new Map<
    string,
    { at: number; rows: NearbyWaterPlace[] }
  >();

  constructor(private config: ConfigService) {}

  private get kakaoKey() {
    return this.config.get<string>('KAKAO_REST_API_KEY');
  }

  /** 추천 포인트 + 카카오 검색 결과 (같은 좌표는 하나만, 최대 15개) */
  async search(query: string): Promise<PlaceResult[]> {
    const q = query.trim().toLowerCase();
    if (!q) return PRESET_FISHING_SPOTS.slice(0, 8).map(presetToResult);

    const presetMatches = PRESET_FISHING_SPOTS.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.region.toLowerCase().includes(q),
    ).map(presetToResult);
    const kakao = await this.searchPlaces(query);

    const seen = new Set<string>();
    return [...presetMatches, ...kakao]
      .filter((item) => {
        const key = `${item.lat.toFixed(3)},${item.lng.toFixed(3)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 15);
  }

  getPresets(): PlaceResult[] {
    return PRESET_FISHING_SPOTS.map(presetToResult);
  }

  /** 좌표 → 활동 지역(시·도 + 시·군·구). 실패하면 서울 강남 */
  async reverseRegion(lat: number, lng: number): Promise<RegionAnchorResult> {
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const cached = this.reverseCache.get(key);
    if (cached) return cached;

    const result =
      (await this.reverseKakaoRegion(lat, lng)) ?? defaultRegionAnchor();
    this.reverseCache.set(key, result);
    return result;
  }

  /**
   * 지도 중심 주변 저수지·댐 POI (카카오 키워드 + 반경).
   * KRC 지오코딩이 비는 지역을 메우기 위한 보강용.
   */
  async searchNearbyReservoirs(
    lat: number,
    lng: number,
    radiusM = 15000,
  ): Promise<NearbyWaterPlace[]> {
    const cacheKey = `near|${lat.toFixed(2)}|${lng.toFixed(2)}|${radiusM}`;
    const cached = this.nearbyReservoirCache.get(cacheKey);
    if (cached && Date.now() - cached.at < NEARBY_CACHE_MS) return cached.rows;

    const byId = new Map<string, NearbyWaterPlace>();
    for (const q of ['저수지', '댐', '호수']) {
      const docs = await searchKakaoKeyword(this.kakaoKey, q, {
        lat,
        lng,
        radiusM,
        size: 15,
      });
      for (const doc of docs) {
        const name = doc.place_name ?? '';
        if (!WATER_PLACE_RE.test(name) || REJECT_PLACE_RE.test(name)) continue;
        const id = String(doc.id);
        if (byId.has(id)) continue;
        byId.set(id, {
          id: `kakao-${id}`,
          name,
          address: doc.address_name ?? '',
          lat: Number(doc.y),
          lng: Number(doc.x),
        });
      }
    }

    const rows = [...byId.values()];
    this.nearbyReservoirCache.set(cacheKey, { at: Date.now(), rows });
    return rows;
  }

  /** 저수지·댐만 매칭. 동명 건물/학교/공장은 제외 */
  async geocodeReservoir(
    facName: string,
    county: string | null,
    bias?: { lat: number; lng: number },
  ): Promise<{ lat: number; lng: number } | null> {
    const cacheKey = `v3|${facName}|${county ?? ''}|${bias ? `${bias.lat.toFixed(2)},${bias.lng.toFixed(2)}` : ''}`;
    if (this.geocodeCache.has(cacheKey))
      return this.geocodeCache.get(cacheKey) ?? null;

    const baseName = normalizeReservoirName(facName);
    const countyHint = (county ?? '')
      .replace(/(특별자치시|광역시|특별시|시|군|구)$/, '')
      .trim();
    const queries = [
      `${countyHint} ${baseName} 저수지`.trim(),
      `${countyHint} ${baseName} 댐`.trim(),
      `${baseName} 저수지`,
      `${baseName} 댐`,
      `${facName} 저수지`,
    ].filter((q, i, arr) => q.length >= 3 && arr.indexOf(q) === i);
    const opts: KakaoKeywordOptions = bias
      ? { lat: bias.lat, lng: bias.lng, radiusM: 40000, size: 15 }
      : { size: 15 };

    let best: { lat: number; lng: number; score: number } | null = null;
    for (const query of queries) {
      for (const doc of await searchKakaoKeyword(this.kakaoKey, query, opts)) {
        const score = scoreReservoirMatch(doc, baseName, facName, countyHint);
        if (score >= 35 && (!best || score > best.score)) {
          best = { lat: Number(doc.y), lng: Number(doc.x), score };
        }
      }
      if (best && best.score >= 75) break;
    }

    const hit = best ? { lat: best.lat, lng: best.lng } : null;
    this.geocodeCache.set(cacheKey, hit);
    return hit;
  }

  private async searchPlaces(query: string): Promise<PlaceResult[]> {
    const docs = await searchKakaoKeyword(this.kakaoKey, query);
    return docs.map((doc) => ({
      id: `kakao-${doc.id}`,
      name: doc.place_name,
      address: doc.address_name,
      lat: Number(doc.y),
      lng: Number(doc.x),
      source: 'kakao' as const,
    }));
  }

  private async reverseKakaoRegion(
    lat: number,
    lng: number,
  ): Promise<RegionAnchorResult | null> {
    const doc = await kakaoCoordToRegion(this.kakaoKey, lat, lng);
    return doc ? toRegionAnchor(doc, lat, lng) : null;
  }
}
