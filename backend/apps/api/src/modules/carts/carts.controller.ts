import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CartsService } from './carts.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { CartResponseDto, CheckoutResponseDto } from './dto/cart-response.dto';
import {
  MutationGuard,
  AuthenticatedRequest,
} from '../auth/guards/auth.guards';
import { CartIdentityGuard, CartVisitor } from './cart-identity.guard';

@Controller('stores/:storeSlug/cart')
@UseGuards(CartIdentityGuard, MutationGuard)
export class CartsController {
  constructor(private readonly carts: CartsService) {}

  @Get()
  async getCart(
    @Param('storeSlug') storeSlug: string,
    @Req() request: AuthenticatedRequest | { user?: { id: string } },
    @CartVisitor() visitorId?: string,
  ): Promise<CartResponseDto> {
    const userId = 'user' in request ? request.user?.id : undefined;
    return this.carts.getCart(storeSlug, userId, visitorId);
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  async addItem(
    @Param('storeSlug') storeSlug: string,
    @Body() dto: AddToCartDto,
    @Req() request: AuthenticatedRequest | { user?: { id: string } },
    @CartVisitor() visitorId?: string,
  ): Promise<CartResponseDto> {
    const userId = 'user' in request ? request.user?.id : undefined;
    return this.carts.addItem(storeSlug, dto, userId, visitorId);
  }

  @Patch('items/:itemId')
  async updateItem(
    @Param('storeSlug') storeSlug: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
    @Req() request: AuthenticatedRequest | { user?: { id: string } },
    @CartVisitor() visitorId?: string,
  ): Promise<CartResponseDto> {
    const userId = 'user' in request ? request.user?.id : undefined;
    return this.carts.updateItem(storeSlug, itemId, dto, userId, visitorId);
  }

  @Delete('items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeItem(
    @Param('storeSlug') storeSlug: string,
    @Param('itemId') itemId: string,
    @Req() request: AuthenticatedRequest | { user?: { id: string } },
    @CartVisitor() visitorId?: string,
  ): Promise<void> {
    const userId = 'user' in request ? request.user?.id : undefined;
    await this.carts.removeItem(storeSlug, itemId, userId, visitorId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearCart(
    @Param('storeSlug') storeSlug: string,
    @Req() request: AuthenticatedRequest | { user?: { id: string } },
    @CartVisitor() visitorId?: string,
  ): Promise<void> {
    const userId = 'user' in request ? request.user?.id : undefined;
    await this.carts.clearCart(storeSlug, userId, visitorId);
  }

  @Post('checkout')
  async checkout(
    @Param('storeSlug') storeSlug: string,
    @Body() dto: CheckoutDto,
    @Req() request: AuthenticatedRequest | { user?: { id: string } },
    @CartVisitor() visitorId?: string,
  ): Promise<CheckoutResponseDto> {
    const userId = 'user' in request ? request.user?.id : undefined;
    return this.carts.checkout(storeSlug, dto, userId, visitorId);
  }

  @Post('checkout/redirect')
  async checkoutRedirect(
    @Param('storeSlug') storeSlug: string,
    @Body() dto: CheckoutDto,
    @Req() request: AuthenticatedRequest | { user?: { id: string } },
    @Res() response: Response,
    @CartVisitor() visitorId?: string,
  ): Promise<void> {
    const userId = 'user' in request ? request.user?.id : undefined;
    const result = await this.carts.checkout(storeSlug, dto, userId, visitorId);
    response.redirect(result.whatsappUrl);
  }
}
