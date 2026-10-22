import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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
import {
  isEncyclopediaSort,
  isEncyclopediaTechnique,
} from './encyclopedia-filter.util';
import { EncyclopediaService } from './encyclopedia.service';
import { EncyclopediaContributionService } from './encyclopedia-contribution.service';
import { CreateEncyclopediaTipDto } from './dto/create-encyclopedia-tip.dto';
import { CreateFishSpeciesDto } from './dto/create-fish-species.dto';

@ApiTags('어종 사전')
@Controller('encyclopedia')
export class EncyclopediaController {
  constructor(
    private encyclopedia: EncyclopediaService,
    private contributions: EncyclopediaContributionService,
  ) {}

  @Get()
  @ApiOperation({ summary: '어종 사전 목록 (사진·실전 정보)' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'sort', required: false, enum: ['name', 'popular'] })
  @ApiQuery({
    name: 'technique',
    required: false,
    enum: ['all', 'lure', 'float', 'bottom', 'fly', 'ice', 'boat'],
  })
  async getAll(
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '48',
    @Query('sort') sort?: string,
    @Query('technique') technique?: string,
  ) {
    return ok(
      await this.encyclopedia.list(
        category,
        search,
        Number(page) || 1,
        Number(limit) || 48,
        isEncyclopediaSort(sort) ? sort : 'name',
        isEncyclopediaTechnique(technique) ? technique : 'all',
      ),
    );
  }

  @Get('stats')
  @ApiOperation({ summary: '어종 사전 통계' })
  async getStats() {
    return ok(await this.encyclopedia.getStats());
  }

  @Post()
  @Auth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '어종 새로 등록 (로그인 필요)' })
  @UseInterceptors(
    createImageUploadInterceptor('image', 'encyclopedia'),
    ImageMagicInterceptor,
  )
  async createSpecies(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateFishSpeciesDto,
  ) {
    return ok(
      await this.contributions.createSpecies(
        user.id,
        dto,
        saveUploadedFile(file),
      ),
    );
  }

  @Get(':speciesId/detail')
  @ApiOperation({ summary: '어종 상세 (실전 정보·기사·기여)' })
  async getDetail(@Param('speciesId') speciesId: string) {
    return ok(await this.encyclopedia.getDetail(Number(speciesId)));
  }

  @Get(':speciesId/edit-logs')
  @ApiOperation({ summary: '어종 정보 수정 기록' })
  async getEditLogs(@Param('speciesId') speciesId: string) {
    return ok(await this.encyclopedia.getEditLogs(Number(speciesId)));
  }

  @Get(':speciesId/tips')
  @ApiOperation({ summary: '정보 기여 목록' })
  async getTips(@Param('speciesId') speciesId: string) {
    return ok(await this.encyclopedia.getTips(Number(speciesId)));
  }

  @Post(':speciesId/tips')
  @Auth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '어종 정보 수정 (사진·텍스트, 수정 로그 기록)' })
  @UseInterceptors(
    createImageUploadInterceptor('image', 'encyclopedia'),
    ImageMagicInterceptor,
  )
  async createTip(
    @Param('speciesId') speciesId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateEncyclopediaTipDto,
  ) {
    return ok(
      await this.contributions.createTip(
        Number(speciesId),
        user.id,
        dto,
        saveUploadedFile(file),
      ),
    );
  }

  @Delete(':speciesId/tips/:tipId')
  @Auth()
  @ApiOperation({ summary: '정보 기여 삭제 (본인만)' })
  async deleteTip(
    @Param('speciesId') speciesId: string,
    @Param('tipId') tipId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.contributions.deleteTip(Number(speciesId), tipId, user.id);
    return { success: true };
  }

  @Get(':speciesId/news')
  @ApiOperation({ summary: '관련 뉴스 기사' })
  async getNews(@Param('speciesId') speciesId: string) {
    return ok(await this.encyclopedia.getNews(Number(speciesId)));
  }

  @Get(':speciesId')
  @ApiOperation({ summary: '어종 기본 정보 (레거시)' })
  async getOne(@Param('speciesId') speciesId: string) {
    return ok(await this.encyclopedia.getDetail(Number(speciesId)));
  }
}
