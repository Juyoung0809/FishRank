import { Module } from '@nestjs/common';
import { CatchesService } from './catches.service';
import { CatchesController } from './catches.controller';
import { CaptureSessionService } from './capture-session.service';
import { CatchVotesService } from './catch-votes.service';
import { CatchRecordsService } from './catch-records.service';
import { AiModule } from '../ai/ai.module';
import { TournamentsModule } from '../tournaments/tournaments.module';

@Module({
  imports: [AiModule, TournamentsModule],
  controllers: [CatchesController],
  providers: [
    CatchesService,
    CatchRecordsService,
    CatchVotesService,
    CaptureSessionService,
  ],
})
export class CatchesModule {}
