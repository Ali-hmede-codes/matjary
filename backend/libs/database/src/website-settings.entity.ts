import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'website_settings' })
export class WebsiteSettings {
  @PrimaryColumn({ type: 'tinyint', unsigned: true })
  id = 1;

  @Column({
    name: 'site_name',
    type: 'varchar',
    length: 100,
    default: 'Matjary',
  })
  siteName = 'Matjary';

  @Column({ type: 'varchar', length: 200, nullable: true })
  tagline: string | null = null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null = null;

  @Column({
    name: 'primary_color',
    type: 'varchar',
    length: 7,
    default: '#254e40',
  })
  primaryColor = '#254e40';

  @Column({
    name: 'secondary_color',
    type: 'varchar',
    length: 7,
    default: '#d9a441',
  })
  secondaryColor = '#d9a441';

  @Column({
    name: 'background_color',
    type: 'varchar',
    length: 7,
    default: '#ffffff',
  })
  backgroundColor = '#ffffff';

  @Column({
    name: 'text_color',
    type: 'varchar',
    length: 7,
    default: '#17231e',
  })
  textColor = '#17231e';

  @Column({ name: 'logo_url', type: 'varchar', length: 2048, nullable: true })
  logoUrl: string | null = null;

  @Column({
    name: 'favicon_url',
    type: 'varchar',
    length: 2048,
    nullable: true,
  })
  faviconUrl: string | null = null;

  @Column({ name: 'banner_url', type: 'varchar', length: 2048, nullable: true })
  bannerUrl: string | null = null;

  @Column({
    name: 'contact_email',
    type: 'varchar',
    length: 254,
    nullable: true,
  })
  contactEmail: string | null = null;

  @Column({ name: 'footer_text', type: 'varchar', length: 500, nullable: true })
  footerText: string | null = null;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt!: Date;
}

// Only these fields are writable and public; never serialize the whole entity.
export const WEBSITE_SETTINGS_FIELDS = [
  'siteName',
  'tagline',
  'description',
  'primaryColor',
  'secondaryColor',
  'backgroundColor',
  'textColor',
  'logoUrl',
  'faviconUrl',
  'bannerUrl',
  'contactEmail',
  'footerText',
] as const;

export type WebsiteSettingsValues = Pick<
  WebsiteSettings,
  (typeof WEBSITE_SETTINGS_FIELDS)[number]
>;
