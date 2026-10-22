import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminAuth } from '../common/decorators/auth.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { ok } from '../common/http/api-response';
import { AnnouncementsService } from '../announcements/announcements.service';
import { UpsertAnnouncementDto } from '../announcements/dto/upsert-announcement.dto';
import { AdminCommunityService } from './admin-community.service';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';

@ApiTags('관리자')
@Controller('admin')
@AdminAuth()
export class AdminCommunityController {
  constructor(
    private community: AdminCommunityService,
    private announcements: AnnouncementsService,
  ) {}

  @Get('posts')
  @ApiOperation({ summary: '게시글 관리 목록' })
  async listPosts(@Query('page') page = '1', @Query('limit') limit = '20') {
    return ok(
      await this.community.listPosts(Number(page) || 1, Number(limit) || 20),
    );
  }

  @Delete('posts/:id')
  @ApiOperation({ summary: '게시글 삭제 (관리자)' })
  async deletePost(@Param('id') id: string) {
    return ok(await this.community.deletePost(id));
  }

  @Get('comments')
  @ApiOperation({ summary: '댓글 목록' })
  async listComments(
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '30',
  ) {
    return ok(
      await this.community.listComments(
        Number(page) || 1,
        Number(limit) || 30,
        search,
      ),
    );
  }

  @Delete('comments/:id')
  @ApiOperation({ summary: '댓글 삭제' })
  async deleteComment(@Param('id') id: string) {
    return ok(await this.community.deleteComment(id));
  }

  @Get('feedbacks')
  @ApiOperation({ summary: '사용자 피드백 목록' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listFeedbacks(
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return ok(
      await this.community.listFeedbacks(
        status,
        Number(page) || 1,
        Number(limit) || 20,
      ),
    );
  }

  @Patch('feedbacks/:id')
  @ApiOperation({ summary: '피드백 상태 변경' })
  async updateFeedback(
    @Param('id') id: string,
    @Body() dto: UpdateFeedbackDto,
  ) {
    return ok(await this.community.updateFeedback(id, dto));
  }

  @Get('announcements')
  @ApiOperation({ summary: '공지·이벤트 목록 (관리자)' })
  async listAnnouncements() {
    return ok(await this.announcements.listAll());
  }

  @Post('announcements')
  @ApiOperation({ summary: '공지·이벤트 등록' })
  async createAnnouncement(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertAnnouncementDto,
  ) {
    return ok(await this.announcements.create(user.id, dto));
  }

  @Patch('announcements/:id')
  @ApiOperation({ summary: '공지·이벤트 수정' })
  async updateAnnouncement(
    @Param('id') id: string,
    @Body() dto: UpsertAnnouncementDto,
  ) {
    return ok(await this.announcements.update(id, dto));
  }

  @Delete('announcements/:id')
  @ApiOperation({ summary: '공지·이벤트 삭제' })
  async deleteAnnouncement(@Param('id') id: string) {
    return ok(await this.announcements.delete(id));
  }
}
