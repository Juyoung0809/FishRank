import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminReportsService } from './admin-reports.service';

const PENDING_CERTIFIED = {
  deletedAt: null,
  status: 'pending',
  recordType: 'certified',
};

/** 관리자 대시보드 집계 */
@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private reports: AdminReportsService,
  ) {}

  async getStats() {
    const [
      pendingCatches,
      flaggedReports,
      openFeedbacks,
      totalCatches,
      totalPosts,
      activeTournaments,
      publishedAnnouncements,
      totalUsers,
      recentPending,
      recentFlagged,
      recentPosts,
      recentFeedbacks,
    ] = await Promise.all([
      this.prisma.catch.count({ where: PENDING_CERTIFIED }),
      this.reports.countFlagged(1),
      this.prisma.userFeedback.count({ where: { status: 'open' } }),
      this.prisma.catch.count({ where: { deletedAt: null } }),
      this.prisma.post.count({ where: { deletedAt: null } }),
      this.prisma.tournament.count({
        where: { status: { in: ['upcoming', 'active'] } },
      }),
      this.prisma.announcement.count({ where: { isPublished: true } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.catch.findMany({
        where: PENDING_CERTIFIED,
        include: {
          user: { select: { nickname: true } },
          fishSpecies: { select: { nameKo: true } },
          certification: { select: { grade: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.reports.listFlagged(1, 5),
      this.prisma.post.findMany({
        where: { deletedAt: null },
        include: {
          user: { select: { nickname: true } },
          _count: { select: { comments: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.userFeedback.findMany({
        where: { status: 'open' },
        include: { user: { select: { nickname: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    return {
      pendingCatches,
      flaggedReports,
      openFeedbacks,
      totalCatches,
      totalPosts,
      activeTournaments,
      publishedAnnouncements,
      totalUsers,
      recentPending,
      recentFlagged,
      recentPosts,
      recentFeedbacks,
      generatedAt: new Date().toISOString(),
    };
  }
}
