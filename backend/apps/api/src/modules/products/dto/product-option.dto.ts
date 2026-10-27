import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProductOptionValueDto {
  @IsString()
  @Length(1, 80)
  label!: string;

  // Optional price for this value alone, replacing the product's base price.
  // At most one option group may carry prices.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  priceCents?: number | null;
}

// Mirrors the JSON shape stored on Product.options. The service still trims
// and de-duplicates so hand-made requests follow the same limits.
export class ProductOptionGroupDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionValueDto)
  values!: ProductOptionValueDto[];
}
