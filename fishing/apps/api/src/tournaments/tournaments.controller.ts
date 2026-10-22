import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  createImageUploadInterceptor,
  saveUploadedFile,
} from '../common/upload/upload.config';
import { ImageMagicInterceptor } from '../common/upload/image-magic.interceptor';
import { TournamentsService } from './tournaments.service';
import { TournamentDayCodeService } from './tournament-day-code.service';
import { SetDayCodeDto } from './dto/set-day-code.dto';

/** 관리자 대회 등록·수정 multipart 폼 → Prisma 입력 */
function parseTournamentBody(body: Record<string, any>) {
  return {
    title: body.title,
    description: body.description,
    category: body.category,
    isFree: body.isFree === 'true' || body.isFree === true,
    entryFee: Number(body.entryFee ?? 0),
    prize: body.prize || null,
    prizeAmount: body.prizeAmount ? Number(body.prizeAmount) : null,
    maxEntries: body.maxEntries ? Number(body.maxEntries) : null,
    startAt: new Date(body.startAt),
    endAt: new Date(body.endAt),
    rules: body.rules || null,
    status: body.status || 'upcoming',
  };
}

/** 대회 조회·참가와 관리자 대회 관리. 운영자용은 TournamentOrganizerController */
@ApiTags('대회')
@Controller('tournaments')
export class TournamentsController {
  constructor(
    private tournaments: TournamentsService,
    private dayCodes: TournamentDayCodeService,
  ) {}

  @Get()
  @ApiOperation({ summary: '대회 목록' })
  async findAll(
    @Query('status') status?: string,
    @Query('category') category?: string,
  ) {
    return ok(await this.tournaments.findAll(status, category));
  }

  @Get('me/active')
  @Auth()
  @ApiOperation({
    summary: '내가 참가 중인 진행 대회. 오늘 코드 값은 포함하지 않음',
  })
  async listMyActive(@CurrentUser() user: AuthUser) {
    return ok(await this.dayCodes.listMyActive(user.id));
  }

  @Get(':id')
  @ApiOperation({ summary: '대회 상세' })
  async findOne(@Param('id') id: string) {
    return ok(await this.tournaments.findById(id));
  }

  @Get(':id/ranking')
  @ApiOperation({ summary: '대회 참가자 랭킹' })
  async getRanking(@Param('id') id: string) {
    return ok(await this.tournaments.getRanking(id));
  }

  @Post(':id/join')
  @Auth()
  @ApiOperation({ summary: '대회 참가 신청' })
  async join(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return ok(await this.tournaments.join(id, user.id));
  }

  @Get(':id/my-entry')
  @Auth()
  @ApiOperation({ summary: '내 참가 여부 확인' })
  async getMyEntry(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return ok(await this.tournaments.getMyEntry(id, user.id));
  }

  @Get(':id/day-code')
  @ApiOperation({
    summary: '오늘(서울) 대회 코드 등록 여부. 코드 값은 반환하지 않음',
  })
  async getDayCode(@Param('id') id: string) {
    return ok(await this.dayCodes.getToday(id));
  }

  @Post(':id/day-code')
  @Auth()
  @ApiOperation({ summary: '[어드민·운영자] 오늘(서울) 대회 코드 등록' })
  async setDayCode(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: SetDayCodeDto,
  ) {
    return ok(await this.dayCodes.setToday(user.id, id, body.code));
  }

  // ── 관리자 (권한은 서비스에서 확인) ──────────────────────

  @Post()
  @Auth()
  @ApiOperation({ summary: '[어드민] 대회 생성' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    createImageUploadInterceptor('banner', 'tournament'),
    ImageMagicInterceptor,
  )
  async create(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, any>,
  ) {
    return ok(
      await this.tournaments.create(user.id, {
        ...parseTournamentBody(body),
        bannerUrl: saveUploadedFile(file),
      }),
    );
  }

  @Patch(':id/status')
  @Auth()
  @ApiOperation({ summary: '[어드민] 대회 상태 변경' })
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body('status') status: string,
  ) {
    return ok(await this.tournaments.updateStatus(user.id, id, status));
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({ summary: '[어드민] 대회 수정' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    createImageUploadInterceptor('banner', 'tournament'),
    ImageMagicInterceptor,
  )
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, any>,
  ) {
    const bannerUrl = saveUploadedFile(file);
    return ok(
      await this.tournaments.update(user.id, id, {
        ...parseTournamentBody(body),
        ...(bannerUrl ? { bannerUrl } : {}),
      }),
    );
  }

  @Delete(':id')
  @Auth()
  @ApiOperation({ summary: '[어드민] 대회 삭제' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return ok(await this.tournaments.delete(user.id, id));
  }
}
