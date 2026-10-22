import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminAuth } from '../common/decorators/auth.decorator';
import { ok } from '../common/http/api-response';
import { AdminUsersService } from './admin-users.service';
import { UpdateUserDto } from './dto/update-user.dto';

@ApiTags('관리자')
@Controller('admin')
@AdminAuth()
export class AdminUsersController {
  constructor(private users: AdminUsersService) {}

  @Get('users')
  @ApiOperation({ summary: '회원 목록' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'role', required: false })
  @ApiQuery({
    name: 'accountStatus',
    required: false,
    enum: ['active', 'suspended', 'all'],
  })
  async list(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('accountStatus') accountStatus = 'active',
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return ok(
      await this.users.list(
        search,
        role,
        accountStatus,
        Number(page) || 1,
        Number(limit) || 20,
      ),
    );
  }

  @Get('users/:id')
  @ApiOperation({ summary: '회원 상세' })
  async getOne(@Param('id') id: string) {
    return ok(await this.users.getDetail(id));
  }

  @Patch('users/:id')
  @ApiOperation({ summary: '회원 역할·계정 상태 변경' })
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return ok(await this.users.update(id, dto));
  }

  @Get('tournament-entries')
  @ApiOperation({ summary: '대회 참가 목록' })
  @ApiQuery({ name: 'tournamentId', required: false })
  async listTournamentEntries(
    @Query('tournamentId') tournamentId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '30',
  ) {
    return ok(
      await this.users.listTournamentEntries(
        tournamentId,
        Number(page) || 1,
        Number(limit) || 30,
      ),
    );
  }
}
