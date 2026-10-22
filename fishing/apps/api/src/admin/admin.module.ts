import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { AdminController } from './admin.controller';
import { AdminCatchesController } from './admin-catches.controller';
import { AdminCommunityController } from './admin-community.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminSpeciesController } from './admin-species.controller';
import { AdminService } from './admin.service';
import { AdminReportsService } from './admin-reports.service';
import { AdminCatchesService } from './admin-catches.service';
import { AdminCommunityService } from './admin-community.service';
import { AdminUsersService } from './admin-users.service';
import { AdminSpeciesService } from './admin-species.service';

@Module({
  imports: [PrismaModule, AnnouncementsModule],
  controllers: [
    AdminController,
    AdminCatchesController,
    AdminCommunityController,
    AdminUsersController,
    AdminSpeciesController,
  ],
  providers: [
    AdminService,
    AdminReportsService,
    AdminCatchesService,
    AdminCommunityService,
    AdminUsersService,
    AdminSpeciesService,
  ],
})
export class AdminModule {}
