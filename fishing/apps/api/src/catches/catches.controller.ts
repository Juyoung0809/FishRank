import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { ok } from '../common/http/api-response';
import { createImageUploadInterceptor } from '../common/upload/upload.config';
import { ImageMagicInterceptor } from '../common/upload/image-magic.interceptor';
import { CatchesService } from './catches.service';
import { CatchVotesService } from './catch-votes.service';
import { CaptureSessionService } from './capture-session.service';
import { UpdatePersonalCatchDto } from './dto/update-personal-catch.dto';

@ApiTags('낚시 기록')
@Controller('catches')
export class CatchesController {
  constructor(
    private catchesService: CatchesService,
    private votes: CatchVotesService,
    private captureSessions: CaptureSessionService,
  ) {}

  @Post('capture-sessions')
  @Auth()
  @HttpCode(201)
  @ApiOperation({ summary: '공식 인증 촬영용 일회성 토큰 발급 (10분)' })
  async issueCaptureSession(@CurrentUser() user: AuthUser) {
    return ok(await this.captureSessions.issue(user.id));
  }

  @Post()
  @Auth()
  @ApiOperation({ summary: '인증 기록 업로드 (줄자 AI 측정)' })
  @ApiConsumes('multipart/form-data')
  @HttpCode(202)
  @UseInterceptors(
    createImageUploadInterceptor('image', 'catch'),
    ImageMagicInterceptor,
  )
  async createCertified(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Headers('x-capture-token') captureHeader?: string,
  ) {
    await this.captureSessions.consume(
      user.id,
      body?.captureToken || captureHeader,
    );
    return ok(await this.catchesService.createCertified(user.id, file, body));
  }

  @Post('personal')
  @Auth()
  @ApiOperation({ summary: '비공식 자랑 기록 업로드' })
  @ApiConsumes('multipart/form-data')
  @HttpCode(201)
  @UseInterceptors(
    createImageUploadInterceptor('image', 'personal'),
    ImageMagicInterceptor,
  )
  async createPersonal(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    return ok(await this.catchesService.createPersonal(user.id, file, body));
  }

  @Get('me')
  @Auth()
  @ApiOperation({ summary: '내 기록 목록' })
  async getMyList(
    @CurrentUser() user: AuthUser,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('recordType') recordType?: string,
  ) {
    return ok(
      await this.catchesService.findMyList(
        user.id,
        Number(page),
        Number(limit),
        recordType,
      ),
    );
  }

  @Patch(':id/personal')
  @Auth()
  @ApiOperation({ summary: '자랑 기록 수정' })
  async updatePersonal(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdatePersonalCatchDto,
  ) {
    return ok(await this.catchesService.updatePersonal(user.id, id, body));
  }

  @Delete(':id/personal')
  @Auth()
  @ApiOperation({ summary: '자랑 기록 삭제' })
  async deletePersonal(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.catchesService.deletePersonal(user.id, id);
    return ok({ deleted: true });
  }

  @Post(':id/vote')
  @Auth()
  @ApiOperation({ summary: '자랑 기록 추천 토글' })
  async toggleVote(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return ok(await this.votes.toggle(id, user.id));
  }

  @Post(':id/like')
  @Auth()
  @ApiOperation({ summary: '자랑 기록 좋아요 (추가만)' })
  async addVote(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return ok(await this.votes.add(id, user.id));
  }

  @Get(':id/votes')
  @ApiOperation({ summary: '추천 수 조회' })
  async getVotes(@Param('id') id: string) {
    return ok(await this.votes.summary(id));
  }

  @Get(':id/status')
  @Auth()
  @ApiOperation({ summary: 'AI 처리 상태 확인' })
  async getStatus(@Param('id') id: string) {
    return ok(await this.catchesService.findStatus(id));
  }

  @Get(':id')
  @ApiOperation({ summary: '낚시 기록 단건 조회' })
  async findOne(@Param('id') id: string) {
    return ok(await this.catchesService.findById(id));
  }
}
