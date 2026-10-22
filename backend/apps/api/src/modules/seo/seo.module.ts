import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeoService } from './seo.service';
import { SeoController } from './seo.controller';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '@app/storage';
import { Store, Product, Showcase } from '@app/database';
import {
  StoreSeo,
  ProductSeo,
  ShowcaseSeo,
  SeoRedirect,
  SeoSettings,
} from './seo.entities';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    TypeOrmModule.forFeature([
      Store,
      Product,
      Showcase,
      StoreSeo,
      ProductSeo,
      ShowcaseSeo,
      SeoRedirect,
      SeoSettings,
    ]),
  ],
  controllers: [SeoController],
  providers: [SeoService],
  exports: [SeoService],
})
export class SeoModule {}
