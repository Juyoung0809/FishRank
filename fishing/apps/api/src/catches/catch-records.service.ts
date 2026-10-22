import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { softDeleteCatchData } from '../common/upload/catch-retention.util';
import { parsePageLimit } from '../common/pagination.util';
import { toPublicCatch, toPublicCatches } from './public-catch';

/** 기록 조회(단건·처리 상태·내 목록)와 본인 자랑 기록 수정·삭제. 응답에서 비공개 칸은 뺀다. */
@Injectable()
export class CatchRecordsService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const catch_ = await this.prisma.catch.findUnique({
      where: { id, deletedAt: null },
      include: {
        user: { select: { id: true, nickname: true, profileImage: true } },
        fishSpecies: true,
        certification: true,
      },
    });
    if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');
    return toPublicCatch(catch_);
  }

  async findStatus(id: string) {
    const catch_ = await this.prisma.catch.findUnique({
      where: { id },
      include: {
        certification: { select: { grade: true } },
        fishSpecies: { select: { nameKo: true } },
      },
    });
    if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');

    return {
      status: catch_.status,
      recordType: catch_.recordType,
      grade: catch_.certification?.grade ?? null,
      lengthCm: catch_.lengthCm,
      fishSpecies: catch_.fishSpecies?.nameKo ?? null,
    };
  }

  async findMyList(userId: string, page = 1, limit = 20, recordType?: string) {
    const paging = parsePageLimit(page, limit, 20, 50);
    const where = {
      userId,
      deletedAt: null,
      ...(recordType === 'certified' || recordType === 'personal'
        ? { recordType }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.catch.findMany({
        where,
        include: {
          fishSpecies: true,
          certification: { select: { grade: true, errorMessage: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (paging.page - 1) * paging.limit,
        take: paging.limit,
      }),
      this.prisma.catch.count({ where }),
    ]);

    return {
      items: toPublicCatches(items),
      total,
      page: paging.page,
      limit: paging.limit,
      recordType: recordType ?? 'all',
    };
  }

  async updatePersonal(
    userId: string,
    catchId: string,
    body: { memo?: string; locationName?: string; fishSpeciesId?: number },
  ) {
    await this.findOwnPersonal(userId, catchId, '수정');

    const data: Record<string, unknown> = {};
    if (body.memo !== undefined) data.memo = body.memo.trim() || null;
    if (body.locationName !== undefined)
      data.locationName = body.locationName.trim() || null;
    if (body.fishSpeciesId !== undefined)
      data.fishSpeciesId = body.fishSpeciesId;

    const updated = await this.prisma.catch.update({
      where: { id: catchId },
      data,
      include: { fishSpecies: true },
    });
    return toPublicCatch(updated);
  }

  async deletePersonal(userId: string, catchId: string) {
    await this.findOwnPersonal(userId, catchId, '삭제');
    return this.prisma.catch.update({
      where: { id: catchId },
      data: softDeleteCatchData(),
    });
  }

  private async findOwnPersonal(
    userId: string,
    catchId: string,
    verb: '수정' | '삭제',
  ) {
    const catch_ = await this.prisma.catch.findUnique({
      where: { id: catchId, deletedAt: null },
    });
    if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');
    if (catch_.userId !== userId)
      throw new ForbiddenException(`본인 기록만 ${verb}할 수 있습니다.`);
    if (catch_.recordType !== 'personal') {
      throw new BadRequestException(`자랑 기록만 ${verb}할 수 있습니다.`);
    }
    return catch_;
  }
}
