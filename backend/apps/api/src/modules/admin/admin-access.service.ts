import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { adminContext, requireAdmin, type AdminActor } from '@app/database';
import type { AppEnvironment } from '@app/config';

@Injectable()
export class AdminAccessService {
  constructor(
    readonly database: DataSource,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  get allowlist(): string {
    return this.config.get('ADMIN_EMAILS', { infer: true });
  }

  async check(
    actor: AdminActor,
    manager = this.database.manager,
  ): Promise<void> {
    await requireAdmin(manager, actor, this.allowlist);
  }

  async transaction<T>(
    actor: AdminActor,
    action: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.transaction(async (manager) => {
        await this.check(actor, manager);
        return adminContext.run(actor, () => action(manager));
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (
        error instanceof QueryFailedError &&
        error.driverError?.code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException('This identifier is already in use');
      }
      throw new ServiceUnavailableException(
        'Administrative storage is temporarily unavailable',
      );
    }
  }

  reason(actor: AdminActor, reason: string): AdminActor {
    if (
      typeof reason !== 'string' ||
      reason.trim().length < 3 ||
      reason.length > 500
    )
      throw new BadRequestException(
        'A reason between 3 and 500 characters is required',
      );
    return { ...actor, reason: reason.trim() };
  }
}
