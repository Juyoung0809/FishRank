import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { resolveSpeciesId } from '../ai/species-slug.util';
import { determineGrade } from '../common/certification/certification-grade.util';
import { computeRankScore } from '../common/certification/rank-score.util';
import {
  appendIntegrityNote,
  computeImageHash,
  removeUploadedFile,
  validatePhotoFreshness,
} from '../common/upload/image-integrity.util';
import {
  isUniqueConstraintError,
  softDeleteCatchData,
} from '../common/upload/catch-retention.util';
import {
  computePerceptualHash,
  isNearDuplicate,
} from '../common/upload/image-phash.util';
import { parsePageLimit } from '../common/pagination.util';
import {
  TournamentDayCodeService,
  type DayCodeClaim,
} from '../tournaments/tournament-day-code.service';
import { toPublicCatch, toPublicCatches } from './public-catch';

type CatchUploadBody = {
  locationName?: string;
  memo?: string;
  locationLat?: unknown;
  locationLng?: unknown;
  lengthCm?: unknown;
  fishSpeciesId?: unknown;
  tournamentId?: unknown;
  dayCode?: unknown;
};

type PhotoFreshness = {
  takenAt?: Date;
  exifLat?: number;
  exifLng?: number;
  integrityNote?: string;
};

const DUPLICATE_IMAGE_MESSAGE =
  '이미 등록된 사진입니다. 동일 사진 재업로드·타인 사진 도용은 허용되지 않습니다.';

function claimedLocation(body: CatchUploadBody) {
  const lat = Number(body.locationLat);
  const lng = Number(body.locationLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

/** 폼 값이 0·빈 값·숫자가 아니면 null */
function optionalNumber(value: unknown): number | null {
  return Number(value) || null;
}

@Injectable()
export class CatchesService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private dayCodes: TournamentDayCodeService,
  ) {}

  async createCertified(
    userId: string,
    file: Express.Multer.File,
    body: CatchUploadBody,
  ) {
    if (!file?.path) throw new BadRequestException('사진 파일이 필요합니다.');

    const freshness = await validatePhotoFreshness(
      file.path,
      undefined,
      claimedLocation(body),
    );
    if (!freshness.ok) {
      await removeUploadedFile(file.path);
      throw new BadRequestException(freshness.reason);
    }

    const hashes = await this.assertUniqueImage(file.path);

    let claim: DayCodeClaim;
    try {
      claim = await this.dayCodes.resolveClaim(
        userId,
        body,
        new Date(),
        freshness.takenAt,
      );
    } catch (error) {
      await removeUploadedFile(file.path);
      throw error;
    }

    // 촬영 시각이 없으면 코드 날짜와 맞는지 확인할 수 없으니 운영자가 볼 수 있게 표시한다
    const notedFreshness =
      claim.claimedTournamentId && !freshness.takenAt
        ? {
            ...freshness,
            integrityNote: appendIntegrityNote(
              freshness.integrityNote,
              'code_date_unverified',
            ),
          }
        : freshness;

    const imageUrl = `/uploads/${file.filename}`;
    const catch_ = await this.createCertifiedRow(
      userId,
      file.path,
      imageUrl,
      hashes,
      body,
      notedFreshness,
      claim,
    );

    try {
      await this.runAiProcess(catch_.id, imageUrl);
    } catch (error) {
      await this.discardFailedCertifiedCatch(catch_.id, file.path);
      throw error;
    }

    const processed = await this.prisma.catch.findUnique({
      where: { id: catch_.id },
      include: {
        certification: { select: { grade: true, errorMessage: true } },
      },
    });

    const status = processed?.status ?? 'pending';
    const message =
      status === 'approved'
        ? '인증이 완료되었습니다. 랭킹에 반영됩니다.'
        : status === 'rejected'
          ? (processed?.certification?.errorMessage ??
            '인증 기준이 충족되지 않아 반려되었습니다.')
          : 'AI 분석 중입니다. 잠시 후 결과를 확인하세요.';

    return {
      catchId: catch_.id,
      status,
      recordType: 'certified',
      grade: processed?.certification?.grade ?? null,
      message,
    };
  }

  async createPersonal(
    userId: string,
    file: Express.Multer.File,
    body: CatchUploadBody,
  ) {
    if (!file?.path) throw new BadRequestException('사진 파일이 필요합니다.');

    const hashes = await this.assertUniqueImage(file.path);
    const catch_ = await this.createOrRejectDuplicate(file.path, () =>
      this.prisma.catch.create({
        data: {
          userId,
          imageUrl: `/uploads/${file.filename}`,
          ...hashes,
          locationName: body.locationName || null,
          memo: body.memo || null,
          recordType: 'personal',
          status: 'approved',
          lengthCm: optionalNumber(body.lengthCm),
          fishSpeciesId: optionalNumber(body.fishSpeciesId),
        },
        include: { fishSpecies: true },
      }),
    );

    return {
      catchId: catch_.id,
      status: 'approved',
      recordType: 'personal',
      message: '자랑 기록이 올라갔습니다. 다른 낚시인의 추천을 받아보세요!',
      catch: toPublicCatch(catch_),
    };
  }

  private createCertifiedRow(
    userId: string,
    filePath: string,
    imageUrl: string,
    hashes: { imageHash: string; perceptualHash: string | null },
    body: CatchUploadBody,
    freshness: PhotoFreshness,
    claim: DayCodeClaim,
  ) {
    return this.createOrRejectDuplicate(filePath, () =>
      this.prisma.catch.create({
        data: {
          userId,
          imageUrl,
          ...hashes,
          ...claim,
          locationName: body.locationName,
          memo: body.memo,
          photoTakenAt: freshness.takenAt,
          exifLat: freshness.exifLat,
          exifLng: freshness.exifLng,
          integrityNote: freshness.integrityNote,
          recordType: 'certified',
          status: 'pending',
        },
      }),
    );
  }

  /** 정확히 같은 사진(SHA)과 살짝 바꾼 사진(지각 해시)을 모두 막는다. 실패하면 업로드 파일을 지운다. */
  private async assertUniqueImage(filePath: string) {
    const imageHash = await computeImageHash(filePath);
    const existing = await this.prisma.catch.findFirst({
      where: { imageHash },
      select: { id: true, deletedAt: true },
    });

    if (existing && !existing.deletedAt) {
      await removeUploadedFile(filePath);
      throw new ConflictException(DUPLICATE_IMAGE_MESSAGE);
    }
    if (existing) {
      // 삭제된 기록의 해시는 비워서 같은 사진을 다시 올릴 수 있게 한다
      await this.prisma.catch.update({
        where: { id: existing.id },
        data: { imageHash: null, perceptualHash: null },
      });
    }

    const perceptualHash = await computePerceptualHash(filePath);
    if (perceptualHash) {
      const rows = await this.prisma.catch.findMany({
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
  private async createOrRejectDuplicate<T>(
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

  private async discardFailedCertifiedCatch(catchId: string, filePath: string) {
    await this.prisma.certification.deleteMany({ where: { catchId } });
    await this.prisma.catch.delete({ where: { id: catchId } });
    await removeUploadedFile(filePath);
  }

  private async runAiProcess(catchId: string, imageUrl: string) {
    const analysis = await this.aiService.analyze(catchId, imageUrl);

    const rules = {
      ruleFlat: analysis.ruleFlat,
      ruleVertical: analysis.ruleVertical,
      ruleRuler: analysis.ruleRuler,
      ruleFullBody: analysis.ruleFullBody,
    };

    const gradeResult = determineGrade({
      rulerDetected: analysis.rulerDetected,
      speciesConfidence: analysis.speciesConfidence,
      rules,
    });

    const fishSpeciesId = resolveSpeciesId(analysis.speciesDetected);
    const species = fishSpeciesId
      ? await this.prisma.fishSpecies.findUnique({
          where: { id: fishSpeciesId },
        })
      : null;

    const lengthCm = analysis.rulerLengthCm;
    const rankScore = computeRankScore(
      lengthCm,
      species?.rarityWeight ?? 1,
      gradeResult.rankScoreEligible,
    );

    await this.prisma.catch.update({
      where: { id: catchId },
      data: {
        status: gradeResult.status,
        fishSpeciesId: species?.id ?? null,
        lengthCm,
        aiLengthCm: lengthCm,
        aiConfidence: analysis.speciesConfidence,
        rankScore,
      },
    });

    await this.prisma.certification.create({
      data: {
        catchId,
        grade: gradeResult.grade,
        rulerDetected: analysis.rulerDetected,
        rulerStartPx: analysis.rulerStartPx,
        rulerEndPx: analysis.rulerEndPx,
        rulerLengthCm: analysis.rulerLengthCm,
        speciesDetected: species?.nameKo ?? analysis.speciesDetected,
        speciesConfidence: analysis.speciesConfidence,
        ...rules,
        processedAt: new Date(),
        errorMessage:
          gradeResult.status === 'rejected' ? gradeResult.reason : null,
      },
    });
  }

  async findById(id: string) {
    const catch_ = await this.prisma.catch.findUnique({
      where: { id, deletedAt: null },
      include: {
        user: { select: { id: true, nickname: true, profileImage: true } },
        fishSpecies: true,
        certification: true,
      },
    });
    if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');
    return toPublicCatch(catch_);
  }

  async findStatus(id: string) {
    const catch_ = await this.prisma.catch.findUnique({
      where: { id },
      include: {
        certification: { select: { grade: true } },
        fishSpecies: { select: { nameKo: true } },
      },
    });
    if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');

    return {
      status: catch_.status,
      recordType: catch_.recordType,
      grade: catch_.certification?.grade ?? null,
      lengthCm: catch_.lengthCm,
      fishSpecies: catch_.fishSpecies?.nameKo ?? null,
    };
  }

  async findMyList(userId: string, page = 1, limit = 20, recordType?: string) {
    const paging = parsePageLimit(page, limit, 20, 50);
    const where = {
      userId,
      deletedAt: null,
      ...(recordType === 'certified' || recordType === 'personal'
        ? { recordType }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.catch.findMany({
        where,
        include: {
          fishSpecies: true,
          certification: { select: { grade: true, errorMessage: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (paging.page - 1) * paging.limit,
        take: paging.limit,
      }),
      this.prisma.catch.count({ where }),
    ]);

    return {
      items: toPublicCatches(items),
      total,
      page: paging.page,
      limit: paging.limit,
      recordType: recordType ?? 'all',
    };
  }

  async updatePersonal(
    userId: string,
    catchId: string,
    body: { memo?: string; locationName?: string; fishSpeciesId?: number },
  ) {
    await this.findOwnPersonal(userId, catchId, '수정');

    const data: Record<string, unknown> = {};
    if (body.memo !== undefined) data.memo = body.memo.trim() || null;
    if (body.locationName !== undefined)
      data.locationName = body.locationName.trim() || null;
    if (body.fishSpeciesId !== undefined)
      data.fishSpeciesId = body.fishSpeciesId;

    const updated = await this.prisma.catch.update({
      where: { id: catchId },
      data,
      include: { fishSpecies: true },
    });
    return toPublicCatch(updated);
  }

  async deletePersonal(userId: string, catchId: string) {
    await this.findOwnPersonal(userId, catchId, '삭제');
    return this.prisma.catch.update({
      where: { id: catchId },
      data: softDeleteCatchData(),
    });
  }

  private async findOwnPersonal(
    userId: string,
    catchId: string,
    verb: '수정' | '삭제',
  ) {
    const catch_ = await this.prisma.catch.findUnique({
      where: { id: catchId, deletedAt: null },
    });
    if (!catch_) throw new NotFoundException('기록을 찾을 수 없습니다.');
    if (catch_.userId !== userId)
      throw new ForbiddenException(`본인 기록만 ${verb}할 수 있습니다.`);
    if (catch_.recordType !== 'personal') {
      throw new BadRequestException(`자랑 기록만 ${verb}할 수 있습니다.`);
    }
    return catch_;
  }
}
