import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuth } from '../common/decorators/auth.decorator';
import { ok } from '../common/http/api-response';
import { AdminSpeciesService } from './admin-species.service';
import { UpdateSpeciesDto } from './dto/update-species.dto';

@ApiTags('관리자')
@Controller('admin')
@AdminAuth()
export class AdminSpeciesController {
  constructor(private species: AdminSpeciesService) {}

  @Get('species')
  @ApiOperation({ summary: '어종 마스터 목록' })
  async list(
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '30',
  ) {
    return ok(
      await this.species.list(search, Number(page) || 1, Number(limit) || 30),
    );
  }

  @Patch('species/:id')
  @ApiOperation({ summary: '어종 파라미터 수정 (희귀도·법정치)' })
  async update(@Param('id') id: string, @Body() dto: UpdateSpeciesDto) {
    return ok(await this.species.update(Number(id), dto));
  }
}
