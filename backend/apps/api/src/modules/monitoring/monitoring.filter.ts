import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { Request, Response } from 'express';
import { errorTracker, requestMethod, routeTemplate } from '@app/observability';
import { SAFE_SUBSCRIPTION_CODES } from '../../../../../libs/database/src/subscription-errors';

export class SafeValidationException extends BadRequestException {
  constructor(errors: ValidationError[]) {
    const messages: string[] = [];
    const visit = (items: ValidationError[], parent = '') => {
      for (const item of items) {
        const path = /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(item.property)
          ? `${parent}${item.property}`.slice(0, 100)
          : 'field';
        for (const constraint of Object.keys(item.constraints ?? {})) {
          if (messages.length < 20)
            messages.push(
              constraint === 'whitelistValidation'
                ? 'Unexpected field'
                : `${path}: invalid ${constraint}`,
            );
        }
        if (item.children?.length && messages.length < 20)
          visit(item.children, `${path}.`);
      }
    };
    visit(errors);
    super(messages.length ? messages : ['Invalid request fields']);
  }
}

const MESSAGES: Record<number, string> = {
  400: 'Invalid request',
  401: 'Please sign in again',
  403: 'Access is not allowed',
  404: 'Resource not found',
  409: 'This action conflicts with the current state',
  413: 'Request exceeds the size limit',
  415: 'Unsupported content type',
  429: 'Too many requests; try again shortly',
};

// Only known subscription codes may reach the client. Everything else keeps
// the generic status message so driver details and internal text never leak.
function safeBusinessCode(error: unknown, status: number): string | undefined {
  if (status >= 500 || !(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  if (!body || typeof body !== 'object') return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' && SAFE_SUBSCRIPTION_CODES.has(code)
    ? code
    : undefined;
}

@Catch()
export class MonitoringExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const parser =
      error instanceof Error
        ? (error as Error & { type?: string; status?: number })
        : null;
    const parserStatus =
      parser?.type === 'entity.too.large' && parser.status === 413
        ? 413
        : parser?.type === 'encoding.unsupported' && parser.status === 415
          ? 415
          : null;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : (parserStatus ?? 500);
    const requestId =
      typeof response.locals.requestId === 'string'
        ? response.locals.requestId
        : undefined;
    const code = safeBusinessCode(error, status);
    if (status >= 500)
      errorTracker.capture(
        'api',
        `${requestMethod(request)} ${routeTemplate(request)}`,
        'HTTP_FAILURE',
        'error',
        requestId,
      );
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof SafeValidationException) {
      response
        .status(status)
        .json({ ...(error.getResponse() as object), requestId });
      return;
    }
    if (
      status === 503 &&
      request.path === '/api/v1/health/ready' &&
      error instanceof HttpException
    ) {
      const body = error.getResponse() as {
        checks?: { mysql?: string; redis?: string };
      };
      response.status(status).json({
        status: 'error',
        checks: {
          mysql: body.checks?.mysql === 'up' ? 'up' : 'down',
          redis: body.checks?.redis === 'up' ? 'up' : 'down',
        },
        requestId,
      });
      return;
    }
    response.status(status).json({
      statusCode: status,
      message:
        status >= 500
          ? 'Service temporarily unavailable'
          : (MESSAGES[status] ?? 'Unable to complete this request'),
      ...(code ? { code } : {}),
      requestId,
    });
  }
}
