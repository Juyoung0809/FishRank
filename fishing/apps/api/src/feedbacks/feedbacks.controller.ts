import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { ok } from '../common/http/api-response';
import { FeedbacksService } from './feedbacks.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@ApiTags('피드백')
@Controller('feedbacks')
export class FeedbacksController {
  constructor(private feedbacks: FeedbacksService) {}

  @Post()
  @Auth()
  @ApiOperation({ summary: '서비스 피드백 제출' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateFeedbackDto) {
    return ok(await this.feedbacks.create(user.id, dto));
  }
}
