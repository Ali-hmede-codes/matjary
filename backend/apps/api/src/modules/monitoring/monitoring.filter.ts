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

// A 5xx is otherwise unexplainable in production: SafeLogger drops every
// message so driver text can never reach a log file, and the error event it
// records carries only a route fingerprint. A TypeError, EACCES and a MySQL
// ER_LOCK_WAIT_TIMEOUT therefore look identical while the site is down. The
// error class, its machine-readable code (filesystem errno, MySQL/Redis code)
// and the stack's function names identify the failing component without any
// message, SQL text, bound parameters or request data.
const STACK_FRAME = /^\s*at\s+(?:async\s+|new\s+)?([^\s(]+)/;

function failureDetail(error: unknown): {
  name: string;
  code?: string;
  frames: string[];
} {
  if (!(error instanceof Error)) return { name: 'non_error', frames: [] };
  const candidate =
    (error as { code?: unknown }).code ??
    (error as { driverError?: { code?: unknown } }).driverError?.code;
  return {
    name: (error.name || 'Error').slice(0, 40),
    ...(typeof candidate === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(candidate)
      ? { code: candidate }
      : {}),
    frames: (error.stack ?? '')
      .split('\n')
      .slice(1, 9)
      .map((line) => STACK_FRAME.exec(line)?.[1])
      .filter((frame): frame is string => Boolean(frame))
      .map((frame) => frame.slice(0, 80)),
  };
}

let failureWindow = 0;
let failureCount = 0;

// A failing dependency can reject thousands of requests per second, so the
// diagnostics are throttled exactly like error events are.
function logFailure(detail: Record<string, unknown>): void {
  const window = Math.floor(Date.now() / 1000);
  if (window !== failureWindow) {
    failureWindow = window;
    failureCount = 0;
  }
  if (++failureCount > 10) return;
  process.stderr.write(
    JSON.stringify({ event: 'http_failure', ...detail }) + '\n',
  );
}

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
    if (status >= 500) {
      const operation = `${requestMethod(request)} ${routeTemplate(request)}`;
      errorTracker.capture(
        'api',
        operation,
        'HTTP_FAILURE',
        'error',
        requestId,
      );
      logFailure({
        operation,
        status,
        ...(requestId ? { requestId } : {}),
        ...failureDetail(error),
      });
    }
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
