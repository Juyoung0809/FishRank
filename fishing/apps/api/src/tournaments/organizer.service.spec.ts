import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { TournamentDayCodeService } from './tournament-day-code.service';
import { TournamentOrganizerService } from './tournament-organizer.service';

describe('TournamentOrganizerService 운영자 대회', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    tournament: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    tournamentDayCode: { upsert: jest.fn() },
    catch: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  const service = new TournamentOrganizerService(
    prisma as never,
    new TournamentsService(prisma as never),
  );
  const dayCodes = new TournamentDayCodeService(prisma as never);
  const dto = {
    title: '거제 감성돔',
    description: '낚시점 후원 대회',
    category: 'saltwater',
    region: '경남 거제',
    minLengthCm: 25,
    maxLengthCm: 80,
    prize: '상품권',
    prizeAmount: 100000,
    sponsorName: '거제낚시점',
    startAt: '2026-11-01T00:00:00.000Z',
    endAt: '2026-11-02T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('운영자는 무료 대회만 만들고 후원 상을 저장한다', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'org-1',
      role: 'organizer',
    });
    prisma.tournament.create.mockImplementation(async ({ data }) => data);

    const created = await service.create('org-1', dto);

    expect(created).toEqual(
      expect.objectContaining({
        organizerId: 'org-1',
        isFree: true,
        entryFee: 0,
        sponsorName: '거제낚시점',
        region: '경남 거제',
        minLengthCm: 25,
        prize: '상품권',
      }),
    );
  });

  it('참가비가 있으면 거절한다', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'org-1',
      role: 'organizer',
    });
    await expect(
      service.create('org-1', { ...dto, entryFee: 5000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('일반 회원은 대회를 열 수 없다', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });
    await expect(service.create('user-1', dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('운영자는 자기 대회의 오늘 코드를 등록한다', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'org-1',
      role: 'organizer',
    });
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      organizerId: 'org-1',
    });
    prisma.tournamentDayCode.upsert.mockResolvedValue({ code: 'SHOP1' });

    await dayCodes.setToday(
      'org-1',
      'tour-1',
      'shop1',
      new Date('2026-10-20T03:00:00.000Z'),
    );

    expect(prisma.tournamentDayCode.upsert).toHaveBeenCalled();
  });

  it('다른 운영자의 대회 코드는 등록하지 못한다', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'org-2',
      role: 'organizer',
    });
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      organizerId: 'org-1',
    });
    await expect(
      dayCodes.setToday(
        'org-2',
        'tour-1',
        'SHOP1',
        new Date('2026-10-20T03:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('운영자는 자기 대회를 진행 중으로 연다', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'org-1',
      role: 'organizer',
    });
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      organizerId: 'org-1',
    });
    prisma.tournament.update.mockResolvedValue({
      id: 'tour-1',
      status: 'active',
    });

    await expect(
      service.updateStatus('org-1', 'tour-1', 'active'),
    ).resolves.toEqual({
      id: 'tour-1',
      status: 'active',
    });
  });

  it('알 수 없는 대회 상태는 저장하지 않는다', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'org-1',
      role: 'organizer',
    });
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      organizerId: 'org-1',
    });

    await expect(
      service.updateStatus('org-1', 'tour-1', 'paid'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });

  it('운영자는 자기 대회에 제출된 코드만 수락한다', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'org-1',
      role: 'organizer',
    });
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      organizerId: 'org-1',
    });
    prisma.catch.findFirst.mockResolvedValue({
      id: 'catch-1',
      claimedDayCode: 'SHOP1',
      status: 'approved',
    });
    prisma.catch.update.mockResolvedValue({
      id: 'catch-1',
      dayCodeStatus: 'accepted',
    });

    await expect(
      service.reviewDayCodeClaim('org-1', 'tour-1', 'catch-1', 'accepted'),
    ).resolves.toEqual({
      id: 'catch-1',
      dayCodeStatus: 'accepted',
    });
    expect(prisma.catch.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'catch-1',
        deletedAt: null,
        claimedTournamentId: 'tour-1',
        claimedDayCode: { not: null },
      },
    });
  });

  it('다른 대회 제출은 수락하지 못한다', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'org-1',
      role: 'organizer',
    });
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      organizerId: 'org-1',
    });
    prisma.catch.findFirst.mockResolvedValue(null);

    await expect(
      service.reviewDayCodeClaim('org-1', 'tour-1', 'catch-9', 'accepted'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.catch.update).not.toHaveBeenCalled();
  });

  it('반려된 인증은 코드 수락을 거절한다', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'org-1',
      role: 'organizer',
    });
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      organizerId: 'org-1',
    });
    prisma.catch.findFirst.mockResolvedValue({
      id: 'catch-1',
      claimedDayCode: 'SHOP1',
      status: 'rejected',
    });

    await expect(
      service.reviewDayCodeClaim('org-1', 'tour-1', 'catch-1', 'accepted'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.catch.update).not.toHaveBeenCalled();
  });
});
