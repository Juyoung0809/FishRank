import { TournamentsService } from './tournaments.service';
import { TournamentOrganizerService } from './tournament-organizer.service';

describe('TournamentsService 실시간 순위', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    tournament: { findUnique: jest.fn() },
    tournamentEntry: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    tournamentDayCode: { count: jest.fn() },
    catch: { findMany: jest.fn() },
  };
  const service = new TournamentsService(prisma as never);
  const organizer = new TournamentOrganizerService(prisma as never, service);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tournamentDayCode.count.mockResolvedValue(0);
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      organizerId: 'org-1',
      fishSpeciesId: null,
      minLengthCm: null,
      maxLengthCm: null,
      startAt: new Date('2026-11-01T00:00:00.000Z'),
      endAt: new Date('2026-11-02T00:00:00.000Z'),
    });
  });

  it('저장된 최고 체장 대신 승인된 인증 기록으로 순위를 만든다', async () => {
    prisma.tournamentEntry.findMany.mockResolvedValue([
      {
        id: 'entry-1',
        userId: 'user-1',
        disqualified: false,
        paymentStatus: 'free',
        bestLengthCm: 99,
        user: { id: 'user-1', nickname: '하나', profileImage: null },
      },
    ]);
    prisma.catch.findMany.mockResolvedValue([
      {
        id: 'catch-1',
        userId: 'user-1',
        lengthCm: 32.5,
        createdAt: new Date('2026-11-01T03:00:00.000Z'),
        fishSpeciesId: 1,
      },
    ]);

    const rows = await service.getRanking('tour-1');
    expect(rows).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        bestLengthCm: 32.5,
        bestCatchId: 'catch-1',
        rank: 1,
      }),
    ]);
    expect(prisma.catch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ dayCodeStatus: 'accepted' }),
      }),
    );
  });

  it('코드를 한 번이라도 등록한 대회는 수락된 제출만 집계한다', async () => {
    prisma.tournamentDayCode.count.mockResolvedValue(2);
    prisma.tournamentEntry.findMany.mockResolvedValue([
      {
        id: 'entry-1',
        userId: 'user-1',
        disqualified: false,
        paymentStatus: 'free',
        user: { id: 'user-1', nickname: '하나', profileImage: null },
      },
      {
        id: 'entry-2',
        userId: 'user-2',
        disqualified: false,
        paymentStatus: 'free',
        user: { id: 'user-2', nickname: '둘', profileImage: null },
      },
    ]);
    prisma.catch.findMany.mockResolvedValue([
      {
        id: 'accepted',
        userId: 'user-2',
        lengthCm: 30,
        createdAt: new Date('2026-11-01T04:00:00.000Z'),
        fishSpeciesId: 1,
        claimedTournamentId: 'tour-1',
        dayCodeStatus: 'accepted',
      },
    ]);

    const rows = await service.getRanking('tour-1');

    expect(rows.map((row) => row.bestCatchId)).toEqual(['accepted']);
    expect(prisma.catch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          claimedTournamentId: 'tour-1',
          dayCodeStatus: 'accepted',
        }),
      }),
    );
  });

  it('실격은 참가 행을 지우지 않고 표시만 바꾼다', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'org-1',
      role: 'organizer',
    });
    prisma.tournamentEntry.findUnique.mockResolvedValue({ id: 'entry-1' });
    prisma.tournamentEntry.update.mockResolvedValue({
      id: 'entry-1',
      disqualified: true,
    });

    await organizer.setDisqualified(
      'org-1',
      'tour-1',
      'user-1',
      true,
      '사진 재사용',
    );

    expect(prisma.tournamentEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: { disqualified: true, disqualifyNote: '사진 재사용' },
    });
  });
});
