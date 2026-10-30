import { applyDecorators } from '@nestjs/common';
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { AiRobotsDirective, RobotsDirective } from './seo.entities';

// A public image reference: an HTTPS URL or a root-relative file on this site.
// The server never fetches these addresses; they are printed into meta tags.
function SeoImageUrl(): PropertyDecorator {
  return applyDecorators(
    ValidateIf((_object, value) => value !== undefined && value !== null),
    IsString(),
    MaxLength(512),
    ValidateBy({
      name: 'seoImageUrl',
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || /[\s\\]/u.test(value)) return false;
          if (!/^https:\/\//.test(value) && !/^\/(?!\/)/.test(value))
            return false;
          try {
            const url = new URL(value, 'https://website.invalid');
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

// Entity identity, relationships, generated fields, and arbitrary JSON are never
// writable metadata. URL and image-key authorization is also checked in service.
export class SeoMetadataDto {
  @IsOptional() @IsString() @MaxLength(120) metaTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(320) metaDescription?: string | null;
  @IsOptional() @IsString() @MaxLength(500) metaKeywords?: string | null;
  @IsOptional() @IsString() @MaxLength(120) ogTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(320) ogDescription?: string | null;
  @IsOptional() @IsString() @MaxLength(512) ogImageKey?: string | null;
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(['website', 'product', 'article'])
  ogType?: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(['summary', 'summary_large_image'])
  twitterCard?: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(RobotsDirective)
  robots?: RobotsDirective;
  @IsOptional() @IsEnum(AiRobotsDirective) aiRobots?: AiRobotsDirective | null;
  @IsOptional()
  @IsEnum(AiRobotsDirective)
  aiTraining?: AiRobotsDirective | null;
  @IsOptional()
  @IsUrl({
    require_tld: false,
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  @MaxLength(1000)
  canonicalUrl?: string | null;
}

export class StoreSeoDto extends SeoMetadataDto {
  @IsOptional() @IsString() @MaxLength(100) ogSiteName?: string | null;
  @IsOptional() @IsString() @MaxLength(100) twitterSite?: string | null;
  @IsOptional() @IsString() @MaxLength(100) twitterCreator?: string | null;
}

export class ProductSeoDto extends SeoMetadataDto {
  @IsOptional() @IsString() @MaxLength(100) gtin?: string | null;
  @IsOptional() @IsString() @MaxLength(100) mpn?: string | null;
  @IsOptional() @IsString() @MaxLength(100) brand?: string | null;
  @IsOptional() @IsString() @MaxLength(100) sku?: string | null;
}

export class ShowcaseSeoDto extends SeoMetadataDto {
  @IsOptional() @IsString() @MaxLength(100) articleAuthor?: string | null;
  @IsOptional() @IsString() @MaxLength(100) articleSection?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  articleTags?: string[] | null;
  @IsOptional() @Type(() => Date) @IsDate() articlePublishedTime?: Date | null;
  @IsOptional() @Type(() => Date) @IsDate() articleModifiedTime?: Date | null;
}

export class SeoSettingsDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(100)
  siteName?: string;
  @IsOptional() @IsString() @MaxLength(120) defaultTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(320) defaultDescription?: string | null;
  @IsOptional() @IsString() @MaxLength(512) defaultOgImageKey?: string | null;
  @IsOptional() @SeoImageUrl() defaultOgImageUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(100) twitterSite?: string | null;
  @IsOptional()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  @MaxLength(255)
  googleSiteVerification?: string | null;
  @IsOptional()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  @MaxLength(255)
  bingSiteVerification?: string | null;
  @IsOptional()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  @MaxLength(255)
  yandexSiteVerification?: string | null;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() sitemapEnabled?: boolean;
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'])
  sitemapChangefreq?: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(1)
  sitemapPriority?: number;
  @IsOptional() @IsString() @MaxLength(4000) robotsTxtCustom?: string | null;
  @IsOptional() @IsString() @MaxLength(200) organizationName?: string | null;
  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(500)
  organizationUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(512) organizationLogoKey?: string | null;
  @IsOptional() @SeoImageUrl() organizationLogoUrl?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl(
    { protocols: ['https', 'http'], require_protocol: true },
    { each: true },
  )
  @MaxLength(500, { each: true })
  organizationSameAs?: string[] | null;
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  aiCrawlersAllowed?: boolean;
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  aiTrainingAllowed?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(/^[a-zA-Z0-9_.*-]+$/, { each: true })
  @MaxLength(100, { each: true })
  aiCrawlerUserAgents?: string[] | null;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() llmsTxtEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(4000) llmsTxtContent?: string | null;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() indexNowEnabled?: boolean;
  @IsOptional() @Matches(/^[a-zA-Z0-9-]{8,128}$/) indexNowKey?: string | null;
  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(512)
  indexNowKeyLocation?: string | null;
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  speakableEnabled?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  speakableCssSelectors?: string[] | null;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() faqEnabled?: boolean;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() howtoEnabled?: boolean;
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(3650)
  freshnessThresholdDays?: number;
}

export class CreateRedirectDto {
  @IsString()
  @MaxLength(700)
  @Matches(/^\/(?!\/)[^\\\s?#]*$/)
  fromPath!: string;
  @IsString() @MaxLength(1000) @Matches(/^\/(?!\/)[^\\\s]*$/) toPath!: string;
  @IsOptional() @IsUUID() storeId?: string | null;
  @ValidateIf((_, v) => v !== undefined) @IsIn([301, 302]) statusCode?: number;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() isActive?: boolean;
}

export class UpdateRedirectDto extends PartialType(CreateRedirectDto, {
  skipNullProperties: false,
}) {}

export class IndexNowDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUrl(
    {
      require_tld: false,
      protocols: ['http', 'https'],
      require_protocol: true,
    },
    { each: true },
  )
  @MaxLength(1000, { each: true })
  urls!: string[];
}
