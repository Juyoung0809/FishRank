import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertAnnouncementDto } from './dto/upsert-announcement.dto';

const WITH_AUTHOR = { author: { select: { nickname: true } } } as const;

function announcementData(dto: UpsertAnnouncementDto) {
  return {
    type: dto.type,
    title: dto.title.trim(),
    content: dto.content.trim(),
    linkUrl: dto.linkUrl?.trim() || null,
    isPinned: dto.isPinned ?? false,
    isPublished: dto.isPublished ?? true,
    startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
    endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
  };
}

@Injectable()
export class AnnouncementsService {
  constructor(private prisma: PrismaService) {}

  async listAll() {
    return this.prisma.announcement.findMany({
      include: WITH_AUTHOR,
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(userId: string, dto: UpsertAnnouncementDto) {
    return this.prisma.announcement.create({
      data: { ...announcementData(dto), createdBy: userId },
      include: WITH_AUTHOR,
    });
  }

  async update(id: string, dto: UpsertAnnouncementDto) {
    await this.assertExists(id);
    return this.prisma.announcement.update({
      where: { id },
      data: announcementData(dto),
      include: WITH_AUTHOR,
    });
  }

  async delete(id: string) {
    await this.assertExists(id);
    await this.prisma.announcement.delete({ where: { id } });
    return { deleted: true };
  }

  /** 게시 중이고 노출 기간(startsAt~endsAt, 비어 있으면 무제한) 안에 있는 공지 */
  async listPublic(limit = 10) {
    const now = new Date();
    return this.prisma.announcement.findMany({
      where: {
        isPublished: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        linkUrl: true,
        isPinned: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
      },
    });
  }

  private async assertExists(id: string) {
    const existing = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('공지를 찾을 수 없습니다.');
  }
}
