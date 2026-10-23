import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  createParamDecorator,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { adminContext, isAdminEmail, type AdminActor } from '@app/database';
import type { AppEnvironment } from '@app/config';
import type { AuthenticatedRequest } from '../auth/guards/auth.guards';

export function requestActor(request: AuthenticatedRequest): AdminActor {
  return {
    id: request.user.id,
    requestId:
      typeof request.res?.locals.requestId === 'string'
        ? request.res.locals.requestId
        : randomUUID(),
  };
}

export const Actor = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    requestActor(context.switchToHttp().getRequest<AuthenticatedRequest>()),
);

@Injectable()
export class AdminContextInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (
      !request.user ||
      !isAdminEmail(
        request.user.email,
        this.config.get('ADMIN_EMAILS', { infer: true }),
      )
    )
      return next.handle();
    const actor = requestActor(request);
    const reason: unknown = request.body?.reason ?? request.body?.description;
    if (
      typeof reason === 'string' &&
      reason.length >= 3 &&
      reason.length <= 500
    )
      actor.reason = reason;
    return new Observable((subscriber) =>
      adminContext.run(actor, () => next.handle().subscribe(subscriber)),
    );
  }
}
