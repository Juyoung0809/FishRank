import { Module } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { TournamentDayCodeService } from './tournament-day-code.service';
import { TournamentOrganizerService } from './tournament-organizer.service';
import { TournamentsController } from './tournaments.controller';
import { TournamentOrganizerController } from './tournament-organizer.controller';

@Module({
  // 'tournaments/organized' 경로가 'tournaments/:id' 보다 먼저 등록되도록 운영자 컨트롤러를 앞에 둔다
  controllers: [TournamentOrganizerController, TournamentsController],
  providers: [
    TournamentsService,
    TournamentDayCodeService,
    TournamentOrganizerService,
  ],
  exports: [TournamentsService, TournamentDayCodeService],
})
export class TournamentsModule {}
