import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import {
  computeImageHash,
  removeUploadedFile,
} from '../common/upload/image-integrity.util';
import { isUniqueConstraintError } from '../common/upload/catch-retention.util';
import {
  computePerceptualHash,
  isNearDuplicate,
} from '../common/upload/image-phash.util';

const DUPLICATE_IMAGE_MESSAGE =
  '이미 등록된 사진입니다. 동일 사진 재업로드·타인 사진 도용은 허용되지 않습니다.';

/**
 * 정확히 같은 사진(SHA)과 살짝 바꾼 사진(지각 해시)을 모두 막는다.
 * 삭제된 기록의 같은 사진은 해시를 비워 다시 올릴 수 있게 한다. 막으면 업로드 파일을 지운다.
 */
export async function assertUniqueCatchImage(
  prisma: PrismaService,
  filePath: string,
) {
  const imageHash = await computeImageHash(filePath);
  const existing = await prisma.catch.findFirst({
    where: { imageHash },
    select: { id: true, deletedAt: true },
  });

  if (existing && !existing.deletedAt) {
    await removeUploadedFile(filePath);
    throw new ConflictException(DUPLICATE_IMAGE_MESSAGE);
  }
  if (existing) {
    await prisma.catch.update({
      where: { id: existing.id },
      data: { imageHash: null, perceptualHash: null },
    });
  }

  const perceptualHash = await computePerceptualHash(filePath);
  if (perceptualHash) {
    const rows = await prisma.catch.findMany({
      where: { deletedAt: null, perceptualHash: { not: null } },
      select: { perceptualHash: true },
    });
    if (
      rows.some(
        (row) =>
          row.perceptualHash &&
          isNearDuplicate(perceptualHash, row.perceptualHash),
      )
    ) {
      await removeUploadedFile(filePath);
      throw new ConflictException(
        '이미 등록된 사진과 매우 비슷한 사진입니다. 같은 사진을 조금 바꾼 재업로드는 허용되지 않습니다.',
      );
    }
  }

  return { imageHash, perceptualHash };
}

/** 동시 업로드로 unique 제약에 걸리면 409 로 바꾸고 파일을 지운다. */
export async function createOrRejectDuplicate<T>(
  filePath: string,
  create: () => Promise<T>,
): Promise<T> {
  try {
    return await create();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      await removeUploadedFile(filePath);
      throw new ConflictException(DUPLICATE_IMAGE_MESSAGE);
    }
    throw error;
  }
}
