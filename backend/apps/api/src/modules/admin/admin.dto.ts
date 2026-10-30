import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import { CreateStoreDto } from '../stores/dto/create-store.dto';
import { CreateProductDto } from '../products/dto/create-product.dto';
import { CreateShowcaseDto } from '../showcases/dto/create-showcase.dto';
import {
  AdminScope,
  StoreType,
  SystemErrorState,
  UserRole,
} from '@app/database';
import { CreateBoostCampaignDto } from '../boost/dto/boost-coin.dto';

export class AdminListDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-z_]+$/)
  status?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsIn(['all', 'active', 'archived'])
  archive: 'all' | 'active' | 'archived' = 'all';

  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort: 'newest' | 'oldest' = 'newest';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset = 0;
}

export class AdminReasonDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class AdminUserRoleDto extends AdminReasonDto {
  @IsEnum(UserRole)
  role!: UserRole;

  // Granting admin access can be limited to chosen shops. Omitting the scope
  // keeps the historic full-platform grant.
  @IsOptional()
  @IsEnum(AdminScope)
  scope?: AdminScope;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  storeIds?: string[];
}

// Changing only which shops an existing administrator oversees, without
// touching the role itself.
export class AdminUserScopeDto extends AdminReasonDto {
  @IsEnum(AdminScope)
  scope!: AdminScope;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  storeIds?: string[];
}

export class AdminUserUpdateDto {
  @IsString()
  @Length(1, 120)
  displayName!: string;
}

export class AdminCreateStoreDto extends CreateStoreDto {
  @IsUUID()
  ownerId!: string;
}

// Identity fields only. Prices, plans, verification, lifecycle status, and
// moderation each have their own audited operation, so an administrator editing
// a shop's public address cannot accidentally change any of them.
export class AdminUpdateStoreDto extends AdminReasonDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(0, 65535)
  description?: string | null;

  @IsOptional()
  @IsHexColor()
  brandColor?: string | null;

  @IsOptional()
  @IsEnum(StoreType)
  storeType?: StoreType;

  // Business taxonomy slug from the shared catalog (restaurant, school, ...).
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-z0-9_]+$/u)
  businessCategory?: string;
}

export class AdminCreateProductDto extends CreateProductDto {
  @IsUUID()
  storeId!: string;
}

export class AdminCreatePostDto extends CreateShowcaseDto {
  @IsUUID()
  ownerId!: string;
}

export class AdminMediaUpdateDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  altText?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  position?: number;
}

export class AdminErrorStateDto extends AdminReasonDto {
  @IsEnum(SystemErrorState)
  state!: SystemErrorState;
}

export class AdminCreateCampaignDto extends CreateBoostCampaignDto {
  @IsUUID()
  ownerId!: string;
}

export class AdminCampaignActionDto extends AdminReasonDto {
  @IsIn(['approve', 'reject', 'pause', 'resume', 'cancel'])
  action!: 'approve' | 'reject' | 'pause' | 'resume' | 'cancel';
}

export class AdminBadgeDto extends AdminReasonDto {
  @IsBoolean()
  enabled!: boolean;
}
