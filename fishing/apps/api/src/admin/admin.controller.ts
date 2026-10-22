import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminAuth } from '../common/decorators/auth.decorator';
import { ok } from '../common/http/api-response';
import { AdminService } from './admin.service';
import {
  AdminReportsService,
  type ReportTargetType,
} from './admin-reports.service';
import { ResolveReportDto } from './dto/resolve-report.dto';

@ApiTags('관리자')
@Controller('admin')
@AdminAuth()
export class AdminController {
  constructor(
    private admin: AdminService,
    private reports: AdminReportsService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: '관리자 대시보드 통계' })
  async getStats() {
    return ok(await this.admin.getStats());
  }

  @Get('reports/flagged')
  @ApiOperation({
    summary: '열린 신고 콘텐츠 (기본 1건부터, 신고 수 내림차순)',
  })
  @ApiQuery({ name: 'minCount', required: false })
  async listFlaggedReports(@Query('minCount') minCount = '1') {
    return ok(await this.reports.listFlagged(Number(minCount) || 1));
  }

  @Patch('reports/:targetType/:targetId')
  @ApiOperation({
    summary: '신고 처리 — 무시(dismiss) 또는 콘텐츠 삭제(delete)',
  })
  async resolveFlaggedReport(
    @Param('targetType') targetType: ReportTargetType,
    @Param('targetId') targetId: string,
    @Body() body: ResolveReportDto,
  ) {
    return ok(
      await this.reports.resolve(
        targetType,
        targetId,
        body.action,
        body.adminNote,
      ),
    );
  }
}
