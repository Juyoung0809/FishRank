import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserProfileService } from './user-profile.service';
import { UserGearsService } from './user-gears.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UserProfileService, UserGearsService],
  exports: [UsersService],
})
export class UsersModule {}
