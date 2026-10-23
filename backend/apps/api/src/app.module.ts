import { Module } from '@nestjs/common';
import { ConfigurationModule } from '@app/config';
import { DatabaseModule } from '@app/database';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MediaModule } from './modules/media/media.module';
import { ShowcasesModule } from './modules/showcases/showcases.module';
import { UsersModule } from './modules/users/users.module';
import { StorageModule } from '@app/storage';
import { StoresModule } from './modules/stores/stores.module';
import { ProductsModule } from './modules/products/products.module';
import { CartsModule } from './modules/carts/carts.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { UserDashboardModule } from './modules/user-dashboard/user-dashboard.module';
import { SeoModule } from './modules/seo/seo.module';
import { BoostModule } from './modules/boost/boost.module';
import { AdminModule } from './modules/admin/admin.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';

// ShowcasesModule already imports StorageModule and QueueModule, but
// importing StorageModule here keeps the dependency graph explicit for the
// API deployable.
@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    StorageModule,
    AuthModule,
    UsersModule,
    ShowcasesModule,
    MediaModule,
    HealthModule,
    StoresModule,
    ProductsModule,
    CartsModule,
    SubscriptionsModule,
    UserDashboardModule,
    SeoModule,
    BoostModule,
    MonitoringModule,
    AdminModule,
  ],
})
export class AppModule {}
