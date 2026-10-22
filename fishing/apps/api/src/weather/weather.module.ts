import { Module } from '@nestjs/common';
import { WeatherController } from './weather.controller';
import { FishingConditionsController } from './fishing-conditions.controller';
import { WeatherService } from './weather.service';
import { GeocodeService } from './geocode.service';
import { KhoaPublicClient } from './khoa-public.client';
import { ReservoirPublicClient } from './reservoir-public.client';
import { MarineConditionsService } from './marine-conditions.service';
import { ReservoirConditionsService } from './reservoir-conditions.service';
import { FishingBanService } from './fishing-ban.service';

@Module({
  controllers: [WeatherController, FishingConditionsController],
  providers: [
    WeatherService,
    GeocodeService,
    KhoaPublicClient,
    ReservoirPublicClient,
    MarineConditionsService,
    ReservoirConditionsService,
    FishingBanService,
  ],
})
export class WeatherModule {}
