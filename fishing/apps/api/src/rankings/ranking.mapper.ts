import { compareOfficialRank } from './official-rank';

export type RankingType = 'official' | 'unofficial';
export type PeriodType = 'weekly' | 'alltime';

export type BriefUser = {
  id: string;
  nickname: string;
  profileImage: string | null;
};

export type RankingEntry = {
  rank: number;
  user: BriefUser;
  catch: {
    id: string;
    imageUrl: string;
    locationName: string | null;
    createdAt: Date;
    memo?: string | null;
  };
  fishSpecies: { id: number; nameKo: string; rarityWeight: unknown } | null;
  lengthCm: unknown;
  rankScore: unknown;
  voteCount?: number;
  grade: string | null;
  recordType: 'certified' | 'personal';
  verified: boolean;
};

export type RankingHighlight = RankingEntry & {
  previousRank: number | null;
  rankGain: number;
  highlightReason: string | null;
};

/** 랭킹 계산에 쓰는 기록 행 (include 결과) */
export type RankedCatch = {
  userId?: string;
  user: BriefUser & { activityRegion?: string | null };
  id: string;
  imageUrl: string;
  locationName: string | null;
  createdAt: Date;
  memo?: string | null;
  recordType: string;
  fishSpecies: { id: number; nameKo: string; rarityWeight: unknown } | null;
  lengthCm: unknown;
  rankScore: unknown;
  certification: { grade: string } | null;
  _count?: { votes: number };
};

export function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

export function briefUser(user: BriefUser): BriefUser {
  return {
    id: user.id,
    nickname: user.nickname,
    profileImage: user.profileImage,
  };
}

/** 공식: 승인된 인증 기록(점수 있음), 자랑: 승인된 자랑 기록. 종·주간 조건을 더한다. */
export function rankingWhere(
  speciesId?: number,
  weekly = false,
  rankingType: RankingType = 'official',
) {
  const where: Record<string, unknown> =
    rankingType === 'unofficial'
      ? { status: 'approved', recordType: 'personal', deletedAt: null }
      : {
          status: 'approved',
          recordType: 'certified',
          deletedAt: null,
          rankScore: { not: null },
        };

  if (speciesId) where.fishSpeciesId = speciesId;
  if (weekly) where.createdAt = { gte: daysAgo(7) };
  return where;
}

/** 자랑 랭킹은 추천 수가 필요하고, 지역 랭킹은 사용자 활동 지역이 필요하다. */
export function rankingInclude(rankingType: RankingType, withRegion = false) {
  return {
    user: {
      select: {
        id: true,
        nickname: true,
        profileImage: true,
        activityRegion: withRegion,
      },
    },
    fishSpecies: true,
    certification: { select: { grade: true } },
    ...(rankingType === 'unofficial'
      ? { _count: { select: { votes: true } } }
      : {}),
  };
}

/** 자랑 랭킹: 추천 수 내림차순, 동점이면 최신 기록이 위. */
export function sortByVotes(list: RankedCatch[]) {
  const votesOf = (c: RankedCatch) => c._count?.votes ?? 0;
  return [...list].sort(
    (a, b) =>
      votesOf(b) - votesOf(a) || b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

export function sortForType(list: RankedCatch[], rankingType: RankingType) {
  return rankingType === 'official'
    ? [...list].sort(compareOfficialRank)
    : sortByVotes(list);
}

/** 공식은 점수·등급, 자랑은 추천 수·메모를 보여 준다. */
export function toRankingEntry(
  c: RankedCatch,
  rank: number,
  rankingType: RankingType,
): RankingEntry {
  const official = rankingType === 'official';
  const voteCount = c._count?.votes ?? 0;

  return {
    rank,
    user: briefUser(c.user),
    catch: {
      id: c.id,
      imageUrl: c.imageUrl,
      locationName: c.locationName,
      createdAt: c.createdAt,
      ...(official ? {} : { memo: c.memo ?? null }),
    },
    fishSpecies: c.fishSpecies,
    lengthCm: c.lengthCm,
    rankScore: official ? Number(c.rankScore) : voteCount,
    voteCount: official ? undefined : voteCount,
    grade: official ? (c.certification?.grade ?? null) : null,
    recordType: c.recordType as 'certified' | 'personal',
    verified: official,
  };
}
