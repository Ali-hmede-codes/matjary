import { IsIn, IsOptional } from 'class-validator';
import { StoreStatus } from '@app/database';

export class StoreStatusDto {
  @IsIn([StoreStatus.ACTIVE, StoreStatus.OFFLINE, StoreStatus.ARCHIVED])
  status!: StoreStatus.ACTIVE | StoreStatus.OFFLINE | StoreStatus.ARCHIVED;
}

export class MyStoresQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  includeTrashed?: string;
}
