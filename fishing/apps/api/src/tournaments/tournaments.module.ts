import { Module } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { TournamentDayCodeService } from './tournament-day-code.service';
import { TournamentOrganizerService } from './tournament-organizer.service';
import { TournamentsController } from './tournaments.controller';

@Module({
  controllers: [TournamentsController],
  providers: [
    TournamentsService,
    TournamentDayCodeService,
    TournamentOrganizerService,
  ],
  exports: [TournamentsService, TournamentDayCodeService],
})
export class TournamentsModule {}
