import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SelectedProductOptionDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsString()
  @Length(1, 80)
  value!: string;
}

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

  // Required exactly when the product declares options. The service checks
  // every group and rejects values that the product no longer offers.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SelectedProductOptionDto)
  selectedOptions?: SelectedProductOptionDto[] | null;
}
