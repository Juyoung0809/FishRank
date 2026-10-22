import { AdminReportsService } from './admin-reports.service';

describe('AdminReportsService.resolve', () => {
  const prisma = {
    catch: { findUnique: jest.fn(), update: jest.fn() },
    contentReport: { updateMany: jest.fn() },
  };
  const service = new AdminReportsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.catch.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.catch.update.mockResolvedValue({});
    prisma.contentReport.updateMany.mockResolvedValue({ count: 1 });
  });

  it('한 건 신고를 삭제 처리할 때 메모와 처리 시각을 남긴다', async () => {
    await service.resolve('catch', 'c1', 'delete', ' 사진이 같음 ');

    expect(prisma.contentReport.updateMany).toHaveBeenCalledWith({
      where: { targetType: 'catch', targetId: 'c1', status: 'open' },
      data: {
        status: 'resolved',
        adminNote: '사진이 같음',
        resolvedAt: expect.any(Date),
      },
    });
    expect(prisma.catch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imageHash: null,
          perceptualHash: null,
        }),
      }),
    );
  });

  it('무시할 때도 처리 시각을 남긴다', async () => {
    await service.resolve('catch', 'c1', 'dismiss');
    expect(prisma.contentReport.updateMany).toHaveBeenCalledWith({
      where: { targetType: 'catch', targetId: 'c1', status: 'open' },
      data: {
        status: 'dismissed',
        adminNote: null,
        resolvedAt: expect.any(Date),
      },
    });
  });
});
