import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, IsDateString } from 'class-validator';

export class UpsertAnnouncementDto {
  @IsIn(['notice', 'event'])
  type: 'notice' | 'event';

  @IsString()
  @MaxLength(120)
  title: string;

  @IsString()
  @MaxLength(5000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkUrl?: string;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
