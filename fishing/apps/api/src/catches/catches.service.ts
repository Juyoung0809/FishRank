import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import {
  appendIntegrityNote,
  removeUploadedFile,
  validatePhotoFreshness,
} from '../common/upload/image-integrity.util';
import {
  TournamentDayCodeService,
  type DayCodeClaim,
} from '../tournaments/tournament-day-code.service';
import {
  assertUniqueCatchImage,
  createOrRejectDuplicate,
} from './catch-image-dedupe.util';
import { certifyCatchWithAi } from './catch-certification.util';
import { toPublicCatch } from './public-catch';

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

/** 낚시 기록 업로드: 공식 인증(AI 측정·대회 코드)과 자랑 기록. 조회·수정은 CatchRecordsService */
@Injectable()
export class CatchesService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private dayCodes: TournamentDayCodeService,
  ) {}

  /**
   * 공식 인증 업로드: 촬영 신선도 → 중복 사진 → 대회 코드 → 기록 생성 → AI 인증.
   * AI 가 실패하면 기록과 파일을 되돌려 같은 사진으로 다시 올릴 수 있게 한다.
   */
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

    const hashes = await assertUniqueCatchImage(this.prisma, file.path);

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
    const integrityNote =
      claim.claimedTournamentId && !freshness.takenAt
        ? appendIntegrityNote(freshness.integrityNote, 'code_date_unverified')
        : freshness.integrityNote;

    const imageUrl = `/uploads/${file.filename}`;
    const catch_ = await createOrRejectDuplicate(file.path, () =>
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
          integrityNote,
          recordType: 'certified',
          status: 'pending',
        },
      }),
    );

    try {
      await certifyCatchWithAi(
        this.prisma,
        this.aiService,
        catch_.id,
        imageUrl,
      );
    } catch (error) {
      await this.prisma.certification.deleteMany({
        where: { catchId: catch_.id },
      });
      await this.prisma.catch.delete({ where: { id: catch_.id } });
      await removeUploadedFile(file.path);
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

  /** 자랑(비공식) 업로드: 중복 사진만 막고 바로 공개한다. */
  async createPersonal(
    userId: string,
    file: Express.Multer.File,
    body: CatchUploadBody,
  ) {
    if (!file?.path) throw new BadRequestException('사진 파일이 필요합니다.');

    const hashes = await assertUniqueCatchImage(this.prisma, file.path);
    const catch_ = await createOrRejectDuplicate(file.path, () =>
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
}
