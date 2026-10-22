import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';
import { LocationService } from './services/location.service';
import { Store, Product, Showcase, SubscriptionPlan } from '@app/database';
import { AuthModule } from '../auth/auth.module';
import { SeoModule } from '../seo/seo.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Store, Product, Showcase, SubscriptionPlan]),
    AuthModule,
    SeoModule,
  ],
  controllers: [StoresController],
  providers: [StoresService, LocationService],
  exports: [StoresService, LocationService],
})
export class StoresModule {}
