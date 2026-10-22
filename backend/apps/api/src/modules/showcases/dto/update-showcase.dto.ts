import {
  IsString,
  Length,
  IsEnum,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { ShowcaseStatus } from '@app/database';

export class UpdateShowcaseDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 65535)
  description?: string | null;

  @IsOptional()
  @IsEnum(ShowcaseStatus)
  status?: ShowcaseStatus;

  @IsOptional()
  @IsDateString()
  publishedAt?: string | null;
}
