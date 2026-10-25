import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartsController } from './carts.controller';
import { CartsService } from './carts.service';
import { Store, StoreBranch, Product, Cart, CartItem } from '@app/database';
import { AuthModule } from '../auth/auth.module';
import { CartIdentityGuard } from './cart-identity.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Store, StoreBranch, Product, Cart, CartItem]),
    AuthModule,
  ],
  controllers: [CartsController],
  providers: [CartsService, CartIdentityGuard],
  exports: [CartsService],
})
export class CartsModule {}
