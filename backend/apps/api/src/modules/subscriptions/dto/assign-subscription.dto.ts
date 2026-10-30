import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class AssignSubscriptionDto {
  @IsUUID() userId!: string;
  @IsUUID() planId!: string;
  // The administrator must record how to reach the person receiving the plan.
  // Any country works: a full international number is accepted as typed.
  @IsString() @MaxLength(30) phone!: string;
  @IsOptional() @Matches(/^\+\d{1,3}$/u) phoneCountryCode?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
