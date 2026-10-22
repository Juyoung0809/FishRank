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

/** 인증 기록 검수(승인·반려), 대회 코드 확인, 기록 삭제. 랭킹 운영은 AdminRankingsService */
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

  private async findLive(catchId: string) {
    const catch_ = await this.prisma.catch.findUnique({
      where: { id: catchId, deletedAt: null },
    });
    if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');
    return catch_;
  }
}
