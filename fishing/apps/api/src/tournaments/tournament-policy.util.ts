import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

export const TOURNAMENT_STATUSES = ['upcoming', 'active', 'closed', 'finished'];

/** 관리자이거나 이 대회를 연 운영자만 통과시키고 대회 행을 돌려준다. */
export async function findManagedTournament(
  prisma: PrismaService,
  actorId: string,
  tournamentId: string,
  deniedMessage = '이 대회를 운영할 수 없습니다.',
) {
  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });
  if (!tournament) throw new NotFoundException('대회를 찾을 수 없습니다.');
  const isAdmin = actor?.role === 'admin';
  const isOwner =
    actor?.role === 'organizer' && tournament.organizerId === actorId;
  if (!isAdmin && !isOwner) throw new ForbiddenException(deniedMessage);
  return tournament;
}

/** 참가비는 아직 받지 않는다. 상은 후원으로만 안내한다. */
export function assertFreeEntry(dto: { entryFee?: number; isFree?: boolean }) {
  if ((dto.entryFee ?? 0) > 0 || dto.isFree === false) {
    throw new BadRequestException(
      '참가비는 아직 받을 수 없습니다. 상은 후원으로 안내해 주세요.',
    );
  }
}

/** 운영자 대회 등록·수정 입력 */
export type OrganizerTournamentWrite = {
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

/** 운영자 입력 검증(무료·기간·체장 범위) 후 Prisma 저장용 데이터. 참가비는 항상 0 */
export function toFreeTournamentData(dto: OrganizerTournamentWrite) {
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
  if (minLengthCm != null && maxLengthCm != null && minLengthCm > maxLengthCm) {
    throw new BadRequestException('최소 체장이 최대 체장보다 클 수 없습니다.');
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
