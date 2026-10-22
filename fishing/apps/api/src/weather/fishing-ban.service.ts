import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  fetchPublicDataXml,
  PublicDataAuthError,
} from '../common/public-data-request.util';
import { haversineKm } from '../common/geo.util';
import { parseMofWfs } from './mof-wfs.parser';

export type FishingBanKind = 'prohibit' | 'restrict' | 'protect';

export type FishingBanZoneDto = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  kind: FishingBanKind;
  reason: string;
  sido?: string;
  address?: string;
  source: string;
  sourceDate?: string;
  path?: Array<{ lat: number; lng: number }>;
};

type CuratedFile = {
  updatedAt?: string;
  disclaimer?: string;
  zones: Array<Omit<FishingBanZoneDto, 'kind' | 'path'> & { kind: string }>;
};

const MOF_CACHE_MS = 6 * 60 * 60 * 1000;
const BAN_KINDS: FishingBanKind[] = ['prohibit', 'restrict', 'protect'];

/** 구역 경계(반경)가 검색 반경 안에 걸치면 포함 */
function withinRadius(
  zones: FishingBanZoneDto[],
  lat: number,
  lng: number,
  radiusKm: number,
) {
  return zones.filter(
    (z) => haversineKm(lat, lng, z.lat, z.lng) <= radiusKm + z.radiusM / 1000,
  );
}

function dedupeZones(zones: FishingBanZoneDto[]): FishingBanZoneDto[] {
  const seen = new Set<string>();
  return zones.filter((z) => {
    const key = `${z.name}|${z.lat.toFixed(3)}|${z.lng.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 인근 낚시금지·제한·보호구역: 직접 정리한 공개 지정구역 + 해양수산부 수산자원보호구역(WFS) */
@Injectable()
export class FishingBanService {
  private readonly logger = new Logger(FishingBanService.name);
  private mofCache: { at: number; zones: FishingBanZoneDto[] } | null = null;
  private curatedCache: CuratedFile | null = null;

  constructor(private config: ConfigService) {}

  async getNearby(lat: number, lng: number, radiusKm = 80) {
    const file = this.loadCuratedFile();
    const curatedZones = withinRadius(
      this.mapCurated(file),
      lat,
      lng,
      radiusKm,
    );
    const mofZones = await this.fetchMofProtectZonesSafe(lat, lng, radiusKm);
    const merged = dedupeZones([...mofZones, ...curatedZones]);

    return {
      zones: merged.sort(
        (a, b) =>
          haversineKm(lat, lng, a.lat, a.lng) -
          haversineKm(lat, lng, b.lat, b.lng),
      ),
      disclaimer:
        file.disclaimer ??
        '공개 지정구역 기반 안내입니다. 정확한 경계는 관할 지자체 고시를 확인하세요.',
      sources: [...new Set(merged.map((z) => z.source))],
      updatedAt: file.updatedAt ?? null,
    };
  }

  private loadCuratedFile(): CuratedFile {
    this.curatedCache ??= JSON.parse(
      readFileSync(join(__dirname, 'data', 'fishing-ban-zones.json'), 'utf8'),
    ) as CuratedFile;
    return this.curatedCache;
  }

  private mapCurated(file: CuratedFile): FishingBanZoneDto[] {
    return (file.zones ?? []).map((z) => ({
      id: z.id,
      name: z.name,
      lat: z.lat,
      lng: z.lng,
      radiusM: z.radiusM,
      kind: BAN_KINDS.includes(z.kind as FishingBanKind)
        ? (z.kind as FishingBanKind)
        : 'restrict',
      reason: z.reason,
      sido: z.sido,
      address: z.address,
      source: z.source,
      sourceDate: z.sourceDate,
    }));
  }

  /** WFS 는 6시간 캐시. 키·주소가 없거나 실패하면 빈 목록 */
  private async fetchMofProtectZonesSafe(
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<FishingBanZoneDto[]> {
    const serviceKey = this.config.get<string>('DATA_GO_KR_SERVICE_KEY');
    const baseUrl = this.config.get<string>('MOF_FISHERY_PROTECT_WFS_URL');
    if (!serviceKey || !baseUrl) return [];

    const now = Date.now();
    if (this.mofCache && now - this.mofCache.at < MOF_CACHE_MS) {
      return withinRadius(this.mofCache.zones, lat, lng, radiusKm);
    }

    try {
      const zones = parseMofWfs(
        await fetchPublicDataXml(baseUrl, serviceKey, { maxFeatures: 100 }),
      );
      this.mofCache = { at: now, zones };
      return withinRadius(zones, lat, lng, radiusKm);
    } catch (err) {
      const reason =
        err instanceof PublicDataAuthError ? '미승인/키오류' : '조회 실패';
      this.logger.warn(
        `수산자원보호구역 WFS ${reason}: ${(err as Error).message}`,
      );
      return [];
    }
  }
}
