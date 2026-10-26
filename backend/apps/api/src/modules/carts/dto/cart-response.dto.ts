import {
  Cart,
  CartItem,
  CartStatus,
  type SelectedProductOption,
} from '@app/database';

export class CartItemResponseDto {
  id!: string;
  productId!: string;
  productName!: string;
  productSlug!: string;
  quantity!: number;
  unitPriceCents!: string; // BIGINT stays as string
  currency!: string;
  notes!: string | null;
  selectedOptions!: SelectedProductOption[] | null;
  lineTotalCents!: string; // quantity * unitPriceCents
  createdAt!: Date;
  updatedAt!: Date;
}

export class CartResponseDto {
  id!: string;
  storeId!: string;
  storeSlug!: string;
  storeName!: string;
  storeWhatsApp?: string | null;
  currency!: string;
  status!: CartStatus;
  customerNotes!: string | null;
  items!: CartItemResponseDto[];
  subtotalCents!: string;
  itemCount!: number;
  expiresAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class CheckoutResponseDto {
  whatsappUrl!: string;
  message!: string;
  totalCents!: string;
  currency!: string;
  branchId!: string | null;
  branchName!: string | null;
}

export function toCartItemResponseDto(item: CartItem): CartItemResponseDto {
  const unitPrice = BigInt(item.unitPriceCents);
  const lineTotal = unitPrice * BigInt(item.quantity);
  return {
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    productSlug: item.productSlug,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    currency: item.cart?.currency ?? 'USD',
    notes: item.notes,
    selectedOptions: item.selectedOptions ?? null,
    lineTotalCents: lineTotal.toString(),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function toCartResponseDto(
  cart: Cart,
  storeSlug: string,
  storeName: string,
  storeWhatsApp: string | null,
  items: CartItem[],
): CartResponseDto {
  const subtotal = items.reduce((sum, item) => {
    return sum + BigInt(item.unitPriceCents) * BigInt(item.quantity);
  }, BigInt(0));

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    id: cart.id,
    storeId: cart.storeId,
    storeSlug,
    storeName,
    storeWhatsApp,
    currency: cart.currency,
    status: cart.status,
    customerNotes: cart.customerNotes,
    items: items.map(toCartItemResponseDto),
    subtotalCents: subtotal.toString(),
    itemCount,
    expiresAt: cart.expiresAt,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}

export function formatCurrency(cents: string, currency: string): string {
  const amount = Number(cents) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}
