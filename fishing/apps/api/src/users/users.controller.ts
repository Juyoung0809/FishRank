import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { ok } from '../common/http/api-response';
import {
  createImageUploadInterceptor,
  saveUploadedFile,
} from '../common/upload/upload.config';
import { ImageMagicInterceptor } from '../common/upload/image-magic.interceptor';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateFeaturedCatchesDto } from './dto/update-featured-catches.dto';
import { UpsertUserGearDto } from './dto/upsert-user-gear.dto';

@ApiTags('사용자')
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @Auth()
  @ApiOperation({ summary: '내 프로필 조회' })
  async getMe(@CurrentUser() user: AuthUser) {
    // JwtStrategy 가 매 요청마다 DB 에서 읽은 사용자 행이라 다시 조회하지 않는다
    const [stats, posts, featuredCatches, gears] = await Promise.all([
      this.usersService.getMyStats(user.id),
      this.usersService.getMyPosts(user.id),
      this.usersService.getFeaturedCatches(user.id, user.featuredCatchIds),
      this.usersService.getUserGears(user.id),
    ]);

    return ok({
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      role: user.role,
      profileImage: user.profileImage,
      bio: user.bio,
      activityRegion: user.activityRegion,
      fishingCategory: user.fishingCategory,
      featuredCatchIds: user.featuredCatchIds,
      featuredCatches,
      gears,
      stats,
      posts,
    });
  }

  @Patch('me')
  @Auth()
  @ApiOperation({ summary: '내 프로필 수정' })
  async updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return ok(await this.usersService.updateProfile(user.id, dto));
  }

  @Patch('me/profile-image')
  @Auth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '프로필 사진 변경' })
  @UseInterceptors(
    createImageUploadInterceptor('image', 'profile'),
    ImageMagicInterceptor,
  )
  async updateProfileImage(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const profileImage = saveUploadedFile(file);
    if (!profileImage)
      throw new BadRequestException('이미지 파일이 필요합니다.');
    return ok(
      await this.usersService.updateProfileImage(user.id, profileImage),
    );
  }

  @Delete('me/profile-image')
  @Auth()
  @ApiOperation({ summary: '프로필 사진 삭제' })
  async deleteProfileImage(@CurrentUser() user: AuthUser) {
    return ok(await this.usersService.updateProfileImage(user.id, null));
  }

  @Patch('me/featured-catches')
  @Auth()
  @ApiOperation({ summary: '대표 낚시 기록 설정 (최대 3개)' })
  async updateFeaturedCatches(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateFeaturedCatchesDto,
  ) {
    const featuredCatches = await this.usersService.updateFeaturedCatches(
      user.id,
      dto.catchIds,
    );
    return ok({ featuredCatchIds: dto.catchIds, featuredCatches });
  }

  @Post('me/gears')
  @Auth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '내 장비 등록 (최대 6개)' })
  @UseInterceptors(
    createImageUploadInterceptor('image', 'gear'),
    ImageMagicInterceptor,
  )
  async createGear(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UpsertUserGearDto,
  ) {
    return ok(
      await this.usersService.createUserGear(
        user.id,
        dto,
        saveUploadedFile(file),
      ),
    );
  }

  @Patch('me/gears/:gearId')
  @Auth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '내 장비 수정' })
  @UseInterceptors(
    createImageUploadInterceptor('image', 'gear'),
    ImageMagicInterceptor,
  )
  async updateGear(
    @CurrentUser() user: AuthUser,
    @Param('gearId') gearId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UpsertUserGearDto,
  ) {
    const imageUrl = file ? saveUploadedFile(file) : undefined;
    return ok(
      await this.usersService.updateUserGear(user.id, gearId, dto, imageUrl),
    );
  }

  @Delete('me/gears/:gearId')
  @Auth()
  @ApiOperation({ summary: '내 장비 삭제' })
  async deleteGear(
    @CurrentUser() user: AuthUser,
    @Param('gearId') gearId: string,
  ) {
    await this.usersService.deleteUserGear(user.id, gearId);
    return { success: true };
  }

  @Get('profile/:nickname')
  @ApiOperation({ summary: '유저 공개 프로필 조회' })
  async getProfile(@Param('nickname') nickname: string) {
    return ok(await this.usersService.getPublicProfile(nickname));
  }
}
