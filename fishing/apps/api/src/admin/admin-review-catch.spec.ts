import { AdminCatchesService } from './admin-catches.service';

describe('AdminCatchesService.review 랭킹 점수', () => {
  const prisma = {
    catch: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    certification: {
      update: jest.fn(),
    },
  };
  const service = new AdminCatchesService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.catch.update.mockResolvedValue({});
    prisma.certification.update.mockResolvedValue({});
    prisma.catch.findUnique.mockResolvedValueOnce(undefined);
  });

  function queueCatch(row: Record<string, unknown>) {
    prisma.catch.findUnique.mockReset();
    prisma.catch.findUnique
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ id: row.id });
  }

  it('이미 계산된 점수는 승인 때 덮어쓰지 않는다', async () => {
    queueCatch({
      id: 'c1',
      lengthCm: 30,
      rankScore: 45,
      certification: { id: 'cert' },
      fishSpecies: { rarityWeight: 2 },
    });

    await service.review('c1', { status: 'approved' });

    expect(prisma.catch.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'approved' },
    });
  });

  it('점수가 없으면 길이 × 희귀도로 채운다', async () => {
    queueCatch({
      id: 'c1',
      lengthCm: 30,
      rankScore: null,
      certification: null,
      fishSpecies: { rarityWeight: 1.5 },
    });

    await service.review('c1', { status: 'approved' });

    expect(prisma.catch.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'approved', rankScore: 45 },
    });
  });

  it('반려하면 랭킹 점수를 지운다', async () => {
    queueCatch({
      id: 'c1',
      lengthCm: 30,
      rankScore: 45,
      certification: { id: 'cert' },
      fishSpecies: { rarityWeight: 1.5 },
    });

    await service.review('c1', { status: 'rejected', note: '규칙 위반' });

    expect(prisma.catch.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'rejected', rankScore: null },
    });
  });
});
