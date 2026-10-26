import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Length,
} from 'class-validator';

// Mirrors the JSON shape stored on Product.options. The service still trims
// and de-duplicates so hand-made requests follow the same limits.
export class ProductOptionGroupDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  values!: string[];
}
