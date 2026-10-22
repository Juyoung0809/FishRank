import { pickField } from './data-go-kr.util';
import type { PublicFishRecord } from './public-data-fish.client';

type Item = Record<string, unknown>;

/** API 마다 다른 필드 이름 후보: 국명, 영명, 학명, 분류, 서식지, 분포, 생태, 형태 */
export type FieldMap = {
  ko: string[];
  en: string[];
  sci: string[];
  tax: string[];
  habitat: string[];
  distribution: string[];
  ecology: string[];
  morphology: string[];
};

export const MARINE_FIELDS: FieldMap = {
  ko: ['korNm', 'koreanName', 'spcsKrnNm', 'speciesNm', '국명'],
  en: ['engNm', 'englishName', 'spcsEngNm', '영명'],
  sci: ['sciNm', 'scientificName', 'spcsScinNm', 'stnmItl', '학명'],
  tax: ['taxonFullNm', 'clsFullNm', 'classification', 'bioClsFullNm'],
  habitat: ['habitat', 'habitats', 'hab'],
  distribution: ['rgnDist', 'distribution', 'distrib', 'domesticDist'],
  ecology: ['ecology', 'ecoInfo', 'ecologicalInfo'],
  morphology: ['morph', 'morphology', 'formInfo'],
};

export const NIFS_FIELDS: FieldMap = {
  ko: ['spcsKrnNm', 'speciesNm', 'korNm', 'koreanName', 'commNm'],
  en: ['spcsEngNm', 'englishNm', 'engNm', 'englishName'],
  sci: ['spcsScinNm', 'scientificNm', 'sciNm', 'scientificName'],
  tax: ['bioClsFullNm', 'classification', 'taxonFullNm', 'clsFullNm'],
  habitat: ['livingEnv', 'habitat', 'habitats', 'hab'],
  distribution: ['distribution', 'rgnDist', 'distrib'],
  ecology: ['ecology', 'ecoInfo'],
  morphology: ['morphology', 'morph', 'formInfo'],
};

export const FRESHWATER_FIELDS: FieldMap = {
  ko: ['korean_name', 'korNm', 'koreanName', 'taxonKnm', 'commNm', 'speciesNm'],
  en: ['engNm', 'englishName'],
  sci: ['scientific_name', 'sciNm', 'scientificName', 'taxonNm'],
  tax: ['taxonomy', 'taxonFullNm', 'classification', 'clsFullNm', 'taxon'],
  habitat: ['habitat', 'habitats'],
  distribution: ['distribution', 'rgnDist', 'institution'],
  ecology: ['ecology', 'ecoInfo', 'category1', 'category2'],
  morphology: ['morphology', 'morph'],
};

/** 해양수산부(odcloud) 분류 3단계를 "대 > 중 > 소" 로 */
export function odcloudTaxonomy(item: Item): string | null {
  const parts = ['생물분류대분류', '생물분류중분류', '생물분류소분류']
    .map((key) => pickField(item, [key]))
    .filter(Boolean);
  return parts.length ? parts.join(' > ') : null;
}

/** 학명이 맞으면 우선, 아니면 국명(괄호·공백 무시)이 서로 포함되면 같은 종으로 본다. */
export function isNameMatch(
  foundKo: string | null,
  expectedKo: string,
  foundSci: string | null,
  expectedSci?: string,
): boolean {
  if (expectedSci && foundSci) {
    const a = expectedSci.toLowerCase();
    const b = foundSci.toLowerCase();
    if (b === a || b.startsWith(`${a} `) || b.includes(a)) return true;
  }
  if (!foundKo) return false;
  const a = expectedKo.replace(/\s/g, '');
  const b = foundKo.replace(/\s/g, '').replace(/\(.*\)/, '');
  return b.includes(a) || a.includes(b);
}

/** 정확히 맞는 항목 → 국명이 겹치는 항목 → (허용 시) 첫 항목 */
export function pickBestItem(
  items: Item[],
  expectedNameKo: string,
  expectedScientific: string | undefined,
  fields: FieldMap,
  allowFallback = true,
): Item | null {
  const exact = items.find((item) =>
    isNameMatch(
      pickField(item, fields.ko),
      expectedNameKo,
      pickField(item, fields.sci),
      expectedScientific,
    ),
  );
  if (exact) return exact;

  const partial = items.find((item) => {
    const ko = pickField(item, fields.ko);
    return (
      ko &&
      (ko.includes(expectedNameKo) ||
        expectedNameKo.includes(ko.replace(/\(.*\)/, '').trim()))
    );
  });
  if (partial) return partial;

  return allowFallback ? (items[0] ?? null) : null;
}

/** 응답 항목 중 가장 잘 맞는 하나를 공통 레코드로 바꾼다. */
export function buildRecord(
  items: Item[],
  expectedNameKo: string,
  expectedScientific: string | undefined,
  source: PublicFishRecord['source'],
  fields: FieldMap,
): PublicFishRecord | null {
  const item = pickBestItem(items, expectedNameKo, expectedScientific, fields);
  if (!item) return null;

  const nameKo = pickField(item, fields.ko);
  const scientificName = pickField(item, fields.sci);
  return {
    nameKo,
    nameEn: pickField(item, fields.en),
    scientificName,
    taxonomy: odcloudTaxonomy(item) ?? pickField(item, fields.tax),
    habitat: pickField(item, fields.habitat),
    distribution: pickField(item, fields.distribution),
    ecology: pickField(item, fields.ecology),
    morphology: pickField(item, fields.morphology),
    source,
    matched: isNameMatch(
      nameKo,
      expectedNameKo,
      scientificName,
      expectedScientific,
    ),
  };
}
