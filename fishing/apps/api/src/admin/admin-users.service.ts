import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pageWindow, paginated } from '../common/pagination.util';
import type { UpdateUserDto } from './dto/update-user.dto';

/** 회원 관리와 회원의 대회 참가 내역 */
@Injectable()
export class AdminUsersService {
  constructor(private prisma: PrismaService) {}

  async list(
    search?: string,
    role?: string,
    accountStatus = 'active',
    page = 1,
    limit = 20,
  ) {
    const w = pageWindow(page, limit);
    const where: Record<string, unknown> = {};

    if (accountStatus === 'suspended') where.deletedAt = { not: null };
    else if (accountStatus !== 'all') where.deletedAt = null;

    if (role && role !== 'all') where.role = role;

    const q = search?.trim();
    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { nickname: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          nickname: true,
          role: true,
          provider: true,
          profileImage: true,
          fishingCategory: true,
          activityRegion: true,
          createdAt: true,
          deletedAt: true,
          _count: {
            select: {
              catches: true,
              posts: true,
              comments: true,
              userFeedbacks: true,
              contentReports: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: w.skip,
        take: w.take,
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(items, total, w.page, w.take);
  }

  async getDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nickname: true,
        role: true,
        provider: true,
        providerId: true,
        profileImage: true,
        bio: true,
        activityRegion: true,
        fishingCategory: true,
        featuredCatchIds: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        _count: {
          select: {
            catches: true,
            posts: true,
            comments: true,
            userFeedbacks: true,
            contentReports: true,
            catchVotes: true,
            tournamentEntries: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    const [recentCatches, recentPosts, recentFeedbacks] = await Promise.all([
      this.prisma.catch.findMany({
        where: { userId, deletedAt: null },
        include: {
          fishSpecies: { select: { nameKo: true } },
          certification: { select: { grade: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.post.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, title: true, viewCount: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.userFeedback.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    return { user, recentCatches, recentPosts, recentFeedbacks };
  }

  async update(userId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    if (dto.role && dto.role !== 'admin' && user.role === 'admin') {
      const adminCount = await this.prisma.user.count({
        where: { role: 'admin', deletedAt: null, id: { not: userId } },
      });
      if (adminCount < 1) {
        throw new BadRequestException(
          '마지막 관리자 계정의 권한은 해제할 수 없습니다.',
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.role) data.role = dto.role;
    if (dto.accountStatus === 'suspended') {
      data.deletedAt = new Date();
      data.refreshTokenHash = null;
    }
    if (dto.accountStatus === 'active') data.deletedAt = null;

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        nickname: true,
        role: true,
        deletedAt: true,
      },
    });
  }

  async listTournamentEntries(tournamentId?: string, page = 1, limit = 30) {
    const w = pageWindow(page, limit);
    const where = tournamentId ? { tournamentId } : {};
    const [items, total] = await Promise.all([
      this.prisma.tournamentEntry.findMany({
        where,
        include: {
          user: { select: { id: true, nickname: true, email: true } },
          tournament: { select: { id: true, title: true, status: true } },
        },
        orderBy: { joinedAt: 'desc' },
        skip: w.skip,
        take: w.take,
      }),
      this.prisma.tournamentEntry.count({ where }),
    ]);
    return paginated(items, total, w.page, w.take);
  }
}
