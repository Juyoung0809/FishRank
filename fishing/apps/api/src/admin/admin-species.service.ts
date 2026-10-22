import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pageWindow, paginated } from '../common/pagination.util';
import type { UpdateSpeciesDto } from './dto/update-species.dto';

/** 어종 마스터(희귀도·법정 체장) 관리 */
@Injectable()
export class AdminSpeciesService {
  constructor(private prisma: PrismaService) {}

  async list(search?: string, page = 1, limit = 30) {
    const w = pageWindow(page, limit, 100);
    const q = search?.trim();
    const where = q
      ? {
          OR: [
            { nameKo: { contains: q, mode: 'insensitive' as const } },
            { nameEn: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.fishSpecies.findMany({
        where,
        include: { _count: { select: { catches: true } } },
        orderBy: { nameKo: 'asc' },
        skip: w.skip,
        take: w.take,
      }),
      this.prisma.fishSpecies.count({ where }),
    ]);
    return paginated(items, total, w.page, w.take);
  }

  async update(speciesId: number, dto: UpdateSpeciesDto) {
    const species = await this.prisma.fishSpecies.findUnique({
      where: { id: speciesId },
    });
    if (!species) throw new NotFoundException('어종을 찾을 수 없습니다.');

    return this.prisma.fishSpecies.update({
      where: { id: speciesId },
      data: {
        ...(dto.rarityWeight !== undefined
          ? { rarityWeight: dto.rarityWeight }
          : {}),
        ...(dto.minLengthCm !== undefined
          ? { minLengthCm: dto.minLengthCm }
          : {}),
      },
      include: { _count: { select: { catches: true } } },
    });
  }
}
