import {
  Controller,
  Get,
  Header,
  Headers,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { SessionGuard, AdminGuard } from '../auth/guards/auth.guards';
import { MonitoringService } from './monitoring.service';
import { PrometheusService } from './prometheus.service';

export class MonitoringWindowDto {
  @IsOptional()
  @IsIn(['1h', '24h', '7d'])
  window: '1h' | '24h' | '7d' = '1h';
}

@Controller('admin/monitoring')
@UseGuards(SessionGuard, AdminGuard)
export class MonitoringController {
  constructor(
    private readonly monitoring: MonitoringService,
    private readonly prometheus: PrometheusService,
  ) {}

  @Get('health')
  health() {
    return this.monitoring.health();
  }

  @Get('vps')
  vps(@Query() dto: MonitoringWindowDto) {
    return this.prometheus.vps(dto.window);
  }

  @Get('alerts')
  alerts() {
    return this.prometheus.alerts();
  }
}

@Controller('internal/metrics')
export class MetricsController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(@Headers('authorization') authorization?: string) {
    this.monitoring.assertScrape(authorization);
    return this.monitoring.metrics();
  }
}
