import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MAX_GEARS = 6;

const GEAR_SELECT = {
  id: true,
  title: true,
  description: true,
  imageUrl: true,
  sortOrder: true,
  createdAt: true,
} as const;

/** 프로필에 보여 주는 내 장비 (최대 6개) */
@Injectable()
export class UserGearsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.userGear.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: GEAR_SELECT,
    });
  }

  async create(
    userId: string,
    dto: { title: string; description?: string },
    imageUrl?: string | null,
  ) {
    const count = await this.prisma.userGear.count({ where: { userId } });
    if (count >= MAX_GEARS) {
      throw new BadRequestException(
        `장비는 최대 ${MAX_GEARS}개까지 등록할 수 있습니다.`,
      );
    }

    return this.prisma.userGear.create({
      data: {
        userId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        imageUrl: imageUrl ?? null,
        sortOrder: count,
      },
      select: GEAR_SELECT,
    });
  }

  /** imageUrl 이 undefined 면 사진은 그대로 둔다. */
  async update(
    userId: string,
    gearId: string,
    dto: { title?: string; description?: string },
    imageUrl?: string | null,
  ) {
    await this.assertOwn(userId, gearId);

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined)
      data.description = dto.description?.trim() || null;
    if (imageUrl !== undefined) data.imageUrl = imageUrl;

    return this.prisma.userGear.update({
      where: { id: gearId },
      data,
      select: GEAR_SELECT,
    });
  }

  async delete(userId: string, gearId: string) {
    await this.assertOwn(userId, gearId);
    await this.prisma.userGear.delete({ where: { id: gearId } });
    return { deleted: true };
  }

  private async assertOwn(userId: string, gearId: string) {
    const gear = await this.prisma.userGear.findFirst({
      where: { id: gearId, userId },
    });
    if (!gear) throw new NotFoundException('장비를 찾을 수 없습니다.');
  }
}
