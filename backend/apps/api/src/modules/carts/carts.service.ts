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
  StoreBranch,
  Product,
  ProductStatus,
  Cart,
  CartItem,
  CartStatus,
  effectiveLimits,
  publicWhere,
  normalizeSelectedOptions,
  selectedOptionsKey,
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
    @InjectRepository(StoreBranch)
    private readonly branches: Repository<StoreBranch>,
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
        ...publicWhere('store'),
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
        ...publicWhere('store'),
      });
      if (!store) {
        throw new NotFoundException('Store not found');
      }

      await this.checkCartEnabled(store);

      const product = await this.products.findOneBy({
        id: dto.productId,
        ...publicWhere('product'),
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

      // Product options are required exactly when the product declares them.
      // The canonical selection is snapshotted on the cart line so a later
      // option edit does not rewrite an order that is already in progress.
      const selectedOptions = normalizeSelectedOptions(
        product.options,
        dto.selectedOptions,
      );
      const optionKey = selectedOptionsKey(selectedOptions);

      const cart = await this.getOrCreateCart(store.id, userId, visitorId);

      const matchingItems = await this.cartItems.find({
        where: { cartId: cart.id, productId: dto.productId },
      });
      const existingQuantity = matchingItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      // Stock applies to the product as a whole, across every option
      // combination, not just the line that is being changed.
      if (
        product.stockQuantity !== null &&
        product.stockQuantity < existingQuantity + dto.quantity
      ) {
        throw new ConflictException(
          `Only ${product.stockQuantity} items available in stock`,
        );
      }

      let cartItem = matchingItems.find(
        (item) => selectedOptionsKey(item.selectedOptions) === optionKey,
      );
      if (cartItem) {
        cartItem.quantity += dto.quantity;
        if (dto.notes !== undefined) cartItem.notes = dto.notes;
      } else {
        // Create a separate line for each option combination so the shop can
        // see which size or color belongs to each ordered item.
        cartItem = this.cartItems.create({
          cartId: cart.id,
          productId: product.id,
          quantity: dto.quantity,
          unitPriceCents: product.priceCents,
          productName: product.name,
          productSlug: product.slug,
          notes: dto.notes ?? null,
          selectedOptions,
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
        ...publicWhere('store'),
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
        ...publicWhere('product'),
        storeId: store.id,
        status: ProductStatus.ACTIVE,
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      if (dto.quantity !== undefined) {
        if (product.stockQuantity !== null) {
          const siblingItems = await this.cartItems.find({
            where: { cartId: cart.id, productId: cartItem.productId },
          });
          const otherQuantity = siblingItems
            .filter((item) => item.id !== cartItem.id)
            .reduce((sum, item) => sum + item.quantity, 0);
          if (product.stockQuantity < otherQuantity + dto.quantity) {
            throw new ConflictException(
              `Only ${product.stockQuantity} items available in stock`,
            );
          }
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
        ...publicWhere('store'),
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
        ...publicWhere('store'),
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
        ...publicWhere('store'),
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

      // Verify all products are still available and in stock. Option
      // combinations are separate cart lines, so quantities are summed per
      // product before comparing against the shared stock count.
      const quantitiesByProduct = new Map<string, number>();
      for (const item of items) {
        quantitiesByProduct.set(
          item.productId,
          (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity,
        );
      }
      for (const item of items) {
        const product = await this.products.findOneBy({
          id: item.productId,
          ...publicWhere('product'),
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
          product.stockQuantity <
            (quantitiesByProduct.get(product.id) ?? item.quantity)
        ) {
          throw new ConflictException(
            `Only ${product.stockQuantity} of "${item.productName}" available`,
          );
        }
      }

      const storeWhatsApp = store.socialMediaLinks?.whatsapp;

      // A branch-specific number takes priority so each location receives its
      // own orders. Without branches the shop-level WhatsApp remains the owner.
      let branch: StoreBranch | null = null;
      if (dto.branchId) {
        branch = await this.branches.findOneBy({
          id: dto.branchId,
          storeId: store.id,
        });
        if (!branch)
          throw new BadRequestException('The selected branch is unavailable');
      } else {
        branch = await this.branches.findOne({
          where: { storeId: store.id },
          order: { isPrimary: 'DESC', sortOrder: 'ASC' },
        });
      }

      const orderWhatsApp = branch?.whatsapp || storeWhatsApp;
      if (!orderWhatsApp) {
        throw new BadRequestException(
          'Store does not have a WhatsApp number configured for orders',
        );
      }
      const whatsappNumber = this.normalizePhoneNumber(orderWhatsApp);
      if (!/^\d{7,15}$/u.test(whatsappNumber)) {
        throw new BadRequestException(
          'Store WhatsApp number is not valid for orders',
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
        branch,
      );

      // Generate WhatsApp URL
      const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

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
        branchId: branch?.id ?? null,
        branchName: branch?.name ?? null,
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
    // A saved shop link may carry a prefilled message; never let digits from
    // the query string become part of the destination number.
    try {
      const url = new URL(phone);
      if (url.protocol === 'https:' && url.hostname === 'wa.me')
        return url.pathname.replace(/\D/gu, '');
    } catch {
      /* Not a URL: treat the value as a phone number. */
    }
    // wa.me expects digits only, without spaces, dashes, or a leading plus.
    return phone.replace(/\D/gu, '');
  }

  private buildWhatsAppMessage(
    storeName: string,
    items: CartItem[],
    total: string,
    currency: string,
    customerNotes: string,
    customerName: string,
    customerPhone: string,
    branch: StoreBranch | null,
  ): string {
    const lines: string[] = [];
    lines.push(`*New Order from ${storeName}*`);
    lines.push('');

    if (branch) {
      lines.push(`*Branch:* ${branch.name}`);
      const address = [branch.address, branch.city, branch.country]
        .filter((value) => value?.trim())
        .join(', ');
      if (address) lines.push(`*Location:* ${address}`);
      lines.push('');
    }

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
      if (item.selectedOptions?.length) {
        lines.push(
          `  ${item.selectedOptions
            .map((option) => `${option.name}: ${option.value}`)
            .join(' · ')}`,
        );
      }
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
