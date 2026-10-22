import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  getRegionDisplayName,
  RegionLevel,
  resolveCatchRegionKey,
} from '../common/constants/korean-regions';
import { parseLimit } from '../common/pagination.util';
import {
  rankingInclude,
  rankingWhere,
  sortForType,
  toRankingEntry,
  type PeriodType,
  type RankedCatch,
  type RankingEntry,
  type RankingType,
} from './ranking.mapper';

/** 지역(시·도 / 시·군·구)별 낚시왕과 지역 랭킹. 지역은 사용자 활동 지역 → 기록 장소 순으로 정한다. */
@Injectable()
export class RegionalRankingsService {
  constructor(private prisma: PrismaService) {}

  async getKings(
    level: RegionLevel,
    periodType: PeriodType = 'weekly',
    speciesId?: number,
    rankingType: RankingType = 'official',
  ) {
    const ranked = await this.fetchSorted(periodType, speciesId, rankingType);

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
        kings.set(regionKey, toRankingEntry(c, 1, rankingType));
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

  async getRankings(
    regionKey: string,
    level: RegionLevel,
    periodType: PeriodType = 'weekly',
    speciesId?: number,
    limit = 20,
    rankingType: RankingType = 'official',
  ) {
    const ranked = (
      await this.fetchSorted(periodType, speciesId, rankingType)
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
        .map((c, index) => toRankingEntry(c, index + 1, rankingType)),
    };
  }

  private async fetchSorted(
    periodType: PeriodType,
    speciesId: number | undefined,
    rankingType: RankingType,
  ) {
    const catches = (await this.prisma.catch.findMany({
      where: rankingWhere(speciesId, periodType === 'weekly', rankingType),
      include: rankingInclude(rankingType, true),
    })) as RankedCatch[];
    return sortForType(catches, rankingType);
  }
}
