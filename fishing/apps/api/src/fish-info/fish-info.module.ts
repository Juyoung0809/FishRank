import { Module } from '@nestjs/common';
import { FishInfoController } from './fish-info.controller';
import { FishInfoService } from './fish-info.service';
import { FishSpeciesImportService } from './fish-species-import.service';
import { InaturalistClient } from './inaturalist.client';
import { PublicDataFishClient } from './public-data-fish.client';

@Module({
  controllers: [FishInfoController],
  providers: [
    FishInfoService,
    FishSpeciesImportService,
    InaturalistClient,
    PublicDataFishClient,
  ],
  exports: [
    FishInfoService,
    FishSpeciesImportService,
    InaturalistClient,
    PublicDataFishClient,
  ],
})
export class FishInfoModule {}
