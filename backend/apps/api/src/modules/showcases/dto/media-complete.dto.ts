import { IsString, IsUUID, IsOptional } from 'class-validator';

export class MediaCompleteDto {
  @IsUUID('4')
  mediaId!: string;

  @IsOptional()
  @IsUUID('4')
  storeId?: string;
}
