import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FISH_CATALOG,
  FISH_CATALOG_STATS,
  getCatalogEntry,
  type FishCatalogEntry,
} from './fish-species-catalog';
import { InaturalistClient } from './inaturalist.client';
import { PublicDataFishClient } from './public-data-fish.client';
import { FishSpeciesImportService } from './fish-species-import.service';
import { toDbCategory } from './fish-info-text.util';
import {
  mergeEnrichedInfo,
  publicCategoryOf,
  syncSummary,
  type EnrichedFishInfo,
  type SpeciesWithEncyclopedia,
  type SyncResultItem,
} from './fish-info-enrich.util';

export type { ImportResult } from './fish-species-import.service';
export type { EnrichedFishInfo, SyncResultItem } from './fish-info-enrich.util';

const SYNC_DELAY_MS = 400;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 어종 정보 조회와 외부(iNaturalist·공공데이터) 정보로 사전 동기화 */
@Injectable()
export class FishInfoService {
  private readonly logger = new Logger(FishInfoService.name);

  constructor(
    private prisma: PrismaService,
    private inaturalist: InaturalistClient,
    private publicData: PublicDataFishClient,
    private importer: FishSpeciesImportService,
  ) {}

  getCatalog() {
    return {
      stats: FISH_CATALOG_STATS,
      freshwater: FISH_CATALOG.filter((s) => s.category === 'freshwater'),
      saltwater: FISH_CATALOG.filter((s) => s.category === 'saltwater'),
      brackish: FISH_CATALOG.filter((s) => s.category === 'brackish'),
    };
  }

  /** 카탈로그 어종이면 카탈로그 기준으로, 아니면 검색어 그대로 외부 정보를 찾는다. */
  async searchExternal(query: string) {
    const catalog = FISH_CATALOG.find(
      (s) =>
        s.nameKo === query || s.nameEn.toLowerCase() === query.toLowerCase(),
    );

    const [inat, publicRecord] = await Promise.all([
      catalog
        ? this.inaturalist.resolveFromCatalog(catalog)
        : this.inaturalist.searchTaxon(query),
      catalog
        ? this.publicData.searchByCategory(
            catalog.publicDataQuery,
            catalog.category,
            catalog.scientificName,
          )
        : this.publicData.searchByCategory(query, 'saltwater'),
    ]);

    return {
      query,
      catalog: catalog ?? null,
      iNaturalist: inat,
      publicData: publicRecord,
    };
  }

  async getEnriched(speciesId: number): Promise<EnrichedFishInfo> {
    await this.importer.ensureCatalogRegistered();

    const species = await this.prisma.fishSpecies.findUnique({
      where: { id: speciesId },
      include: { encyclopedia: true },
    });
    if (!species) throw new NotFoundException('어종을 찾을 수 없습니다');

    return this.buildEnriched(species, getCatalogEntry(speciesId));
  }

  /** 카탈로그 어종 하나를 외부 정보로 채워 어종·사전 행에 저장한다. */
  async syncSpecies(speciesId: number): Promise<EnrichedFishInfo> {
    const catalog = getCatalogEntry(speciesId);
    if (!catalog || !catalog.scientificName) {
      throw new NotFoundException('동기화 카탈로그에 없는 어종입니다');
    }

    await this.importer.registerOneSpecies(catalog);

    const enriched = await this.buildEnriched(
      await this.prisma.fishSpecies.findUniqueOrThrow({
        where: { id: speciesId },
        include: { encyclopedia: true },
      }),
      catalog,
    );

    await this.prisma.fishSpecies.update({
      where: { id: speciesId },
      data: {
        nameKo: catalog.nameKo,
        nameEn: enriched.nameEn ?? catalog.nameEn,
        category: toDbCategory(catalog.category),
        rarityWeight: catalog.rarityWeight,
        imageUrl: enriched.imageUrl,
      },
    });

    const encyclopedia = {
      description: enriched.description,
      habitat: enriched.habitat,
      season: enriched.season,
      bait: enriched.bait,
      technique: enriched.technique,
      avgLengthCm: enriched.avgLengthCm,
      maxLengthCm: enriched.maxLengthCm,
      minSizeLaw: enriched.minSizeLaw,
      imageUrl: enriched.imageUrl,
    };
    await this.prisma.fishEncyclopedia.upsert({
      where: { fishSpeciesId: speciesId },
      update: encyclopedia,
      create: { fishSpeciesId: speciesId, ...encyclopedia },
    });

    return enriched;
  }

  /** 공공데이터 전체 반영 후 카탈로그 어종을 하나씩(외부 API 부담을 줄이려 간격을 두고) 동기화 */
  async syncAll(): Promise<SyncResultItem[]> {
    const imported = await this.importer.importPublicFishSpecies();
    this.logger.log(
      `공공데이터 어류 ${imported.total}종 반영 (신규 ${imported.created}, 갱신 ${imported.updated}, DB ${imported.dbCount}종)`,
    );

    await this.importer.ensureCatalogRegistered();

    const results: SyncResultItem[] = [];
    for (const entry of FISH_CATALOG) {
      results.push(await this.syncOne(entry));
      await delay(SYNC_DELAY_MS);
    }

    this.logger.log(
      `어종 동기화 완료: ${results.filter((r) => r.ok).length}/${results.length}`,
    );
    return results;
  }

  private async syncOne(entry: FishCatalogEntry): Promise<SyncResultItem> {
    try {
      return syncSummary(entry, await this.syncSpecies(entry.speciesId));
    } catch (err) {
      return {
        speciesId: entry.speciesId,
        nameKo: entry.nameKo,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown',
      };
    }
  }

  async getDbStats() {
    const [speciesCount, encyclopediaCount, featuredCount] = await Promise.all([
      this.prisma.fishSpecies.count(),
      this.prisma.fishEncyclopedia.count(),
      this.prisma.fishSpecies.count({ where: { id: { lte: 100 } } }),
    ]);
    return {
      speciesCount,
      encyclopediaCount,
      featuredCatalog: FISH_CATALOG.length,
      featuredCount,
    };
  }

  /** iNaturalist·공공데이터를 함께 조회해 DB·카탈로그 정보와 합친다. */
  private async buildEnriched(
    species: SpeciesWithEncyclopedia,
    catalog?: FishCatalogEntry,
  ) {
    const scientificName =
      catalog?.scientificName ?? species.scientificName ?? undefined;

    const [inat, publicRecord] = await Promise.all([
      catalog
        ? this.inaturalist.resolveFromCatalog(catalog)
        : this.inaturalist.searchTaxon(scientificName || species.nameKo),
      this.publicData.searchByCategory(
        catalog?.publicDataQuery ?? species.nameKo,
        publicCategoryOf(species, catalog),
        scientificName,
      ),
    ]);

    return mergeEnrichedInfo(species, catalog, inat, publicRecord);
  }
}
