import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigurationModule, type AppEnvironment } from '@app/config';
import { createDatabaseOptions } from './database.options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigurationModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnvironment, true>) => ({
        ...createDatabaseOptions({
          MYSQL_HOST: config.get('MYSQL_HOST', { infer: true }),
          MYSQL_PORT: config.get('MYSQL_PORT', { infer: true }),
          MYSQL_DATABASE: config.get('MYSQL_DATABASE', { infer: true }),
          MYSQL_USER: config.get('MYSQL_USER', { infer: true }),
          MYSQL_PASSWORD: config.get('MYSQL_PASSWORD', { infer: true }),
          MYSQL_POOL_SIZE: config.get('MYSQL_POOL_SIZE', { infer: true }),
          MYSQL_CONNECT_TIMEOUT_MS: config.get('MYSQL_CONNECT_TIMEOUT_MS', {
            infer: true,
          }),
        }),
        retryAttempts: 3,
        retryDelay: 2000,
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
