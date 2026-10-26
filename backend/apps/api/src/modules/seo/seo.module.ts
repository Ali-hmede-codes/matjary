import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeoService } from './seo.service';
import { SeoController } from './seo.controller';
import { ShareShellController } from './share-shell.controller';
import { ShareShellService } from './share-shell.service';
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
  controllers: [SeoController, ShareShellController],
  providers: [SeoService, ShareShellService],
  exports: [SeoService],
})
export class SeoModule {}
