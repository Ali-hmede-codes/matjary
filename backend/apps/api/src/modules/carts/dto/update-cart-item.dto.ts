import { IsNumber, Min, IsOptional, IsString, Length } from 'class-validator';

export class UpdateCartItemDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  @Length(0, 65535)
  notes?: string | null;
}
