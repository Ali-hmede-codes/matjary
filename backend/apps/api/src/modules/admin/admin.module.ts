import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { StorageModule } from '@app/storage';
import { QueueModule } from '@app/queue';
import { AuthModule } from '../auth/auth.module';
import { SeoModule } from '../seo/seo.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { BoostModule } from '../boost/boost.module';
import { ShowcasesModule } from '../showcases/showcases.module';
import { AdminAccessService } from './admin-access.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminQueriesService } from './admin-queries.service';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminBusinessController } from './admin-business.controller';
import { AdminPageController } from './admin-page.controller';
import { AdminContextInterceptor } from './admin-context.interceptor';
import { WebsiteSettingsService } from './website-settings.service';
import {
  AdminWebsiteSettingsController,
  PublicWebsiteSettingsController,
} from './website-settings.controller';

@Module({
  imports: [
    AuthModule,
    SeoModule,
    SubscriptionsModule,
    BoostModule,
    ShowcasesModule,
    StorageModule,
    QueueModule,
  ],
  controllers: [
    AdminWebsiteSettingsController,
    PublicWebsiteSettingsController,
    AdminPageController,
    AdminBusinessController,
    AdminCatalogController,
  ],
  providers: [
    WebsiteSettingsService,
    AdminAccessService,
    AdminQueriesService,
    AdminCatalogService,
    { provide: APP_INTERCEPTOR, useClass: AdminContextInterceptor },
  ],
})
export class AdminModule {}
