import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pageWindow, paginated } from '../common/pagination.util';
import type { UpdateCatchRankingDto } from './dto/update-catch-ranking.dto';

/** 랭킹 운영: 공식(점수순)·자랑(추천순) 랭킹 목록과 점수·상태 수동 조정 */
@Injectable()
export class AdminRankingsService {
  constructor(private prisma: PrismaService) {}

  async listRankings(
    periodType = 'alltime',
    rankingType: 'official' | 'unofficial' = 'official',
    speciesId?: number,
    page = 1,
    limit = 30,
  ) {
    const w = pageWindow(page, limit);
    const where: Record<string, unknown> = {
      status: 'approved',
      recordType: rankingType === 'unofficial' ? 'personal' : 'certified',
      deletedAt: null,
    };
    if (speciesId) where.fishSpeciesId = speciesId;
    if (periodType === 'weekly') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      where.createdAt = { gte: weekAgo };
    }

    const include = {
      user: {
        select: { id: true, nickname: true, email: true, profileImage: true },
      },
      fishSpecies: { select: { id: true, nameKo: true, rarityWeight: true } },
      certification: { select: { grade: true } },
      _count: { select: { votes: true } },
    };

    const total = await this.prisma.catch.count({ where });
    let items;
    if (rankingType === 'official') {
      items = await this.prisma.catch.findMany({
        where,
        include,
        orderBy: { rankScore: 'desc' },
        skip: w.skip,
        take: w.take,
      });
    } else {
      // 추천 수는 정렬 키로 쓸 수 없어 최근 1000건을 메모리에서 정렬한다
      const pool = await this.prisma.catch.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        take: Math.min(1000, total),
      });
      items = pool
        .sort((a, b) => b._count.votes - a._count.votes)
        .slice(w.skip, w.skip + w.take);
    }

    const ranked = items.map((c, index) => ({
      ...c,
      displayRank: w.skip + index + 1,
      effectiveScore:
        rankingType === 'official' ? Number(c.rankScore ?? 0) : c._count.votes,
    }));
    return {
      ...paginated(ranked, total, w.page, w.take),
      periodType,
      rankingType,
    };
  }

  async updateRanking(catchId: string, dto: UpdateCatchRankingDto) {
    const catch_ = await this.prisma.catch.findUnique({
      where: { id: catchId, deletedAt: null },
    });
    if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');

    const data: Record<string, unknown> = {};
    if (dto.rankScore !== undefined) data.rankScore = dto.rankScore;
    if (dto.lengthCm !== undefined) data.lengthCm = dto.lengthCm;
    if (dto.status) data.status = dto.status;
    if (dto.excludeFromRanking) data.rankScore = null;

    if (
      dto.status === 'approved' &&
      dto.rankScore === undefined &&
      !dto.excludeFromRanking
    ) {
      const length = dto.lengthCm ?? catch_.lengthCm;
      if (length) data.rankScore = Number(length);
    }

    return this.prisma.catch.update({
      where: { id: catchId },
      data,
      include: {
        user: { select: { id: true, nickname: true, email: true } },
        fishSpecies: { select: { id: true, nameKo: true } },
        certification: { select: { grade: true } },
        _count: { select: { votes: true } },
      },
    });
  }
}
