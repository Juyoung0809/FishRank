import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  getRegionDisplayName,
  RegionLevel,
  resolveCatchRegionKey,
} from '../common/constants/korean-regions';
import { compareOfficialRank, OFFICIAL_RANK_ORDER } from './official-rank';
import { parseLimit } from '../common/pagination.util';

export type RankingType = 'official' | 'unofficial';
type PeriodType = 'weekly' | 'alltime';

type RankingEntry = {
  rank: number;
  user: { id: string; nickname: string; profileImage: string | null };
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

type CatchWithRelations = {
  userId?: string;
  user: {
    id: string;
    nickname: string;
    profileImage: string | null;
    activityRegion?: string | null;
  };
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

type OvertakeCatch = {
  id: string;
  userId: string;
  rankScore: unknown;
  createdAt: Date;
  lengthCm: unknown;
  user: { id: string; nickname: string; profileImage: string | null };
  fishSpecies: { id: number; nameKo: string } | null;
  certification: { grade: string } | null;
};

type OvertakeEvent = {
  overtaker: { id: string; nickname: string; profileImage: string | null };
  overtaken: { id: string; nickname: string; profileImage: string | null };
  newRank: number;
  overtakenPreviousRank: number;
  fishSpecies: { id: number; nameKo: string } | null;
  lengthCm: unknown;
  grade: string | null;
  occurredAt: Date;
};

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function briefUser(user: {
  id: string;
  nickname: string;
  profileImage: string | null;
}) {
  return {
    id: user.id,
    nickname: user.nickname,
    profileImage: user.profileImage,
  };
}

/** 자랑 랭킹: 추천 수 내림차순, 동점이면 최신 기록이 위. */
function sortByVotes(list: CatchWithRelations[]) {
  const votesOf = (c: CatchWithRelations) => c._count?.votes ?? 0;
  return [...list].sort(
    (a, b) =>
      votesOf(b) - votesOf(a) || b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

function sortForType(list: CatchWithRelations[], rankingType: RankingType) {
  return rankingType === 'official'
    ? [...list].sort(compareOfficialRank)
    : sortByVotes(list);
}

@Injectable()
export class RankingsService {
  constructor(private prisma: PrismaService) {}

  private buildBaseWhere(
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

  private catchInclude(rankingType: RankingType, withRegion = false) {
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

  private mapCatchToRanking(
    c: CatchWithRelations,
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

  private async fetchRankedCatches(
    speciesId: number | undefined,
    weekly: boolean,
    rankingType: RankingType,
    limit: number,
  ) {
    limit = parseLimit(limit, 10, 100);
    const catches = await this.prisma.catch.findMany({
      where: this.buildBaseWhere(speciesId, weekly, rankingType),
      include: this.catchInclude(rankingType),
      // 자랑 랭킹은 추천 수로 정렬해야 해서 전부 불러와 메모리에서 정렬한다
      ...(rankingType === 'official'
        ? { orderBy: OFFICIAL_RANK_ORDER, take: limit }
        : {}),
    });

    const ranked: CatchWithRelations[] =
      rankingType === 'official'
        ? catches
        : sortByVotes(catches).slice(0, limit);
    return ranked.map((c, index) =>
      this.mapCatchToRanking(c, index + 1, rankingType),
    );
  }

  /** 상위권에서 오늘 0시 이전 대비 가장 크게 오른 기록. 없으면 현재 1위. (공식 랭킹 전용) */
  async getTodayHighlight(
    speciesId?: number,
    periodType: PeriodType = 'weekly',
    topPool = 20,
  ): Promise<RankingHighlight | null> {
    const allCatches = (await this.prisma.catch.findMany({
      where: this.buildBaseWhere(
        speciesId,
        periodType === 'weekly',
        'official',
      ),
      include: this.catchInclude('official'),
    })) as CatchWithRelations[];
    if (!allCatches.length) return null;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const currentSorted = sortForType(allCatches, 'official');
    const beforeSorted = sortForType(
      allCatches.filter((c) => c.createdAt < startOfToday),
      'official',
    );

    // 현재 순위를 위에서부터 훑으므로 상승 폭이 같으면 먼저 찾은(더 높은) 순위가 남는다
    let best: RankingHighlight | null = null;
    for (const [i, c] of currentSorted.slice(0, topPool).entries()) {
      const currentRank = i + 1;
      const prevIndex = beforeSorted.findIndex((x) => x.id === c.id);
      const previousRank =
        prevIndex >= 0 ? prevIndex + 1 : beforeSorted.length + 1;
      const rankGain = previousRank - currentRank;
      if (rankGain < 2 || (best && rankGain <= best.rankGain)) continue;
      best = {
        ...this.mapCatchToRanking(c, currentRank, 'official'),
        previousRank,
        rankGain,
        highlightReason: `${previousRank}위 → ${currentRank}위`,
      };
    }

    return (
      best ?? {
        ...this.mapCatchToRanking(currentSorted[0], 1, 'official'),
        previousRank: null,
        rankGain: 0,
        highlightReason: null,
      }
    );
  }

  async getBragFeed(
    speciesId?: number,
    periodType: PeriodType = 'weekly',
    excludeUserId?: string,
    limit = 50,
  ) {
    const where = this.buildBaseWhere(
      speciesId,
      periodType === 'weekly',
      'unofficial',
    );
    if (excludeUserId) where.userId = { not: excludeUserId };

    const catches = await this.prisma.catch.findMany({
      where,
      include: this.catchInclude('unofficial'),
      orderBy: { createdAt: 'desc' },
      take: parseLimit(limit, 50, 100),
    });
    return catches.map((c) => this.mapCatchToRanking(c, 0, 'unofficial'));
  }

  async getTopRankings(
    speciesId?: number,
    limit = 10,
    rankingType: RankingType = 'official',
  ) {
    return this.fetchRankedCatches(speciesId, false, rankingType, limit);
  }

  async getWeeklyRankings(
    speciesId?: number,
    limit = 10,
    rankingType: RankingType = 'official',
  ) {
    return this.fetchRankedCatches(speciesId, true, rankingType, limit);
  }

  async getWeeklySpeciesSpotlight() {
    const topRanking = await this.getWeeklyRankings(undefined, 1, 'official');
    const topRankSpecies = topRanking[0]?.fishSpecies?.nameKo ?? null;

    const [topGroup] = await this.prisma.catch.groupBy({
      by: ['fishSpeciesId'],
      where: {
        status: 'approved',
        recordType: 'certified',
        deletedAt: null,
        createdAt: { gte: daysAgo(7) },
        fishSpeciesId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { fishSpeciesId: 'desc' } },
      take: 1,
    });

    if (!topGroup?.fishSpeciesId) {
      return { topRankSpecies, popularSpecies: null, popularCatchCount: 0 };
    }

    const species = await this.prisma.fishSpecies.findUnique({
      where: { id: topGroup.fishSpeciesId },
      select: { nameKo: true },
    });
    return {
      topRankSpecies,
      popularSpecies: species?.nameKo ?? null,
      popularCatchCount: topGroup._count._all,
    };
  }

  /** 지역 판정에 활동 지역이 필요해서 사용자 활동 지역까지 함께 불러와 정렬한다. */
  private async fetchSortedWithRegion(
    periodType: PeriodType,
    speciesId: number | undefined,
    rankingType: RankingType,
  ) {
    const catches = (await this.prisma.catch.findMany({
      where: this.buildBaseWhere(
        speciesId,
        periodType === 'weekly',
        rankingType,
      ),
      include: this.catchInclude(rankingType, true),
    })) as CatchWithRelations[];
    return sortForType(catches, rankingType);
  }

  async getRegionalKings(
    level: RegionLevel,
    periodType: PeriodType = 'weekly',
    speciesId?: number,
    rankingType: RankingType = 'official',
  ) {
    const ranked = await this.fetchSortedWithRegion(
      periodType,
      speciesId,
      rankingType,
    );

    const kings = new Map<string, RankingEntry>();
    const counts = new Map<string, number>();
    for (const c of ranked) {
      const regionKey = resolveCatchRegionKey(
        c.user.activityRegion,
        c.locationName,
        level,
      );
      if (!regionKey) continue;
      counts.set(regionKey, (counts.get(regionKey) ?? 0) + 1);
      if (!kings.has(regionKey))
        kings.set(regionKey, this.mapCatchToRanking(c, 1, rankingType));
    }

    return Array.from(kings.entries())
      .map(([regionKey, king]) => ({
        regionKey,
        regionName: getRegionDisplayName(regionKey, level),
        recordCount: counts.get(regionKey) ?? 0,
        king,
      }))
      .sort((a, b) => a.regionName.localeCompare(b.regionName, 'ko'));
  }

  async getRegionalRankings(
    regionKey: string,
    level: RegionLevel,
    periodType: PeriodType = 'weekly',
    speciesId?: number,
    limit = 20,
    rankingType: RankingType = 'official',
  ) {
    const ranked = (
      await this.fetchSortedWithRegion(periodType, speciesId, rankingType)
    ).filter(
      (c) =>
        resolveCatchRegionKey(c.user.activityRegion, c.locationName, level) ===
        regionKey,
    );

    return {
      regionKey,
      regionName: getRegionDisplayName(regionKey, level),
      rankings: ranked
        .slice(0, parseLimit(limit, 20, 50))
        .map((c, index) => this.mapCatchToRanking(c, index + 1, rankingType)),
    };
  }

  /** 최근 14일 기록 중 공식 상위 topN 안에서 다른 사람을 밀어낸 사건. */
  async getTopOvertakes(
    periodType: PeriodType = 'weekly',
    speciesId?: number,
    topN = 10,
    limit = 8,
  ) {
    topN = parseLimit(topN, 10, 50);
    limit = parseLimit(limit, 8, 30);

    const allCatches = (await this.prisma.catch.findMany({
      where: this.buildBaseWhere(speciesId, periodType === 'weekly'),
      include: {
        user: { select: { id: true, nickname: true, profileImage: true } },
        fishSpecies: { select: { id: true, nameKo: true } },
        certification: { select: { grade: true } },
      },
    })) as OvertakeCatch[];

    const cutoff = daysAgo(14);
    const recent = allCatches
      .filter((c) => c.createdAt >= cutoff)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const topOf = (pool: OvertakeCatch[]) =>
      [...pool].sort(compareOfficialRank).slice(0, topN);

    const events: OvertakeEvent[] = [];
    for (const c of recent) {
      const beforeTop = topOf(
        allCatches.filter((x) => x.createdAt < c.createdAt),
      );
      const afterTop = topOf(
        allCatches.filter((x) => x.createdAt <= c.createdAt),
      );

      const newRank = afterTop.findIndex((x) => x.id === c.id) + 1;
      if (newRank <= 0) continue;

      const displaced = beforeTop[newRank - 1];
      if (!displaced || displaced.id === c.id || displaced.userId === c.userId)
        continue;
      if (Number(c.rankScore) <= Number(displaced.rankScore)) continue;

      const displacedAfterRank = afterTop.findIndex(
        (x) => x.id === displaced.id,
      );
      if (displacedAfterRank !== -1 && displacedAfterRank + 1 <= newRank)
        continue;

      events.push({
        overtaker: briefUser(c.user),
        overtaken: briefUser(displaced.user),
        newRank,
        overtakenPreviousRank: newRank,
        fishSpecies: c.fishSpecies,
        lengthCm: c.lengthCm,
        grade: c.certification?.grade ?? null,
        occurredAt: c.createdAt,
      });
      if (events.length >= limit) break;
    }

    return events;
  }
}
