import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

// Opening hours are stored as { mon: "09:00-18:00" }. A missing weekday means
// the branch is closed; null is accepted from older clients and treated the same.
export class StoreBranchDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  address?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  city?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  country?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  postalCode?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @IsOptional()
  @IsString()
  @Length(0, 30)
  @Matches(/^[+\d\s().-]*$/u, {
    message: 'phone must contain only digits and phone punctuation',
  })
  phone?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 30)
  @Matches(/^[+\d\s().-]*$/u, {
    message: 'whatsapp must contain only digits and phone punctuation',
  })
  whatsapp?: string | null;

  @IsOptional()
  @IsObject()
  openingHours?: Record<string, string | null> | null;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  googleMapsUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
