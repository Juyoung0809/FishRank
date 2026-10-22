import { getCatalogEntry } from '../fish-info/fish-species-catalog';
import {
  isGenericSummary,
  mergeBasicInfoWithTips,
} from './encyclopedia-merge.util';
import {
  buildSpeciesSummary,
  extractHabitat,
} from './encyclopedia-summary.util';

export const SPECIES_NOT_FOUND = '어종을 찾을 수 없습니다';
export const WITH_NICKNAME = { user: { select: { nickname: true } } } as const;

type TipWithUser = {
  id: string;
  userId: string;
  season: string | null;
  bait: string | null;
  technique: string | null;
  habitat: string | null;
  note: string | null;
  summary: string | null;
  imageUrl: string | null;
  createdAt: Date;
  user: { nickname: string };
};

type SpeciesWithInfo = {
  id: number;
  nameKo: string;
  category: string;
  imageUrl: string | null;
  encyclopedia: {
    description: string;
    season: string | null;
    bait: string | null;
    technique: string | null;
    habitat: string | null;
    imageUrl: string | null;
    avgLengthCm: number | null;
    minSizeLaw: number | null;
  } | null;
  tips: Parameters<typeof mergeBasicInfoWithTips>[1];
};

export function mapTip(t: TipWithUser) {
  return {
    id: t.id,
    userId: t.userId,
    nickname: t.user.nickname,
    season: t.season,
    bait: t.bait,
    technique: t.technique,
    habitat: t.habitat,
    note: t.note,
    summary: t.summary,
    imageUrl: t.imageUrl,
    createdAt: t.createdAt,
  };
}

/** 공식 정보(DB·카탈로그)를 기본으로 두고 빈 칸을 낚시인 기여로 채운 현재 사전 내용 */
export function mergedSpeciesInfo(species: SpeciesWithInfo) {
  const catalog = getCatalogEntry(species.id);
  const enc = species.encyclopedia;
  const nameKo = catalog?.nameKo ?? species.nameKo;
  const summary = buildSpeciesSummary(
    nameKo,
    enc?.description,
    species.category,
    catalog,
  );

  const merged = mergeBasicInfoWithTips(
    {
      imageUrl: species.imageUrl ?? enc?.imageUrl ?? null,
      season: enc?.season ?? catalog?.season ?? null,
      bait: enc?.bait ?? catalog?.bait ?? null,
      technique: enc?.technique ?? catalog?.technique ?? null,
      habitat: enc?.habitat ?? extractHabitat(enc?.description),
      summary: summary && !isGenericSummary(summary, nameKo) ? summary : null,
      avgLengthCm: enc?.avgLengthCm ?? catalog?.avgLengthCm ?? null,
    },
    species.tips,
  );
  return { nameKo, catalog, merged };
}
