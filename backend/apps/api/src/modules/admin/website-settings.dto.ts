import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';

function SettingText(max: number, nullable = true): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string'
        ? value.trim() || (nullable ? null : '')
        : value,
    ),
    ValidateIf(
      (_object, value) => value !== undefined && (!nullable || value !== null),
    ),
    IsString(),
    Length(1, max),
    Matches(/^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u, {
      message: '$property must be plain text',
    }),
  );
}

function SettingColor(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toLowerCase() : value,
    ),
    ValidateIf((_object, value) => value !== undefined),
    Matches(/^#[0-9a-f]{6}$/, {
      message: '$property must be a six-digit hex color',
    }),
  );
}

function SettingImage(): PropertyDecorator {
  return applyDecorators(
    SettingText(2048),
    ValidateBy({
      name: 'websiteImageUrl',
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || /[\s\\]/u.test(value)) return false;
          if (!/^https:\/\//.test(value) && !/^\/(?!\/)/.test(value))
            return false;
          try {
            const url = new URL(value, 'https://website.invalid');
            // These are public references, never fetched/proxied by the server.
            return (
              url.protocol === 'https:' &&
              !url.username &&
              !url.password &&
              !url.hash
            );
          } catch {
            return false;
          }
        },
        defaultMessage: () =>
          '$property must be an HTTPS URL or root-relative path without credentials or fragments',
      },
    }),
  );
}

export class UpdateWebsiteSettingsDto {
  @SettingText(100, false)
  siteName?: string;

  @SettingText(200)
  tagline?: string | null;

  @SettingText(1000)
  description?: string | null;

  @SettingColor()
  primaryColor?: string;

  @SettingColor()
  secondaryColor?: string;

  @SettingColor()
  backgroundColor?: string;

  @SettingColor()
  textColor?: string;

  @SettingImage()
  logoUrl?: string | null;

  @SettingImage()
  faviconUrl?: string | null;

  @SettingImage()
  bannerUrl?: string | null;

  @SettingText(254)
  @IsEmail()
  contactEmail?: string | null;

  @SettingText(500)
  footerText?: string | null;

  // Whole Lebanese pounds per 1 US dollar. Zero turns LBP display off. Null is
  // rejected on purpose: a cleared input must mean an explicit zero, never a
  // silent database error.
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  lbpExchangeRate?: number;
}
