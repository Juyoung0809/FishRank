import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertDayCodePhoto,
  normalizeDayCode,
  seoulDateKey,
} from './day-code.util';
import { findManagedTournament } from './tournament-policy.util';

export type DayCodeClaim = {
  claimedTournamentId: string | null;
  claimedDayCode: string | null;
  dayCodeStatus: string | null;
};

const EMPTY_DAY_CODE_CLAIM: DayCodeClaim = {
  claimedTournamentId: null,
  claimedDayCode: null,
  dayCodeStatus: null,
};

const INVALID_CODE_MESSAGE = '대회 코드는 4~12자의 영문 또는 숫자여야 합니다.';

/** 대회 일일(서울 날짜) 인증 코드: 등록, 조회, 인증 업로드 시 검증 */
@Injectable()
export class TournamentDayCodeService {
  constructor(private prisma: PrismaService) {}

  /** 공개 조회. 코드 값은 돌려주지 않고 등록 여부만 알린다. */
  async getToday(tournamentId: string, now = new Date()) {
    const row = await this.findToday(tournamentId, now);
    return { codeDate: row.codeDate, hasCode: row.code !== null };
  }

  /** 대회 운영자용. 코드 값까지 돌려준다. */
  async getManaged(actorId: string, tournamentId: string, now = new Date()) {
    await findManagedTournament(this.prisma, actorId, tournamentId);
    return this.findToday(tournamentId, now);
  }

  async setToday(
    actorId: string,
    tournamentId: string,
    rawCode: string,
    now = new Date(),
  ) {
    await findManagedTournament(
      this.prisma,
      actorId,
      tournamentId,
      '이 대회의 코드를 등록할 수 없습니다.',
    );

    const code = normalizeDayCode(rawCode);
    if (!code) throw new BadRequestException(INVALID_CODE_MESSAGE);

    const codeDate = seoulDateKey(now);
    return this.prisma.tournamentDayCode.upsert({
      where: { tournamentId_codeDate: { tournamentId, codeDate } },
      create: { tournamentId, codeDate, code },
      update: { code },
    });
  }

  /** 지금 코드를 낼 수 있는 내 참가 대회(진행 중·실격 아님). 코드 값은 포함하지 않는다. */
  async listMyActive(userId: string, now = new Date()) {
    const entries = await this.prisma.tournamentEntry.findMany({
      where: {
        userId,
        disqualified: false,
        paymentStatus: { in: ['free', 'paid'] },
        tournament: {
          status: 'active',
          startAt: { lte: now },
          endAt: { gte: now },
        },
      },
      include: {
        tournament: { select: { id: true, title: true, region: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
    if (!entries.length) return [];

    const codeDate = seoulDateKey(now);
    const codes = await this.prisma.tournamentDayCode.findMany({
      where: {
        codeDate,
        tournamentId: { in: entries.map((entry) => entry.tournamentId) },
      },
      select: { tournamentId: true },
    });
    const withCode = new Set(codes.map((row) => row.tournamentId));
    return entries.map((entry) => ({
      tournamentId: entry.tournamentId,
      title: entry.tournament.title,
      region: entry.tournament.region,
      codeDate,
      hasCode: withCode.has(entry.tournamentId),
    }));
  }

  /**
   * 인증 업로드에 함께 온 대회 코드를 확인한다. 코드가 없으면 빈 claim 을 돌려준다.
   * 촬영 시각(takenAt)이 있으면 코드 날짜·대회 기간 안에 찍었는지도 본다.
   */
  async resolveClaim(
    userId: string,
    body: { tournamentId?: unknown; dayCode?: unknown },
    now = new Date(),
    takenAt?: Date,
  ): Promise<DayCodeClaim> {
    const tournamentId =
      typeof body.tournamentId === 'string' ? body.tournamentId.trim() : '';
    const rawCode = typeof body.dayCode === 'string' ? body.dayCode : '';
    if (!tournamentId && !rawCode.trim()) return EMPTY_DAY_CODE_CLAIM;
    if (!tournamentId || !rawCode.trim()) {
      throw new BadRequestException('대회와 오늘의 코드를 함께 보내야 합니다.');
    }

    const code = normalizeDayCode(rawCode);
    if (!code) throw new BadRequestException(INVALID_CODE_MESSAGE);

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) throw new NotFoundException('대회를 찾을 수 없습니다.');
    if (
      tournament.status !== 'active' ||
      now < tournament.startAt ||
      now > tournament.endAt
    ) {
      throw new BadRequestException(
        '진행 중인 대회 기간에만 코드를 제출할 수 있습니다.',
      );
    }

    const entry = await this.prisma.tournamentEntry.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    });
    if (
      !entry ||
      (entry.paymentStatus !== 'free' && entry.paymentStatus !== 'paid')
    ) {
      throw new BadRequestException(
        '참가 중인 대회만 코드를 제출할 수 있습니다.',
      );
    }
    if (entry.disqualified)
      throw new BadRequestException(
        '실격된 대회에는 코드를 제출할 수 없습니다.',
      );

    const codeDate = seoulDateKey(now);
    const stored = await this.findCode(tournamentId, codeDate);
    if (!stored)
      throw new BadRequestException('오늘 대회 코드가 아직 없습니다.');
    if (stored.code !== code)
      throw new BadRequestException('대회 코드가 맞지 않습니다.');

    if (takenAt) {
      const photo = assertDayCodePhoto({
        takenAt,
        codeDate,
        startAt: tournament.startAt,
        endAt: tournament.endAt,
      });
      if (!photo.ok) throw new BadRequestException(photo.reason);
    }

    return {
      claimedTournamentId: tournamentId,
      claimedDayCode: code,
      dayCodeStatus: 'pending',
    };
  }

  private async findToday(tournamentId: string, now: Date) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) throw new NotFoundException('대회를 찾을 수 없습니다.');
    const codeDate = seoulDateKey(now);
    const row = await this.findCode(tournamentId, codeDate);
    return { codeDate, code: row?.code ?? null };
  }

  private findCode(tournamentId: string, codeDate: string) {
    return this.prisma.tournamentDayCode.findUnique({
      where: { tournamentId_codeDate: { tournamentId, codeDate } },
    });
  }
}
