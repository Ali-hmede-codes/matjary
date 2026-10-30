import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import {
  adminContext,
  adminStoreScope,
  requireAdmin,
  type AdminActor,
  type AdminStoreScope,
} from '@app/database';
import type { AppEnvironment } from '@app/config';

export type AdminScopeLevel = 'all' | 'any';

@Injectable()
export class AdminAccessService {
  constructor(
    readonly database: DataSource,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  get allowlist(): string {
    return this.config.get('ADMIN_EMAILS', { infer: true });
  }

  // Platform-wide operations keep the default; panel reads opt into `any` and
  // filter their records through the returned scope.
  async check(
    actor: AdminActor,
    manager = this.database.manager,
    scope: AdminScopeLevel = 'all',
  ): Promise<void> {
    await requireAdmin(manager, actor, this.allowlist, { scope });
  }

  async panel(
    actor: AdminActor,
    manager = this.database.manager,
  ): Promise<{ scope: AdminStoreScope }> {
    const user = await requireAdmin(manager, actor, this.allowlist, {
      scope: 'any',
    });
    return { scope: await adminStoreScope(manager, user) };
  }

  async transaction<T>(
    actor: AdminActor,
    action: (manager: EntityManager) => Promise<T>,
    scope: AdminScopeLevel = 'all',
  ): Promise<T> {
    try {
      return await this.database.transaction(async (manager) => {
        await this.check(actor, manager, scope);
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

  // Answers "not found" for a shop outside the actor's scope, so a store-scoped
  // administrator cannot probe which other shops exist.
  assertStoreInScope(
    scope: AdminStoreScope,
    storeId: string | null | undefined,
  ): void {
    if (scope.all) return;
    if (!storeId || !scope.storeIds.includes(storeId))
      throw new NotFoundException('Store not found');
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
