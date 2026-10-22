import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { softDeleteCatchData } from '../common/upload/catch-retention.util';

export type ReportTargetType = 'catch' | 'post';

/** 신고 누적 콘텐츠 조회·처리 */
@Injectable()
export class AdminReportsService {
  constructor(private prisma: PrismaService) {}

  async countFlagged(minCount = 1) {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT target_type, target_id
        FROM content_reports
        WHERE status = 'open'
        GROUP BY target_type, target_id
        HAVING COUNT(*) >= ${minCount}
      ) flagged
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async listFlagged(minCount = 1, limit = 50) {
    const rows = await this.prisma.$queryRaw<
      Array<{ target_type: string; target_id: string; report_count: number }>
    >`
      SELECT target_type, target_id, COUNT(*)::int AS report_count
      FROM content_reports
      WHERE status = 'open'
      GROUP BY target_type, target_id
      HAVING COUNT(*) >= ${minCount}
      ORDER BY report_count DESC
      LIMIT ${limit}
    `;

    const items = await Promise.all(
      rows.map(async (row) => {
        const [reports, target] = await Promise.all([
          this.prisma.contentReport.findMany({
            where: {
              targetType: row.target_type,
              targetId: row.target_id,
              status: 'open',
            },
            include: { reporter: { select: { nickname: true } } },
            orderBy: { createdAt: 'desc' },
            take: 10,
          }),
          this.findTarget(row.target_type, row.target_id),
        ]);
        return {
          targetType: row.target_type,
          targetId: row.target_id,
          reportCount: row.report_count,
          reports,
          target,
        };
      }),
    );

    return items.filter((item) => item.target);
  }

  async resolve(
    targetType: ReportTargetType,
    targetId: string,
    action: 'dismiss' | 'delete',
    adminNote?: string,
  ) {
    if (action === 'delete') await this.softDeleteTarget(targetType, targetId);

    await this.prisma.contentReport.updateMany({
      where: { targetType, targetId, status: 'open' },
      data: {
        status: action === 'delete' ? 'resolved' : 'dismissed',
        adminNote: adminNote?.trim() || null,
        resolvedAt: new Date(),
      },
    });
    return { action, targetType, targetId };
  }

  private async findTarget(
    targetType: string,
    targetId: string,
  ): Promise<Record<string, unknown> | null> {
    if (targetType === 'catch') {
      return this.prisma.catch.findUnique({
        where: { id: targetId, deletedAt: null },
        include: {
          user: { select: { id: true, nickname: true, profileImage: true } },
          fishSpecies: { select: { nameKo: true } },
          certification: { select: { grade: true } },
        },
      });
    }
    if (targetType === 'post') {
      return this.prisma.post.findUnique({
        where: { id: targetId, deletedAt: null },
        include: { user: { select: { id: true, nickname: true } } },
      });
    }
    return null;
  }

  private async softDeleteTarget(
    targetType: ReportTargetType,
    targetId: string,
  ) {
    if (targetType === 'catch') {
      const catch_ = await this.prisma.catch.findUnique({
        where: { id: targetId, deletedAt: null },
      });
      if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');
      await this.prisma.catch.update({
        where: { id: targetId },
        data: softDeleteCatchData(),
      });
      return;
    }
    const post = await this.prisma.post.findUnique({
      where: { id: targetId, deletedAt: null },
    });
    if (!post) throw new NotFoundException('게시글을 찾을 수 없습니다.');
    await this.prisma.post.update({
      where: { id: targetId },
      data: { deletedAt: new Date() },
    });
  }
}
