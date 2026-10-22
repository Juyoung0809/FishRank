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
