import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
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
import { PostsService } from './posts.service';
import { UpdatePostDto } from './dto/update-post.dto';
import { parseTagsInput } from './post-tags.util';

@ApiTags('커뮤니티')
@Controller('posts')
export class PostsController {
  constructor(private postsService: PostsService) {}

  @Post()
  @Auth()
  @ApiOperation({ summary: '게시글 작성' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    createImageUploadInterceptor('image', 'post'),
    ImageMagicInterceptor,
  )
  async create(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: { title: string; content: string; catchId?: string; tags?: string },
  ) {
    return ok(
      await this.postsService.create(user.id, {
        title: body.title,
        content: body.content,
        catchId: body.catchId || undefined,
        imageUrl: saveUploadedFile(file),
        tags: parseTagsInput(body.tags),
      }),
    );
  }

  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ summary: '커뮤니티 글 목록' })
  async findAll(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('sort') sort: 'latest' | 'popular' = 'latest',
    @Query('tag') tag?: string,
    @Query('q') q?: string,
  ) {
    return ok(
      await this.postsService.findAll(
        Number(page),
        Number(limit),
        sort,
        tag,
        q,
      ),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '게시글 상세' })
  async findOne(@Param('id') id: string) {
    return ok(await this.postsService.findById(id));
  }

  @Post(':id/comments')
  @Auth()
  @ApiOperation({ summary: '댓글 작성' })
  async addComment(
    @Param('id') postId: string,
    @CurrentUser() user: AuthUser,
    @Body('content') content: string,
  ) {
    return ok(await this.postsService.addComment(postId, user.id, content));
  }

  @Patch(':id')
  @Auth()
  @ApiOperation({ summary: '게시글 수정' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    createImageUploadInterceptor('image', 'post'),
    ImageMagicInterceptor,
  )
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UpdatePostDto,
  ) {
    // removeImage=true 면 지우고, 새 파일이 있으면 교체, 둘 다 없으면 유지(undefined)
    const imageUrl =
      body.removeImage === 'true'
        ? null
        : file
          ? saveUploadedFile(file)
          : undefined;
    return ok(
      await this.postsService.update(id, user.id, {
        title: body.title,
        content: body.content,
        catchId: body.catchId,
        imageUrl,
        tags: body.tags !== undefined ? parseTagsInput(body.tags) : undefined,
      }),
    );
  }

  @Delete(':id')
  @Auth()
  @HttpCode(200)
  @ApiOperation({ summary: '게시글 삭제' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.postsService.delete(id, user.id);
    return { success: true };
  }
}
