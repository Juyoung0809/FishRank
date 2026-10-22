import { Module } from '@nestjs/common';
import { RankingsService } from './rankings.service';
import { RegionalRankingsService } from './regional-rankings.service';
import { RankingOvertakesService } from './ranking-overtakes.service';
import { RankingsController } from './rankings.controller';

@Module({
  controllers: [RankingsController],
  providers: [
    RankingsService,
    RegionalRankingsService,
    RankingOvertakesService,
  ],
  exports: [RankingsService],
})
export class RankingsModule {}
