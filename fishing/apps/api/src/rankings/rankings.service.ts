import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseLimit } from '../common/pagination.util';
import { OFFICIAL_RANK_ORDER } from './official-rank';
import {
  daysAgo,
  rankingInclude,
  rankingWhere,
  sortByVotes,
  sortForType,
  toRankingEntry,
  type PeriodType,
  type RankedCatch,
  type RankingHighlight,
  type RankingType,
} from './ranking.mapper';

export type { RankingHighlight, RankingType } from './ranking.mapper';

/** 전체·주간 랭킹, 오늘의 순위 상승, 자랑 피드, 이번 주 인기 어종 */
@Injectable()
export class RankingsService {
  constructor(private prisma: PrismaService) {}

  async getTopRankings(
    speciesId?: number,
    limit = 10,
    rankingType: RankingType = 'official',
  ) {
    return this.fetchRanked(speciesId, false, rankingType, limit);
  }

  async getWeeklyRankings(
    speciesId?: number,
    limit = 10,
    rankingType: RankingType = 'official',
  ) {
    return this.fetchRanked(speciesId, true, rankingType, limit);
  }

  private async fetchRanked(
    speciesId: number | undefined,
    weekly: boolean,
    rankingType: RankingType,
    limit: number,
  ) {
    limit = parseLimit(limit, 10, 100);
    const catches = await this.prisma.catch.findMany({
      where: rankingWhere(speciesId, weekly, rankingType),
      include: rankingInclude(rankingType),
      // 자랑 랭킹은 추천 수로 정렬해야 해서 전부 불러와 메모리에서 정렬한다
      ...(rankingType === 'official'
        ? { orderBy: OFFICIAL_RANK_ORDER, take: limit }
        : {}),
    });

    const ranked: RankedCatch[] =
      rankingType === 'official'
        ? catches
        : sortByVotes(catches).slice(0, limit);
    return ranked.map((c, index) => toRankingEntry(c, index + 1, rankingType));
  }

  /** 상위권에서 오늘 0시 이전 대비 2계단 이상 가장 크게 오른 기록. 없으면 현재 1위. (공식 랭킹 전용) */
  async getTodayHighlight(
    speciesId?: number,
    periodType: PeriodType = 'weekly',
    topPool = 20,
  ): Promise<RankingHighlight | null> {
    const allCatches = (await this.prisma.catch.findMany({
      where: rankingWhere(speciesId, periodType === 'weekly', 'official'),
      include: rankingInclude('official'),
    })) as RankedCatch[];
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
        ...toRankingEntry(c, currentRank, 'official'),
        previousRank,
        rankGain,
        highlightReason: `${previousRank}위 → ${currentRank}위`,
      };
    }

    return (
      best ?? {
        ...toRankingEntry(currentSorted[0], 1, 'official'),
        previousRank: null,
        rankGain: 0,
        highlightReason: null,
      }
    );
  }

  /** 새 자랑 기록을 평가하는 피드 (최신순) */
  async getBragFeed(
    speciesId?: number,
    periodType: PeriodType = 'weekly',
    excludeUserId?: string,
    limit = 50,
  ) {
    const where = rankingWhere(
      speciesId,
      periodType === 'weekly',
      'unofficial',
    );
    if (excludeUserId) where.userId = { not: excludeUserId };

    const catches = await this.prisma.catch.findMany({
      where,
      include: rankingInclude('unofficial'),
      orderBy: { createdAt: 'desc' },
      take: parseLimit(limit, 50, 100),
    });
    return catches.map((c) => toRankingEntry(c, 0, 'unofficial'));
  }

  /** 주간 1위 기록의 어종과 이번 주 인증이 가장 많은 어종 */
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
}
