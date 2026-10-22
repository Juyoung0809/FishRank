import type { FishCatalogEntry } from './fish-species-catalog';
import type { InaturalistTaxonSummary } from './inaturalist.client';
import type { PublicFishRecord } from './public-data-fish.client';
import {
  composeDescription,
  publicDataSourceLabel,
} from './fish-info-text.util';

/** 여러 출처(DB 사전·카탈로그·iNaturalist·공공데이터)를 합친 어종 정보 */
export type EnrichedFishInfo = {
  speciesId: number;
  nameKo: string;
  nameEn: string | null;
  scientificName: string | null;
  category: string;
  description: string;
  habitat: string | null;
  season: string | null;
  bait: string | null;
  technique: string | null;
  avgLengthCm: number | null;
  maxLengthCm: number | null;
  minSizeLaw: number | null;
  imageUrl: string | null;
  imageAttribution: string | null;
  wikipediaUrl: string | null;
  iNaturalist: InaturalistTaxonSummary | null;
  publicData: PublicFishRecord | null;
  sources: string[];
  catalogMatch: boolean;
};

export type SyncResultItem = {
  speciesId: number;
  nameKo: string;
  ok: boolean;
  iNaturalist?: string;
  publicData?: string;
  error?: string;
};

export type SpeciesWithEncyclopedia = {
  id: number;
  nameKo: string;
  nameEn: string | null;
  scientificName: string | null;
  category: string;
  encyclopedia: {
    description: string;
    habitat: string | null;
    season: string | null;
    bait: string | null;
    technique: string | null;
    avgLengthCm: number | null;
    maxLengthCm: number | null;
    minSizeLaw: number | null;
    imageUrl: string | null;
  } | null;
};

/** 공공데이터 검색에 넘길 분류 (기수는 그대로, 그 밖은 민물·바다) */
export function publicCategoryOf(
  species: SpeciesWithEncyclopedia,
  catalog?: FishCatalogEntry,
) {
  const category = catalog?.category ?? species.category;
  return category === 'brackish'
    ? 'brackish'
    : category === 'freshwater'
      ? 'freshwater'
      : 'saltwater';
}

/**
 * 출처별 우선순위로 칸을 채운다.
 * 이름·학명: iNaturalist → 카탈로그 → DB → 공공데이터
 * 서식지: 공공데이터 → DB / 실전 정보(시즌·미끼·길이): DB → 카탈로그 / 사진: iNaturalist → DB
 */
export function mergeEnrichedInfo(
  species: SpeciesWithEncyclopedia,
  catalog: FishCatalogEntry | undefined,
  inat: InaturalistTaxonSummary | null,
  publicRecord: PublicFishRecord | null,
): EnrichedFishInfo {
  const enc = species.encyclopedia;
  const sources: string[] = [];
  if (inat) sources.push('iNaturalist');
  if (publicRecord) sources.push(publicDataSourceLabel(publicRecord.source));

  return {
    speciesId: species.id,
    nameKo: catalog?.nameKo ?? species.nameKo,
    nameEn:
      inat?.nameEn ??
      catalog?.nameEn ??
      species.nameEn ??
      publicRecord?.nameEn ??
      null,
    scientificName:
      inat?.scientificName ??
      catalog?.scientificName ??
      species.scientificName ??
      publicRecord?.scientificName ??
      null,
    category: catalog?.category ?? species.category,
    description: composeDescription(
      catalog,
      inat,
      publicRecord,
      enc?.description,
      species.nameKo,
    ),
    habitat:
      publicRecord?.habitat ??
      publicRecord?.distribution ??
      enc?.habitat ??
      null,
    season: enc?.season ?? catalog?.season ?? null,
    bait: enc?.bait ?? catalog?.bait ?? null,
    technique: enc?.technique ?? catalog?.technique ?? null,
    avgLengthCm: enc?.avgLengthCm ?? catalog?.avgLengthCm ?? null,
    maxLengthCm: enc?.maxLengthCm ?? catalog?.maxLengthCm ?? null,
    minSizeLaw: enc?.minSizeLaw ?? catalog?.minSizeLaw ?? null,
    imageUrl: inat?.imageUrl ?? enc?.imageUrl ?? null,
    imageAttribution: inat?.imageAttribution ?? null,
    wikipediaUrl: inat?.wikipediaUrl ?? null,
    iNaturalist: inat,
    publicData: publicRecord,
    sources,
    catalogMatch: !!catalog,
  };
}

/** 동기화 결과 한 줄 요약 (iNaturalist 매칭 방식, 공공데이터 검증 여부) */
export function syncSummary(
  entry: FishCatalogEntry,
  enriched: EnrichedFishInfo,
): SyncResultItem {
  const { iNaturalist: inat, publicData } = enriched;
  return {
    speciesId: entry.speciesId,
    nameKo: entry.nameKo,
    ok: true,
    iNaturalist: inat ? `${inat.scientificName} (${inat.matchType})` : '없음',
    publicData: publicData?.matched
      ? `${publicData.source} ✓`
      : publicData
        ? `${publicData.source} (검증 미통과)`
        : '없음',
  };
}
