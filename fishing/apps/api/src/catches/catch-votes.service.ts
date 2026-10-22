import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 자랑(personal) 기록 추천 */
@Injectable()
export class CatchVotesService {
  constructor(private prisma: PrismaService) {}

  /** 추천만 추가한다. 이미 추천했으면 그대로 둔다. */
  async add(catchId: string, userId: string) {
    await this.assertVotable(catchId, userId);
    const existing = await this.findVote(catchId, userId);
    if (!existing)
      await this.prisma.catchVote.create({ data: { catchId, userId } });
    return { voted: true, voteCount: await this.count(catchId) };
  }

  async toggle(catchId: string, userId: string) {
    await this.assertVotable(catchId, userId);
    const existing = await this.findVote(catchId, userId);
    if (existing) {
      await this.prisma.catchVote.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.catchVote.create({ data: { catchId, userId } });
    }
    return { voted: !existing, voteCount: await this.count(catchId) };
  }

  async summary(catchId: string, userId?: string) {
    const [voteCount, myVote] = await Promise.all([
      this.count(catchId),
      userId ? this.findVote(catchId, userId) : Promise.resolve(null),
    ]);
    return { voteCount, voted: Boolean(myVote) };
  }

  private count(catchId: string) {
    return this.prisma.catchVote.count({ where: { catchId } });
  }

  private findVote(catchId: string, userId: string) {
    return this.prisma.catchVote.findUnique({
      where: { catchId_userId: { catchId, userId } },
    });
  }

  private async assertVotable(catchId: string, userId: string) {
    const catch_ = await this.prisma.catch.findUnique({
      where: { id: catchId, deletedAt: null },
    });
    if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');
    if (catch_.recordType !== 'personal') {
      throw new BadRequestException('자랑 기록만 추천할 수 있습니다.');
    }
    if (catch_.userId === userId) {
      throw new BadRequestException('본인 기록에는 추천할 수 없습니다.');
    }
  }
}
