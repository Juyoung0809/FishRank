import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { TournamentOrganizerService } from './tournament-organizer.service';
import { SetDayCodeDto } from './dto/set-day-code.dto';
import { OrganizerTournamentDto } from './dto/organizer-tournament.dto';
import { OrganizerStatusDto } from './dto/organizer-status.dto';
import { ReviewDayCodeClaimDto } from './dto/review-day-code-claim.dto';
import { SetParticipantDto } from './dto/set-participant.dto';

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

@ApiTags('대회')
@Controller('tournaments')
export class TournamentsController {
  constructor(
    private tournaments: TournamentsService,
    private dayCodes: TournamentDayCodeService,
    private organizer: TournamentOrganizerService,
  ) {}

  @Get()
  @ApiOperation({ summary: '대회 목록' })
  async findAll(
    @Query('status') status?: string,
    @Query('category') category?: string,
  ) {
    return ok(await this.tournaments.findAll(status, category));
  }

  // ── 운영자 ──────────────────────────────────────────────

  @Get('organized')
  @Auth()
  @ApiOperation({ summary: '내가 운영하는 대회' })
  async listOrganized(@CurrentUser() user: AuthUser) {
    return ok(await this.organizer.list(user.id));
  }

  @Post('organized')
  @Auth()
  @ApiOperation({ summary: '낚시점·포인트 운영자가 무료 대회 생성' })
  async createOrganized(
    @CurrentUser() user: AuthUser,
    @Body() body: OrganizerTournamentDto,
  ) {
    return ok(await this.organizer.create(user.id, body));
  }

  @Patch('organized/:id/status')
  @Auth()
  @ApiOperation({ summary: '운영 대회 상태 변경. 참가 개방은 active' })
  async updateOrganizedStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: OrganizerStatusDto,
  ) {
    return ok(await this.organizer.updateStatus(user.id, id, body.status));
  }

  @Get('organized/:id/day-code-claims')
  @Auth()
  @ApiOperation({ summary: '이 대회에 제출된 일일 코드' })
  async listDayCodeClaims(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.organizer.listDayCodeClaims(user.id, id));
  }

  @Patch('organized/:id/day-code-claims/:catchId')
  @Auth()
  @ApiOperation({ summary: '제출된 일일 코드를 수락하거나 거절' })
  async reviewDayCodeClaim(
    @Param('id') id: string,
    @Param('catchId') catchId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: ReviewDayCodeClaimDto,
  ) {
    return ok(
      await this.organizer.reviewDayCodeClaim(
        user.id,
        id,
        catchId,
        body.status,
      ),
    );
  }

  @Patch('organized/:id')
  @Auth()
  @ApiOperation({ summary: '운영 대회 수정. 참가비는 항상 무료' })
  async updateOrganized(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: OrganizerTournamentDto,
  ) {
    return ok(await this.organizer.update(user.id, id, body));
  }

  @Get('organized/:id/participants')
  @Auth()
  @ApiOperation({ summary: '대회 참가자. 실격은 삭제하지 않음' })
  async listParticipants(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.organizer.listParticipants(user.id, id));
  }

  @Patch('organized/:id/participants/:userId')
  @Auth()
  @ApiOperation({ summary: '참가자 실격 또는 복귀' })
  async setParticipant(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: SetParticipantDto,
  ) {
    return ok(
      await this.organizer.setDisqualified(
        user.id,
        id,
        userId,
        body.disqualified,
        body.note,
      ),
    );
  }

  @Get('organized/:id/day-code')
  @Auth()
  @ApiOperation({ summary: '운영 중인 대회의 오늘 코드 확인' })
  async getManagedDayCode(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.dayCodes.getManaged(user.id, id));
  }

  @Get('organized/:id/export')
  @Auth()
  @ApiOperation({ summary: '실시간 순위 CSV' })
  async exportLeaderboard(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.organizer.exportLeaderboard(user.id, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tournament-${id}.csv"`,
    );
    return `\uFEFF${csv}`;
  }

  // ── 참가자 ──────────────────────────────────────────────

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
