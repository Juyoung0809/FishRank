import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseLimit } from '../common/pagination.util';
import { compareOfficialRank } from './official-rank';
import {
  briefUser,
  daysAgo,
  rankingWhere,
  type BriefUser,
  type PeriodType,
} from './ranking.mapper';

type OvertakeCatch = {
  id: string;
  userId: string;
  rankScore: unknown;
  createdAt: Date;
  lengthCm: unknown;
  user: BriefUser;
  fishSpecies: { id: number; nameKo: string } | null;
  certification: { grade: string } | null;
};

type OvertakeEvent = {
  overtaker: BriefUser;
  overtaken: BriefUser;
  newRank: number;
  overtakenPreviousRank: number;
  fishSpecies: { id: number; nameKo: string } | null;
  lengthCm: unknown;
  grade: string | null;
  occurredAt: Date;
};

/** 상위권 추월 피드 (공식 랭킹) */
@Injectable()
export class RankingOvertakesService {
  constructor(private prisma: PrismaService) {}

  /**
   * 최근 14일 기록마다 등록 직전·직후 상위 topN 을 비교해,
   * 다른 사람의 자리를 더 높은 점수로 차지한 경우를 최신순으로 모은다.
   */
  async getTopOvertakes(
    periodType: PeriodType = 'weekly',
    speciesId?: number,
    topN = 10,
    limit = 8,
  ) {
    topN = parseLimit(topN, 10, 50);
    limit = parseLimit(limit, 8, 30);

    const allCatches = (await this.prisma.catch.findMany({
      where: rankingWhere(speciesId, periodType === 'weekly'),
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
