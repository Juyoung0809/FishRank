import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { ok } from '../common/http/api-response';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';

@ApiTags('신고')
@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Post()
  @Auth()
  @ApiOperation({ summary: '콘텐츠 신고' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return ok(await this.reports.create(user.id, dto));
  }
}
