import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Platform-wide economics for verification badges sold outside a plan bundle.
// A plan may set its own verificationBadgePriceCents; plans without one charge
// this monthly price, and zero turns the paid add-on off platform-wide.
@Entity({ name: 'verification_settings', engine: 'InnoDB' })
export class VerificationSettings {
  @PrimaryColumn({ type: 'tinyint', unsigned: true })
  id = 1;

  @Column({
    name: 'badge_price_cents',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  badgePriceCents = 0;

  // The number an owner calls or messages to pay for a badge month. It is
  // shown on the owner's Verification tab and never to shoppers.
  @Column({
    name: 'contact_phone',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  contactPhone: string | null = null;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
