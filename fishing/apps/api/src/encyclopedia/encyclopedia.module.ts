import { Module } from '@nestjs/common';
import { EncyclopediaController } from './encyclopedia.controller';
import { EncyclopediaService } from './encyclopedia.service';
import { EncyclopediaContributionService } from './encyclopedia-contribution.service';
import { FishNewsClient } from './fish-news.client';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EncyclopediaController],
  providers: [
    EncyclopediaService,
    EncyclopediaContributionService,
    FishNewsClient,
  ],
})
export class EncyclopediaModule {}
