import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export type RenewalKindFilter = 'all' | 'subscription' | 'verification';

// The owner's notification tab is a short list by construction; the cap keeps
// a pathological account from turning one read into an unbounded response.
export class OwnerNotificationListDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset = 0;
}

export class AdminRenewalQueryDto {
  // The Notifications tab asks for both queues; the Subscriptions and
  // Verification sections ask for their own kind only.
  @IsOptional()
  @IsIn(['all', 'subscription', 'verification'])
  kind: RenewalKindFilter = 'all';
}

// Renewals are audited like every other administrative write, so a short reason
// is required by the shared audit contract.
export class RenewalReasonDto {
  @Transform(trimmed)
  @IsString()
  @Length(3, 500)
  reason!: string;
}
