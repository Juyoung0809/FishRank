import { UserProfileService } from './user-profile.service';
import { UserGearsService } from './user-gears.service';

describe('공개 프로필 기록', () => {
  const secretCatch = {
    id: 'c1',
    userId: 'user-1',
    claimedDayCode: 'LAKE1',
    imageHash: 'hash',
    perceptualHash: 'ffff',
    exifLat: 35.1,
    exifLng: 129.1,
    lengthCm: 40,
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    catch: { findMany: jest.fn(), count: jest.fn() },
    post: { findMany: jest.fn(), count: jest.fn() },
    userGear: { findMany: jest.fn() },
  };
  const service = new UserProfileService(
    prisma as never,
    new UserGearsService(prisma as never),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      nickname: 'angler',
      profileImage: null,
      bio: null,
      activityRegion: null,
      fishingCategory: null,
      featuredCatchIds: ['c1'],
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    prisma.catch.count.mockResolvedValue(1);
    prisma.post.count.mockResolvedValue(0);
    prisma.catch.findMany.mockResolvedValue([secretCatch]);
    prisma.post.findMany.mockResolvedValue([]);
    prisma.userGear.findMany.mockResolvedValue([]);
  });

  it('대표 기록과 목록에서 대회 코드와 해시를 빼 준다', async () => {
    const result = await service.getPublicProfile('angler');
    const body = JSON.stringify(result);

    expect(body).not.toContain('LAKE1');
    expect(body).not.toContain('ffff');
    expect(result.catches[0]).not.toHaveProperty('exifLat');
    expect(result.featuredCatches[0]).toEqual(
      expect.objectContaining({ id: 'c1', lengthCm: 40 }),
    );
    expect(result.personalCatches[0]).not.toHaveProperty('claimedDayCode');
  });
});
