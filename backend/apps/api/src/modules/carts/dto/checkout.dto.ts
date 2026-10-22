import { IsString, Length, IsOptional, IsUUID } from 'class-validator';

export class CheckoutDto {
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
