import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { leaderboardCsv } from './live-leaderboard.util';
import {
  assertFreeEntry,
  findManagedTournament,
  TOURNAMENT_STATUSES,
} from './tournament-policy.util';
import { TournamentsService } from './tournaments.service';

type OrganizerTournamentWrite = {
  title: string;
  description: string;
  category: string;
  fishSpeciesId?: number | null;
  region?: string | null;
  minLengthCm?: number | null;
  maxLengthCm?: number | null;
  prize?: string | null;
  prizeAmount?: number | null;
  sponsorName?: string | null;
  maxEntries?: number | null;
  startAt: string;
  endAt: string;
  rules?: string | null;
  status?: string;
  entryFee?: number;
  isFree?: boolean;
};

/** 낚시점·포인트 운영자가 여는 무료 대회: 대회 관리, 참가자, 일일 코드 심사 */
@Injectable()
export class TournamentOrganizerService {
  constructor(
    private prisma: PrismaService,
    private tournaments: TournamentsService,
  ) {}

  async list(userId: string) {
    await this.assertOrganizer(userId);
    return this.prisma.tournament.findMany({
      where: { organizerId: userId },
      include: { _count: { select: { entries: true } } },
      orderBy: { startAt: 'desc' },
    });
  }

  async create(userId: string, dto: OrganizerTournamentWrite) {
    await this.assertOrganizer(userId);
    return this.prisma.tournament.create({
      data: { ...this.toFreeTournamentData(dto), organizerId: userId },
    });
  }

  async update(userId: string, id: string, dto: OrganizerTournamentWrite) {
    const actor = await this.assertOrganizer(userId);
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
    });
    if (!tournament) throw new NotFoundException('대회를 찾을 수 없습니다.');
    if (actor.role !== 'admin' && tournament.organizerId !== userId) {
      throw new ForbiddenException('본인이 연 대회만 수정할 수 있습니다.');
    }
    return this.prisma.tournament.update({
      where: { id },
      data: this.toFreeTournamentData(dto),
    });
  }

  async updateStatus(actorId: string, tournamentId: string, status: string) {
    await findManagedTournament(this.prisma, actorId, tournamentId);
    if (!TOURNAMENT_STATUSES.includes(status))
      throw new BadRequestException('대회 상태가 올바르지 않습니다.');
    return this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { status },
      select: { id: true, status: true },
    });
  }

  async listParticipants(actorId: string, tournamentId: string) {
    await findManagedTournament(this.prisma, actorId, tournamentId);
    return this.prisma.tournamentEntry.findMany({
      where: { tournamentId },
      include: {
        user: { select: { id: true, nickname: true, profileImage: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /** 실격은 참가 행을 지우지 않고 표시만 바꾼다. */
  async setDisqualified(
    actorId: string,
    tournamentId: string,
    userId: string,
    disqualified: boolean,
    note?: string,
  ) {
    await findManagedTournament(this.prisma, actorId, tournamentId);
    const entry = await this.prisma.tournamentEntry.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    });
    if (!entry) throw new NotFoundException('참가자를 찾을 수 없습니다.');
    return this.prisma.tournamentEntry.update({
      where: { id: entry.id },
      data: { disqualified, disqualifyNote: note?.trim() || null },
    });
  }

  async listDayCodeClaims(actorId: string, tournamentId: string) {
    await findManagedTournament(this.prisma, actorId, tournamentId);
    return this.prisma.catch.findMany({
      where: {
        deletedAt: null,
        claimedTournamentId: tournamentId,
        claimedDayCode: { not: null },
      },
      select: {
        id: true,
        lengthCm: true,
        status: true,
        imageUrl: true,
        claimedDayCode: true,
        dayCodeStatus: true,
        integrityNote: true,
        photoTakenAt: true,
        createdAt: true,
        user: { select: { id: true, nickname: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async reviewDayCodeClaim(
    actorId: string,
    tournamentId: string,
    catchId: string,
    status: 'accepted' | 'rejected',
  ) {
    await findManagedTournament(this.prisma, actorId, tournamentId);
    const catch_ = await this.prisma.catch.findFirst({
      where: {
        id: catchId,
        deletedAt: null,
        claimedTournamentId: tournamentId,
        claimedDayCode: { not: null },
      },
    });
    if (!catch_)
      throw new NotFoundException('이 대회에 제출된 코드를 찾을 수 없습니다.');
    if (status === 'accepted' && catch_.status === 'rejected') {
      throw new BadRequestException('반려된 인증은 대회에 넣을 수 없습니다.');
    }
    return this.prisma.catch.update({
      where: { id: catchId },
      data: { dayCodeStatus: status },
      select: { id: true, dayCodeStatus: true },
    });
  }

  async exportLeaderboard(actorId: string, tournamentId: string) {
    await findManagedTournament(this.prisma, actorId, tournamentId);
    return leaderboardCsv(await this.tournaments.getRanking(tournamentId));
  }

  private async assertOrganizer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || (user.role !== 'organizer' && user.role !== 'admin')) {
      throw new ForbiddenException('대회 운영자만 사용할 수 있습니다.');
    }
    return user;
  }

  private toFreeTournamentData(dto: OrganizerTournamentWrite) {
    assertFreeEntry(dto);
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(endAt.getTime()) ||
      endAt <= startAt
    ) {
      throw new BadRequestException('대회 기간이 올바르지 않습니다.');
    }
    const minLengthCm = dto.minLengthCm ?? null;
    const maxLengthCm = dto.maxLengthCm ?? null;
    if (
      minLengthCm != null &&
      maxLengthCm != null &&
      minLengthCm > maxLengthCm
    ) {
      throw new BadRequestException(
        '최소 체장이 최대 체장보다 클 수 없습니다.',
      );
    }
    return {
      title: dto.title.trim(),
      description: dto.description.trim(),
      category: dto.category,
      fishSpeciesId: dto.fishSpeciesId ?? null,
      region: dto.region?.trim() || null,
      minLengthCm,
      maxLengthCm,
      prize: dto.prize?.trim() || null,
      prizeAmount: dto.prizeAmount ?? null,
      sponsorName: dto.sponsorName?.trim() || null,
      maxEntries: dto.maxEntries ?? null,
      startAt,
      endAt,
      rules: dto.rules?.trim() || null,
      status: dto.status || 'upcoming',
      isFree: true,
      entryFee: 0,
    };
  }
}
