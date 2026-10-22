import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getCatalogEntry } from '../fish-info/fish-species-catalog';
import { pageWindow, paginated } from '../common/pagination.util';
import { FishNewsClient } from './fish-news.client';
import {
  buildTechniqueSpeciesOr,
  type EncyclopediaSort,
  type EncyclopediaTechnique,
} from './encyclopedia-filter.util';
import { buildSpeciesCategoryFilter } from './fish-category.util';
import {
  mapTip,
  mergedSpeciesInfo,
  SPECIES_NOT_FOUND,
  WITH_NICKNAME,
} from './encyclopedia-info.util';

const DATA_SOURCE = '해양수산부 해양생물종기본정보 · 공공데이터포털';

/** 어종 사전 조회: 목록·통계·상세·수정 기록·기여·뉴스 */
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

  private async assertSpeciesExists(speciesId: number) {
    const species = await this.prisma.fishSpecies.findUnique({
      where: { id: speciesId },
    });
    if (!species) throw new NotFoundException(SPECIES_NOT_FOUND);
    return species;
  }
}
