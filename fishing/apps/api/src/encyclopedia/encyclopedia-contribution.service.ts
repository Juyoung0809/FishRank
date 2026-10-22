import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateEncyclopediaTipDto } from './dto/create-encyclopedia-tip.dto';
import type { CreateFishSpeciesDto } from './dto/create-fish-species.dto';
import {
  buildEncyclopediaChanges,
  type EncyclopediaEditField,
} from './encyclopedia-edit.util';
import { formatFishCategoryLabel } from './fish-category.util';
import {
  mapTip,
  mergedSpeciesInfo,
  SPECIES_NOT_FOUND,
  WITH_NICKNAME,
} from './encyclopedia-info.util';

/** 낚시인 기여: 새 어종 등록, 정보 수정(기여), 기여 삭제와 대표 사진 갱신 */
@Injectable()
export class EncyclopediaContributionService {
  constructor(private prisma: PrismaService) {}

  /** 이름·학명 중복을 막고 어종·사전·수정 로그(+사진·메모가 있으면 첫 기여)를 만든다. */
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
