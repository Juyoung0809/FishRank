import type { FishCatalogEntry } from './fish-species-catalog';
import type { InaturalistTaxonSummary } from './inaturalist.client';
import type { PublicFishRecord } from './public-data-fish.client';

/** DB 는 기수(brackish)를 따로 두지 않고 바다로 저장한다. */
export function toDbCategory(category: string): string {
  return category === 'brackish' ? 'saltwater' : category;
}

export function publicDataSourceLabel(
  source: PublicFishRecord['source'],
): string {
  switch (source) {
    case 'nifs':
      return '국립수산과학원';
    case 'nakdong':
      return '국립낙동강생물자원관';
    case 'mbris':
      return 'MBRIS 해양생물종';
    case 'mof':
      return '해양수산부';
    default:
      return '공공데이터포털';
  }
}

/** 해양수산부 목록으로 새로 넣는 어종의 기본 설명 */
export function buildPublicDescription(row: {
  nameKo: string;
  nameEn: string | null;
  scientificName: string;
  taxonomy: string | null;
}): string {
  const parts = [
    row.nameEn ? `${row.nameKo}(${row.nameEn})` : row.nameKo,
    `학명: ${row.scientificName}`,
  ];
  if (row.taxonomy) parts.push(`분류: ${row.taxonomy}`);
  parts.push('출처: 해양수산부 해양생물종기본정보');
  return parts.join('\n\n');
}

/** 카탈로그 소개 → 분류·학명 → 공공데이터 생태·형태·분포 → iNaturalist 관찰 수 → 출처 순 설명 */
export function composeDescription(
  catalog: FishCatalogEntry | undefined,
  inat: InaturalistTaxonSummary | null,
  publicRecord: PublicFishRecord | null,
  existing?: string,
  fallbackNameKo?: string,
): string {
  const parts: string[] = [];

  if (catalog) {
    const place =
      catalog.category === 'freshwater'
        ? '민물'
        : catalog.category === 'brackish'
          ? '기수'
          : '바다';
    parts.push(
      `${catalog.nameKo}(${catalog.nameEn}) — 국내 낚시 대상 ${place} 어종`,
    );
  } else if (fallbackNameKo) {
    parts.push(`${fallbackNameKo} — 대한민국 수산·해양 생물종`);
  }

  if (publicRecord?.taxonomy) parts.push(`분류: ${publicRecord.taxonomy}`);
  else if (inat?.scientificName) parts.push(`학명: ${inat.scientificName}`);

  if (publicRecord?.ecology) parts.push(publicRecord.ecology);
  if (publicRecord?.morphology) parts.push(publicRecord.morphology);
  if (publicRecord?.distribution)
    parts.push(`국내 분포: ${publicRecord.distribution}`);

  if (inat?.observationsCountKorea) {
    parts.push(
      `대한민국 iNaturalist 관찰 ${inat.observationsCountKorea.toLocaleString()}건 (전 세계 ${inat.observationsCount.toLocaleString()}건)`,
    );
  }

  if (!parts.length && existing) parts.push(existing);
  if (!parts.length && catalog)
    parts.push(`${catalog.nameKo}에 대한 FishRank 어종 정보입니다.`);

  parts.push(
    `출처: iNaturalist${publicRecord ? ` · ${publicDataSourceLabel(publicRecord.source)}` : ''}`,
  );
  return parts.join('\n\n');
}
