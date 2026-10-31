import type { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';
import type { DatabaseEnvironment } from '../../config/src/environment';
import { databaseEntities } from './entities';
import { StoreLifecycle1793918400000 } from './migrations/1793918400000-StoreLifecycle';
import { FreeTrialSubscriptions1794004800000 } from './migrations/1794004800000-FreeTrialSubscriptions';
import { UnlimitedPlanStorage1794091200000 } from './migrations/1794091200000-UnlimitedPlanStorage';
import { MaxPostsOnly1794177600000 } from './migrations/1794177600000-MaxPostsOnly';
import { StoreCategoriesAndPlanQuotas1794264000000 } from './migrations/1794264000000-StoreCategoriesAndPlanQuotas';
import { AddStoreBranches1794350400000 } from './migrations/1794350400000-AddStoreBranches';
import { AddBranchGoogleMapsUrl1794436800000 } from './migrations/1794436800000-AddBranchGoogleMapsUrl';
import { AddBusinessCategory1794523200000 } from './migrations/1794523200000-AddBusinessCategory';
import { ProductOptions1794609600000 } from './migrations/1794609600000-ProductOptions';
import { AbsoluteProductOptionPrices1794696000000 } from './migrations/1794696000000-AbsoluteProductOptionPrices';
import { PostLinks1794782400000 } from './migrations/1794782400000-PostLinks';
import { LbpPriceDisplay1794868800000 } from './migrations/1794868800000-LbpPriceDisplay';
import { SectionAllowanceTrading1794955200000 } from './migrations/1794955200000-SectionAllowanceTrading';
import { StoreStories1795041600000 } from './migrations/1795041600000-StoreStories';
import { StoryMediaPurpose1795128000000 } from './migrations/1795128000000-StoryMediaPurpose';
import { StoreTeam1795214400000 } from './migrations/1795214400000-StoreTeam';
import { ProductSalePrice1795300800000 } from './migrations/1795300800000-ProductSalePrice';
import { StoreVerificationRequests1795387200000 } from './migrations/1795387200000-StoreVerificationRequests';
import { PlanIncludedVerificationBadges1795473600000 } from './migrations/1795473600000-PlanIncludedVerificationBadges';
import { SeoImageUrls1795560000000 } from './migrations/1795560000000-SeoImageUrls';
import { FreeTrialThreeDays1795646400000 } from './migrations/1795646400000-FreeTrialThreeDays';
import { AdminStoreScopes1795732800000 } from './migrations/1795732800000-AdminStoreScopes';
import { ArabicSlugRepair1795819200000 } from './migrations/1795819200000-ArabicSlugRepair';
import { UserPhones1795905600000 } from './migrations/1795905600000-UserPhones';
import { VerificationSettings1795992000000 } from './migrations/1795992000000-VerificationSettings';
import { RenewalReminders1796078400000 } from './migrations/1796078400000-RenewalReminders';
import { OwnerMediaTargets1793832000000 } from './migrations/1793832000000-OwnerMediaTargets';
import { AddUserRoles1793745600000 } from './migrations/1793745600000-AddUserRoles';
import { WebsiteSettings1793659200000 } from './migrations/1793659200000-WebsiteSettings';
import { AdminOperations1793572800000 } from './migrations/1793572800000-AdminOperations';
import { InitialSchema1792368000000 } from './migrations/1792368000000-InitialSchema';
import { GoogleAuthentication1792454400000 } from './migrations/1792454400000-GoogleAuthentication';
import { AddStoresAndSubscription1792540800000 } from './migrations/1792540800000-AddStoresAndSubscription';
import { AddPostEngagement1792627200000 } from './migrations/1792627200000-AddPostEngagement';
import { AddStoreBrandingAndProducts1792713600000 } from './migrations/1792713600000-AddStoreBrandingAndProducts';
import { AddStoreType1792800000000 } from './migrations/1792800000000-AddStoreType';
import { AddCartAndCartItems1792886400000 } from './migrations/1792886400000-AddCartAndCartItems';
import { AddStoreFeatureFlagsAndDesignSettings1792972800000 } from './migrations/1792972800000-AddStoreFeatureFlagsAndDesignSettings';
import { AddSubscriptionSystem1793059200000 } from './migrations/1793059200000-AddSubscriptionSystem';
import { AddPerformanceIndexesAndDenormalizedCounters1793145600000 } from './migrations/1793145600000-AddPerformanceIndexesAndDenormalizedCounters';
import { AddSeoSystem1793232000000 } from './migrations/1793232000000-AddSeoSystem';
import { AddStoreLocation1793318400000 } from './migrations/1793318400000-AddStoreLocation';
import { AddVerificationBadge1792657536000 } from './migrations/1792657536000-AddVerificationBadge';
import { AddBoostSystem1793400000000 } from './migrations/1793400000000-AddBoostSystem';
import { AddDurableProcessing1793486400000 } from './migrations/1793486400000-AddDurableProcessing';

export function createDatabaseOptions(
  env: DatabaseEnvironment,
): MysqlConnectionOptions {
  return {
    type: 'mysql',
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    database: env.MYSQL_DATABASE,
    username: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    charset: 'utf8mb4_0900_ai_ci',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectTimeout: env.MYSQL_CONNECT_TIMEOUT_MS,
    poolSize: env.MYSQL_POOL_SIZE,
    extra: { waitForConnections: true, queueLimit: 100, enableKeepAlive: true },
    entities: databaseEntities,
    synchronize: false,
    migrationsRun: false,
    // Register generated migrations here for both the CLI and webpack bundles.
    migrations: [
      InitialSchema1792368000000,
      GoogleAuthentication1792454400000,
      AddStoresAndSubscription1792540800000,
      AddPostEngagement1792627200000,
      AddStoreBrandingAndProducts1792713600000,
      AddStoreType1792800000000,
      AddCartAndCartItems1792886400000,
      AddStoreFeatureFlagsAndDesignSettings1792972800000,
      AddSubscriptionSystem1793059200000,
      AddPerformanceIndexesAndDenormalizedCounters1793145600000,
      AddSeoSystem1793232000000,
      AddStoreLocation1793318400000,
      AddVerificationBadge1792657536000,
      AddBoostSystem1793400000000,
      AddDurableProcessing1793486400000,
      AdminOperations1793572800000,
      WebsiteSettings1793659200000,
      AddUserRoles1793745600000,
      OwnerMediaTargets1793832000000,
      StoreLifecycle1793918400000,
      FreeTrialSubscriptions1794004800000,
      UnlimitedPlanStorage1794091200000,
      MaxPostsOnly1794177600000,
      StoreCategoriesAndPlanQuotas1794264000000,
      AddStoreBranches1794350400000,
      AddBranchGoogleMapsUrl1794436800000,
      AddBusinessCategory1794523200000,
      ProductOptions1794609600000,
      AbsoluteProductOptionPrices1794696000000,
      PostLinks1794782400000,
      LbpPriceDisplay1794868800000,
      SectionAllowanceTrading1794955200000,
      StoreStories1795041600000,
      StoryMediaPurpose1795128000000,
      StoreTeam1795214400000,
      ProductSalePrice1795300800000,
      StoreVerificationRequests1795387200000,
      PlanIncludedVerificationBadges1795473600000,
      SeoImageUrls1795560000000,
      FreeTrialThreeDays1795646400000,
      AdminStoreScopes1795732800000,
      ArabicSlugRepair1795819200000,
      UserPhones1795905600000,
      VerificationSettings1795992000000,
      RenewalReminders1796078400000,
    ],
    migrationsTableName: 'schema_migrations',
    // MySQL DDL implicitly commits; never pretend migrations are atomic.
    migrationsTransactionMode: 'none',
    logging: false,
  };
}
