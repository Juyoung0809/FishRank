import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok } from '../common/http/api-response';
import { AnnouncementsService } from './announcements.service';

@ApiTags('공지')
@Controller('announcements')
export class AnnouncementsController {
  constructor(private announcements: AnnouncementsService) {}

  @Get()
  @ApiOperation({ summary: '공개 공지·이벤트 목록' })
  async list(@Query('limit') limit = '10') {
    return ok(await this.announcements.listPublic(Number(limit) || 10));
  }
}
