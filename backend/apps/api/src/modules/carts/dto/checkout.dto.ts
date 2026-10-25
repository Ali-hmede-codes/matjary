import { IsString, Length, IsOptional, IsUUID } from 'class-validator';

export class CheckoutDto {
  // Optional when the shop has no branches; otherwise it selects the pickup
  // branch whose WhatsApp number receives the order.
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 65535)
  customerNotes?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  customerName?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  customerPhone?: string | null;
}
