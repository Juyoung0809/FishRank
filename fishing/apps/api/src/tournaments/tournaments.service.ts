import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildLiveLeaderboard } from './live-leaderboard.util';
import { assertFreeEntry } from './tournament-policy.util';

const USER_BRIEF = {
  select: { id: true, nickname: true, profileImage: true },
} as const;

/** 대회 조회·참가·실시간 순위와 관리자 CRUD */
@Injectable()
export class TournamentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(status?: string, category?: string) {
    return this.prisma.tournament.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(category && category !== 'all'
          ? { category: { in: [category, 'all'] } }
          : {}),
      },
      include: { _count: { select: { entries: true } } },
      orderBy: [{ status: 'asc' }, { startAt: 'asc' }],
    });
  }

  async findById(id: string) {
    const t = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        _count: { select: { entries: true, dayCodes: true } },
        entries: {
          where: { rank: { not: null } },
          include: { user: USER_BRIEF },
          orderBy: { rank: 'asc' },
          take: 10,
        },
      },
    });
    if (!t) throw new NotFoundException('대회를 찾을 수 없습니다.');
    return t;
  }

  async join(tournamentId: string, userId: string) {
    const tournament = await this.findOrThrow(tournamentId);
    if (tournament.status !== 'active')
      throw new BadRequestException('참가 가능한 대회가 아닙니다.');
    if (!tournament.isFree || tournament.entryFee > 0) {
      throw new BadRequestException('유료 참가는 아직 열리지 않았습니다.');
    }

    const existing = await this.getMyEntry(tournamentId, userId);
    if (existing) throw new BadRequestException('이미 참가 중인 대회입니다.');

    if (tournament.maxEntries) {
      const count = await this.prisma.tournamentEntry.count({
        where: { tournamentId },
      });
      if (count >= tournament.maxEntries)
        throw new BadRequestException('참가 인원이 마감되었습니다.');
    }

    return this.prisma.tournamentEntry.create({
      data: { tournamentId, userId, paymentStatus: 'free', paymentAmount: 0 },
    });
  }

  async getMyEntry(tournamentId: string, userId: string) {
    return this.prisma.tournamentEntry.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    });
  }

  /**
   * 대회 기간의 승인된 인증 기록으로 매번 순위를 계산한다.
   * 일일 코드를 한 번이라도 등록한 대회는 코드가 수락된 기록만 인정한다.
   */
  async getRanking(tournamentId: string) {
    const tournament = await this.findOrThrow(tournamentId);

    const entries = await this.prisma.tournamentEntry.findMany({
      where: { tournamentId },
      include: { user: USER_BRIEF },
    });
    if (!entries.length) return [];

    const requireAcceptedDayCode =
      (await this.prisma.tournamentDayCode.count({ where: { tournamentId } })) >
      0;
    const catches = await this.prisma.catch.findMany({
      where: {
        deletedAt: null,
        status: 'approved',
        recordType: 'certified',
        userId: { in: entries.map((entry) => entry.userId) },
        createdAt: { gte: tournament.startAt, lte: tournament.endAt },
        ...(requireAcceptedDayCode
          ? { claimedTournamentId: tournamentId, dayCodeStatus: 'accepted' }
          : {}),
      },
      select: {
        id: true,
        userId: true,
        lengthCm: true,
        createdAt: true,
        fishSpeciesId: true,
        claimedTournamentId: true,
        dayCodeStatus: true,
      },
    });

    return buildLiveLeaderboard(
      {
        id: tournament.id,
        fishSpeciesId: tournament.fishSpeciesId,
        minLengthCm:
          tournament.minLengthCm == null
            ? null
            : Number(tournament.minLengthCm),
        maxLengthCm:
          tournament.maxLengthCm == null
            ? null
            : Number(tournament.maxLengthCm),
        startAt: tournament.startAt,
        endAt: tournament.endAt,
        requireAcceptedDayCode,
      },
      entries,
      catches.map((catch_) => ({
        ...catch_,
        lengthCm: Number(catch_.lengthCm),
      })),
    );
  }

  // ── 관리자 ──────────────────────────────────────────────

  async create(adminId: string, dto: any) {
    await this.assertAdmin(adminId, '관리자만 대회를 생성할 수 있습니다.');
    assertFreeEntry(dto);
    return this.prisma.tournament.create({
      data: { ...dto, isFree: true, entryFee: 0 },
    });
  }

  async updateStatus(adminId: string, id: string, status: string) {
    await this.assertAdmin(adminId);
    return this.prisma.tournament.update({ where: { id }, data: { status } });
  }

  async update(adminId: string, id: string, dto: any) {
    await this.assertAdmin(adminId);
    assertFreeEntry(dto);
    return this.prisma.tournament.update({
      where: { id },
      data: { ...dto, isFree: true, entryFee: 0 },
    });
  }

  async delete(adminId: string, id: string) {
    await this.assertAdmin(adminId);
    await this.findOrThrow(id);
    await this.prisma.$transaction([
      this.prisma.tournamentEntry.deleteMany({ where: { tournamentId: id } }),
      this.prisma.tournament.delete({ where: { id } }),
    ]);
    return { deleted: true };
  }

  private async assertAdmin(userId: string, message?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role !== 'admin') throw new ForbiddenException(message);
  }

  private async findOrThrow(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
    });
    if (!tournament) throw new NotFoundException('대회를 찾을 수 없습니다.');
    return tournament;
  }
}
