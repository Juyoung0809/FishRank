import { Injectable } from '@nestjs/common';
import { RankingsService } from '../rankings/rankings.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { PostsService } from '../posts/posts.service';
import { AnnouncementsService } from '../announcements/announcements.service';

@Injectable()
export class HomeService {
  constructor(
    private readonly rankings: RankingsService,
    private readonly tournaments: TournamentsService,
    private readonly posts: PostsService,
    private readonly announcements: AnnouncementsService,
  ) {}

  async getHomePayload() {
    const [
      rankings,
      speciesSpotlight,
      tournaments,
      postsResult,
      announcements,
    ] = await Promise.all([
      this.rankings.getWeeklyRankings(undefined, 8, 'official'),
      this.rankings.getWeeklySpeciesSpotlight(),
      this.tournaments.findAll('active'),
      this.posts.findAll(1, 5),
      this.announcements.listPublic(3),
    ]);

    return {
      rankings,
      speciesSpotlight,
      tournaments,
      posts: postsResult.items,
      announcements,
    };
  }
}
