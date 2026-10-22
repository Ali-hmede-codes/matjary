import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { Store, Product } from '@app/database';
import { AuthModule } from '../auth/auth.module';
import { StoresModule } from '../stores/stores.module';
import { SeoModule } from '../seo/seo.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Store, Product]),
    AuthModule,
    StoresModule,
    SeoModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
