import { Module } from '@nestjs/common';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { RankingsModule } from '../rankings/rankings.module';
import { TournamentsModule } from '../tournaments/tournaments.module';
import { PostsModule } from '../posts/posts.module';
import { AnnouncementsModule } from '../announcements/announcements.module';

@Module({
  imports: [
    RankingsModule,
    TournamentsModule,
    PostsModule,
    AnnouncementsModule,
  ],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
