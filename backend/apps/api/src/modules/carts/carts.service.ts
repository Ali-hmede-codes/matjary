import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import {
  Store,
  Product,
  ProductStatus,
  Cart,
  CartItem,
  CartStatus,
  effectiveLimits,
  moderationWhere,
} from '@app/database';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CheckoutDto } from './dto/checkout.dto';
import {
  CartResponseDto,
  CheckoutResponseDto,
  toCartResponseDto,
  formatCurrency,
} from './dto/cart-response.dto';

@Injectable()
export class CartsService {
  constructor(
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Cart)
    private readonly carts: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItems: Repository<CartItem>,
  ) {}

  private sanitize(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Cart storage is temporarily unavailable',
    );
  }

  /**
   * Check if cart feature is enabled for the store
   */
  private async checkCartEnabled(store: Store): Promise<void> {
    const limits = await effectiveLimits(this.stores.manager, store.ownerId);
    if (!store.enableCart || !limits.enableCart) {
      throw new BadRequestException('Cart feature is disabled for this store');
    }
  }

  /**
   * Check if WhatsApp checkout feature is enabled for the store
   */
  private async checkWhatsAppCheckoutEnabled(store: Store): Promise<void> {
    const limits = await effectiveLimits(this.stores.manager, store.ownerId);
    if (!store.enableWhatsAppCheckout || !limits.enableWhatsAppCheckout) {
      throw new BadRequestException(
        'WhatsApp checkout is disabled for this store',
      );
    }
  }

  /**
   * Get or create a cart for a store.
   * For authenticated users: uses userId
   * For anonymous visitors: uses visitorId (stored in cookie)
   */
  async getOrCreateCart(
    storeId: string,
    userId: string | undefined,
    visitorId: string | undefined,
  ): Promise<Cart> {
    try {
      if (!userId && !visitorId)
        throw new ForbiddenException('Cart identity required');
      // Authenticated and anonymous carts are separate; never infer a merge.
      if (userId) visitorId = undefined;
      let cart: Cart | null = null;

      if (userId) {
        cart = await this.carts.findOne({
          where: { userId, storeId, status: CartStatus.ACTIVE },
        });
      } else if (visitorId) {
        cart = await this.carts.findOne({
          where: {
            visitorId,
            userId: IsNull(),
            storeId,
            status: CartStatus.ACTIVE,
          },
        });
      }

      if (!cart) {
        // Create new cart
        cart = this.carts.create({
          userId: userId ?? null,
          visitorId: visitorId ?? null,
          storeId,
          currency: 'USD',
          status: CartStatus.ACTIVE,
          // Cart expires after 7 days of inactivity
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        cart = await this.carts.save(cart);
      }

      // Update expiry on access
      if (cart.expiresAt && cart.expiresAt < new Date()) {
        // Cart expired, create new one
        await this.carts.update(cart.id, { status: CartStatus.EXPIRED });
        cart = this.carts.create({
          userId: userId ?? null,
          visitorId: visitorId ?? null,
          storeId,
          currency: 'USD',
          status: CartStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        cart = await this.carts.save(cart);
      } else {
        // Extend expiry
        await this.carts.update(cart.id, {
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }

      return cart;
    } catch (error) {
      this.sanitize(error);
    }
  }

  async getCart(
    storeSlug: string,
    userId: string | undefined,
    visitorId: string | undefined,
  ): Promise<CartResponseDto> {
    try {
      const store = await this.stores.findOneBy({
        slug: storeSlug,
        ...moderationWhere('store'),
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      await this.checkCartEnabled(store);

      const cart = await this.getOrCreateCart(store.id, userId, visitorId);
      const items = await this.cartItems.find({
        where: { cartId: cart.id },
        order: { createdAt: 'ASC' },
      });

      // Get store's WhatsApp number from social media links
      const storeWhatsApp = store.socialMediaLinks?.whatsapp ?? null;

      return toCartResponseDto(
        cart,
        store.slug,
        store.name,
        storeWhatsApp,
        items,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async addItem(
    storeSlug: string,
    dto: AddToCartDto,
    userId: string | undefined,
    visitorId: string | undefined,
  ): Promise<CartResponseDto> {
    try {
      const store = await this.stores.findOneBy({
        slug: storeSlug,
        ...moderationWhere('store'),
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      await this.checkCartEnabled(store);

      const product = await this.products.findOneBy({
        id: dto.productId,
        ...moderationWhere('product'),
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }
      if (product.storeId !== store.id) {
        throw new ForbiddenException('Product does not belong to this store');
      }
      if (product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException('Product is not available');
      }
      // Check stock if tracking is enabled
      if (
        product.stockQuantity !== null &&
        product.stockQuantity < dto.quantity
      ) {
        throw new ConflictException(
          `Only ${product.stockQuantity} items available in stock`,
        );
      }

      const cart = await this.getOrCreateCart(store.id, userId, visitorId);

      // Check if item already exists in cart
      let cartItem = await this.cartItems.findOne({
        where: { cartId: cart.id, productId: dto.productId },
      });

      if (cartItem) {
        // Update quantity
        const newQuantity = cartItem.quantity + dto.quantity;
        if (
          product.stockQuantity !== null &&
          product.stockQuantity < newQuantity
        ) {
          throw new ConflictException(
            `Only ${product.stockQuantity} items available in stock`,
          );
        }
        cartItem.quantity = newQuantity;
        if (dto.notes !== undefined) cartItem.notes = dto.notes;
      } else {
        // Create new cart item
        cartItem = this.cartItems.create({
          cartId: cart.id,
          productId: product.id,
          quantity: dto.quantity,
          unitPriceCents: product.priceCents,
          productName: product.name,
          productSlug: product.slug,
          notes: dto.notes ?? null,
        });
      }

      await this.cartItems.save(cartItem);

      // Return updated cart
      return this.getCart(storeSlug, userId, visitorId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async updateItem(
    storeSlug: string,
    itemId: string,
    dto: UpdateCartItemDto,
    userId: string | undefined,
    visitorId: string | undefined,
  ): Promise<CartResponseDto> {
    try {
      const store = await this.stores.findOneBy({
        slug: storeSlug,
        ...moderationWhere('store'),
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      await this.checkCartEnabled(store);

      const cart = await this.getOrCreateCart(store.id, userId, visitorId);

      const cartItem = await this.cartItems.findOneBy({ id: itemId });
      if (!cartItem) {
        throw new NotFoundException('Cart item not found');
      }
      if (cartItem.cartId !== cart.id) {
        throw new ForbiddenException('Cart item does not belong to this cart');
      }

      const product = await this.products.findOneBy({
        id: cartItem.productId,
        ...moderationWhere('product'),
        storeId: store.id,
        status: ProductStatus.ACTIVE,
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      if (dto.quantity !== undefined) {
        if (
          product.stockQuantity !== null &&
          product.stockQuantity < dto.quantity
        ) {
          throw new ConflictException(
            `Only ${product.stockQuantity} items available in stock`,
          );
        }
        cartItem.quantity = dto.quantity;
      }
      if (dto.notes !== undefined) cartItem.notes = dto.notes;

      await this.cartItems.save(cartItem);

      return this.getCart(storeSlug, userId, visitorId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async removeItem(
    storeSlug: string,
    itemId: string,
    userId: string | undefined,
    visitorId: string | undefined,
  ): Promise<CartResponseDto> {
    try {
      const store = await this.stores.findOneBy({
        slug: storeSlug,
        ...moderationWhere('store'),
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      await this.checkCartEnabled(store);

      const cart = await this.getOrCreateCart(store.id, userId, visitorId);

      const cartItem = await this.cartItems.findOneBy({ id: itemId });
      if (!cartItem) {
        throw new NotFoundException('Cart item not found');
      }
      if (cartItem.cartId !== cart.id) {
        throw new ForbiddenException('Cart item does not belong to this cart');
      }

      await this.cartItems.remove(cartItem);

      return this.getCart(storeSlug, userId, visitorId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async clearCart(
    storeSlug: string,
    userId: string | undefined,
    visitorId: string | undefined,
  ): Promise<CartResponseDto> {
    try {
      const store = await this.stores.findOneBy({
        slug: storeSlug,
        ...moderationWhere('store'),
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      await this.checkCartEnabled(store);

      const cart = await this.getOrCreateCart(store.id, userId, visitorId);

      await this.cartItems.delete({ cartId: cart.id });

      return this.getCart(storeSlug, userId, visitorId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  async checkout(
    storeSlug: string,
    dto: CheckoutDto,
    userId: string | undefined,
    visitorId: string | undefined,
  ): Promise<CheckoutResponseDto> {
    try {
      const store = await this.stores.findOneBy({
        slug: storeSlug,
        ...moderationWhere('store'),
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      await this.checkCartEnabled(store);
      await this.checkWhatsAppCheckoutEnabled(store);

      const cart = await this.getOrCreateCart(store.id, userId, visitorId);
      const items = await this.cartItems.find({
        where: { cartId: cart.id },
      });

      if (items.length === 0) {
        throw new BadRequestException('Cart is empty');
      }

      // Verify all products are still available and in stock
      for (const item of items) {
        const product = await this.products.findOneBy({
          id: item.productId,
          ...moderationWhere('product'),
        });
        if (!product || product.storeId !== store.id) {
          throw new BadRequestException(
            `Product "${item.productName}" is no longer available`,
          );
        }
        if (product.status !== ProductStatus.ACTIVE) {
          throw new BadRequestException(
            `Product "${item.productName}" is not available`,
          );
        }
        if (
          product.stockQuantity !== null &&
          product.stockQuantity < item.quantity
        ) {
          throw new ConflictException(
            `Only ${product.stockQuantity} of "${item.productName}" available`,
          );
        }
      }

      const storeWhatsApp = store.socialMediaLinks?.whatsapp;
      if (!storeWhatsApp) {
        throw new BadRequestException(
          'Store does not have a WhatsApp number configured for orders',
        );
      }

      // Calculate totals
      const subtotal = items.reduce((sum, item) => {
        return sum + BigInt(item.unitPriceCents) * BigInt(item.quantity);
      }, BigInt(0));

      const totalCents = subtotal.toString();
      const currency = cart.currency;
      const formattedTotal = formatCurrency(totalCents, currency);

      // Build WhatsApp message
      const message = this.buildWhatsAppMessage(
        store.name,
        items,
        formattedTotal,
        currency,
        dto.customerNotes ?? '',
        dto.customerName ?? '',
        dto.customerPhone ?? '',
      );

      // Generate WhatsApp URL
      const whatsappUrl = `https://wa.me/${this.normalizePhoneNumber(storeWhatsApp)}?text=${encodeURIComponent(message)}`;

      // Mark cart as checked out
      await this.carts.update(cart.id, {
        status: CartStatus.CHECKED_OUT,
        customerNotes: dto.customerNotes ?? null,
      });

      return {
        whatsappUrl,
        message,
        totalCents,
        currency,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.sanitize(error);
    }
  }

  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters except +
    let normalized = phone.replace(/[^\d+]/g, '');
    // Ensure it starts with + or country code
    if (!normalized.startsWith('+')) {
      // Assume it's a valid international format, just add + if missing
      normalized = '+' + normalized;
    }
    return normalized;
  }

  private buildWhatsAppMessage(
    storeName: string,
    items: CartItem[],
    total: string,
    currency: string,
    customerNotes: string,
    customerName: string,
    customerPhone: string,
  ): string {
    const lines: string[] = [];
    lines.push(`*New Order from ${storeName}*`);
    lines.push('');

    if (customerName) {
      lines.push(`*Customer:* ${customerName}`);
    }
    if (customerPhone) {
      lines.push(`*Phone:* ${customerPhone}`);
    }
    lines.push('');

    lines.push('*Items:*');
    for (const item of items) {
      const lineTotal = BigInt(item.unitPriceCents) * BigInt(item.quantity);
      const formattedLineTotal = formatCurrency(lineTotal.toString(), currency);
      lines.push(
        `• ${item.productName} x${item.quantity} = ${formattedLineTotal}`,
      );
      if (item.notes) {
        lines.push(`  Note: ${item.notes}`);
      }
    }
    lines.push('');
    lines.push(`*Total:* ${total}`);
    lines.push('');

    if (customerNotes) {
      lines.push(`*Customer Notes:* ${customerNotes}`);
      lines.push('');
    }

    lines.push(`Order placed via ${storeName} showcase`);
    return lines.join('\n');
  }
}
