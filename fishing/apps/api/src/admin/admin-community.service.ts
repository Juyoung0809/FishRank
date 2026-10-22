import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pageWindow, paginated } from '../common/pagination.util';
import type { UpdateFeedbackDto } from './dto/update-feedback.dto';

/** 게시글·댓글·사용자 피드백 관리 */
@Injectable()
export class AdminCommunityService {
  constructor(private prisma: PrismaService) {}

  async listPosts(page = 1, limit = 20) {
    const w = pageWindow(page, limit);
    const where = { deletedAt: null };
    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: {
          user: { select: { id: true, nickname: true } },
          _count: { select: { comments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: w.skip,
        take: w.take,
      }),
      this.prisma.post.count({ where }),
    ]);
    return paginated(items, total, w.page, w.take);
  }

  async deletePost(postId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('게시글을 찾을 수 없습니다.');
    await this.prisma.post.update({
      where: { id: postId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  async listComments(page = 1, limit = 30, search?: string) {
    const w = pageWindow(page, limit);
    const where: Record<string, unknown> = { deletedAt: null };
    const q = search?.trim();
    if (q) {
      where.OR = [
        { content: { contains: q, mode: 'insensitive' } },
        { user: { nickname: { contains: q, mode: 'insensitive' } } },
        { post: { title: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        include: {
          user: { select: { id: true, nickname: true, email: true } },
          post: { select: { id: true, title: true, deletedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: w.skip,
        take: w.take,
      }),
      this.prisma.comment.count({ where }),
    ]);
    return paginated(items, total, w.page, w.take);
  }

  async deleteComment(commentId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId, deletedAt: null },
    });
    if (!comment) throw new NotFoundException('댓글을 찾을 수 없습니다.');
    await this.prisma.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  async listFeedbacks(status?: string, page = 1, limit = 20) {
    const w = pageWindow(page, limit);
    const where = status && status !== 'all' ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.userFeedback.findMany({
        where,
        include: { user: { select: { id: true, nickname: true } } },
        orderBy: { createdAt: 'desc' },
        skip: w.skip,
        take: w.take,
      }),
      this.prisma.userFeedback.count({ where }),
    ]);
    return paginated(items, total, w.page, w.take);
  }

  async updateFeedback(id: string, dto: UpdateFeedbackDto) {
    const existing = await this.prisma.userFeedback.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('피드백을 찾을 수 없습니다.');

    return this.prisma.userFeedback.update({
      where: { id },
      data: { status: dto.status, adminNote: dto.adminNote?.trim() || null },
      include: { user: { select: { id: true, nickname: true } } },
    });
  }
}
