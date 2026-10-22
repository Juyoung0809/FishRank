import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TournamentDayCodeService } from './tournament-day-code.service';

describe('TournamentDayCodeService 일일 코드', () => {
  const now = new Date('2026-10-20T03:00:00.000Z');
  const prisma = {
    user: { findUnique: jest.fn() },
    tournament: { findUnique: jest.fn() },
    tournamentEntry: { findUnique: jest.fn(), findMany: jest.fn() },
    tournamentDayCode: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const service = new TournamentDayCodeService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      status: 'active',
      startAt: new Date('2026-10-01T00:00:00.000Z'),
      endAt: new Date('2026-11-01T00:00:00.000Z'),
    });
  });

  it('관리자가 서울 날짜 코드를 저장한다', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.tournamentDayCode.upsert.mockResolvedValue({ code: 'LAKE1' });

    await service.setToday('admin-1', 'tour-1', 'lake1', now);

    expect(prisma.tournamentDayCode.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tournamentId_codeDate: {
            tournamentId: 'tour-1',
            codeDate: '2026-10-20',
          },
        },
        create: {
          tournamentId: 'tour-1',
          codeDate: '2026-10-20',
          code: 'LAKE1',
        },
      }),
    );
  });

  it('관리자가 아니면 코드를 저장하지 않는다', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'user' });
    await expect(
      service.setToday('user-1', 'tour-1', 'LAKE1', now),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('참가자의 맞는 코드는 검수 대기로 남긴다', async () => {
    prisma.tournamentEntry.findUnique.mockResolvedValue({
      paymentStatus: 'free',
    });
    prisma.tournamentDayCode.findUnique.mockResolvedValue({ code: 'LAKE1' });

    await expect(
      service.resolveClaim(
        'user-1',
        { tournamentId: 'tour-1', dayCode: 'lake1' },
        now,
        now,
      ),
    ).resolves.toEqual({
      claimedTournamentId: 'tour-1',
      claimedDayCode: 'LAKE1',
      dayCodeStatus: 'pending',
    });
  });

  it('코드가 없으면 제출을 요구하지 않는다', async () => {
    await expect(service.resolveClaim('user-1', {}, now)).resolves.toEqual({
      claimedTournamentId: null,
      claimedDayCode: null,
      dayCodeStatus: null,
    });
    expect(prisma.tournamentEntry.findUnique).not.toHaveBeenCalled();
  });

  it('공개 조회는 코드가 있는지만 알려 준다', async () => {
    prisma.tournamentDayCode.findUnique.mockResolvedValue({ code: 'LAKE1' });

    const result = await service.getToday('tour-1', now);

    expect(result).toEqual({ codeDate: '2026-10-20', hasCode: true });
    expect(JSON.stringify(result)).not.toContain('LAKE1');
  });

  it('코드가 없으면 공개 조회도 값 없이 없다고 한다', async () => {
    prisma.tournamentDayCode.findUnique.mockResolvedValue(null);

    await expect(service.getToday('tour-1', now)).resolves.toEqual({
      codeDate: '2026-10-20',
      hasCode: false,
    });
  });

  it('대회 운영자는 오늘 코드를 확인한다', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'org-1',
      role: 'organizer',
    });
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      organizerId: 'org-1',
    });
    prisma.tournamentDayCode.findUnique.mockResolvedValue({ code: 'LAKE1' });

    await expect(service.getManaged('org-1', 'tour-1', now)).resolves.toEqual({
      codeDate: '2026-10-20',
      code: 'LAKE1',
    });
  });

  it('참가자는 오늘 코드를 조회하지 못한다', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      organizerId: 'org-1',
    });

    await expect(
      service.getManaged('user-1', 'tour-1', now),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tournamentDayCode.findUnique).not.toHaveBeenCalled();
  });

  it('참가 중인 진행 대회는 오늘 코드 값 없이 여부만 알려 준다', async () => {
    prisma.tournamentEntry.findMany.mockResolvedValue([
      {
        tournamentId: 'tour-1',
        tournament: { id: 'tour-1', title: '거제', region: '경남' },
      },
      {
        tournamentId: 'tour-2',
        tournament: { id: 'tour-2', title: '춘천', region: null },
      },
    ]);
    prisma.tournamentDayCode.findMany.mockResolvedValue([
      { tournamentId: 'tour-1' },
    ]);

    await expect(service.listMyActive('user-1', now)).resolves.toEqual([
      {
        tournamentId: 'tour-1',
        title: '거제',
        region: '경남',
        codeDate: '2026-10-20',
        hasCode: true,
      },
      {
        tournamentId: 'tour-2',
        title: '춘천',
        region: null,
        codeDate: '2026-10-20',
        hasCode: false,
      },
    ]);
    expect(prisma.tournamentEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          disqualified: false,
        }),
      }),
    );
  });

  it('다른 코드는 거절한다', async () => {
    prisma.tournamentEntry.findUnique.mockResolvedValue({
      paymentStatus: 'paid',
    });
    prisma.tournamentDayCode.findUnique.mockResolvedValue({ code: 'LAKE1' });

    await expect(
      service.resolveClaim(
        'user-1',
        { tournamentId: 'tour-1', dayCode: 'RIVER' },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('실격 참가자와 진행 중이 아닌 대회는 코드를 받지 않는다', async () => {
    prisma.tournamentEntry.findUnique.mockResolvedValue({
      paymentStatus: 'free',
      disqualified: true,
    });
    prisma.tournamentDayCode.findUnique.mockResolvedValue({ code: 'LAKE1' });
    await expect(
      service.resolveClaim(
        'user-1',
        { tournamentId: 'tour-1', dayCode: 'LAKE1' },
        now,
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      status: 'upcoming',
      startAt: new Date('2026-10-01T00:00:00.000Z'),
      endAt: new Date('2026-11-01T00:00:00.000Z'),
    });
    prisma.tournamentEntry.findUnique.mockResolvedValue({
      paymentStatus: 'free',
      disqualified: false,
    });
    await expect(
      service.resolveClaim(
        'user-1',
        { tournamentId: 'tour-1', dayCode: 'LAKE1' },
        now,
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tournamentDayCode.findUnique).not.toHaveBeenCalled();
  });

  it('다른 날 사진은 오늘 코드로 받지 않는다', async () => {
    prisma.tournamentEntry.findUnique.mockResolvedValue({
      paymentStatus: 'free',
      disqualified: false,
    });
    prisma.tournamentDayCode.findUnique.mockResolvedValue({ code: 'LAKE1' });

    await expect(
      service.resolveClaim(
        'user-1',
        { tournamentId: 'tour-1', dayCode: 'LAKE1' },
        now,
        new Date('2026-10-19T03:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
