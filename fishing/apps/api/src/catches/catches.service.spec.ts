import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CatchesService } from './catches.service';
import { removeUploadedFile } from '../common/upload/image-integrity.util';
import { computePerceptualHash } from '../common/upload/image-phash.util';

jest.mock('../common/upload/image-integrity.util', () => {
  const actual = jest.requireActual('../common/upload/image-integrity.util');
  return {
    ...actual,
    computeImageHash: jest.fn().mockResolvedValue('hash-1'),
    removeUploadedFile: jest.fn().mockResolvedValue(undefined),
    validatePhotoFreshness: jest.fn().mockResolvedValue({ ok: true }),
  };
});

jest.mock('../common/upload/image-phash.util', () => {
  const actual = jest.requireActual('../common/upload/image-phash.util');
  return {
    ...actual,
    computePerceptualHash: jest.fn().mockResolvedValue(null),
  };
});

describe('CatchesService 이미지 해시', () => {
  const prisma = {
    catch: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    certification: {
      deleteMany: jest.fn(),
    },
  };
  const aiService = { analyze: jest.fn() };
  const dayCodes = {
    resolveClaim: jest.fn().mockResolvedValue({
      claimedTournamentId: null,
      claimedDayCode: null,
      dayCodeStatus: null,
    }),
  };
  const service = new CatchesService(
    prisma as never,
    aiService as never,
    dayCodes as never,
  );
  const file = {
    path: '/tmp/fish.jpg',
    filename: 'catch-1.jpg',
  } as Express.Multer.File;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AI 분석이 실패하면 대기 기록과 파일을 되돌려 재업로드를 막지 않는다', async () => {
    prisma.catch.findFirst.mockResolvedValue({
      id: 'old',
      deletedAt: new Date('2026-01-01'),
    });
    prisma.catch.update.mockResolvedValue({});
    prisma.catch.create.mockResolvedValue({ id: 'new-catch' });
    prisma.certification.deleteMany.mockResolvedValue({ count: 0 });
    prisma.catch.delete.mockResolvedValue({});
    aiService.analyze.mockRejectedValue(
      new ServiceUnavailableException('AI down'),
    );

    await expect(
      service.createCertified('user-1', file, {}),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.catch.update).toHaveBeenCalledWith({
      where: { id: 'old' },
      data: { imageHash: null, perceptualHash: null },
    });
    expect(prisma.certification.deleteMany).toHaveBeenCalledWith({
      where: { catchId: 'new-catch' },
    });
    expect(prisma.catch.delete).toHaveBeenCalledWith({
      where: { id: 'new-catch' },
    });
    expect(removeUploadedFile).toHaveBeenCalledWith(file.path);
    expect(prisma.catch.findUnique).not.toHaveBeenCalled();
  });

  it('살아있는 동일 해시는 충돌로 거절하고 파일을 지운다', async () => {
    prisma.catch.findFirst.mockResolvedValue({ id: 'live', deletedAt: null });

    await expect(
      service.createCertified('user-1', file, {}),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.catch.create).not.toHaveBeenCalled();
    expect(removeUploadedFile).toHaveBeenCalledWith(file.path);
  });

  it('살아있는 비슷한 사진은 충돌로 거절한다', async () => {
    (computePerceptualHash as jest.Mock).mockResolvedValueOnce(
      '0000000000000000',
    );
    prisma.catch.findFirst.mockResolvedValue(null);
    prisma.catch.findMany.mockResolvedValue([
      { perceptualHash: '0000000000000001' },
    ]);

    await expect(
      service.createCertified('user-1', file, {}),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.catch.create).not.toHaveBeenCalled();
    expect(removeUploadedFile).toHaveBeenCalledWith(file.path);
  });

  it('삭제된 기록의 지각 해시는 비교하지 않고 새 해시를 저장한다', async () => {
    (computePerceptualHash as jest.Mock).mockResolvedValueOnce(
      'aaaaaaaaaaaaaaaa',
    );
    prisma.catch.findFirst.mockResolvedValue(null);
    prisma.catch.findMany.mockResolvedValue([]);
    prisma.catch.create.mockResolvedValue({ id: 'new-catch' });
    prisma.catch.findUnique.mockResolvedValue({
      id: 'new-catch',
      status: 'approved',
      certification: { grade: 'A', errorMessage: null },
    });
    aiService.analyze.mockResolvedValue({
      ruleFlat: true,
      ruleVertical: true,
      ruleRuler: true,
      ruleFullBody: true,
      rulerDetected: true,
      speciesConfidence: 0.9,
      speciesDetected: null,
      lengthCm: 30,
    });

    await service.createPersonal('user-1', file, { memo: '자랑' });

    expect(prisma.catch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, perceptualHash: { not: null } },
      }),
    );
    expect(prisma.catch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ perceptualHash: 'aaaaaaaaaaaaaaaa' }),
      }),
    );
  });

  it('대회 코드가 맞지 않으면 파일을 지우고 기록을 만들지 않는다', async () => {
    prisma.catch.findFirst.mockResolvedValue(null);
    dayCodes.resolveClaim.mockRejectedValueOnce(
      new BadRequestException('대회 코드가 맞지 않습니다.'),
    );

    await expect(
      service.createCertified('user-1', file, {
        tournamentId: 'tour-1',
        dayCode: 'NOPE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(removeUploadedFile).toHaveBeenCalledWith(file.path);
    expect(prisma.catch.create).not.toHaveBeenCalled();
  });

  it('공개 단건 조회는 대회 코드와 해시를 빼 준다', async () => {
    prisma.catch.findUnique.mockResolvedValue({
      id: 'catch-1',
      claimedDayCode: 'LAKE1',
      imageHash: 'abc',
      perceptualHash: 'ffff',
      exifLat: 35.1,
      exifLng: 129.1,
      dayCodeStatus: 'accepted',
      lengthCm: 42,
      user: { id: 'user-1', nickname: 'angler', profileImage: null },
      fishSpecies: null,
      certification: { grade: 'S' },
    });

    const result = await service.findById('catch-1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'catch-1',
        dayCodeStatus: 'accepted',
        lengthCm: 42,
      }),
    );
    expect(result).not.toHaveProperty('claimedDayCode');
    expect(result).not.toHaveProperty('imageHash');
    expect(result).not.toHaveProperty('perceptualHash');
    expect(result).not.toHaveProperty('exifLat');
    expect(JSON.stringify(result)).not.toContain('LAKE1');
  });

  it('촬영 시각이 없는 대회 제출은 확인 불가로 남긴다', async () => {
    prisma.catch.findFirst.mockResolvedValue(null);
    prisma.catch.findMany.mockResolvedValue([]);
    dayCodes.resolveClaim.mockResolvedValueOnce({
      claimedTournamentId: 'tour-1',
      claimedDayCode: 'LAKE1',
      dayCodeStatus: 'pending',
    });
    prisma.catch.create.mockResolvedValue({ id: 'new-catch' });
    prisma.certification.deleteMany.mockResolvedValue({ count: 0 });
    prisma.catch.delete.mockResolvedValue({});
    aiService.analyze.mockRejectedValue(
      new ServiceUnavailableException('AI down'),
    );

    await expect(
      service.createCertified('user-1', file, {
        tournamentId: 'tour-1',
        dayCode: 'LAKE1',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.catch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claimedDayCode: 'LAKE1',
          integrityNote: 'code_date_unverified',
        }),
      }),
    );
  });

  it('자랑 기록을 지우면 이미지 해시를 비운다', async () => {
    prisma.catch.findUnique.mockResolvedValue({
      id: 'catch-1',
      userId: 'user-1',
      recordType: 'personal',
      deletedAt: null,
    });
    prisma.catch.update.mockResolvedValue({ id: 'catch-1' });

    await service.deletePersonal('user-1', 'catch-1');

    expect(prisma.catch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'catch-1' },
        data: expect.objectContaining({
          imageHash: null,
          deletedAt: expect.any(Date),
        }),
      }),
    );
  });
});
