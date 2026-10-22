import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getCatalogEntry } from '../fish-info/fish-species-catalog';
import { pageWindow, paginated } from '../common/pagination.util';
import { FishNewsClient } from './fish-news.client';
import type { CreateEncyclopediaTipDto } from './dto/create-encyclopedia-tip.dto';
import type { CreateFishSpeciesDto } from './dto/create-fish-species.dto';
import {
  buildEncyclopediaChanges,
  type EncyclopediaEditField,
} from './encyclopedia-edit.util';
import {
  isGenericSummary,
  mergeBasicInfoWithTips,
} from './encyclopedia-merge.util';
import {
  buildTechniqueSpeciesOr,
  type EncyclopediaSort,
  type EncyclopediaTechnique,
} from './encyclopedia-filter.util';
import {
  buildSpeciesSummary,
  extractHabitat,
} from './encyclopedia-summary.util';
import {
  buildSpeciesCategoryFilter,
  formatFishCategoryLabel,
} from './fish-category.util';

const DATA_SOURCE = '해양수산부 해양생물종기본정보 · 공공데이터포털';
const SPECIES_NOT_FOUND = '어종을 찾을 수 없습니다';
const WITH_NICKNAME = { user: { select: { nickname: true } } } as const;

type TipWithUser = {
  id: string;
  userId: string;
  season: string | null;
  bait: string | null;
  technique: string | null;
  habitat: string | null;
  note: string | null;
  summary: string | null;
  imageUrl: string | null;
  createdAt: Date;
  user: { nickname: string };
};

type SpeciesWithInfo = {
  id: number;
  nameKo: string;
  category: string;
  imageUrl: string | null;
  encyclopedia: {
    description: string;
    season: string | null;
    bait: string | null;
    technique: string | null;
    habitat: string | null;
    imageUrl: string | null;
    avgLengthCm: number | null;
    minSizeLaw: number | null;
  } | null;
  tips: Parameters<typeof mergeBasicInfoWithTips>[1];
};

function mapTip(t: TipWithUser) {
  return {
    id: t.id,
    userId: t.userId,
    nickname: t.user.nickname,
    season: t.season,
    bait: t.bait,
    technique: t.technique,
    habitat: t.habitat,
    note: t.note,
    summary: t.summary,
    imageUrl: t.imageUrl,
    createdAt: t.createdAt,
  };
}

/** 공식 정보(DB·카탈로그)를 기본으로 두고 빈 칸을 낚시인 기여로 채운 현재 사전 내용 */
function mergedSpeciesInfo(species: SpeciesWithInfo) {
  const catalog = getCatalogEntry(species.id);
  const enc = species.encyclopedia;
  const nameKo = catalog?.nameKo ?? species.nameKo;
  const summary = buildSpeciesSummary(
    nameKo,
    enc?.description,
    species.category,
    catalog,
  );

  const merged = mergeBasicInfoWithTips(
    {
      imageUrl: species.imageUrl ?? enc?.imageUrl ?? null,
      season: enc?.season ?? catalog?.season ?? null,
      bait: enc?.bait ?? catalog?.bait ?? null,
      technique: enc?.technique ?? catalog?.technique ?? null,
      habitat: enc?.habitat ?? extractHabitat(enc?.description),
      summary: summary && !isGenericSummary(summary, nameKo) ? summary : null,
      avgLengthCm: enc?.avgLengthCm ?? catalog?.avgLengthCm ?? null,
    },
    species.tips,
  );
  return { nameKo, catalog, merged };
}

@Injectable()
export class EncyclopediaService {
  constructor(
    private prisma: PrismaService,
    private news: FishNewsClient,
  ) {}

  async list(
    category?: string,
    search?: string,
    page = 1,
    limit = 48,
    sort: EncyclopediaSort = 'name',
    technique: EncyclopediaTechnique = 'all',
  ) {
    const w = pageWindow(page, limit, 100);

    const speciesAnd: Record<string, unknown>[] = [];
    const categoryFilter = buildSpeciesCategoryFilter(category);
    if (categoryFilter) speciesAnd.push(categoryFilter);

    const q = search?.trim();
    if (q) {
      speciesAnd.push({
        OR: [
          { nameKo: { contains: q, mode: 'insensitive' } },
          { nameEn: { contains: q, mode: 'insensitive' } },
          { scientificName: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    const techniqueOr = buildTechniqueSpeciesOr(technique);
    if (techniqueOr?.length === 0) return paginated([], 0, w.page, w.take);
    if (techniqueOr) speciesAnd.push({ OR: techniqueOr });

    const where =
      speciesAnd.length > 0 ? { fishSpecies: { AND: speciesAnd } } : {};
    const orderBy =
      sort === 'popular'
        ? [
            { fishSpecies: { catches: { _count: 'desc' as const } } },
            { fishSpecies: { nameKo: 'asc' as const } },
          ]
        : [{ fishSpecies: { nameKo: 'asc' as const } }];

    const [rows, total] = await Promise.all([
      this.prisma.fishEncyclopedia.findMany({
        where,
        include: { fishSpecies: true },
        orderBy,
        skip: w.skip,
        take: w.take,
      }),
      this.prisma.fishEncyclopedia.count({ where }),
    ]);

    const items = rows.map((row) => {
      const catalog = getCatalogEntry(row.fishSpeciesId);
      const season = row.season ?? catalog?.season ?? null;
      const bait = row.bait ?? catalog?.bait ?? null;
      const technique = row.technique ?? catalog?.technique ?? null;
      return {
        id: row.fishSpeciesId,
        fishSpeciesId: row.fishSpeciesId,
        nameKo: catalog?.nameKo ?? row.fishSpecies.nameKo,
        nameEn: row.fishSpecies.nameEn,
        category: row.fishSpecies.category,
        imageUrl: row.fishSpecies.imageUrl ?? row.imageUrl ?? null,
        imageAttribution: null,
        season,
        bait,
        technique,
        minSizeLaw: row.minSizeLaw ?? catalog?.minSizeLaw ?? null,
        hint: season ?? bait ?? technique,
      };
    });

    return paginated(items, total, w.page, w.take);
  }

  async getStats() {
    const countIn = (category: string) =>
      this.prisma.fishEncyclopedia.count({
        where: { fishSpecies: { category } },
      });
    const [total, freshwater, saltwater, both] = await Promise.all([
      this.prisma.fishEncyclopedia.count(),
      countIn('freshwater'),
      countIn('saltwater'),
      countIn('both'),
    ]);
    return { total, freshwater, saltwater, both };
  }

  async createSpecies(
    userId: string,
    dto: CreateFishSpeciesDto,
    imageUrl?: string | null,
  ) {
    const nameKo = dto.nameKo.trim();
    const scientificName = dto.scientificName?.trim() || null;

    const duplicateName = await this.prisma.fishSpecies.findFirst({
      where: { nameKo: { equals: nameKo, mode: 'insensitive' } },
      select: { id: true, nameKo: true },
    });
    if (duplicateName) {
      throw new ConflictException(
        `"${duplicateName.nameKo}"은(는) 이미 사전에 등록된 어종입니다.`,
      );
    }

    if (scientificName) {
      const duplicateSci = await this.prisma.fishSpecies.findUnique({
        where: { scientificName },
        select: { id: true, nameKo: true },
      });
      if (duplicateSci) {
        throw new ConflictException(
          `학명이 "${duplicateSci.nameKo}"과(와) 중복됩니다.`,
        );
      }
    }

    const summary =
      dto.summary?.trim() ||
      `${nameKo} — FishRank 낚시인 사전에 등록된 어종입니다.`;
    const info = {
      season: dto.season?.trim() || null,
      bait: dto.bait?.trim() || null,
      technique: dto.technique?.trim() || null,
      habitat: dto.habitat?.trim() || null,
      imageUrl: imageUrl ?? null,
    };

    const species = await this.prisma.fishSpecies.create({
      data: {
        nameKo,
        nameEn: dto.nameEn?.trim() || null,
        scientificName,
        category: dto.category,
        imageUrl: info.imageUrl,
      },
    });

    await this.prisma.fishEncyclopedia.create({
      data: { fishSpeciesId: species.id, description: summary, ...info },
    });

    await this.prisma.fishEncyclopediaEditLog.create({
      data: {
        fishSpeciesId: species.id,
        userId,
        changes: [
          {
            field: 'species',
            label: '어종 등록',
            oldValue: null,
            newValue: nameKo,
          },
        ],
      },
    });

    if (dto.note?.trim() || imageUrl) {
      await this.prisma.fishEncyclopediaTip.create({
        data: {
          fishSpeciesId: species.id,
          userId,
          ...info,
          summary,
          note: dto.note?.trim() || null,
        },
      });
    }

    return {
      speciesId: species.id,
      nameKo: species.nameKo,
      category: species.category,
    };
  }

  /** DB·카탈로그만 사용 — 외부 API 호출 없음 (빠른 응답) */
  async getDetail(speciesId: number) {
    const species = await this.prisma.fishSpecies.findUnique({
      where: { id: speciesId },
      include: {
        encyclopedia: true,
        tips: {
          include: WITH_NICKNAME,
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
      },
    });
    if (!species) throw new NotFoundException(SPECIES_NOT_FOUND);

    const { nameKo, catalog, merged } = mergedSpeciesInfo(species);

    return {
      speciesId: species.id,
      nameKo,
      nameEn: species.nameEn,
      scientificName: species.scientificName,
      category: species.category,
      imageUrl: merged.imageUrl,
      imageAttribution: merged.filledByCommunity.imageUrl
        ? '낚시인 제공'
        : null,
      season: merged.season,
      bait: merged.bait,
      technique: merged.technique,
      habitat: merged.habitat,
      distribution: null,
      summary: merged.summary,
      minSizeLaw:
        species.encyclopedia?.minSizeLaw ?? catalog?.minSizeLaw ?? null,
      avgLengthCm: merged.avgLengthCm,
      filledByCommunity: merged.filledByCommunity,
      needsFill: merged.needsFill,
      communityTips: species.tips.map(mapTip),
      editLogs: await this.getEditLogs(speciesId),
      dataSource: DATA_SOURCE,
    };
  }

  async getEditLogs(speciesId: number) {
    await this.assertSpeciesExists(speciesId);
    const logs = await this.prisma.fishEncyclopediaEditLog.findMany({
      where: { fishSpeciesId: speciesId },
      include: WITH_NICKNAME,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return logs.map((log) => ({
      id: log.id,
      userId: log.userId,
      nickname: log.user.nickname,
      changes: log.changes,
      createdAt: log.createdAt,
    }));
  }

  async getTips(speciesId: number) {
    await this.assertSpeciesExists(speciesId);
    const tips = await this.prisma.fishEncyclopediaTip.findMany({
      where: { fishSpeciesId: speciesId },
      include: WITH_NICKNAME,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return tips.map(mapTip);
  }

  async getNews(speciesId: number) {
    const species = await this.assertSpeciesExists(speciesId);
    return this.news.searchArticles(
      getCatalogEntry(speciesId)?.nameKo ?? species.nameKo,
    );
  }

  /** 기여는 현재 사전 내용에 덮어쓴 전체 스냅샷으로 저장하고, 바뀐 칸만 수정 로그로 남긴다. */
  async createTip(
    speciesId: number,
    userId: string,
    dto: CreateEncyclopediaTipDto,
    imageUrl?: string | null,
  ) {
    const species = await this.prisma.fishSpecies.findUnique({
      where: { id: speciesId },
      include: { encyclopedia: true, tips: { orderBy: { createdAt: 'desc' } } },
    });
    if (!species) throw new NotFoundException(SPECIES_NOT_FOUND);

    const { merged } = mergedSpeciesInfo(species);
    const beforeValues: Record<EncyclopediaEditField, string | null> = {
      season: merged.season,
      bait: merged.bait,
      technique: merged.technique,
      habitat: merged.habitat,
      summary: merged.summary,
      imageUrl: merged.imageUrl,
    };
    const afterValues: Record<EncyclopediaEditField, string | null> = {
      season: dto.season?.trim() || merged.season,
      bait: dto.bait?.trim() || merged.bait,
      technique: dto.technique?.trim() || merged.technique,
      habitat: dto.habitat?.trim() || merged.habitat,
      summary: dto.summary?.trim() || merged.summary,
      imageUrl: imageUrl ?? merged.imageUrl,
    };

    const changes = buildEncyclopediaChanges(beforeValues, afterValues);
    const nextCategory = dto.category?.trim() || species.category;
    if (nextCategory !== species.category) {
      changes.push({
        field: 'category',
        label: '분류',
        oldValue: formatFishCategoryLabel(species.category),
        newValue: formatFishCategoryLabel(nextCategory),
      });
    }
    if (changes.length === 0)
      throw new BadRequestException('변경된 내용이 없습니다.');

    const tip = await this.prisma.fishEncyclopediaTip.create({
      data: {
        fishSpeciesId: speciesId,
        userId,
        ...afterValues,
        note: dto.note?.trim() || null,
      },
      include: WITH_NICKNAME,
    });

    await this.prisma.fishEncyclopediaEditLog.create({
      data: { fishSpeciesId: speciesId, userId, changes },
    });

    if (nextCategory !== species.category) {
      await this.prisma.fishSpecies.update({
        where: { id: speciesId },
        data: { category: nextCategory },
      });
    }

    if (
      afterValues.imageUrl &&
      afterValues.imageUrl !== beforeValues.imageUrl
    ) {
      await this.maybePromoteSpeciesImage(speciesId, afterValues.imageUrl);
    }

    return mapTip(tip);
  }

  async deleteTip(speciesId: number, tipId: string, userId: string) {
    const tip = await this.prisma.fishEncyclopediaTip.findFirst({
      where: { id: tipId, fishSpeciesId: speciesId },
    });
    if (!tip) throw new NotFoundException('기여 정보를 찾을 수 없습니다');
    if (tip.userId !== userId)
      throw new ForbiddenException('본인이 올린 정보만 삭제할 수 있어요');

    await this.prisma.fishEncyclopediaTip.delete({ where: { id: tipId } });

    if (tip.imageUrl) {
      const species = await this.prisma.fishSpecies.findUnique({
        where: { id: speciesId },
      });
      if (species?.imageUrl === tip.imageUrl)
        await this.refreshSpeciesImageFromTips(speciesId);
    }
  }

  private async assertSpeciesExists(speciesId: number) {
    const species = await this.prisma.fishSpecies.findUnique({
      where: { id: speciesId },
    });
    if (!species) throw new NotFoundException(SPECIES_NOT_FOUND);
    return species;
  }

  /** 공식 사진이 없을 때만 기여 사진을 대표 사진으로 올린다. */
  private async maybePromoteSpeciesImage(speciesId: number, imageUrl: string) {
    const species = await this.prisma.fishSpecies.findUnique({
      where: { id: speciesId },
      include: { encyclopedia: true },
    });
    if (!species || (species.imageUrl ?? species.encyclopedia?.imageUrl))
      return;

    await this.prisma.fishSpecies.update({
      where: { id: speciesId },
      data: { imageUrl },
    });
    if (species.encyclopedia) {
      await this.prisma.fishEncyclopedia.update({
        where: { fishSpeciesId: speciesId },
        data: { imageUrl },
      });
    }
  }

  /** 대표 사진으로 쓰던 기여가 지워지면 가장 최근 기여 사진으로 바꾼다(없으면 비운다). */
  private async refreshSpeciesImageFromTips(speciesId: number) {
    const next = await this.prisma.fishEncyclopediaTip.findFirst({
      where: { fishSpeciesId: speciesId, imageUrl: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { imageUrl: true },
    });
    const imageUrl = next?.imageUrl ?? null;
    await this.prisma.fishSpecies.update({
      where: { id: speciesId },
      data: { imageUrl },
    });
    await this.prisma.fishEncyclopedia.updateMany({
      where: { fishSpeciesId: speciesId },
      data: { imageUrl },
    });
  }
}
