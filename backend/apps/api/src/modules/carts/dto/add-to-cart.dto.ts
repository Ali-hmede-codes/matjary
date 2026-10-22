import {
  IsString,
  IsUUID,
  IsNumber,
  Min,
  IsOptional,
  Length,
} from 'class-validator';

export class AddToCartDto {
  @IsString()
  @IsUUID('4')
  productId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @Length(0, 65535)
  notes?: string | null;
}
