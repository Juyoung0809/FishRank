import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 계정 조회·생성과 리프레시 토큰 (인증 모듈이 사용) */
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id, deletedAt: null } });
  }

  /** 정지(soft delete) 여부까지 구분이 필요할 때. 인증 통과용으로는 findById 를 쓴다. */
  async findByIdIncludingDeleted(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async setRefreshTokenHash(userId: string, refreshTokenHash: string | null) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByNickname(nickname: string) {
    return this.prisma.user.findUnique({ where: { nickname } });
  }

  async create(data: {
    email: string;
    nickname: string;
    passwordHash: string;
  }) {
    return this.prisma.user.create({ data });
  }
}
