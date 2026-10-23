import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { QueueModule, RedisModule } from '@app/queue';
import { ObservabilityModule } from '@app/observability';
import { AuthModule } from '../auth/auth.module';
import { MonitoringExceptionFilter } from './monitoring.filter';
import {
  MonitoringController,
  MetricsController,
} from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { PrometheusService } from './prometheus.service';

@Module({
  imports: [AuthModule, RedisModule, QueueModule, ObservabilityModule],
  controllers: [MonitoringController, MetricsController],
  providers: [
    MonitoringService,
    PrometheusService,
    { provide: APP_FILTER, useClass: MonitoringExceptionFilter },
  ],
})
export class MonitoringModule {}
