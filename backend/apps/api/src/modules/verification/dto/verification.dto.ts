import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VerificationRequestStatus } from '@app/database';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SubmitVerificationDto {
  // The legal or trading name shown to shoppers once the badge is granted.
  @Transform(trimmed)
  @IsString()
  @Length(2, 120)
  applicantName!: string;

  // Any common Lebanese form (+961, 00961, 03 123 456). The service stores the
  // normalized +961XXXXXXXX value.
  @Transform(trimmed)
  @IsString()
  @Length(7, 20)
  @Matches(/^[0-9+()\s-]+$/u)
  phone!: string;

  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdminVerificationListDto {
  @IsOptional()
  @IsEnum(VerificationRequestStatus)
  status?: VerificationRequestStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset = 0;
}

export class AdminVerificationStoresDto {
  @IsOptional()
  @IsIn(['all', 'active', 'grace', 'expired'])
  state: 'all' | 'active' | 'grace' | 'expired' = 'all';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 100;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset = 0;
}

export class VerificationReasonDto {
  @Transform(trimmed)
  @IsString()
  @Length(3, 500)
  reason!: string;
}
