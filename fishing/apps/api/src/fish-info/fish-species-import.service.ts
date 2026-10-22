import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALL_FISH_CATALOG,
  FISH_CATALOG,
  type FishCatalogEntry,
} from './fish-species-catalog';
import { buildFishableImportRows } from './fishing-species.util';
import { buildPublicDescription, toDbCategory } from './fish-info-text.util';
import { PublicDataFishClient } from './public-data-fish.client';

export type ImportResult = {
  total: number;
  created: number;
  updated: number;
  pruned: number;
  dbCount: number;
  freshwater: number;
  saltwater: number;
  brackish: number;
};

/** 어종 마스터 채우기: 핵심 카탈로그 등록 + 해양수산부 어류 중 낚시 대상 일괄 반영 */
@Injectable()
export class FishSpeciesImportService {
  constructor(
    private prisma: PrismaService,
    private publicData: PublicDataFishClient,
  ) {}

  /** 카탈로그(고정 ID) 어종을 모두 DB 에 맞춘다. */
  async ensureCatalogRegistered() {
    for (const entry of ALL_FISH_CATALOG) {
      await this.registerOneSpecies(entry);
    }
  }

  async registerOneSpecies(entry: FishCatalogEntry) {
    const data = {
      nameKo: entry.nameKo,
      nameEn: entry.nameEn,
      scientificName: entry.scientificName || null,
      category: toDbCategory(entry.category),
      rarityWeight: entry.rarityWeight,
    };
    await this.prisma.fishSpecies.upsert({
      where: { id: entry.speciesId },
      update: data,
      create: { id: entry.speciesId, ...data },
    });
  }

  /** 해양수산부 + 국내 낚시 어종 DB 반영 (낚시 대상만) */
  async importPublicFishSpecies(): Promise<ImportResult> {
    await this.ensureCatalogRegistered();
    await this.resetFishSpeciesIdSequence();

    const rows = buildFishableImportRows(
      await this.publicData.fetchAllMofFishSpecies(),
    );
    const curatedBySci = new Map(
      FISH_CATALOG.filter((e) => e.scientificName).map((e) => [
        e.scientificName.toLowerCase(),
        e,
      ]),
    );
    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const curated = curatedBySci.get(row.scientificName.toLowerCase());
      const category = toDbCategory(curated?.category ?? row.category);
      const description = buildPublicDescription(row);

      if (curated) {
        await this.prisma.fishSpecies.update({
          where: { id: curated.speciesId },
          data: {
            nameKo: curated.nameKo,
            nameEn: curated.nameEn,
            scientificName: row.scientificName,
            category,
          },
        });
        await this.upsertPublicEncyclopedia(
          curated.speciesId,
          description,
          curated,
        );
        updated += 1;
        continue;
      }

      const existing = await this.prisma.fishSpecies.findUnique({
        where: { scientificName: row.scientificName },
      });
      if (existing) {
        await this.prisma.fishSpecies.update({
          where: { id: existing.id },
          data: {
            nameKo: row.nameKo,
            nameEn: row.nameEn ?? existing.nameEn,
            category,
          },
        });
        await this.upsertPublicEncyclopedia(existing.id, description);
        updated += 1;
        continue;
      }

      const species = await this.prisma.fishSpecies.create({
        data: {
          nameKo: row.nameKo,
          nameEn: row.nameEn,
          scientificName: row.scientificName,
          category,
          rarityWeight: 1.0,
        },
      });
      await this.upsertPublicEncyclopedia(species.id, description);
      created += 1;
    }

    const pruned = await this.pruneBulkNonFishingSpecies(
      rows.map((r) => r.scientificName),
      new Set(ALL_FISH_CATALOG.map((e) => e.speciesId)),
    );

    const countEncyclopedia = (category: string) =>
      this.prisma.fishEncyclopedia.count({
        where: { fishSpecies: { category } },
      });
    const [dbCount, freshwater, saltwater, brackish] = await Promise.all([
      this.prisma.fishEncyclopedia.count(),
      countEncyclopedia('freshwater'),
      countEncyclopedia('saltwater'),
      this.prisma.fishSpecies.count({ where: { category: 'brackish' } }),
    ]);

    return {
      total: rows.length,
      created,
      updated,
      pruned,
      dbCount,
      freshwater,
      saltwater,
      brackish,
    };
  }

  /** 이전 bulk import 잔여(낚시 비대상) 제거 — 핵심 카탈로그 ID 와 기록이 있는 어종은 유지 */
  private async pruneBulkNonFishingSpecies(
    keptScientificNames: string[],
    curatedIds: Set<number>,
  ): Promise<number> {
    const stale = await this.prisma.fishSpecies.findMany({
      where: {
        id: { gt: 99 },
        NOT: curatedIds.size ? { id: { in: [...curatedIds] } } : undefined,
        OR: [
          { scientificName: null },
          { scientificName: { notIn: keptScientificNames } },
        ],
        catches: { none: {} },
      },
      select: { id: true },
    });
    if (!stale.length) return 0;

    const ids = stale.map((s) => s.id);
    await this.prisma.fishEncyclopedia.deleteMany({
      where: { fishSpeciesId: { in: ids } },
    });
    await this.prisma.fishSpecies.deleteMany({ where: { id: { in: ids } } });
    return ids.length;
  }

  /** 사전이 없으면 만들고, 있으면 설명만 갱신. 카탈로그 어종에 이미 실전 정보가 있으면 건드리지 않는다. */
  private async upsertPublicEncyclopedia(
    speciesId: number,
    description: string,
    curated?: FishCatalogEntry,
  ) {
    const existing = await this.prisma.fishEncyclopedia.findUnique({
      where: { fishSpeciesId: speciesId },
    });
    if (existing?.season && curated) return;

    if (existing) {
      await this.prisma.fishEncyclopedia.update({
        where: { fishSpeciesId: speciesId },
        data: { description },
      });
      return;
    }

    await this.prisma.fishEncyclopedia.create({
      data: {
        fishSpeciesId: speciesId,
        description,
        season: curated?.season ?? null,
        bait: curated?.bait ?? null,
        technique: curated?.technique ?? null,
        avgLengthCm: curated?.avgLengthCm ?? null,
        maxLengthCm: curated?.maxLengthCm ?? null,
        minSizeLaw: curated?.minSizeLaw ?? null,
      },
    });
  }

  /** 시드가 id 1~99를 수동 지정해 둔 뒤 autoincrement 시퀀스가 뒤처지는 문제 보정 */
  private async resetFishSpeciesIdSequence() {
    await this.prisma.$executeRaw`
      SELECT setval(
        pg_get_serial_sequence('fish_species', 'id'),
        COALESCE((SELECT MAX(id) FROM fish_species), 1)
      )
    `;
  }
}
