import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { softDeleteCatchData } from '../common/upload/catch-retention.util';
import { computeRankScore } from '../common/certification/rank-score.util';
import { pageWindow, paginated } from '../common/pagination.util';
import type { ReviewCatchDto } from './dto/review-catch.dto';
import type { UpdateCatchRankingDto } from './dto/update-catch-ranking.dto';

/** 인증 기록 검수, 대회 코드 확인, 랭킹 운영 */
@Injectable()
export class AdminCatchesService {
  constructor(private prisma: PrismaService) {}

  async list(status?: string, page = 1, limit = 20) {
    const w = pageWindow(page, limit);
    const where: Record<string, unknown> = {
      deletedAt: null,
      recordType: 'certified',
    };
    if (status && status !== 'all') where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.catch.findMany({
        where,
        include: {
          user: { select: { id: true, nickname: true, profileImage: true } },
          fishSpecies: { select: { nameKo: true } },
          certification: true,
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: w.skip,
        take: w.take,
      }),
      this.prisma.catch.count({ where }),
    ]);
    return paginated(items, total, w.page, w.take);
  }

  async review(catchId: string, dto: ReviewCatchDto) {
    const catch_ = await this.prisma.catch.findUnique({
      where: { id: catchId, deletedAt: null },
      include: {
        certification: true,
        fishSpecies: { select: { rarityWeight: true } },
      },
    });
    if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');

    const data: { status: string; rankScore?: number | null } = {
      status: dto.status,
    };
    if (dto.status === 'rejected') {
      data.rankScore = null;
    } else if (catch_.rankScore == null) {
      const rankScore = computeRankScore(
        catch_.lengthCm,
        catch_.fishSpecies?.rarityWeight ?? 1,
        true,
      );
      if (rankScore != null) data.rankScore = rankScore;
    }

    await this.prisma.catch.update({ where: { id: catchId }, data });

    if (catch_.certification) {
      await this.prisma.certification.update({
        where: { catchId },
        data: {
          errorMessage:
            dto.status === 'rejected'
              ? dto.note?.trim() || '관리자 검수 반려'
              : null,
          processedAt: new Date(),
        },
      });
    }

    return this.prisma.catch.findUnique({
      where: { id: catchId },
      include: {
        user: { select: { nickname: true } },
        fishSpecies: { select: { nameKo: true } },
        certification: true,
      },
    });
  }

  async reviewDayCode(catchId: string, status: 'accepted' | 'rejected') {
    const catch_ = await this.findLive(catchId);
    if (!catch_.claimedDayCode)
      throw new BadRequestException('제출된 대회 코드가 없습니다.');

    await this.prisma.catch.update({
      where: { id: catchId },
      data: { dayCodeStatus: status },
    });
    return { catchId, dayCodeStatus: status };
  }

  async delete(catchId: string) {
    await this.findLive(catchId);
    await this.prisma.catch.update({
      where: { id: catchId },
      data: softDeleteCatchData(),
    });
    return { deleted: true };
  }

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
    const catch_ = await this.findLive(catchId);

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

  private async findLive(catchId: string) {
    const catch_ = await this.prisma.catch.findUnique({
      where: { id: catchId, deletedAt: null },
    });
    if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');
    return catch_;
  }
}
