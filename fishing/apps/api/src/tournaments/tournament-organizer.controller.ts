import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { ok } from '../common/http/api-response';
import { TournamentDayCodeService } from './tournament-day-code.service';
import { TournamentOrganizerService } from './tournament-organizer.service';
import { OrganizerTournamentDto } from './dto/organizer-tournament.dto';
import { OrganizerStatusDto } from './dto/organizer-status.dto';
import { ReviewDayCodeClaimDto } from './dto/review-day-code-claim.dto';
import { SetParticipantDto } from './dto/set-participant.dto';

/** 낚시점·포인트 운영자(또는 관리자)가 여는 대회 관리. 모두 로그인 필요 */
@ApiTags('대회')
@Controller('tournaments/organized')
@Auth()
export class TournamentOrganizerController {
  constructor(
    private organizer: TournamentOrganizerService,
    private dayCodes: TournamentDayCodeService,
  ) {}

  @Get()
  @ApiOperation({ summary: '내가 운영하는 대회' })
  async list(@CurrentUser() user: AuthUser) {
    return ok(await this.organizer.list(user.id));
  }

  @Post()
  @ApiOperation({ summary: '낚시점·포인트 운영자가 무료 대회 생성' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: OrganizerTournamentDto,
  ) {
    return ok(await this.organizer.create(user.id, body));
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '운영 대회 상태 변경. 참가 개방은 active' })
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: OrganizerStatusDto,
  ) {
    return ok(await this.organizer.updateStatus(user.id, id, body.status));
  }

  @Get(':id/day-code-claims')
  @ApiOperation({ summary: '이 대회에 제출된 일일 코드' })
  async listDayCodeClaims(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.organizer.listDayCodeClaims(user.id, id));
  }

  @Patch(':id/day-code-claims/:catchId')
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

  @Patch(':id')
  @ApiOperation({ summary: '운영 대회 수정. 참가비는 항상 무료' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: OrganizerTournamentDto,
  ) {
    return ok(await this.organizer.update(user.id, id, body));
  }

  @Get(':id/participants')
  @ApiOperation({ summary: '대회 참가자. 실격은 삭제하지 않음' })
  async listParticipants(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return ok(await this.organizer.listParticipants(user.id, id));
  }

  @Patch(':id/participants/:userId')
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

  @Get(':id/day-code')
  @ApiOperation({ summary: '운영 중인 대회의 오늘 코드 확인' })
  async getDayCode(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return ok(await this.dayCodes.getManaged(user.id, id));
  }

  @Get(':id/export')
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
}
