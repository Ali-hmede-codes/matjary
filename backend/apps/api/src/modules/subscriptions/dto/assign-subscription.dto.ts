import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class AssignSubscriptionDto {
  @IsUUID() userId!: string;
  @IsUUID() planId!: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
