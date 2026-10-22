import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicCatches } from '../catches/public-catch';
import { UserGearsService } from './user-gears.service';

const MAX_FEATURED = 3;

/** 승인된 공식(인증) 기록 */
const approvedCertified = (userId: string) => ({
  userId,
  deletedAt: null,
  status: 'approved',
  recordType: 'certified',
});

const PROFILE_SELECT = {
  id: true,
  email: true,
  nickname: true,
  profileImage: true,
  bio: true,
  activityRegion: true,
  fishingCategory: true,
} as const;

/** 내 프로필·공개 프로필, 통계, 대표 기록 */
@Injectable()
export class UserProfileService {
  constructor(
    private prisma: PrismaService,
    private gears: UserGearsService,
  ) {}

  async getPublicProfile(nickname: string) {
    const user = await this.prisma.user.findUnique({
      where: { nickname, deletedAt: null },
      select: {
        id: true,
        nickname: true,
        profileImage: true,
        bio: true,
        activityRegion: true,
        fishingCategory: true,
        featuredCatchIds: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('존재하지 않는 사용자입니다.');

    const [stats, featuredCatches, catches, personalCatches, posts, gears] =
      await Promise.all([
        this.getStats(user.id),
        this.getFeaturedCatches(user.id, user.featuredCatchIds),
        this.prisma.catch.findMany({
          where: approvedCertified(user.id),
          include: {
            fishSpecies: true,
            certification: { select: { grade: true } },
          },
          orderBy: { rankScore: 'desc' },
          take: 6,
        }),
        this.prisma.catch.findMany({
          where: { userId: user.id, deletedAt: null, recordType: 'personal' },
          include: { fishSpecies: true },
          orderBy: { createdAt: 'desc' },
          take: 6,
        }),
        this.prisma.post.findMany({
          where: { userId: user.id, deletedAt: null },
          include: { _count: { select: { comments: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.gears.list(user.id),
      ]);

    return {
      user,
      stats,
      featuredCatches,
      catches: toPublicCatches(catches),
      personalCatches: toPublicCatches(personalCatches),
      posts,
      gears,
    };
  }

  async getStats(userId: string) {
    const [fishCount, personalCount, totalPosts] = await Promise.all([
      this.prisma.catch.count({ where: approvedCertified(userId) }),
      this.prisma.catch.count({
        where: { userId, deletedAt: null, recordType: 'personal' },
      }),
      this.prisma.post.count({ where: { userId, deletedAt: null } }),
    ]);
    return { fishCount, personalCount, totalPosts };
  }

  async getRecentPosts(userId: string) {
    return this.prisma.post.findMany({
      where: { userId, deletedAt: null },
      include: { _count: { select: { comments: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  /** 대표 기록을 저장된 순서대로. 지워졌거나 승인되지 않은 기록은 뺀다. */
  async getFeaturedCatches(userId: string, featuredCatchIds: string[]) {
    if (!featuredCatchIds.length) return [];

    const catches = await this.prisma.catch.findMany({
      where: { id: { in: featuredCatchIds }, ...approvedCertified(userId) },
      include: {
        fishSpecies: true,
        certification: { select: { grade: true } },
      },
    });

    return toPublicCatches(
      featuredCatchIds
        .map((id) => catches.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => !!c),
    );
  }

  async updateFeaturedCatches(userId: string, catchIds: string[]) {
    const uniqueIds = [...new Set(catchIds)];
    if (uniqueIds.length > MAX_FEATURED) {
      throw new BadRequestException(
        `대표 기록은 최대 ${MAX_FEATURED}개까지 설정할 수 있습니다.`,
      );
    }

    if (uniqueIds.length > 0) {
      const validCount = await this.prisma.catch.count({
        where: { id: { in: uniqueIds }, ...approvedCertified(userId) },
      });
      if (validCount !== uniqueIds.length) {
        throw new BadRequestException(
          '본인의 인증 완료 기록만 대표로 설정할 수 있습니다.',
        );
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { featuredCatchIds: uniqueIds },
    });
    return this.getFeaturedCatches(userId, uniqueIds);
  }

  /** 빈 문자열은 null 로 저장한다. */
  async update(
    userId: string,
    data: {
      bio?: string | null;
      activityRegion?: string;
      fishingCategory?: string;
    },
  ) {
    const updateData: Record<string, unknown> = {};
    if (data.bio !== undefined) updateData.bio = data.bio?.trim() || null;
    if (data.activityRegion !== undefined)
      updateData.activityRegion = data.activityRegion || null;
    if (data.fishingCategory !== undefined)
      updateData.fishingCategory = data.fishingCategory || null;

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { ...PROFILE_SELECT, featuredCatchIds: true },
    });
  }

  async updateImage(userId: string, profileImage: string | null) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { profileImage },
      select: PROFILE_SELECT,
    });
  }
}
